import { useMemo, useRef, useState } from 'react';
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type CellContext,
  type ColumnDef,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  parseEjson,
  renderBson,
  type BsonDisplayMode,
  type EjsonEnvelope,
} from '../../../shared/ejson/index.js';
import type {
  ExportFormat,
  QueryExportValue,
  QueryResult,
  TableColumnOrder,
} from '../../../shared/domain/index.js';
import {
  useWorkspaceStore,
  type StatementErrorState,
  type StatementResultState,
} from '../../stores/workspace.js';
import { useSettingsStore } from '../../stores/settings.js';
import {
  BsonTableCell,
  resolveBsonTableField,
} from '../Common/BsonTableCell.js';
import { ExportDialog } from '../Export/ExportDialog.js';
import { useExportJobsStore } from '../../stores/exports.js';
import { extractCollectionColumns } from '../../collection-workspace.js';
import { LoadingOverlay } from '../Common/LoadingOverlay.js';
import { cancelQueryExecution } from '../../query-cancellation.js';
import { formatConsoleEntry, formatConsoleOutput } from '../../console-output.js';
import {
  formatQueryErrorOutput,
  formatQueryResultOutput,
  renderQueryEnvelope,
} from '../../query-output.js';
import { useToastStore } from '../../stores/toasts.js';

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
  content: { position: 'relative', flex: 1, minWidth: 0, overflow: 'auto', padding: 6, fontSize: 12 },
  card: {
    border: '1px solid #353535', borderRadius: 3, marginBottom: 6,
    background: 'var(--color-app)', overflow: 'hidden',
  },
  cardHeader: {
    padding: '4px 8px', background: 'var(--color-panel-raised)', color: 'var(--color-text-muted)',
    fontSize: 11, display: 'flex', alignItems: 'center', gap: 8,
  },
  cardBody: { position: 'relative', padding: 8 },
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
  consoleCode: { userSelect: 'text', cursor: 'text' },
  tableWrap: {
    width: '100%', maxWidth: '100%', minWidth: 0, overflow: 'auto',
    maxHeight: 300, border: '1px solid var(--color-border)',
  },
  table: { display: 'block', borderCollapse: 'collapse', fontSize: 11 },
  th: {
    position: 'sticky', top: 0, textAlign: 'left', padding: '4px 7px',
    background: 'var(--color-panel-raised)', color: 'var(--color-text-muted)', borderBottom: '1px solid var(--color-border)',
    boxSizing: 'border-box', whiteSpace: 'nowrap', zIndex: 1,
  },
  td: {
    padding: '3px 7px', borderBottom: '1px solid #303030',
    maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    boxSizing: 'border-box', fontFamily: 'monospace',
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

interface ActiveResultFetch {
  operationId: string;
  direction: 'next' | 'prev';
  cancelled: boolean;
}

export function ResultsPanel() {
  const { activeTabId, results, tabs } = useWorkspaceStore();
  const displayMode = useSettingsStore((state) => state.settings.ejson.defaultMode);
  const tableColumnOrder = useSettingsStore((state) => state.settings.table.columnOrder);
  const execution = activeTabId ? results[activeTabId] : undefined;
  const database = tabs.find((tab) => tab.id === activeTabId)?.database ?? 'admin';

  if (!activeTabId || !execution) {
    return <div style={s.panel}><div style={s.empty}>Open a query tab to see results</div></div>;
  }

  const hasOutput = execution.statementResults.length > 0 ||
    execution.statementErrors.length > 0 ||
    execution.consoleEntries.length > 0 ||
    execution.skippedStatements.length > 0 ||
    execution.error !== null;
  const executionBusy = execution.status === 'starting' ||
    execution.status === 'running' || execution.status === 'cancelling';
  const executionLoadingLabel = execution.status === 'starting'
    ? 'Starting query…'
    : execution.status === 'cancelling'
      ? 'Cancelling query…'
      : 'Running query…';

  const copyConsoleOutput = async () => {
    const output = formatConsoleOutput(execution.consoleEntries, displayMode);
    try {
      await navigator.clipboard.writeText(output);
      useToastStore.getState().show('Console output copied.');
    } catch {
      useToastStore.getState().show('Could not copy console output.', 'error');
    }
  };

  return (
    <div style={s.panel}>
      <div style={s.header}>
        <span>Results</span>
        {execution.executionId && <span style={s.badge}>{execution.executionId.slice(0, 8)}</span>}
        <span style={s.badge}>{execution.status}</span>
        <span style={s.headerSpacer} />
        <span title="Change in Settings">{displayMode === 'mongosh' ? 'MongoDB Shell' : displayMode === 'relaxed' ? 'Relaxed EJSON' : 'Canonical EJSON'}</span>
      </div>

      <div style={s.content} aria-busy={executionBusy}>
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
            database={database}
            item={item}
            displayMode={displayMode}
            tableColumnOrder={tableColumnOrder}
          />
        ))}

        {execution.statementErrors.map((item) => (
          <ErrorCard key={`error:${item.index}`} item={item} />
        ))}

        {execution.consoleEntries.length > 0 && (
          <div style={s.console}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5, fontSize: 11 }}>
              <span>Console</span>
              <button
                type="button"
                aria-label="Copy console output"
                style={s.btn}
                onClick={() => void copyConsoleOutput()}
              >
                Copy
              </button>
            </div>
            {execution.consoleEntries.map((entry, index) => (
              <pre key={`${entry.statementIndex}:${index}`} style={{ ...s.code, ...s.consoleCode }}>
                {formatConsoleEntry(entry, displayMode)}
              </pre>
            ))}
          </div>
        )}

        {execution.skippedStatements.map((item) => (
          <div key={`skipped:${item.index}`} style={{ color: 'var(--color-text-muted)', padding: '2px 4px' }}>
            Statement {item.index + 1} skipped ({item.reason})
          </div>
        ))}
        {executionBusy && (
          <LoadingOverlay
            label={executionLoadingLabel}
            cancelling={execution.status === 'cancelling'}
            onCancel={() => void cancelQueryExecution(activeTabId)}
          />
        )}
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
  database,
  item,
  displayMode,
  tableColumnOrder,
}: {
  tabId: string;
  connectionId: string | null;
  database: string;
  item: StatementResultState;
  displayMode: BsonDisplayMode;
  tableColumnOrder: TableColumnOrder;
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
        <ExportResultAction
          connectionId={connectionId}
          database={database}
          item={item}
          displayMode={displayMode}
        />
        <CopyResultAction item={item} displayMode={displayMode} />
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
            tableColumnOrder={tableColumnOrder}
          />
        ) : (
          <NonDocumentResult result={item.result} displayMode={displayMode} />
        )}
      </div>}
    </div>
  );
}

