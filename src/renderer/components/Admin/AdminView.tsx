import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AdminSection,
  GlobalSearchResult,
  GridFsFileInfo,
  IndexDescription,
  WorkspaceTab,
} from '../../../shared/domain/index.js';
import type { EjsonEnvelope } from '../../../shared/ejson/index.js';
import { useConnectionStore } from '../../stores/connections.js';
import { useSchemaCache } from '../../stores/schema-cache.js';
import { useWorkspaceStore } from '../../stores/workspace.js';

const sections: Array<{ id: AdminSection; label: string }> = [
  { id: 'indexes', label: 'Indexes' },
  { id: 'explain', label: 'Explain' },
  { id: 'search', label: 'Global Search' },
  { id: 'gridfs', label: 'GridFS' },
];

const ui: Record<string, React.CSSProperties> = {
  root: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--color-app)' },
  context: { display: 'flex', gap: 8, alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid var(--color-border)', background: 'var(--color-panel)' },
  nav: { display: 'flex', gap: 2, padding: '0 14px', borderBottom: '1px solid var(--color-border)', background: 'var(--color-panel)' },
  navButton: { border: 0, borderBottom: '2px solid transparent', background: 'transparent', color: 'var(--color-text-muted)', padding: '9px 12px', cursor: 'pointer', fontSize: 12 },
  body: { flex: 1, overflow: 'auto', padding: 18 },
  panel: { maxWidth: 1100, margin: '0 auto' },
  row: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
  input: { background: 'var(--color-input)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 3, padding: '6px 8px', fontSize: 12 },
  textarea: { width: '100%', minHeight: 82, resize: 'vertical', fontFamily: 'monospace', background: 'var(--color-input)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 3, padding: 8, boxSizing: 'border-box' },
  button: { background: 'var(--color-accent)', border: 0, borderRadius: 3, color: 'white', padding: '6px 11px', cursor: 'pointer', fontSize: 12 },
  secondary: { background: 'var(--color-input-soft)', border: '1px solid var(--color-border-strong)', borderRadius: 3, color: 'var(--color-text)', padding: '5px 10px', cursor: 'pointer', fontSize: 12 },
  danger: { background: 'var(--color-danger-button)', border: 0, borderRadius: 3, color: 'white', padding: '5px 9px', cursor: 'pointer', fontSize: 12 },
  card: { border: '1px solid #383838', borderRadius: 4, background: 'var(--color-panel)', padding: 12, marginTop: 10 },
  pre: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontFamily: 'monospace', fontSize: 11, color: 'var(--color-code-text)', margin: 0 },
  label: { color: 'var(--color-text-muted)', fontSize: 11, display: 'block', marginBottom: 4 },
  muted: { color: 'var(--color-text-muted)', fontSize: 12 },
};

export function AdminView({ tab }: { tab: WorkspaceTab }) {
  const updateTab = useWorkspaceStore((state) => state.updateTab);
  const connectionStore = useConnectionStore();
  const connectedIds = Object.keys(connectionStore.connected);
  const connectionId = tab.connectionId ?? '';
  const database = tab.database ?? '';
  const collection = tab.collection ?? '';
  const section = tab.adminSection ?? 'indexes';
  const profile = connectionStore.profiles.find((candidate) => candidate.id === connectionId);
  const databases = connectionStore.databases[connectionId] ?? [];
  const collections = connectionStore.collections[`${connectionId}:${database}`] ?? [];

  useEffect(() => {
    if (!connectionId && connectedIds[0]) {
      updateTab(tab.id, { connectionId: connectedIds[0] });
    }
  }, [connectionId, connectedIds.join('|'), tab.id, updateTab]);

  useEffect(() => {
    if (connectionId) void connectionStore.loadDatabases(connectionId);
  }, [connectionId]);

  useEffect(() => {
    if (!connectionId || database || databases.length === 0) return;
    const preferred = profile?.defaultDatabase;
    const next = databases.find((candidate) => candidate.name === preferred)?.name ?? databases[0]!.name;
    updateTab(tab.id, { database: next, collection: undefined });
  }, [connectionId, database, databases, profile?.defaultDatabase, tab.id, updateTab]);

  useEffect(() => {
    if (connectionId && database) void connectionStore.loadCollections(connectionId, database);
  }, [connectionId, database]);

  useEffect(() => {
    if (!collection && collections[0]) updateTab(tab.id, { collection: collections[0].name });
  }, [collection, collections, tab.id, updateTab]);

  const setConnection = (next: string) => updateTab(tab.id, {
    connectionId: next || null,
    database: undefined,
    collection: undefined,
  });
  const setDatabase = (next: string) => updateTab(tab.id, { database: next, collection: undefined });

  return (
    <div style={ui.root}>
      <div style={ui.context}>
        <strong style={{ fontSize: 13 }}>Administration</strong>
        <select style={ui.input} value={connectionId} onChange={(event) => setConnection(event.target.value)}>
          <option value="">Select connection</option>
          {connectedIds.map((id) => <option key={id} value={id}>{connectionStore.profiles.find((p) => p.id === id)?.name ?? id}</option>)}
        </select>
        <select style={ui.input} value={database} disabled={!connectionId} onChange={(event) => setDatabase(event.target.value)}>
          <option value="">Select database</option>
          {databases.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}
        </select>
        <select style={ui.input} value={collection} disabled={!database} onChange={(event) => updateTab(tab.id, { collection: event.target.value })}>
          <option value="">Select collection</option>
          {collections.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}
        </select>
        {profile?.readOnly && <span style={{ color: 'var(--color-warning)', fontSize: 11 }}>Read-only connection</span>}
      </div>
      <div style={ui.nav}>
        {sections.map((item) => (
          <button
            key={item.id}
            style={{ ...ui.navButton, ...(section === item.id ? { color: '#fff', borderBottomColor: 'var(--color-focus)' } : {}) }}
            onClick={() => updateTab(tab.id, { adminSection: item.id })}
          >{item.label}</button>
        ))}
      </div>
      <div style={ui.body}>
        <div style={ui.panel}>
          {!connectionId || !database ? <EmptyContext /> : section === 'indexes' ? (
            <IndexesSection connectionId={connectionId} database={database} collection={collection} readOnly={profile?.readOnly === true} />
          ) : section === 'explain' ? (
            <ExplainSection connectionId={connectionId} database={database} collection={collection} />
          ) : section === 'search' ? (
            <SearchSection connectionId={connectionId} database={database} />
          ) : section === 'changes' ? (
            <ChangesSection connectionId={connectionId} database={database} collection={collection} tabId={tab.id} />
          ) : (
            <GridFsSection connectionId={connectionId} database={database} readOnly={profile?.readOnly === true} />
          )}
        </div>
      </div>
    </div>
  );
}

function EmptyContext() {
  return <div style={{ ...ui.card, ...ui.muted }}>Connect to MongoDB and select a database to use administration tools.</div>;
}

interface CollectionContextProps {
  connectionId: string;
  database: string;
  collection: string;
}

function IndexesSection({ connectionId, database, collection, readOnly }: CollectionContextProps & { readOnly: boolean }) {
  const [indexes, setIndexes] = useState<IndexDescription[]>([]);
  const [keys, setKeys] = useState('{ "createdAt": -1 }');
  const [name, setName] = useState('');
  const [unique, setUnique] = useState(false);
  const [sparse, setSparse] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [expireAfterSeconds, setExpireAfterSeconds] = useState('');
  const [partial, setPartial] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!collection) return;
    setBusy(true); setError(null);
    try { setIndexes(await window.mongog.admin.listIndexes(connectionId, database, collection)); }
    catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  }, [connectionId, database, collection]);

  useEffect(() => { void refresh(); }, [refresh]);

  const create = async () => {
    setBusy(true); setError(null);
    try {
      await window.mongog.admin.createIndex({
        connectionId, database, collection, keysEjson: keys,
        ...(name.trim() ? { name: name.trim() } : {}),
        unique, sparse, hidden,
        ...(expireAfterSeconds.trim() ? { expireAfterSeconds: Number(expireAfterSeconds) } : {}),
        ...(partial.trim() ? { partialFilterEjson: partial } : {}),
      });
      useSchemaCache.getState().invalidate(connectionId, database, collection);
      await refresh();
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  };

  const drop = async (indexName: string) => {
    if (!window.confirm(`Drop index "${indexName}"?`)) return;
    setBusy(true); setError(null);
    try {
      await window.mongog.admin.dropIndex(connectionId, database, collection, indexName);
      await refresh();
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  };

  if (!collection) return <div style={ui.muted}>Select a collection to inspect indexes.</div>;
  return <>
    <SectionTitle title="Indexes" detail={`${database}.${collection}`} />
    <div style={ui.card}>
      <label style={ui.label}>Index keys (Extended JSON)</label>
      <textarea style={ui.textarea} value={keys} onChange={(event) => setKeys(event.target.value)} />
      <div style={{ ...ui.row, marginTop: 8 }}>
        <input style={ui.input} placeholder="Optional index name" value={name} onChange={(event) => setName(event.target.value)} />
        <label><input type="checkbox" checked={unique} onChange={(event) => setUnique(event.target.checked)} /> Unique</label>
        <label><input type="checkbox" checked={sparse} onChange={(event) => setSparse(event.target.checked)} /> Sparse</label>
        <label><input type="checkbox" checked={hidden} onChange={(event) => setHidden(event.target.checked)} /> Hidden</label>
        <input style={{ ...ui.input, width: 115 }} type="number" min={0} placeholder="TTL seconds" value={expireAfterSeconds} onChange={(event) => setExpireAfterSeconds(event.target.value)} />
        <input style={{ ...ui.input, minWidth: 240 }} placeholder="Optional partial filter EJSON" value={partial} onChange={(event) => setPartial(event.target.value)} />
        <button style={ui.button} disabled={busy || readOnly} onClick={() => void create()}>Create index</button>
        <button style={ui.secondary} disabled={busy} onClick={() => void refresh()}>Refresh</button>
      </div>
    </div>
    {error && <ErrorBox message={error} />}
    {indexes.map((index) => <div key={index.name} style={ui.card}>
      <div style={{ ...ui.row, justifyContent: 'space-between' }}>
        <strong>{index.name}</strong>
        <button style={ui.danger} disabled={readOnly || index.name === '_id_'} onClick={() => void drop(index.name)}>Drop</button>
      </div>
      <pre style={{ ...ui.pre, marginTop: 8 }}>{prettyEnvelope(index.key)}</pre>
      <div style={{ ...ui.muted, marginTop: 6 }}>
        {[index.unique && 'unique', index.sparse && 'sparse', index.hidden && 'hidden', index.expireAfterSeconds !== undefined && `TTL ${index.expireAfterSeconds}s`].filter(Boolean).join(' · ') || 'standard'}
      </div>
    </div>)}
  </>;
}

function ExplainSection({ connectionId, database, collection }: CollectionContextProps) {
  const [filter, setFilter] = useState('{}');
  const [sort, setSort] = useState('{}');
  const [projection, setProjection] = useState('{}');
  const [verbosity, setVerbosity] = useState<'queryPlanner' | 'executionStats' | 'allPlansExecution'>('executionStats');
  const [result, setResult] = useState<EjsonEnvelope | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    setBusy(true); setError(null); setResult(null);
    try { setResult(await window.mongog.admin.explain({ connectionId, database, collection, filterEjson: filter, sortEjson: sort, projectionEjson: projection, verbosity })); }
    catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  };
  if (!collection) return <div style={ui.muted}>Select a collection to explain a find query.</div>;
  return <>
    <SectionTitle title="Explain" detail="Runs find().explain() through the isolated query runtime." />
    <div style={ui.card}>
      <label style={ui.label}>Filter</label><textarea style={ui.textarea} value={filter} onChange={(event) => setFilter(event.target.value)} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 8 }}>
        <div><label style={ui.label}>Sort</label><textarea style={ui.textarea} value={sort} onChange={(event) => setSort(event.target.value)} /></div>
        <div><label style={ui.label}>Projection</label><textarea style={ui.textarea} value={projection} onChange={(event) => setProjection(event.target.value)} /></div>
      </div>
      <div style={{ ...ui.row, marginTop: 8 }}>
        <select style={ui.input} value={verbosity} onChange={(event) => setVerbosity(event.target.value as typeof verbosity)}>
          <option value="queryPlanner">queryPlanner</option><option value="executionStats">executionStats</option><option value="allPlansExecution">allPlansExecution</option>
        </select>
        <button style={ui.button} disabled={busy} onClick={() => void run()}>{busy ? 'Running…' : 'Run explain'}</button>
      </div>
    </div>
    {error && <ErrorBox message={error} />}
    {result && <div style={ui.card}><pre style={ui.pre}>{prettyEnvelope(result)}</pre></div>}
  </>;
}

