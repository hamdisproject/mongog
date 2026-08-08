import { useMemo, useRef, useState } from 'react';
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  parseEjson,
  renderBson,
  type BsonDisplayMode,
  type EjsonEnvelope,
} from '../../../shared/ejson/index.js';
import type { QueryResult } from '../../../shared/domain/index.js';
import {
  useWorkspaceStore,
  type StatementErrorState,
  type StatementResultState,
} from '../../stores/workspace.js';
import { useSettingsStore } from '../../stores/settings.js';

const s: Record<string, React.CSSProperties> = {
  panel: {
    display: 'flex', flexDirection: 'column', width: '100%', height: '100%',
    minWidth: 0, minHeight: 0,
    background: 'var(--color-app)', borderTop: '1px solid var(--color-border)', overflow: 'hidden',
  },
  header: {
    minHeight: 28, padding: '2px 8px', fontSize: 11, color: 'var(--color-text-muted)', background: 'var(--color-panel)',
    borderBottom: '1px solid var(--color-border)', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8,
  },
  headerSpacer: { flex: 1 },
  select: {
    background: 'var(--color-input-soft)', color: 'var(--color-text)', border: '1px solid var(--color-border-strong)',
    padding: '1px 5px', borderRadius: 2, fontSize: 11,
  },
  content: { flex: 1, minWidth: 0, overflow: 'auto', padding: 6, fontSize: 12 },
  card: {
    border: '1px solid #353535', borderRadius: 3, marginBottom: 6,
    background: 'var(--color-app)', overflow: 'hidden',
  },
  cardHeader: {
    padding: '4px 8px', background: 'var(--color-panel-raised)', color: 'var(--color-text-muted)',
    fontSize: 11, display: 'flex', alignItems: 'center', gap: 8,
  },
  cardBody: { padding: 8 },
  code: {
    margin: 0, fontFamily: 'monospace', fontSize: 12, lineHeight: 1.45,
    whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', color: 'var(--color-text)',
  },
  errorCard: {
    border: '1px solid var(--color-danger-border)', background: 'var(--color-danger-surface)', color: 'var(--color-danger)',
    borderRadius: 3, padding: 8, marginBottom: 6,
  },
  console: {
    border: '1px solid var(--color-warning-border)', background: 'var(--color-warning-surface)', borderRadius: 3,
    padding: 8, marginBottom: 6, color: 'var(--color-warning-text)',
  },
  tableWrap: {
    width: '100%', maxWidth: '100%', minWidth: 0, overflow: 'auto',
    maxHeight: 300, border: '1px solid var(--color-border)',
  },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 11 },
  th: {
    position: 'sticky', top: 0, textAlign: 'left', padding: '4px 7px',
    background: 'var(--color-panel-raised)', color: 'var(--color-text-muted)', borderBottom: '1px solid var(--color-border)',
    whiteSpace: 'nowrap', zIndex: 1,
  },
  td: {
    padding: '3px 7px', borderBottom: '1px solid #303030',
    maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    fontFamily: 'monospace',
  },
  selectedRow: { background: 'var(--color-selected)' },
  controls: { display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, color: 'var(--color-text-muted)', fontSize: 11 },
  btn: {
    background: 'var(--color-input-soft)', color: 'var(--color-text)', border: '1px solid var(--color-border-strong)',
    padding: '2px 7px', borderRadius: 2, fontSize: 11, cursor: 'pointer',
  },
  btnDisabled: { opacity: 0.4, cursor: 'default' },
  empty: { padding: 18, color: 'var(--color-text-faint)', fontSize: 12, textAlign: 'center' },
  status: {
    padding: '2px 8px', fontSize: 11, color: 'var(--color-text-muted)', flexShrink: 0,
    borderTop: '1px solid var(--color-border)', background: 'var(--color-panel)',
  },
  badge: {
    padding: '1px 5px', borderRadius: 8, background: 'var(--color-border)', color: 'var(--color-text-muted)',
    fontSize: 10,
  },
};