function CopyResultAction({
  item,
  displayMode,
}: {
  item: StatementResultState;
  displayMode: BsonDisplayMode;
}) {
  const copy = async () => {
    const output = formatQueryResultOutput(item.result, displayMode);
    try {
      await navigator.clipboard.writeText(output);
      useToastStore.getState().show('Statement output copied.');
    } catch {
      useToastStore.getState().show('Could not copy statement output.', 'error');
    }
  };

  return (
    <button
      type="button"
      aria-label={`Copy Statement ${item.index + 1} output`}
      style={s.btn}
      onClick={(event) => {
        event.stopPropagation();
        void copy();
      }}
      onKeyDown={(event) => event.stopPropagation()}
    >
      Copy
    </button>
  );
}

function ExportResultAction({
  connectionId,
  database,
  item,
  displayMode,
}: {
  connectionId: string | null;
  database: string;
  item: StatementResultState;
  displayMode: BsonDisplayMode;
}) {
  const exportValue = queryExportValue(item.result);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!exportValue || !connectionId) return null;

  const start = async (format: ExportFormat) => {
    setBusy(true);
    setError(null);
    try {
      const result = await window.mongog.exports.startQueryResult({
        connectionId,
        database,
        statementIndex: item.index,
        format,
        bsonMode: displayMode,
        result: exportValue,
      });
      useExportJobsStore.getState().register(connectionId, result);
      setOpen(false);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <span
      style={{ display: 'inline-flex', alignItems: 'center' }}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <button style={s.btn} onClick={() => setOpen(true)}>Export…</button>
      {open && (
        <ExportDialog
          title={`Export Statement ${item.index + 1}`}
          allowAllMatching={false}
          busy={busy}
          onCancel={() => setOpen(false)}
          onExport={(format) => void start(format)}
        />
      )}
      {error && <span role="alert" title={error} style={{ color: 'var(--color-danger)', marginLeft: 5 }}>Export failed</span>}
    </span>
  );
}

