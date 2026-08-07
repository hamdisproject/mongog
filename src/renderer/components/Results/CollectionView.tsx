import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DocumentsPage, WorkspaceTab } from '../../../shared/domain/index.js';
import type { EjsonEnvelope } from '../../../shared/ejson/index.js';
import { useConnectionStore } from '../../stores/connections.js';
import { useSchemaCache } from '../../stores/schema-cache.js';
import { useWorkspaceStore } from '../../stores/workspace.js';

const s: Record<string, React.CSSProperties> = {
  container: { display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' },
  toolbar: {
    display: 'flex', gap: 6, padding: '5px 8px', background: '#2d2d2d',
    borderBottom: '1px solid #3c3c3c', alignItems: 'center', flexShrink: 0, fontSize: 12,
  },
  namespace: { color: '#dcdcaa', whiteSpace: 'nowrap', marginRight: 4 },
  input: {
    background: '#1f1f1f', color: '#ddd', border: '1px solid #555',
    padding: '4px 6px', borderRadius: 2, fontSize: 11, fontFamily: 'monospace', minWidth: 100,
  },
  filterInput: { flex: 3 },
  optionInput: { flex: 1 },
  button: {
    background: '#0e639c', color: '#fff', border: '1px solid #1177bb', padding: '3px 9px',
    borderRadius: 2, fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap',
  },
  secondaryButton: {
    background: '#3c3c3c', color: '#ddd', border: '1px solid #555', padding: '3px 9px',
    borderRadius: 2, fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap',
  },
  dangerButton: {
    background: '#8b2d2d', color: '#fff', border: '1px solid #b33a3a', padding: '3px 9px',
    borderRadius: 2, fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap',
  },
  disabled: { opacity: 0.45, cursor: 'default' },
  error: {
    padding: '6px 10px', color: '#f7b3b3', background: '#4a1f1f', borderBottom: '1px solid #6f2929',
    fontSize: 11, display: 'flex', justifyContent: 'space-between', gap: 8,
  },
  notice: {
    padding: '5px 10px', color: '#b9e4c9', background: '#193927', borderBottom: '1px solid #27543b',
    fontSize: 11,
  },
  tableWrap: { flex: 1, minHeight: 0, overflow: 'auto', fontSize: 12 },
  table: { borderCollapse: 'collapse', width: '100%' },
  th: {
    padding: '5px 8px', textAlign: 'left', background: '#252526', color: '#aaa',
    borderBottom: '1px solid #444', position: 'sticky', top: 0, whiteSpace: 'nowrap',
    fontWeight: 500, fontSize: 11, zIndex: 1,
  },
  td: {
    padding: '3px 8px', borderBottom: '1px solid #333', maxWidth: 340,
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  row: { cursor: 'pointer' },
  selectedRow: { background: '#094771' },
  rowNumber: { color: '#777', fontSize: 10, width: 45 },
  empty: { flex: 1, padding: 28, color: '#777', fontSize: 12, textAlign: 'center' },
  editorPanel: {
    height: '38%', minHeight: 180, maxHeight: 440, display: 'flex', flexDirection: 'column',
    borderTop: '1px solid #444', background: '#1e1e1e', flexShrink: 0,
  },
  editorHeader: {
    display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px', background: '#252526',
    borderBottom: '1px solid #333', fontSize: 11,
  },
  editor: {
    flex: 1, resize: 'none', border: 0, outline: 0, padding: 10, background: '#181818',
    color: '#d4d4d4', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: 12, lineHeight: 1.45,
  },
  status: {
    display: 'flex', justifyContent: 'space-between', gap: 10, padding: '3px 8px', fontSize: 11,
    color: '#999', background: '#252526', borderTop: '1px solid #333', flexShrink: 0,
  },
  select: {
    background: '#3c3c3c', color: '#ddd', border: '1px solid #555', fontSize: 11, borderRadius: 2,
  },
};

const EMPTY_FILTER = '{}';

interface BrowserCriteria {
  filter: string;
  sort: string;
  projection: string;
}

interface DocumentRow {
  key: string;
  absoluteIndex: number;
  envelope: EjsonEnvelope;
  value: Record<string, unknown> | null;
}

type EditorMode = 'view' | 'edit' | 'new';

export function CollectionView() {
  const { activeTabId, tabs } = useWorkspaceStore();
  const tab = tabs.find((candidate) => candidate.id === activeTabId);
  if (!tab || tab.kind !== 'collection') return null;
  return <CollectionBrowser key={tab.id} tab={tab} />;
}

function CollectionBrowser({ tab }: { tab: WorkspaceTab }) {
  const profiles = useConnectionStore((state) => state.profiles);
  const connectionId = tab.connectionId ?? '';
  const database = tab.database ?? 'admin';
  const collection = tab.collection ?? '';
  const readOnly = profiles.find((profile) => profile.id === connectionId)?.readOnly ?? true;

  const [draftFilter, setDraftFilter] = useState(EMPTY_FILTER);
  const [draftSort, setDraftSort] = useState('');
  const [draftProjection, setDraftProjection] = useState('');
  const [criteria, setCriteria] = useState<BrowserCriteria>({
    filter: EMPTY_FILTER,
    sort: '',
    projection: '',
  });
  const [pageSize, setPageSize] = useState(50);
  const [cursorId, setCursorId] = useState<string | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [rows, setRows] = useState<DocumentRow[]>([]);
  const [selected, setSelected] = useState<DocumentRow | null>(null);
  const [editorMode, setEditorMode] = useState<EditorMode>('view');
  const [editorText, setEditorText] = useState('');
  const [loading, setLoading] = useState(false);
  const [editorBusy, setEditorBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const columns = useMemo(
    () => extractColumns(rows.map((row) => row.value).filter(isDocumentValue)),
    [rows],
  );

  const applyPage = useCallback((page: DocumentsPage) => {
    const nextRows = page.documents.map((envelope, index) =>
      createDocumentRow(envelope, page.pageIndex * pageSize + index),
    );
    setRows(nextRows);
    setPageIndex(page.pageIndex);
    setHasMore(page.hasMore);
    setSelected(null);
    setEditorText('');
    setEditorMode('view');
  }, [pageSize]);

  const loadInitial = useCallback(async () => {
    if (!connectionId || !collection) return;
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const page = await window.mongog.query.collectionFind({
        connectionId,
        database,
        collection,
        tabId: tab.id,
        filterEjson: criteria.filter || EMPTY_FILTER,
        ...(criteria.sort ? { sortEjson: criteria.sort } : {}),
        ...(criteria.projection ? { projectionEjson: criteria.projection } : {}),
        pageSize,
      });
      setCursorId(page.cursorId);
      applyPage(page);
    } catch (caught) {
      setRows([]);
      setCursorId(null);
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [connectionId, database, collection, tab.id, criteria, pageSize, applyPage]);

  useEffect(() => {
    void loadInitial();
    return () => {
      if (connectionId) void window.mongog.query.closeOwner(connectionId, tab.id);
    };
  }, [connectionId, tab.id, loadInitial]);

  const applyCriteria = () => {
    const next = {
      filter: draftFilter.trim() || EMPTY_FILTER,
      sort: draftSort.trim(),
      projection: draftProjection.trim(),
    };
    if (sameCriteria(criteria, next)) void loadInitial();
    else setCriteria(next);
  };

  const clearCriteria = () => {
    setDraftFilter(EMPTY_FILTER);
    setDraftSort('');
    setDraftProjection('');
    const cleared = { filter: EMPTY_FILTER, sort: '', projection: '' };
    if (sameCriteria(criteria, cleared)) void loadInitial();
    else setCriteria(cleared);
  };

  const fetchPage = async (direction: 'next' | 'previous') => {
    if (!cursorId) return;
    setLoading(true);
    setError(null);
    try {
      const page = direction === 'next'
        ? await window.mongog.query.cursorFetchNext(connectionId, cursorId, pageSize)
        : await window.mongog.query.cursorFetchPrev(connectionId, cursorId);
      applyPage(page);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  };

  const selectRow = async (row: DocumentRow) => {
    if (selected?.key === row.key) {
      setSelected(null);
      setEditorText('');
      setEditorMode('view');
      return;
    }
    setError(null);
    setEditorBusy(true);
    try {
      let envelope = row.envelope;
      if (envelope.truncated) {
        if (!cursorId || !envelope.fullValueId) {
          throw new Error('The complete document is too large and is no longer retained. Refresh to try again.');
        }
        envelope = await window.mongog.query.cursorFetchFull(
          connectionId,
          cursorId,
          envelope.fullValueId,
        );
      }
      const complete = createDocumentRow(envelope, row.absoluteIndex);
      setSelected(complete);
      setEditorText(prettyEjson(envelope.ejson));
      setEditorMode('view');
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setEditorBusy(false);
    }
  };

  const openNewDocument = () => {
    setSelected(null);
    setEditorMode('new');
    setEditorText('{\n  \n}');
    setError(null);
    setNotice(null);
  };

  const saveDocument = async () => {
    if (readOnly || editorMode === 'view') return;
    setEditorBusy(true);
    setError(null);
    setNotice(null);
    try {
      let successMessage: string;
      if (editorMode === 'new') {
        await window.mongog.query.collectionInsert({
          connectionId,
          database,
          collection,
          documentEjson: editorText,
        });
        successMessage = 'Document inserted.';
      } else {
        if (!selected) throw new Error('No document selected.');
        await window.mongog.query.collectionReplace({
          connectionId,
          database,
          collection,
          originalDocumentEjson: selected.envelope.ejson,
          documentEjson: editorText,
        });
        successMessage = 'Document updated.';
      }
      useSchemaCache.getState().invalidate(connectionId, database, collection);
      await loadInitial();
      setNotice(successMessage);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setEditorBusy(false);
    }
  };

  const deleteDocument = async () => {
    if (readOnly || !selected) return;
    const confirmed = window.confirm('Delete this document? This operation cannot be undone.');
    if (!confirmed) return;
    setEditorBusy(true);
    setError(null);
    setNotice(null);
    try {
      await window.mongog.query.collectionDelete({
        connectionId,
        database,
        collection,
        originalDocumentEjson: selected.envelope.ejson,
      });
      useSchemaCache.getState().invalidate(connectionId, database, collection);
      await loadInitial();
      setNotice('Document deleted.');
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setEditorBusy(false);
    }
  };

  const projectionActive = criteria.projection.length > 0;
  const canEditSelection = !readOnly && !!selected && !projectionActive;
  const busy = loading || editorBusy;

  if (!connectionId || !collection) {
    return <div style={s.empty}>No collection selected</div>;
  }

  return (
    <div style={s.container}>
      <div style={s.toolbar}>
        <span style={s.namespace}>{database}.{collection}</span>
        <input
          style={{ ...s.input, ...s.filterInput }}
          aria-label="Collection filter"
          title="MongoDB filter as Extended JSON"
          placeholder='Filter: {"active": true}'
          value={draftFilter}
          onChange={(event) => setDraftFilter(event.target.value)}
          onKeyDown={(event) => event.key === 'Enter' && applyCriteria()}
          disabled={busy}
        />
        <input
          style={{ ...s.input, ...s.optionInput }}
          aria-label="Collection sort"
          title="Sort as Extended JSON"
          placeholder='Sort: {"_id": -1}'
          value={draftSort}
          onChange={(event) => setDraftSort(event.target.value)}
          disabled={busy}
        />
        <input
          style={{ ...s.input, ...s.optionInput }}
          aria-label="Collection projection"
          title="Projection as Extended JSON. Editing is disabled for projected results."
          placeholder='Projection: {"name": 1}'
          value={draftProjection}
          onChange={(event) => setDraftProjection(event.target.value)}
          disabled={busy}
        />
        <ToolbarButton onClick={applyCriteria} disabled={busy}>Apply</ToolbarButton>
        <ToolbarButton secondary onClick={clearCriteria} disabled={busy}>Clear</ToolbarButton>
        <ToolbarButton secondary onClick={() => void loadInitial()} disabled={busy}>Refresh</ToolbarButton>
        <ToolbarButton onClick={openNewDocument} disabled={readOnly || busy}>New</ToolbarButton>
      </div>

      {error && (
        <div style={s.error} role="alert">
          <span>{error}</span>
          <button style={s.secondaryButton} onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}
      {notice && <div style={s.notice}>{notice}</div>}
      {readOnly && <div style={s.notice}>Read-only connection — document changes are disabled.</div>}

      {rows.length === 0 && !loading ? (
        <div style={s.empty}>No documents found</div>
      ) : (
        <div style={s.tableWrap}>
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>#</th>
                {columns.map((column) => <th key={column} style={s.th}>{column}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.key}
                  style={{ ...s.row, ...(selected?.key === row.key ? s.selectedRow : {}) }}
                  onClick={() => void selectRow(row)}
                >
                  <td style={{ ...s.td, ...s.rowNumber }}>{row.absoluteIndex + 1}</td>
                  {columns.map((column) => (
                    <td key={column} style={s.td}>{formatCellValue(row.value?.[column])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(selected || editorMode === 'new') && (
        <div style={s.editorPanel}>
          <div style={s.editorHeader}>
            <strong>{editorMode === 'new' ? 'New document' : editorMode === 'edit' ? 'Edit document' : 'Document'}</strong>
            <span style={{ flex: 1, color: '#888' }}>
              Canonical Extended JSON{projectionActive ? ' — projected documents cannot be edited' : ''}
            </span>
            {editorMode === 'view' ? (
              <>
                <ToolbarButton secondary onClick={() => setEditorMode('edit')} disabled={!canEditSelection || editorBusy}>Edit</ToolbarButton>
                <ToolbarButton danger onClick={() => void deleteDocument()} disabled={!canEditSelection || editorBusy}>Delete</ToolbarButton>
                <ToolbarButton secondary onClick={() => { setSelected(null); setEditorText(''); }}>Close</ToolbarButton>
              </>
            ) : (
              <>
                <ToolbarButton onClick={() => void saveDocument()} disabled={editorBusy}>Save</ToolbarButton>
                <ToolbarButton secondary onClick={() => {
                  if (selected) {
                    setEditorText(prettyEjson(selected.envelope.ejson));
                    setEditorMode('view');
                  } else {
                    setEditorText('');
                    setEditorMode('view');
                  }
                }} disabled={editorBusy}>Cancel</ToolbarButton>
              </>
            )}
          </div>
          <textarea
            style={s.editor}
            aria-label="Document Extended JSON editor"
            value={editorText}
            readOnly={editorMode === 'view'}
            spellCheck={false}
            onChange={(event) => setEditorText(event.target.value)}
          />
        </div>
      )}

      <div style={s.status}>
        <span>{loading || editorBusy ? 'Working…' : `${rows.length} document(s) — page ${pageIndex + 1}`}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <label>Page size&nbsp;
            <select
              style={s.select}
              value={pageSize}
              disabled={busy}
              onChange={(event) => setPageSize(Number(event.target.value))}
            >
              {[25, 50, 100, 250, 500].map((size) => <option key={size} value={size}>{size}</option>)}
            </select>
          </label>
          <ToolbarButton secondary onClick={() => void fetchPage('previous')} disabled={busy || pageIndex === 0}>Previous</ToolbarButton>
          <ToolbarButton secondary onClick={() => void fetchPage('next')} disabled={busy || !hasMore}>Next</ToolbarButton>
        </span>
      </div>
    </div>
  );
}

function ToolbarButton({
  children,
  disabled = false,
  secondary = false,
  danger = false,
  onClick,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  secondary?: boolean;
  danger?: boolean;
  onClick: () => void;
}) {
  const base = danger ? s.dangerButton : secondary ? s.secondaryButton : s.button;
  return (
    <button style={{ ...base, ...(disabled ? s.disabled : {}) }} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}

function createDocumentRow(envelope: EjsonEnvelope, absoluteIndex: number): DocumentRow {
  const value = envelope.truncated ? null : parseDocumentValue(envelope.ejson);
  const id = value && Object.hasOwn(value, '_id') ? JSON.stringify(value._id) : null;
  return {
    key: id ? `${id}:${absoluteIndex}` : `document:${absoluteIndex}`,
    absoluteIndex,
    envelope,
    value,
  };
}

function parseDocumentValue(ejson: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(ejson) as unknown;
    if (isDocumentValue(value)) return value;
  } catch {
    // The runtime owns validation; an invalid preview is displayed as opaque.
  }
  return null;
}

function prettyEjson(ejson: string): string {
  try {
    return JSON.stringify(JSON.parse(ejson), null, 2);
  } catch {
    return ejson;
  }
}

function extractColumns(documents: Array<Record<string, unknown>>): string[] {
  const keys = new Set<string>();
  for (const document of documents) {
    for (const key of Object.keys(document)) keys.add(key);
  }
  return ['_id', ...Array.from(keys).filter((key) => key !== '_id').sort()];
}

function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') return truncate(value, 100);
  if (typeof value === 'object') return truncate(JSON.stringify(value), 100);
  return String(value);
}

function truncate(value: string, length: number): string {
  return value.length > length ? `${value.slice(0, length)}…` : value;
}

function isDocumentValue(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sameCriteria(left: BrowserCriteria, right: BrowserCriteria): boolean {
  return left.filter === right.filter &&
    left.sort === right.sort &&
    left.projection === right.projection;
}

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    const category = 'category' in error ? `[${String(error.category)}] ` : '';
    return `${category}${String(error.message)}`;
  }
  return String(error);
}