export function ResultsPanel() {
  const { activeTabId, results } = useWorkspaceStore();
  const displayMode = useSettingsStore((state) => state.settings.ejson.defaultMode);
  const execution = activeTabId ? results[activeTabId] : undefined;

  if (!activeTabId || !execution) {
    return <div style={s.panel}><div style={s.empty}>Open a query tab to see results</div></div>;
  }

  const hasOutput = execution.statementResults.length > 0 ||
    execution.statementErrors.length > 0 ||
    execution.consoleEntries.length > 0 ||
    execution.skippedStatements.length > 0 ||
    execution.error !== null;

  return (
    <div style={s.panel}>
      <div style={s.header}>
        <span>Results</span>
        {execution.executionId && <span style={s.badge}>{execution.executionId.slice(0, 8)}</span>}
        <span style={s.badge}>{execution.status}</span>
        <span style={s.headerSpacer} />
        <span title="Change in Settings">{displayMode === 'mongosh' ? 'MongoDB Shell' : displayMode === 'relaxed' ? 'Relaxed EJSON' : 'Canonical EJSON'}</span>
      </div>

      <div style={s.content}>
        {!hasOutput && execution.status === 'idle' && (
          <div style={s.empty}>Run a query to see structured results</div>
        )}
        {!hasOutput && execution.status !== 'idle' && (
          <div style={s.empty}>{execution.status === 'starting' ? 'Starting execution…' : 'Waiting for results…'}</div>
        )}

        {execution.error && <div style={s.errorCard}>{execution.error}</div>}

        {execution.statementResults.map((item) => (
          <ResultCard
            key={`${item.index}:${resultIdentity(item.result)}`}
            tabId={activeTabId}
            connectionId={execution.connectionId}
            item={item}
            displayMode={displayMode}
          />
        ))}

        {execution.statementErrors.map((item) => (
          <ErrorCard key={`error:${item.index}`} item={item} />
        ))}

        {execution.consoleEntries.length > 0 && (
          <div style={s.console}>
            <div style={{ marginBottom: 5, fontSize: 11 }}>Console</div>
            {execution.consoleEntries.map((entry, index) => (
              <pre key={`${entry.statementIndex}:${index}`} style={s.code}>
                {`console.${entry.level} `}
                {entry.args.map((arg) => renderEnvelope(arg, displayMode, false)).join(' ')}
              </pre>
            ))}
          </div>
        )}

        {execution.skippedStatements.map((item) => (
          <div key={`skipped:${item.index}`} style={{ color: 'var(--color-text-muted)', padding: '2px 4px' }}>
            Statement {item.index + 1} skipped ({item.reason})
          </div>
        ))}
      </div>

      <div style={s.status}>
        {execution.durationMs === null
          ? execution.status
          : `${execution.status} in ${execution.durationMs.toFixed(0)} ms`}
      </div>
    </div>
  );
}

function ResultCard({
  tabId,
  connectionId,
  item,
  displayMode,
}: {
  tabId: string;
  connectionId: string | null;
  item: StatementResultState;
  displayMode: BsonDisplayMode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div style={s.card}>
      <div
        style={{ ...s.cardHeader, cursor: 'pointer', userSelect: 'none' }}
        role="button"
        tabIndex={0}
        aria-expanded={!collapsed}
        onClick={() => setCollapsed((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setCollapsed((current) => !current);
          }
        }}
      >
        <span style={{ width: 12, color: 'var(--color-text-muted)' }}>{collapsed ? '▶' : '▼'}</span>
        <span>Statement {item.index + 1}</span>
        <span style={s.badge}>{item.result.kind}</span>
        <span style={{ marginLeft: 'auto' }}>{item.durationMs.toFixed(1)} ms</span>
      </div>
      {!collapsed && <div style={s.cardBody}>
        {item.result.kind === 'documents' ? (
          <DocumentsResult
            tabId={tabId}
            connectionId={connectionId}
            item={item}
            result={item.result}
            displayMode={displayMode}
          />
        ) : (
          <NonDocumentResult result={item.result} displayMode={displayMode} />
        )}
      </div>}
    </div>
  );
}