function DocumentsResult({
  tabId,
  connectionId,
  item,
  result,
  displayMode,
  tableColumnOrder,
}: {
  tabId: string;
  connectionId: string | null;
  item: StatementResultState;
  result: Extract<QueryResult, { kind: 'documents' }>;
  displayMode: BsonDisplayMode;
  tableColumnOrder: TableColumnOrder;
}) {
  const { updateDocumentPage, markCursorClosed } = useWorkspaceStore();
  const [pageFetchState, setPageFetchState] = useState<{
    operationId: string;
    direction: 'next' | 'prev';
    cancelling: boolean;
  } | null>(null);
  const activePageFetchRef = useRef<ActiveResultFetch | null>(null);
  const [closing, setClosing] = useState(false);
  const [loadingFullValueId, setLoadingFullValueId] = useState<string | null>(null);
  const [fullValues, setFullValues] = useState<Record<string, EjsonEnvelope>>({});
  const [error, setError] = useState<string | null>(null);
  const [selectedRow, setSelectedRow] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const rows = useMemo(
    () => result.documents.map((envelope) => envelopeToRow(envelope)),
    [result.documents],
  );
  const columns = useMemo(
    () => extractCollectionColumns(rows.map((row) => row.value), tableColumnOrder),
    [rows, tableColumnOrder],
  );
  const columnDefinitions = useMemo<Array<ColumnDef<QueryTableRow>>>(
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
        size: column === '_id' ? 220 : 180,
        cell: ({ row }: CellContext<QueryTableRow, unknown>) => (
          <BsonTableCell
            field={resolveBsonTableField(
              row.original.value,
              column,
              row.original.fieldsKnown,
            )}
            mode={displayMode}
          />
        ),
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
    const operation: ActiveResultFetch = {
      operationId: crypto.randomUUID(),
      direction,
      cancelled: false,
    };
    activePageFetchRef.current = operation;
    setPageFetchState({ operationId: operation.operationId, direction, cancelling: false });
    setError(null);
    try {
      const page = direction === 'next'
        ? await window.mongog.query.cursorFetchNext(
            connectionId,
            result.cursorId,
            result.pageSize,
            operation.operationId,
          )
        : await window.mongog.query.cursorFetchPrev(connectionId, result.cursorId, operation.operationId);
      if (operation.cancelled || activePageFetchRef.current !== operation) {
        await window.mongog.query.cursorClose(connectionId, result.cursorId).catch(() => undefined);
        markCursorClosed(tabId, result.cursorId);
        return;
      }
      updateDocumentPage(tabId, result.cursorId, page);
      setSelectedRow(null);
      setFullValues({});
    } catch (err) {
      if (!operation.cancelled && !isCancellationError(err)) setError(errorMessage(err));
    } finally {
      if (activePageFetchRef.current === operation) {
        activePageFetchRef.current = null;
        setPageFetchState(null);
      }
    }
  };

  const cancelPageFetch = async () => {
    const operation = activePageFetchRef.current;
    if (!connectionId || !operation || operation.cancelled) return;
    operation.cancelled = true;
    setPageFetchState((current) => current?.operationId === operation.operationId
      ? { ...current, cancelling: true }
      : current);
    try {
      await window.mongog.query.cancelFetch(connectionId, operation.operationId);
      await window.mongog.query.cursorClose(connectionId, result.cursorId).catch(() => undefined);
      markCursorClosed(tabId, result.cursorId);
    } finally {
      if (activePageFetchRef.current === operation) {
        activePageFetchRef.current = null;
        setPageFetchState(null);
      }
    }
  };

  const close = async () => {
    if (!connectionId || item.cursorClosed) return;
    setClosing(true);
    setError(null);
    try {
      await window.mongog.query.cursorClose(connectionId, result.cursorId);
      markCursorClosed(tabId, result.cursorId);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setClosing(false);
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
              width: `max(100%, ${table.getTotalSize()}px)`,
            }}
          >
            <thead style={{ display: 'block', width: '100%', position: 'sticky', top: 0, zIndex: 2 }}>
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
                display: 'block',
                width: '100%',
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
            {renderQueryEnvelope(selectedFullEnvelope ?? selectedEnvelope, displayMode, true)}
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
          style={{ ...s.btn, ...((item.pageIndex <= 0 || pageFetchState !== null || closing || item.cursorClosed) ? s.btnDisabled : {}) }}
          disabled={item.pageIndex <= 0 || pageFetchState !== null || closing || item.cursorClosed}
          onClick={() => void fetchPage('prev')}
        >
          Previous
        </button>
        <span>Page {item.pageIndex + 1}</span>
        <button
          style={{ ...s.btn, ...((!result.hasMore || pageFetchState !== null || closing || item.cursorClosed) ? s.btnDisabled : {}) }}
          disabled={!result.hasMore || pageFetchState !== null || closing || item.cursorClosed}
          onClick={() => void fetchPage('next')}
        >
          Next
        </button>
        <button
          style={{ ...s.btn, ...((pageFetchState !== null || closing || item.cursorClosed) ? s.btnDisabled : {}) }}
          disabled={pageFetchState !== null || closing || item.cursorClosed}
          onClick={() => void close()}
        >
          Close cursor
        </button>
        <span>{result.documents.length} document(s)</span>
        <span>{formatBytes(item.retainedBytes)} retained</span>
        {item.cursorClosed && <span>cursor closed</span>}
        {closing && <span>close…</span>}
        {error && <span style={{ color: 'var(--color-danger)' }}>{error}</span>}
      </div>
      {pageFetchState && (
        <LoadingOverlay
          label={pageFetchState.cancelling
            ? 'Cancelling…'
            : pageFetchState.direction === 'next'
              ? 'Loading next page…'
              : 'Loading previous page…'}
          cancelling={pageFetchState.cancelling}
          onCancel={() => void cancelPageFetch()}
        />
      )}
    </>
  );
}