function SearchSection({ connectionId, database }: Omit<CollectionContextProps, 'collection'>) {
  const [text, setText] = useState('');
  const [maxDocs, setMaxDocs] = useState(500);
  const [result, setResult] = useState<GlobalSearchResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const search = async () => {
    setBusy(true); setError(null);
    try { setResult(await window.mongog.admin.globalSearch({ connectionId, database, text, maxDocumentsPerCollection: maxDocs, maxResults: 100 })); }
    catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  };
  return <>
    <SectionTitle title="Global Search" detail="Bounded sample search across collection documents; results may be incomplete." />
    <div style={{ ...ui.card, ...ui.row }}>
      <input style={{ ...ui.input, flex: 1, minWidth: 280 }} value={text} placeholder="Text to find in canonical Extended JSON" onChange={(event) => setText(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void search(); }} />
      <label style={ui.muted}>Docs / collection <input style={{ ...ui.input, width: 80 }} type="number" min={1} max={10000} value={maxDocs} onChange={(event) => setMaxDocs(Number(event.target.value))} /></label>
      <button style={ui.button} disabled={busy || !text.trim()} onClick={() => void search()}>{busy ? 'Searching…' : 'Search'}</button>
    </div>
    {error && <ErrorBox message={error} />}
    {result && <div style={{ ...ui.muted, marginTop: 10 }}>Scanned {result.scannedDocuments} documents in {result.scannedCollections} collections · {result.matches.length} matches{result.truncated ? ' · result limit reached' : ''}</div>}
    {result?.matches.map((match, index) => <div key={`${match.collection}-${index}`} style={ui.card}><strong style={{ fontSize: 12 }}>{match.collection}</strong><pre style={{ ...ui.pre, marginTop: 8 }}>{prettyEnvelope(match.document)}</pre></div>)}
  </>;
}

