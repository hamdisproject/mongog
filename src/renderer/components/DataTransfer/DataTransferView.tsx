import { useEffect, useMemo, useState } from 'react';
import type {
  ConnectionCopyDataset,
  DataConflictMode,
  DataEmptyCellPolicy,
  DataFileDescriptor,
  DataFilePreview,
  DataMetadataSelection,
  DataRowErrorPolicy,
  FileColumnMapping,
} from '../../../shared/domain/index.js';
import { useConnectionStore } from '../../stores/connections.js';
import { useDataTransferStore } from '../../stores/data-transfer.js';
import { CollectionCriteriaEditor } from '../Results/CollectionCriteriaEditor.js';
import { parseEjson, renderBson } from '../../../shared/ejson/index.js';
import { useSettingsStore } from '../../stores/settings.js';
import { orderCatalogNames } from '../../catalog-order.js';

type Mode = 'file-import' | 'connection-copy';

interface FileDatasetDraft {
  key: string;
  file: DataFileDescriptor;
  sheet?: string;
  selected: boolean;
  targetDatabase: string;
  targetCollection: string;
  preview?: DataFilePreview;
  mappings: FileColumnMapping[];
  delimiter?: string;
  emptyCellPolicy: DataEmptyCellPolicy;
  conflictMode: DataConflictMode;
  rowErrorPolicy: DataRowErrorPolicy;
}

const defaultMetadata = (): DataMetadataSelection => ({
  collectionOptions: false,
  validationRules: false,
  indexes: false,
});