function DocumentsResult({
  tabId,
  connectionId,
  item,
  result,
  displayMode,
}: {
  tabId: string;
  connectionId: string | null;
  item: StatementResultState;
  result: Extract<QueryResult, { kind: 'documents' }>;
  displayMode: BsonDisplayMode;
}) {
  const { updateDocumentPage, markCursorClosed } = useWorkspaceStore();
  const [loading, setLoading] = useState<'next' | 'prev' | 'close' | null>(null);
  const [loadingFullValueId, setLoadingFullValueId] = useState<string | null>(null);
  const [fullValues, setFullValues] = useState<Record<string, EjsonEnvelope>>({});
  const [error, setError] = useState<string | null>(null);
  const [selectedRow, setSelectedRow] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const rows = useMemo(
    () => result.documents.map((envelope) => envelopeToRow(envelope)),
    [result.documents],
  );
  const columns = useMemo(() => extractColumns(rows), [rows]);
  const columnDefinitions = useMemo<Array<ColumnDef<Record<string, unknown>>>>(
    () => [
      {
        id: '$row',
        header: '#',
        size: 48,
        cell: ({ row }) => row.index + 1,
      },
      ...columns.map((column) => ({
        id: column,
        header: column,
        accessorFn: (row: Record<string, unknown>) => row[column],
        size: column === '_id' ? 220 : 180,
        cell: ({ getValue }: { getValue: () => unknown }) => {
          const value = getValue();
          return (
            <span title={formatCell(value, displayMode, false)}>
              {formatCell(value, displayMode, true)}
            </span>
          );
        },
      })),
    ],
    [columns, displayMode],
  );
  const table = useReactTable({
    data: rows,
    columns: columnDefinitions,
    getCoreRowModel: getCoreRowModel(),
  });
  const tableRows = table.getRowModel().rows;
  const rowVirtualizer = useVirtualizer({
    count: tableRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 25,
    overscan: 8,
  });

  const fetchPage = async (direction: 'next' | 'prev') => {
    if (!connectionId || item.cursorClosed) return;
    setLoading(direction);
    setError(null);
    try {
      const page = direction === 'next'
        ? await window.mongog.query.cursorFetchNext(connectionId, result.cursorId, result.pageSize)
        : await window.mongog.query.cursorFetchPrev(connectionId, result.cursorId);
      updateDocumentPage(tabId, result.cursorId, page);
      setSelectedRow(null);
      setFullValues({});
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(null);
    }
  };

  const close = async () => {
    if (!connectionId || item.cursorClosed) return;
    setLoading('close');
    setError(null);
    try {
      await window.mongog.query.cursorClose(connectionId, result.cursorId);
      markCursorClosed(tabId, result.cursorId);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(null);
    }
  };

  const fetchFullValue = async (envelope: EjsonEnvelope) => {
    if (!connectionId || !envelope.fullValueId || item.cursorClosed) return;
    setLoadingFullValueId(envelope.fullValueId);
    setError(null);
    try {
      const full = await window.mongog.query.cursorFetchFull(
        connectionId,
        result.cursorId,
        envelope.fullValueId,
      );
      setFullValues((current) => ({ ...current, [envelope.fullValueId!]: full }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoadingFullValueId(null);
    }
  };

  const selectedEnvelope = selectedRow === null
    ? undefined
    : result.documents[selectedRow];
  const selectedFullEnvelope = selectedEnvelope?.fullValueId
    ? fullValues[selectedEnvelope.fullValueId]
    : undefined;

  return (
    <>
      {rows.length === 0 ? (
        <div style={s.empty}>No documents on this page</div>
      ) : (
        <div data-testid="query-documents-table-wrap" ref={scrollRef} style={s.tableWrap}>
          <table
            data-testid="query-documents-table"
            style={{
              ...s.table,
              display: 'grid',
              width: table.getTotalSize(),
              minWidth: '100%',
            }}
          >
            <thead style={{ display: 'grid', position: 'sticky', top: 0, zIndex: 2 }}>
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id} style={{ display: 'flex', width: '100%' }}>
                  {headerGroup.headers.map((header) => (
                    <th
                      key={header.id}
                      style={{
                        ...s.th,
                        display: 'block',
                        width: header.getSize(),
                        flex: header.id === '$row'
                          ? `0 0 ${header.getSize()}px`
                          : `1 0 ${header.getSize()}px`,
                      }}
                    >
                      {flexRender(header.column.columnDef.header, header.getContext())}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody
              style={{
                display: 'grid',
                height: rowVirtualizer.getTotalSize(),
                position: 'relative',
              }}
            >
              {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                const row = tableRows[virtualRow.index]!;
                return (
                  <tr
                    key={row.id}
                    style={{
                      ...(selectedRow === virtualRow.index ? s.selectedRow : {}),
                      display: 'flex',
                      position: 'absolute',
                      transform: `translateY(${virtualRow.start}px)`,
                      width: '100%',
                      height: virtualRow.size,
                    }}
                    onClick={() => setSelectedRow(
                      selectedRow === virtualRow.index ? null : virtualRow.index,
                    )}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td
                        key={cell.id}
                        style={{
                          ...s.td,
                          display: 'block',
                          width: cell.column.getSize(),
                          flex: cell.column.id === '$row'
                            ? `0 0 ${cell.column.getSize()}px`
                            : `1 0 ${cell.column.getSize()}px`,
                        }}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {selectedEnvelope && (
        <>
          <pre style={{ ...s.code, marginTop: 7 }}>
            {renderEnvelope(selectedFullEnvelope ?? selectedEnvelope, displayMode, true)}
          </pre>
          {selectedEnvelope.truncated && !selectedFullEnvelope && (
            <div style={s.controls}>
              {selectedEnvelope.fullValueId ? (
                <button
                  style={{
                    ...s.btn,
                    ...((loadingFullValueId !== null || item.cursorClosed) ? s.btnDisabled : {}),
                  }}
                  disabled={loadingFullValueId !== null || item.cursorClosed}
                  onClick={() => void fetchFullValue(selectedEnvelope)}
                >
                  {loadingFullValueId ? 'Fetching full document…' : 'Fetch full document'}
                </button>
              ) : (
                <span>Full value exceeds the retained-value budget; re-run with a narrower projection.</span>
              )}
            </div>
          )}
        </>
      )}

      <div style={s.controls}>
        <button
          style={{ ...s.btn, ...((item.pageIndex <= 0 || loading !== null || item.cursorClosed) ? s.btnDisabled : {}) }}
          disabled={item.pageIndex <= 0 || loading !== null || item.cursorClosed}
          onClick={() => void fetchPage('prev')}
        >
          Previous
        </button>
        <span>Page {item.pageIndex + 1}</span>
        <button
          style={{ ...s.btn, ...((!result.hasMore || loading !== null || item.cursorClosed) ? s.btnDisabled : {}) }}
          disabled={!result.hasMore || loading !== null || item.cursorClosed}
          onClick={() => void fetchPage('next')}
        >
          Next
        </button>
        <button
          style={{ ...s.btn, ...((loading !== null || item.cursorClosed) ? s.btnDisabled : {}) }}
          disabled={loading !== null || item.cursorClosed}
          onClick={() => void close()}
        >
          Close cursor
        </button>
        <span>{result.documents.length} document(s)</span>
        <span>{formatBytes(item.retainedBytes)} retained</span>
        {item.cursorClosed && <span>cursor closed</span>}
        {loading && <span>{loading}…</span>}
        {error && <span style={{ color: 'var(--color-danger)' }}>{error}</span>}
      </div>
    </>
  );
}

function NonDocumentResult({ result, displayMode }: { result: QueryResult; displayMode: BsonDisplayMode }) {
  switch (result.kind) {
    case 'scalar':
      return <pre style={s.code}>{renderEnvelope(result.value, displayMode, true)}</pre>;
    case 'command':
      return <pre style={s.code}>{renderEnvelope(result.value, displayMode, true)}</pre>;
    case 'write':
      return (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: result.raw ? 7 : 0 }}>
            <span style={s.badge}>{result.op}</span>
            {countEntries(result).map(([label, value]) => (
              <span key={label}>{label}: {value}</span>
            ))}
          </div>
          {result.raw && <pre style={s.code}>{renderEnvelope(result.raw, displayMode, true)}</pre>}
        </>
      );
    case 'opaque':
      return <pre style={s.code}>{result.preview}</pre>;
    case 'changeStream':
      return <div>Change stream {result.streamId.slice(0, 8)}… ({result.buffered} buffered)</div>;
    case 'console':
      return <div>{result.entries.length} console entr{result.entries.length === 1 ? 'y' : 'ies'}</div>;
    case 'error':
      return <div style={s.errorCard}>{result.error.category}: {result.error.message}</div>;
    case 'documents':
      return null;
  }
}

function ErrorCard({ item }: { item: StatementErrorState }) {
  return (
    <div style={s.errorCard}>
      <div style={{ fontWeight: 600 }}>
        Statement {item.index < 0 ? 'validation' : item.index + 1}: {item.error.category}
      </div>
      <div>{item.error.message}</div>
      {item.error.hint && <div style={{ color: '#d7ba7d', marginTop: 4 }}>{item.error.hint}</div>}
      <div style={{ opacity: 0.65, marginTop: 4 }}>
        line {item.range.startLine}, column {item.range.startCol} · {item.durationMs.toFixed(1)} ms
      </div>
    </div>
  );
}

function envelopeToRow(envelope: EjsonEnvelope): Record<string, unknown> {
  if (envelope.truncated) {
    return {
      $preview: envelope.ejson,
      $truncated: true,
      $originalBytes: envelope.byteSize,
    };
  }
  try {
    const value = parseEjson(envelope);
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return { $value: value };
  } catch {
    return { $preview: envelope.ejson, $parseError: true };
  }
}

function extractColumns(rows: Array<Record<string, unknown>>): string[] {
  const keys = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) keys.add(key);
  }
  return ['_id', ...[...keys].filter((key) => key !== '_id').sort()];
}

function renderEnvelope(envelope: EjsonEnvelope, mode: BsonDisplayMode, pretty: boolean): string {
  if (envelope.truncated) {
    return `${envelope.ejson}\n… truncated preview (${formatBytes(envelope.byteSize)} original)`;
  }
  try {
    return renderBson(parseEjson(envelope), mode, pretty);
  } catch {
    return envelope.ejson;
  }
}

function formatCell(value: unknown, mode: BsonDisplayMode, truncate: boolean): string {
  let rendered: string;
  try {
    rendered = renderBson(value, mode, false);
  } catch {
    rendered = String(value);
  }
  return truncate && rendered.length > 100 ? `${rendered.slice(0, 100)}…` : rendered;
}

function countEntries(result: Extract<QueryResult, { kind: 'write' }>): Array<[string, number]> {
  const counts: Array<[string, number]> = [];
  if (result.insertedCount !== undefined) counts.push(['inserted', result.insertedCount]);
  if (result.matchedCount !== undefined) counts.push(['matched', result.matchedCount]);
  if (result.modifiedCount !== undefined) counts.push(['modified', result.modifiedCount]);
  if (result.deletedCount !== undefined) counts.push(['deleted', result.deletedCount]);
  if (result.upsertedCount !== undefined) counts.push(['upserted', result.upsertedCount]);
  return counts;
}

function resultIdentity(result: QueryResult): string {
  return result.kind === 'documents' ? result.cursorId : result.kind;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}