function NonDocumentResult({ result, displayMode }: { result: QueryResult; displayMode: BsonDisplayMode }) {
  switch (result.kind) {
    case 'scalar':
      return <pre style={s.code}>{renderQueryEnvelope(result.value, displayMode, true)}</pre>;
    case 'command':
      return <pre style={s.code}>{renderQueryEnvelope(result.value, displayMode, true)}</pre>;
    case 'write':
      return (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: result.raw ? 7 : 0 }}>
            <span style={s.badge}>{result.op}</span>
            {countEntries(result).map(([label, value]) => (
              <span key={label}>{label}: {value}</span>
            ))}
          </div>
          {result.raw && <pre style={s.code}>{renderQueryEnvelope(result.raw, displayMode, true)}</pre>}
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
  const copy = async () => {
    const output = formatQueryErrorOutput(item.error);
    try {
      await navigator.clipboard.writeText(output);
      useToastStore.getState().show('Statement output copied.');
    } catch {
      useToastStore.getState().show('Could not copy statement output.', 'error');
    }
  };

  return (
    <div style={s.errorCard}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ fontWeight: 600 }}>
          Statement {item.index < 0 ? 'validation' : item.index + 1}: {item.error.category}
        </div>
        <button
          type="button"
          aria-label={item.index < 0
            ? 'Copy validation error output'
            : `Copy Statement ${item.index + 1} output`}
          style={s.btn}
          onClick={() => void copy()}
        >
          Copy
        </button>
      </div>
      <div>{item.error.message}</div>
      {item.error.hint && <div style={{ color: '#d7ba7d', marginTop: 4 }}>{item.error.hint}</div>}
      <div style={{ opacity: 0.65, marginTop: 4 }}>
        line {item.range.startLine}, column {item.range.startCol} · {item.durationMs.toFixed(1)} ms
      </div>
    </div>
  );
}

interface QueryTableRow {
  value: Record<string, unknown>;
  fieldsKnown: boolean;
}

function envelopeToRow(envelope: EjsonEnvelope): QueryTableRow {
  if (envelope.truncated) {
    return {
      value: {
        $preview: envelope.ejson,
        $truncated: true,
        $originalBytes: envelope.byteSize,
      },
      fieldsKnown: false,
    };
  }
  try {
    const value = parseEjson(envelope);
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return { value: value as Record<string, unknown>, fieldsKnown: true };
    }
    return { value: { $value: value }, fieldsKnown: true };
  } catch {
    return {
      value: { $preview: envelope.ejson, $parseError: true },
      fieldsKnown: false,
    };
  }
}

function queryExportValue(result: QueryResult): QueryExportValue | null {
  switch (result.kind) {
    case 'documents':
      return { kind: 'documents', cursorId: result.cursorId };
    case 'scalar':
      return { kind: 'scalar', value: result.value };
    case 'command':
      return { kind: 'command', value: result.value };
    case 'write':
      return {
        kind: 'write',
        op: result.op,
        ...(result.insertedCount !== undefined ? { insertedCount: result.insertedCount } : {}),
        ...(result.matchedCount !== undefined ? { matchedCount: result.matchedCount } : {}),
        ...(result.modifiedCount !== undefined ? { modifiedCount: result.modifiedCount } : {}),
        ...(result.deletedCount !== undefined ? { deletedCount: result.deletedCount } : {}),
        ...(result.upsertedCount !== undefined ? { upsertedCount: result.upsertedCount } : {}),
      };
    case 'console':
    case 'changeStream':
    case 'opaque':
    case 'error':
      return null;
  }
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

function isCancellationError(error: unknown): boolean {
  return typeof error === 'object' && error !== null &&
    'category' in error && error.category === 'Cancellation';
}