export function DataTransferView() {
  const profiles = useConnectionStore((state) => state.profiles);
  const connected = useConnectionStore((state) => state.connected);
  const launch = useDataTransferStore((state) => state.launch);
  const launchVersion = useDataTransferStore((state) => state.launchVersion);
  const applyProgress = useDataTransferStore((state) => state.applyProgress);
  const bsonMode = useSettingsStore((state) => state.settings.ejson.defaultMode);
  const databaseOrder = useSettingsStore((state) => state.settings.catalog.databaseOrder);
  const collectionOrder = useSettingsStore((state) => state.settings.catalog.collectionOrder);
  const connectedProfiles = useMemo(() => profiles.filter((profile) => connected[profile.id]), [profiles, connected]);
  const writableProfiles = useMemo(() => connectedProfiles.filter((profile) => !profile.readOnly), [connectedProfiles]);

  const [mode, setMode] = useState<Mode>('file-import');
  const [sourceConnectionId, setSourceConnectionId] = useState('');
  const [targetConnectionId, setTargetConnectionId] = useState('');
  const [sourceDatabases, setSourceDatabases] = useState<string[]>([]);
  const [sourceDatabase, setSourceDatabase] = useState('');
  const [sourceCollections, setSourceCollections] = useState<string[]>([]);
  const [copyDatasets, setCopyDatasets] = useState<ConnectionCopyDataset[]>([]);
  const [activeCopyIndex, setActiveCopyIndex] = useState(0);
  const [fileDatasets, setFileDatasets] = useState<FileDatasetDraft[]>([]);
  const [activeFileIndex, setActiveFileIndex] = useState(0);
  const [previewDocuments, setPreviewDocuments] = useState<string[]>([]);
  const [exactCount, setExactCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterError, setFilterError] = useState<string | null>(null);
  const orderedSourceDatabases = useMemo(
    () => orderCatalogNames(sourceDatabases, databaseOrder),
    [sourceDatabases, databaseOrder],
  );
  const orderedSourceCollections = useMemo(
    () => orderCatalogNames(sourceCollections, collectionOrder),
    [sourceCollections, collectionOrder],
  );

  useEffect(() => {
    const nextMode = launch.mode ?? mode;
    setMode(nextMode);
    if (launch.sourceConnectionId) setSourceConnectionId(launch.sourceConnectionId);
    if (launch.targetConnectionId) setTargetConnectionId(launch.targetConnectionId);
    if (launch.sourceDatabase && launch.sourceCollection) {
      setCopyDatasets([makeCopyDataset(
        launch.sourceDatabase,
        launch.sourceCollection,
        launch.targetConnectionId ? profileDefaultDb(profiles, launch.targetConnectionId) : launch.sourceDatabase,
        launch.filterSource ?? '{}',
      )]);
      setActiveCopyIndex(0);
    }
  }, [launchVersion]);

  useEffect(() => {
    if (!targetConnectionId && writableProfiles[0]) setTargetConnectionId(writableProfiles[0].id);
    if (!sourceConnectionId && connectedProfiles[0]) setSourceConnectionId(connectedProfiles[0].id);
  }, [connectedProfiles, sourceConnectionId, targetConnectionId, writableProfiles]);

  useEffect(() => {
    if (!sourceConnectionId) return;
    setSourceDatabase('');
    setSourceCollections([]);
    void window.mongog.query.listDatabases(sourceConnectionId).then((values) => {
      const names = values.map((value) => value.name).filter((name) => !['admin', 'config', 'local'].includes(name));
      setSourceDatabases(names);
      const orderedNames = orderCatalogNames(
        names,
        useSettingsStore.getState().settings.catalog.databaseOrder,
      );
      const preferred = launch.sourceDatabase && orderedNames.includes(launch.sourceDatabase)
        ? launch.sourceDatabase
        : orderedNames[0] ?? '';
      setSourceDatabase(preferred);
    }).catch((cause) => setError(errorMessage(cause)));
  }, [sourceConnectionId]);

  useEffect(() => {
    if (!sourceConnectionId || !sourceDatabase) return;
    void window.mongog.query.listCollections(sourceConnectionId, sourceDatabase)
      .then((values) => setSourceCollections(values.filter((value) => value.type !== 'view').map((value) => value.name)))
      .catch((cause) => setError(errorMessage(cause)));
  }, [sourceConnectionId, sourceDatabase]);

  const activeCopy = copyDatasets[activeCopyIndex];
  const activeFile = fileDatasets[activeFileIndex];

  const chooseFiles = async () => {
    if (!targetConnectionId) return;
    setBusy(true);
    setError(null);
    try {
      const files = await window.mongog.dataTransfer.selectFiles(targetConnectionId);
      const defaultDb = launch.sourceDatabase || profileDefaultDb(profiles, targetConnectionId);
      const next = files.flatMap<FileDatasetDraft>((file) => {
        const sheets = file.format === 'xlsx' ? file.sheets : [undefined];
        return sheets.map((sheet) => ({
          key: `${file.token}:${sheet ?? 'csv'}`,
          file,
          ...(sheet ? { sheet } : {}),
          selected: true,
          targetDatabase: defaultDb,
          targetCollection: safeCollectionName(sheet ?? file.name.replace(/\.[^.]+$/, '')),
          mappings: [],
          emptyCellPolicy: 'omit',
          conflictMode: 'insert-stop',
          rowErrorPolicy: 'stop',
        }));
      });
      setFileDatasets(next);
      setActiveFileIndex(0);
      if (next[0]) await previewFileDraft(next[0], 0, next);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const previewFileDraft = async (draft: FileDatasetDraft, index: number, current = fileDatasets) => {
    setBusy(true);
    setError(null);
    try {
      const preview = await window.mongog.dataTransfer.previewFile({
        targetConnectionId,
        fileToken: draft.file.token,
        ...(draft.sheet ? { sheet: draft.sheet } : {}),
        ...(draft.delimiter ? { delimiter: draft.delimiter } : {}),
      });
      const next = [...current];
      next[index] = { ...draft, preview, mappings: draft.mappings.length ? draft.mappings : preview.suggestedMappings, delimiter: preview.delimiter };
      setFileDatasets(next);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const addCollection = (collection: string) => {
    const exists = copyDatasets.some((dataset) => dataset.sourceDatabase === sourceDatabase && dataset.sourceCollection === collection);
    if (exists) return;
    const next = [...copyDatasets, makeCopyDataset(
      sourceDatabase,
      collection,
      profileDefaultDb(profiles, targetConnectionId) || sourceDatabase,
      '{}',
    )];
    setCopyDatasets(next);
    setActiveCopyIndex(next.length - 1);
    setPreviewDocuments([]);
    setExactCount(null);
  };

  const updateCopy = (patch: Partial<ConnectionCopyDataset>) => {
    setCopyDatasets((current) => current.map((dataset, index) => index === activeCopyIndex ? { ...dataset, ...patch } : dataset));
  };

  const previewCopy = async (countOnly = false) => {
    if (!activeCopy || filterError) return;
    setBusy(true);
    setError(null);
    try {
      const input = {
        connectionId: sourceConnectionId,
        database: activeCopy.sourceDatabase,
        collection: activeCopy.sourceCollection,
        filterSource: activeCopy.filterSource || '{}',
      };
      if (countOnly) {
        const result = await window.mongog.dataTransfer.countCollection(input);
        setExactCount(result.count);
      } else {
        const result = await window.mongog.dataTransfer.previewCollection(input);
        setPreviewDocuments(result.documents);
      }
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      if (mode === 'file-import') {
        const selected = fileDatasets.filter((dataset) => dataset.selected);
        if (!selected.length || selected.some((dataset) => !dataset.preview || !dataset.mappings.length)) {
          throw new Error('Preview and confirm mappings for every selected file or sheet.');
        }
        const result = await window.mongog.dataTransfer.startFileImport({
          targetConnectionId,
          datasets: selected.map((dataset) => ({
            fileToken: dataset.file.token,
            ...(dataset.sheet ? { sheet: dataset.sheet } : {}),
            ...(dataset.delimiter ? { delimiter: dataset.delimiter } : {}),
            targetDatabase: dataset.targetDatabase,
            targetCollection: dataset.targetCollection,
            mappings: dataset.mappings,
            emptyCellPolicy: dataset.emptyCellPolicy,
            conflictMode: dataset.conflictMode,
            rowErrorPolicy: dataset.rowErrorPolicy,
            upsertFields: ['_id'],
          })),
        });
        applyProgress(pendingProgress(result.jobId, 'file-import', [targetConnectionId], selected.length));
      } else {
        if (!copyDatasets.length || filterError) throw new Error('Select at least one collection and fix filter errors.');
        const result = await window.mongog.dataTransfer.startConnectionCopy({
          sourceConnectionId,
          targetConnectionId,
          datasets: copyDatasets,
        });
        applyProgress(pendingProgress(result.jobId, 'connection-copy', [...new Set([sourceConnectionId, targetConnectionId])], copyDatasets.length));
      }
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={styles.root}>
      <header style={styles.header}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18 }}>Data Transfer</h2>
          <div style={styles.muted}>Import files or copy data between connections. Source data is always read-only and is never deleted.</div>
        </div>
        <button type="button" style={styles.primaryButton} disabled={busy} onClick={() => void start()}>
          {busy ? 'Working…' : mode === 'file-import' ? 'Start import' : 'Start copy'}
        </button>
      </header>

      <div style={styles.modeRow}>
        <ModeCard active={mode === 'file-import'} title="Files → MongoDB" detail="CSV or Excel .xlsx, multiple sheets" onClick={() => setMode('file-import')} />
        <ModeCard active={mode === 'connection-copy'} title="MongoDB → MongoDB" detail="Filtered, multi-collection copy" onClick={() => setMode('connection-copy')} />
      </div>

      {error && <div style={styles.error}>{error}</div>}

      {mode === 'file-import' ? (
        <div style={styles.contentGrid}>
          <section style={styles.sidebarPanel}>
            <Field label="Target connection">
              <select style={styles.input} value={targetConnectionId} onChange={(event) => setTargetConnectionId(event.target.value)}>
                <option value="">Select target…</option>
                {writableProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
              </select>
            </Field>
            <button type="button" style={styles.secondaryButton} disabled={!targetConnectionId || busy} onClick={() => void chooseFiles()}>Choose CSV / XLSX files…</button>
            <div style={styles.datasetList}>
              {fileDatasets.map((dataset, index) => (
                <button key={dataset.key} type="button" style={{ ...styles.datasetRow, ...(index === activeFileIndex ? styles.datasetActive : {}) }} onClick={() => setActiveFileIndex(index)}>
                  <input type="checkbox" checked={dataset.selected} onClick={(event) => event.stopPropagation()} onChange={(event) => setFileDatasets((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, selected: event.target.checked } : item))} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{dataset.file.name}{dataset.sheet ? ` / ${dataset.sheet}` : ''}</span>
                </button>
              ))}
            </div>
          </section>
          <section style={styles.mainPanel}>
            {activeFile ? <FileDatasetEditor draft={activeFile} busy={busy} onChange={(patch) => setFileDatasets((current) => current.map((item, index) => index === activeFileIndex ? { ...item, ...patch } : item))} onPreview={() => void previewFileDraft(activeFile, activeFileIndex)} /> : <Empty message="Choose one or more CSV or .xlsx files." />}
          </section>
        </div>
      ) : (
        <div style={styles.contentGrid}>
          <section style={styles.sidebarPanel}>
            <Field label="Source connection (read only)">
              <select style={styles.input} value={sourceConnectionId} onChange={(event) => setSourceConnectionId(event.target.value)}>
                <option value="">Select source…</option>
                {connectedProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
              </select>
            </Field>
            <Field label="Target connection (writes allowed)">
              <select style={styles.input} value={targetConnectionId} onChange={(event) => setTargetConnectionId(event.target.value)}>
                <option value="">Select target…</option>
                {writableProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
              </select>
            </Field>
            <Field label="Source database">
              <select style={styles.input} value={sourceDatabase} onChange={(event) => setSourceDatabase(event.target.value)}>
                {orderedSourceDatabases.map((database) => <option key={database}>{database}</option>)}
              </select>
            </Field>
            <div style={styles.collectionPicker}>
              {orderedSourceCollections.map((collection) => {
                const selected = copyDatasets.some((dataset) => dataset.sourceDatabase === sourceDatabase && dataset.sourceCollection === collection);
                return <button key={collection} type="button" style={styles.collectionRow} disabled={selected} onClick={() => addCollection(collection)}><span>{selected ? '✓' : '+'}</span>{collection}</button>;
              })}
            </div>
            <div style={styles.datasetList}>
              {copyDatasets.map((dataset, index) => <button key={`${dataset.sourceDatabase}.${dataset.sourceCollection}`} type="button" style={{ ...styles.datasetRow, ...(index === activeCopyIndex ? styles.datasetActive : {}) }} onClick={() => { setActiveCopyIndex(index); setPreviewDocuments([]); setExactCount(null); }}><span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{dataset.sourceDatabase}.{dataset.sourceCollection}</span><span onClick={(event) => { event.stopPropagation(); setCopyDatasets((current) => current.filter((_, itemIndex) => itemIndex !== index)); }}>×</span></button>)}
            </div>
          </section>
          <section style={styles.mainPanel}>
            {activeCopy ? (
              <div style={{ display: 'grid', gap: 14 }}>
                <div style={styles.twoColumns}>
                  <Field label="Target database"><input style={styles.input} value={activeCopy.targetDatabase} onChange={(event) => updateCopy({ targetDatabase: event.target.value })} /></Field>
                  <Field label="Target collection"><input style={styles.input} value={activeCopy.targetCollection} onChange={(event) => updateCopy({ targetCollection: event.target.value })} /></Field>
                </div>
                <CollectionCriteriaEditor tabId={`transfer-${activeCopyIndex}`} kind="filter" label="Source filter" value={activeCopy.filterSource} connectionId={sourceConnectionId} database={activeCopy.sourceDatabase} collection={activeCopy.sourceCollection} placeholder="{ status: 'active' }" onChange={(value) => { updateCopy({ filterSource: value }); setExactCount(null); }} onApply={() => void previewCopy()} onValidationChange={(_kind, message) => setFilterError(message)} />
                {filterError && <div style={styles.error}>{filterError}</div>}
                <div style={{ display: 'flex', gap: 8 }}><button style={styles.secondaryButton} disabled={busy || Boolean(filterError)} onClick={() => void previewCopy()}>Preview 20</button><button style={styles.secondaryButton} disabled={busy || Boolean(filterError)} onClick={() => void previewCopy(true)}>Calculate count</button>{exactCount !== null && <span style={styles.count}>{exactCount.toLocaleString()} matching document(s)</span>}</div>
                <TransferOptions dataset={activeCopy} onChange={updateCopy} />
                <div style={styles.previewBox}>{previewDocuments.length ? previewDocuments.map((document, index) => <pre key={index} style={styles.documentPreview}>{renderBson(parseEjson({ ejson: document, byteSize: document.length, truncated: false }), bsonMode, true)}</pre>) : <span style={styles.muted}>Preview is optional. Projection is never applied; all BSON fields are copied losslessly.</span>}</div>
              </div>
            ) : <Empty message="Add one or more source collections. You can switch databases and keep adding collections." />}
          </section>
        </div>
      )}
    </div>
  );
}

function FileDatasetEditor({ draft, busy, onChange, onPreview }: { draft: FileDatasetDraft; busy: boolean; onChange: (patch: Partial<FileDatasetDraft>) => void; onPreview: () => void }) {
  return <div style={{ display: 'grid', gap: 14 }}>
    <div style={styles.twoColumns}>
      <Field label="Target database"><input style={styles.input} value={draft.targetDatabase} onChange={(event) => onChange({ targetDatabase: event.target.value })} /></Field>
      <Field label="Target collection"><input style={styles.input} value={draft.targetCollection} onChange={(event) => onChange({ targetCollection: event.target.value })} /></Field>
    </div>
    {draft.file.format === 'csv' && <Field label="CSV delimiter"><input style={{ ...styles.input, width: 80 }} maxLength={1} value={draft.delimiter ?? ''} placeholder="Auto" onChange={(event) => onChange({ delimiter: event.target.value || undefined, preview: undefined })} /></Field>}
    <div><button type="button" style={styles.secondaryButton} disabled={busy} onClick={onPreview}>{draft.preview ? 'Refresh preview' : 'Preview & infer types'}</button></div>
    {draft.preview && <>
      <div style={styles.twoColumns}>
        <Field label="Empty cells"><select style={styles.input} value={draft.emptyCellPolicy} onChange={(event) => onChange({ emptyCellPolicy: event.target.value as DataEmptyCellPolicy })}><option value="omit">Omit field</option><option value="null">null</option><option value="empty-string">Empty string</option></select></Field>
        <Field label="Conflict"><ConflictSelect value={draft.conflictMode} onChange={(conflictMode) => onChange({ conflictMode })} /></Field>
      </div>
      <Field label="Row errors"><RowErrorSelect value={draft.rowErrorPolicy} onChange={(rowErrorPolicy) => onChange({ rowErrorPolicy })} /></Field>
      <div style={styles.mappingTable}>
        <div style={styles.mappingHeader}><span>Use</span><span>Source</span><span>Target field</span><span>BSON type</span><span>Literal</span></div>
        {draft.mappings.map((mapping, index) => <div key={mapping.sourceColumn} style={styles.mappingRow}><input type="checkbox" checked={mapping.included} onChange={(event) => onChange({ mappings: updateAt(draft.mappings, index, { included: event.target.checked }) })} /><code>{mapping.sourceColumn}</code><input style={styles.input} value={mapping.targetField} onChange={(event) => onChange({ mappings: updateAt(draft.mappings, index, { targetField: event.target.value }) })} /><select style={styles.input} value={mapping.type} onChange={(event) => onChange({ mappings: updateAt(draft.mappings, index, { type: event.target.value as FileColumnMapping['type'] }) })}>{['string','boolean','int32','long','double','decimal128','date','objectId','json-ejson'].map((type) => <option key={type}>{type}</option>)}</select><input type="checkbox" checked={Boolean(mapping.literalFieldName)} title="Keep dots as literal field-name characters" onChange={(event) => onChange({ mappings: updateAt(draft.mappings, index, { literalFieldName: event.target.checked }) })} /></div>)}
      </div>
      <div style={styles.previewTable}><table><thead><tr>{draft.preview.headers.map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{draft.preview.rows.slice(0, 8).map((row, index) => <tr key={index}>{draft.preview!.headers.map((header) => <td key={header}>{String(row[header] ?? '')}</td>)}</tr>)}</tbody></table></div>
    </>}
  </div>;
}

function TransferOptions({ dataset, onChange }: { dataset: ConnectionCopyDataset; onChange: (patch: Partial<ConnectionCopyDataset>) => void }) {
  const metadata = dataset.metadata;
  return <div style={styles.optionsBox}>
    <div style={styles.twoColumns}><Field label="Conflict"><ConflictSelect value={dataset.conflictMode} onChange={(conflictMode) => onChange({ conflictMode })} /></Field><Field label="Write errors"><RowErrorSelect value={dataset.rowErrorPolicy} onChange={(rowErrorPolicy) => onChange({ rowErrorPolicy })} /></Field></div>
    <Field label="Upsert match fields"><input style={styles.input} value={dataset.upsertFields.join(', ')} onChange={(event) => onChange({ upsertFields: event.target.value.split(',').map((value) => value.trim()).filter(Boolean) })} /><span style={styles.hint}>Non-_id fields require an exact matching unique target index.</span></Field>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}><Check label="Collection options" value={metadata.collectionOptions} onChange={(value) => onChange({ metadata: { ...metadata, collectionOptions: value } })} /><Check label="Validation rules" value={metadata.validationRules} onChange={(value) => onChange({ metadata: { ...metadata, validationRules: value } })} /><Check label="Indexes" value={metadata.indexes} onChange={(value) => onChange({ metadata: { ...metadata, indexes: value } })} /></div>
    {(metadata.validationRules || metadata.indexes) && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}><Check label="Replace target validator (explicit)" value={Boolean(metadata.replaceTargetValidator)} onChange={(value) => onChange({ metadata: { ...metadata, replaceTargetValidator: value } })} /><Check label="Drop & recreate conflicting target index (explicit)" value={Boolean(metadata.recreateConflictingIndexes)} onChange={(value) => onChange({ metadata: { ...metadata, recreateConflictingIndexes: value } })} /></div>}
  </div>;
}

function ConflictSelect({ value, onChange }: { value: DataConflictMode; onChange: (value: DataConflictMode) => void }) { return <select style={styles.input} value={value} onChange={(event) => onChange(event.target.value as DataConflictMode)}><option value="insert-stop">Insert & stop</option><option value="insert-skip">Insert & skip duplicates</option><option value="replace-upsert">Replace/upsert</option><option value="merge-upsert">Merge/upsert</option></select>; }
function RowErrorSelect({ value, onChange }: { value: DataRowErrorPolicy; onChange: (value: DataRowErrorPolicy) => void }) { return <select style={styles.input} value={value} onChange={(event) => onChange(event.target.value as DataRowErrorPolicy)}><option value="stop">Stop</option><option value="skip">Skip row and report</option></select>; }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label style={styles.field}><span style={styles.label}>{label}</span>{children}</label>; }
function Check({ label, value, onChange }: { label: string; value: boolean; onChange: (value: boolean) => void }) { return <label style={styles.check}><input type="checkbox" checked={value} onChange={(event) => onChange(event.target.checked)} />{label}</label>; }
function ModeCard({ active, title, detail, onClick }: { active: boolean; title: string; detail: string; onClick: () => void }) { return <button type="button" style={{ ...styles.modeCard, ...(active ? styles.modeActive : {}) }} onClick={onClick}><strong>{title}</strong><span style={styles.muted}>{detail}</span></button>; }
function Empty({ message }: { message: string }) { return <div style={styles.empty}>{message}</div>; }

function makeCopyDataset(sourceDatabase: string, sourceCollection: string, targetDatabase: string, filterSource: string): ConnectionCopyDataset { return { sourceDatabase, sourceCollection, targetDatabase: targetDatabase || sourceDatabase, targetCollection: sourceCollection, filterSource, conflictMode: 'insert-stop', rowErrorPolicy: 'stop', upsertFields: ['_id'], metadata: defaultMetadata() }; }
function profileDefaultDb(profiles: Array<{ id: string; defaultDatabase?: string | null }>, id: string): string { return profiles.find((profile) => profile.id === id)?.defaultDatabase || 'test'; }
function safeCollectionName(value: string): string { return value.trim().replace(/[\0$]/g, '_').slice(0, 120) || 'imported_data'; }
function updateAt<T>(values: T[], index: number, patch: Partial<T>): T[] { return values.map((value, current) => current === index ? { ...value, ...patch } : value); }
function errorMessage(error: unknown): string { return error && typeof error === 'object' && 'message' in error ? String((error as { message: unknown }).message) : String(error); }
function pendingProgress(jobId: string, kind: 'file-import' | 'connection-copy', connectionIds: string[], datasetCount: number) { return { jobId, kind, connectionIds, datasetCount, datasetIndex: 0, status: 'queued' as const, phase: 'preflight' as const, rowsRead: 0, inserted: 0, updated: 0, skipped: 0, errors: 0, message: 'Queued…' }; }

const styles: Record<string, React.CSSProperties> = {
  root: { flex: 1, minWidth: 0, minHeight: 0, overflow: 'auto', background: 'var(--color-app)', color: 'var(--color-text)', padding: 18 },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginBottom: 14 },
  modeRow: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10, marginBottom: 14 },
  modeCard: { display: 'grid', textAlign: 'left', gap: 4, padding: 12, border: '1px solid var(--color-border)', borderRadius: 7, background: 'var(--color-panel)', color: 'var(--color-text)', cursor: 'pointer' },
  modeActive: { borderColor: 'var(--color-accent)', boxShadow: 'inset 0 0 0 1px var(--color-accent)' },
  contentGrid: { display: 'grid', gridTemplateColumns: 'minmax(230px, 300px) minmax(0, 1fr)', gap: 12, minHeight: 520 },
  sidebarPanel: { border: '1px solid var(--color-border)', borderRadius: 7, background: 'var(--color-panel)', padding: 12, display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 },
  mainPanel: { border: '1px solid var(--color-border)', borderRadius: 7, background: 'var(--color-panel)', padding: 14, minWidth: 0, overflow: 'auto' },
  field: { display: 'grid', gap: 5, minWidth: 0 }, label: { fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)' }, hint: { fontSize: 10, color: 'var(--color-text-faint)' }, muted: { color: 'var(--color-text-muted)', fontSize: 12 }, count: { alignSelf: 'center', color: 'var(--color-success)', fontSize: 12 },
  input: { minWidth: 0, width: '100%', boxSizing: 'border-box', border: '1px solid var(--color-border-strong)', borderRadius: 4, padding: '7px 8px', background: 'var(--color-input)', color: 'var(--color-text)', fontSize: 12 },
  primaryButton: { border: 0, borderRadius: 5, background: 'var(--color-accent)', color: 'white', padding: '8px 14px', cursor: 'pointer', fontWeight: 600 },
  secondaryButton: { border: '1px solid var(--color-border-strong)', borderRadius: 4, background: 'var(--color-input)', color: 'var(--color-text)', padding: '6px 9px', cursor: 'pointer', fontSize: 12 },
  datasetList: { display: 'grid', gap: 3, overflow: 'auto', maxHeight: 220 }, datasetRow: { display: 'flex', alignItems: 'center', gap: 7, width: '100%', padding: '6px 7px', border: 0, borderRadius: 4, background: 'transparent', color: 'var(--color-text-muted)', cursor: 'pointer', textAlign: 'left' }, datasetActive: { background: 'var(--color-selection)', color: 'var(--color-text)' },
  collectionPicker: { display: 'grid', gap: 2, maxHeight: 180, overflow: 'auto', borderTop: '1px solid var(--color-border)', borderBottom: '1px solid var(--color-border)', padding: '5px 0' }, collectionRow: { display: 'flex', gap: 7, border: 0, background: 'transparent', color: 'var(--color-text-muted)', padding: '5px', cursor: 'pointer', textAlign: 'left' },
  twoColumns: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }, optionsBox: { display: 'grid', gap: 12, border: '1px solid var(--color-border)', borderRadius: 6, padding: 12, background: 'var(--color-panel-raised)' }, check: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--color-text-muted)' },
  previewBox: { border: '1px solid var(--color-border)', borderRadius: 5, padding: 10, maxHeight: 300, overflow: 'auto', background: 'var(--color-input)' }, documentPreview: { margin: '0 0 10px', paddingBottom: 10, borderBottom: '1px solid var(--color-border)', whiteSpace: 'pre-wrap', color: 'var(--color-text)', fontSize: 11 },
  previewTable: { overflow: 'auto', maxHeight: 230, border: '1px solid var(--color-border)' }, mappingTable: { display: 'grid', minWidth: 680, border: '1px solid var(--color-border)', borderRadius: 5, overflow: 'hidden' }, mappingHeader: { display: 'grid', gridTemplateColumns: '42px minmax(100px,1fr) minmax(140px,1fr) 130px 50px', gap: 7, padding: 7, background: 'var(--color-panel-raised)', color: 'var(--color-text-muted)', fontSize: 11 }, mappingRow: { display: 'grid', gridTemplateColumns: '42px minmax(100px,1fr) minmax(140px,1fr) 130px 50px', alignItems: 'center', gap: 7, padding: 6, borderTop: '1px solid var(--color-border)', fontSize: 11 },
  error: { border: '1px solid color-mix(in srgb, var(--color-danger) 55%, transparent)', background: 'color-mix(in srgb, var(--color-danger) 10%, transparent)', color: 'var(--color-danger)', padding: 8, borderRadius: 5, fontSize: 12, marginBottom: 10 }, empty: { height: '100%', minHeight: 260, display: 'grid', placeItems: 'center', color: 'var(--color-text-faint)', textAlign: 'center', padding: 30 },
};