function ChangesSection({ connectionId, database, collection, tabId }: CollectionContextProps & { tabId: string }) {
  const runtimeEpoch = useConnectionStore((state) => state.runtimeEpochs[connectionId] ?? 0);
  const [pipeline, setPipeline] = useState('[]');
  const [databaseWide, setDatabaseWide] = useState(false);
  const [fullDocument, setFullDocument] = useState<'default' | 'updateLookup' | 'whenAvailable' | 'required'>('updateLookup');
  const [streamId, setStreamId] = useState<string | null>(null);
  const [events, setEvents] = useState<EjsonEnvelope[]>([]);
  const [error, setError] = useState<string | null>(null);
  const polling = useRef(false);
  const observedRuntimeEpoch = useRef(runtimeEpoch);

  useEffect(() => {
    if (observedRuntimeEpoch.current === runtimeEpoch) return;
    observedRuntimeEpoch.current = runtimeEpoch;
    setStreamId(null);
    setError('Connection restarted after query cancellation. Start a new change stream.');
  }, [runtimeEpoch]);

  useEffect(() => {
    if (!streamId) return;
    let live = true;
    const poll = async () => {
      if (polling.current || !live) return;
      polling.current = true;
      try {
        const result = await window.mongog.admin.pollChangeStream(connectionId, streamId, 50);
        if (result.events.length) setEvents((current) => [...result.events, ...current].slice(0, 200));
        if (result.closed) setStreamId(null);
      } catch (cause) {
        if (live) { setError(errorMessage(cause)); setStreamId(null); }
      } finally { polling.current = false; }
    };
    const timer = window.setInterval(() => void poll(), 1_200);
    void poll();
    return () => {
      live = false;
      window.clearInterval(timer);
      void window.mongog.admin.closeChangeStream(connectionId, streamId).catch(() => undefined);
    };
  }, [connectionId, streamId]);

  const start = async () => {
    setError(null); setEvents([]);
    try {
      const result = await window.mongog.admin.startChangeStream({ connectionId, database, ...(databaseWide ? {} : { collection }), tabId, pipelineEjson: pipeline, fullDocument });
      setStreamId(result.streamId);
    } catch (cause) { setError(errorMessage(cause)); }
  };
  const stop = async () => {
    if (!streamId) return;
    await window.mongog.admin.closeChangeStream(connectionId, streamId).catch(() => undefined);
    setStreamId(null);
  };
  return <>
    <SectionTitle title="Change Streams" detail="Requires a replica set or sharded cluster. Polling is bounded and the stream closes with this view." />
    <div style={ui.card}>
      <label style={ui.label}>Aggregation pipeline</label><textarea style={ui.textarea} value={pipeline} onChange={(event) => setPipeline(event.target.value)} />
      <div style={{ ...ui.row, marginTop: 8 }}>
        <label><input type="checkbox" checked={databaseWide} onChange={(event) => setDatabaseWide(event.target.checked)} /> Watch entire database</label>
        <select style={ui.input} value={fullDocument} onChange={(event) => setFullDocument(event.target.value as typeof fullDocument)}>
          <option value="default">default</option><option value="updateLookup">updateLookup</option><option value="whenAvailable">whenAvailable</option><option value="required">required</option>
        </select>
        {!streamId ? <button style={ui.button} disabled={!databaseWide && !collection} onClick={() => void start()}>Start stream</button> : <button style={ui.danger} onClick={() => void stop()}>Stop stream</button>}
        <span style={{ color: streamId ? '#89d185' : 'var(--color-text-muted)', fontSize: 12 }}>{streamId ? 'Listening' : 'Stopped'}</span>
      </div>
    </div>
    {error && <ErrorBox message={error} />}
    {events.map((event, index) => <div key={`${event.byteSize}-${index}`} style={ui.card}><pre style={ui.pre}>{prettyEnvelope(event)}</pre></div>)}
  </>;
}

