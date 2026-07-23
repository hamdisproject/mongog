import { useEffect, useState, useCallback } from 'react';
import { useWorkspaceStore } from '../../stores/workspace.js';
import type { WorkspaceTab } from '../../../shared/domain/index.js';

const s: Record<string, React.CSSProperties> = {
  container: { display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' },
  toolbar: {
    display: 'flex', gap: 8, padding: '4px 8px', background: '#2d2d2d',
    borderBottom: '1px solid #333', alignItems: 'center', flexShrink: 0, fontSize: 12,
  },
  btn: {
    background: '#0e639c', color: '#fff', border: 'none', padding: '2px 8px',
    borderRadius: 2, fontSize: 11, cursor: 'pointer',
  },
  input: {
    background: '#3c3c3c', color: '#ddd', border: '1px solid #555',
    padding: '2px 6px', borderRadius: 2, fontSize: 12, fontFamily: 'monospace',
    flex: 1, minWidth: 100,
  },
  table: { flex: 1, overflow: 'auto', fontSize: 12 },
  tableInner: { borderCollapse: 'collapse', width: '100%' },
  th: {
    padding: '4px 8px', textAlign: 'left', background: '#252526', color: '#888',
    borderBottom: '1px solid #444', position: 'sticky', top: 0, whiteSpace: 'nowrap',
    fontWeight: 500, fontSize: 11,
  },
  td: { padding: '2px 8px', borderBottom: '1px solid #333', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  tr: { cursor: 'pointer' },
  trSelected: { background: '#094771' },
  trHover: { background: '#2a2d2e' },
  rowNum: { color: '#666', fontSize: 10, width: 40 },
  detailPanel: {
    borderTop: '1px solid #333', background: '#1e1e1e',
    padding: 8, overflow: 'auto', flexShrink: 0,
    fontFamily: 'monospace', fontSize: 12, whiteSpace: 'pre-wrap',
  },
  statusBar: { padding: '2px 8px', fontSize: 11, color: '#888', background: '#252526', borderTop: '1px solid #333' },
  empty: { padding: 24, color: '#666', fontSize: 12, textAlign: 'center' },
};

export function CollectionView() {
  const { activeTabId, tabs } = useWorkspaceStore();
  const tab = tabs.find((t) => t.id === activeTabId);
  if (!tab || tab.kind !== 'collection') return null;
  return <CollectionBrowser tab={tab} />;
}

interface DocRecord {
  _key: string;
  _index: number;
  doc: Record<string, unknown>;
}

function CollectionBrowser({ tab }: { tab: WorkspaceTab }) {
  const { prepareExecution, failExecution } = useWorkspaceStore();
  const [docs, setDocs] = useState<DocRecord[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [selectedDoc, setSelectedDoc] = useState<DocRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cursorId, setCursorId] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [pageSize] = useState(50);
  const [hoveredRow, setHoveredRow] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  const connId = tab.connectionId ?? '';
  const dbName = tab.database ?? 'admin';
  const colName = tab.collection ?? '';

  const loadInitial = useCallback(async (filterExpr?: string) => {
    setLoading(true);
    setError(null);
    setSelectedDoc(null);
    setCursorId(null);
    setHasMore(false);
    setDocs([]);
    const runId = crypto.randomUUID();
    prepareExecution(tab.id, connId, runId);
    try {
      await window.mongog.query.closeOwner(connId, tab.id).catch(() => undefined);
      const where = filterExpr?.trim() ? filterExpr : '{}';
      const source = `const coll = db.collection(${JSON.stringify(colName)});
coll.find(${where}).limit(${pageSize});`;
      await window.mongog.query.execute({
        connectionId: connId,
        tabId: tab.id,
        runId,
        database: dbName,
        mode: 'query',
        source,
        sourceOffset: { line: 0, column: 0 },
      });

      const resultData = await waitForDocumentResult(tab.id, runId);
      if (resultData) {
        setDocs(resultData.docs);
        setColumns(resultData.columns);
        setCursorId(resultData.cursorId ?? null);
        setHasMore(resultData.hasMore);
      }
    } catch (err) {
      const message = errorMessage(err);
      failExecution(tab.id, runId, message);
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [connId, dbName, colName, pageSize, tab.id, prepareExecution, failExecution]);

  useEffect(() => {
    if (!connId || !colName) return;
    void loadInitial(filter || undefined);
    return () => {
      void window.mongog.query.closeOwner(connId, tab.id);
    };
  }, [connId, dbName, colName]);

  const handleFetchNext = async () => {
    if (!cursorId) return;
    setLoading(true);
    try {
      const page = await window.mongog.query.cursorFetchNext(connId, cursorId, pageSize);
      const startIdx = docs.length;
      const extra = page.documents.map((d, i) => ({
        _key: `doc-${startIdx + i}`,
        _index: startIdx + i,
        doc: JSON.parse(d.ejson) as Record<string, unknown>,
      }));
      setDocs((prev) => [...prev, ...extra]);
      setColumns(extractColumns([...docs.map((d) => d.doc), ...extra.map((d) => d.doc)]));
      setHasMore(page.hasMore);
    } catch (err) {
      setError((err as { message?: string }).message ?? String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleFilterSubmit = () => {
    void loadInitial(filter || undefined);
  };

  if (!connId || !colName) {
    return <div style={s.empty}>No collection selected</div>;
  }

  if (error) {
    return <div style={s.empty}>{error}</div>;
  }

  return (
    <div style={s.container}>
      <div style={s.toolbar}>
        <span>{dbName}.{colName}</span>
        <input
          style={s.input}
          placeholder='filter: {"active": true}'
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleFilterSubmit()}
        />
        <button style={s.btn} onClick={handleFilterSubmit}>Apply</button>
        <button style={s.btn} onClick={() => { setFilter(''); void loadInitial(); }}>Clear</button>
        <button style={s.btn} onClick={() => void loadInitial(filter || undefined)}>Refresh</button>
        {hasMore && <button style={s.btn} onClick={() => void handleFetchNext()} disabled={loading}>Load more</button>}
      </div>

      {docs.length === 0 && !loading ? (
        <div style={s.empty}>No documents found</div>
      ) : (
        <div style={s.table}>
          <table style={s.tableInner}>
            <thead>
              <tr>
                <th style={s.th}>#</th>
                {columns.map((col) => (
                  <th key={col} style={s.th}>{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {docs.map((row) => (
                <tr
                  key={row._key}
                  style={{
                    ...s.tr,
                    ...(selectedDoc?._key === row._key ? s.trSelected : {}),
                    ...(hoveredRow === row._key ? s.trHover : {}),
                  }}
                  onClick={() => setSelectedDoc(selectedDoc?._key === row._key ? null : row)}
                  onMouseEnter={() => setHoveredRow(row._key)}
                  onMouseLeave={() => setHoveredRow(null)}
                >
                  <td style={{ ...s.td, ...s.rowNum }}>{row._index + 1}</td>
                  {columns.map((col) => (
                    <td key={col} style={s.td}>{formatCellValue(row.doc[col])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selectedDoc && (
        <div style={{ ...s.detailPanel, maxHeight: 250 }}>
          {JSON.stringify(selectedDoc.doc, null, 2)}
        </div>
      )}

      <div style={s.statusBar}>
        {loading ? 'Loading...' : `${docs.length} document(s)`}
        {filter && ` — filter: ${filter}`}
      </div>
    </div>
  );
}

function extractColumns(docs: Array<Record<string, unknown>>): string[] {
  const keys = new Set<string>();
  for (const d of docs) {
    for (const k of Object.keys(d)) {
      keys.add(k);
    }
  }
  return ['_id', ...Array.from(keys).filter((k) => k !== '_id').sort()];
}

function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') {
    if (value.length > 80) return value.slice(0, 80) + '…';
    return value;
  }
  if (typeof value === 'object') return JSON.stringify(value).slice(0, 80);
  return String(value);
}

function waitForDocumentResult(
  tabId: string,
  runId: string,
): Promise<{ docs: DocRecord[]; columns: string[]; cursorId?: string; hasMore: boolean } | null> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let unsubscribe: () => void = () => undefined;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      unsubscribe();
      reject(new Error('Timeout waiting for results'));
    }, 15_000);

    const inspect = () => {
      if (settled) return;
      const execution = useWorkspaceStore.getState().results[tabId];
      if (!execution || execution.runId !== runId) return;
      const item = execution.statementResults.find((candidate) => candidate.result.kind === 'documents');
      if (item?.result.kind === 'documents') {
        const result = item.result;
        const docs = result.documents.map((envelope, index) => ({
          _key: `doc-${index}`,
          _index: index,
          doc: parseDocumentEnvelope(envelope),
        }));
        settled = true;
        clearTimeout(timeout);
        unsubscribe();
        resolve({
          docs,
          columns: extractColumns(docs.map((doc) => doc.doc)),
          cursorId: result.cursorId,
          hasMore: result.hasMore,
        });
        return;
      }

      if (execution.status === 'failed' || execution.status === 'error' || execution.status === 'cancelled') {
        settled = true;
        clearTimeout(timeout);
        unsubscribe();
        const message = execution.error ??
          execution.statementErrors[0]?.error.message ??
          `Execution ${execution.status}`;
        reject(new Error(message));
      }
    };

    inspect();
    if (!settled) unsubscribe = useWorkspaceStore.subscribe(inspect);
  });
}

function parseDocumentEnvelope(envelope: { ejson: string; byteSize: number; truncated: boolean }): Record<string, unknown> {
  if (envelope.truncated) {
    return {
      $preview: envelope.ejson,
      $truncated: true,
      $originalBytes: envelope.byteSize,
    };
  }
  try {
    const parsed = JSON.parse(envelope.ejson) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return { $value: parsed };
  } catch {
    return { $preview: envelope.ejson, $parseError: true };
  }
}

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}