function GridFsSection({ connectionId, database, readOnly }: Omit<CollectionContextProps, 'collection'> & { readOnly: boolean }) {
  const [bucketName, setBucketName] = useState('fs');
  const [metadata, setMetadata] = useState('{}');
  const [files, setFiles] = useState<GridFsFileInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    setBusy(true); setError(null);
    try { setFiles(await window.mongog.admin.listGridFsFiles(connectionId, database, bucketName, 200)); }
    catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  }, [connectionId, database, bucketName]);
  useEffect(() => { void refresh(); }, [connectionId, database]);
  const upload = async () => {
    setBusy(true); setError(null);
    try {
      const result = await window.mongog.admin.uploadGridFsFile({ connectionId, database, bucketName, metadataEjson: metadata });
      if (!result.cancelled) await refresh();
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  };
  const download = async (file: GridFsFileInfo) => {
    setError(null);
    try { await window.mongog.admin.downloadGridFsFile({ connectionId, database, bucketName, idEjson: file.id.ejson, filename: file.filename }); }
    catch (cause) { setError(errorMessage(cause)); }
  };
  const remove = async (file: GridFsFileInfo) => {
    if (!window.confirm(`Delete GridFS file "${file.filename}"?`)) return;
    setBusy(true); setError(null);
    try { await window.mongog.admin.deleteGridFsFile(connectionId, database, bucketName, file.id.ejson); await refresh(); }
    catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  };
  return <>
    <SectionTitle title="GridFS" detail="File bytes stream directly between the isolated runtime and native file paths; they do not cross renderer IPC." />
    <div style={ui.card}>
      <div style={ui.row}>
        <label style={ui.muted}>Bucket <input style={ui.input} value={bucketName} onChange={(event) => setBucketName(event.target.value)} /></label>
        <button style={ui.secondary} disabled={busy || !bucketName} onClick={() => void refresh()}>Refresh</button>
        <button style={ui.button} disabled={busy || readOnly || !bucketName} onClick={() => void upload()}>Upload file…</button>
      </div>
      <label style={{ ...ui.label, marginTop: 10 }}>Upload metadata (Extended JSON)</label>
      <textarea style={{ ...ui.textarea, minHeight: 54 }} value={metadata} onChange={(event) => setMetadata(event.target.value)} />
    </div>
    {error && <ErrorBox message={error} />}
    {files.map((file) => <div key={file.id.ejson} style={ui.card}>
      <div style={{ ...ui.row, justifyContent: 'space-between' }}>
        <div><strong>{file.filename}</strong><div style={ui.muted}>{formatBytes(file.length)} · {new Date(file.uploadDate).toLocaleString()}</div></div>
        <div style={ui.row}><button style={ui.secondary} onClick={() => void download(file)}>Download…</button><button style={ui.danger} disabled={readOnly} onClick={() => void remove(file)}>Delete</button></div>
      </div>
      {file.metadata && <pre style={{ ...ui.pre, marginTop: 8 }}>{prettyEnvelope(file.metadata)}</pre>}
    </div>)}
  </>;
}

function SectionTitle({ title, detail }: { title: string; detail: string }) {
  return <div><h2 style={{ fontSize: 18, margin: '0 0 4px' }}>{title}</h2><div style={ui.muted}>{detail}</div></div>;
}

function ErrorBox({ message }: { message: string }) {
  return <div style={{ ...ui.card, borderColor: 'var(--color-danger-button)', color: 'var(--color-danger)' }}>{message}</div>;
}

function prettyEnvelope(envelope: EjsonEnvelope): string {
  try { return JSON.stringify(JSON.parse(envelope.ejson), null, 2); }
  catch { return envelope.ejson; }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) return String(error.message);
  return String(error);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
