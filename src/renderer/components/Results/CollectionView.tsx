import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  parseDocumentArrayExpression,
  parseDocumentExpression,
  parseValueExpression,
} from '../../../features/script-analysis/index.js';
import type {
  CollectionBulkDeleteResult,
  CollectionBulkUpdateInput,
  CollectionBulkUpdateResult,
  DocumentCriteriaText,
  DocumentsPage,
  ExportFormat,
  ExportScope,
  WorkspaceTab,
} from '../../../shared/domain/index.js';
import { bulkFieldPathError } from '../../../shared/collection-update.js';
import {
  parseEjson,
  renderBson,
  type BsonDisplayMode,
  type EjsonEnvelope,
} from '../../../shared/ejson/index.js';
import { useConnectionStore } from '../../stores/connections.js';
import { useSchemaCache } from '../../stores/schema-cache.js';
import { useWorkspaceStore } from '../../stores/workspace.js';
import { useSettingsStore } from '../../stores/settings.js';
import {
  collectionDocumentsOwnerId,
  collectionPageSizeOptions,
  emptyDocumentCriteriaState,
  extractCollectionColumns,
  reconcileCollectionColumns,
  sqlQueryTemplate,
} from '../../collection-workspace.js';
import {
  columnFilterHelpText,
  compileColumnFilters,
  reorderColumns,
} from '../../collection-column-filter.js';
import {
  cycleColumnSort,
  readColumnSortIndicators,
  type ColumnSortDirection,
} from '../../collection-column-sort.js';
import { theme } from '../../theme.js';
import { QueryWorkspace } from '../Editor/QueryWorkspace.js';
import { SqlWorkspace } from '../Sql/SqlWorkspace.js';
import { CollectionCriteriaEditor } from './CollectionCriteriaEditor.js';
import { ColumnFilterInput } from './ColumnFilterInput.js';
import type { CriteriaKind } from '../../monaco/object-expression.js';
import { SavedActions } from '../Saved/SavedActions.js';
import { DocumentBsonEditor } from './DocumentBsonEditor.js';
import {
  BsonTableCell,
  resolveBsonTableField,
} from '../Common/BsonTableCell.js';
import { ExportDialog } from '../Export/ExportDialog.js';
import { useExportJobsStore } from '../../stores/exports.js';
import { useDataTransferStore } from '../../stores/data-transfer.js';
import { LoadingOverlay } from '../Common/LoadingOverlay.js';
import { BulkFieldPathCombobox } from './BulkFieldPathCombobox.js';
import {
  immutableDocumentIdError,
  prepareDocumentMutation,
  type PreparedDocumentMutation,
} from '../../document-mutation.js';

const s: Record<string, React.CSSProperties> = {
  workspace: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, overflow: 'hidden' },
  contextBar: {
    minHeight: 36, display: 'flex', alignItems: 'stretch', gap: 4, padding: '0 10px',
    background: theme.colors.panel, borderBottom: `1px solid ${theme.colors.border}`, flexShrink: 0,
  },
  contextNamespace: {
    color: 'var(--color-warning-text)', display: 'flex', alignItems: 'center', marginRight: 12,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12,
  },
  viewButton: {
    border: 0, borderBottom: '2px solid transparent', background: 'transparent',
    color: theme.colors.textMuted, padding: '0 12px', fontSize: 12, cursor: 'pointer',
  },
  viewButtonActive: { color: theme.colors.text, borderBottomColor: theme.colors.accentHover },
  betaBadge: {
    fontSize: 9, lineHeight: '14px', padding: '0 5px', borderRadius: 8,
    border: `1px solid ${theme.colors.accentHover}`, color: theme.colors.accentHover,
    textTransform: 'uppercase', letterSpacing: 0.4, flexShrink: 0,
  },
  surface: { flex: 1, minHeight: 0, overflow: 'hidden' },
  container: { display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' },
  toolbar: {
    display: 'flex', gap: 6, padding: '5px 8px', background: 'var(--color-panel-raised)',
    borderBottom: '1px solid var(--color-input-soft)', alignItems: 'center', flexShrink: 0, fontSize: 12,
  },
  criteriaPanel: {
    padding: '9px 10px 10px', background: theme.colors.panel, borderBottom: `1px solid ${theme.colors.border}`,
    display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0,
  },
  criteriaHeader: {
    display: 'flex', alignItems: 'center', gap: 8, color: theme.colors.textMuted, fontSize: 11,
  },
  criteriaActions: { display: 'flex', alignItems: 'center', gap: 6 },
  criteriaGrid: {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 8,
  },
  criteriaError: { color: theme.colors.danger, fontSize: 11 },
  button: {
    background: 'var(--color-accent)', color: '#fff', border: '1px solid var(--color-accent-hover)', padding: '3px 9px',
    borderRadius: 2, fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap',
  },
  secondaryButton: {
    background: 'var(--color-input-soft)', color: 'var(--color-text)', border: '1px solid var(--color-border-strong)', padding: '3px 9px',
    borderRadius: 2, fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap',
  },
  dangerButton: {
    background: 'var(--color-danger-button)', color: '#fff', border: '1px solid #b33a3a', padding: '3px 9px',
    borderRadius: 2, fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap',
  },
  disabled: { opacity: 0.45, cursor: 'default' },
  error: {
    padding: '6px 10px', color: '#f7b3b3', background: 'var(--color-danger-surface)', borderBottom: '1px solid #6f2929',
    fontSize: 11, display: 'flex', justifyContent: 'space-between', gap: 8,
  },
  notice: {
    padding: '5px 10px', color: 'var(--color-success-text)', background: 'var(--color-success-surface)', borderBottom: '1px solid var(--color-success-border)',
    fontSize: 11,
  },
  tableWrap: { flex: 1, minHeight: 0, overflow: 'auto', fontSize: 12 },
  table: { borderCollapse: 'collapse', width: '100%', tableLayout: 'fixed' },
  th: {
    padding: 0, textAlign: 'left', background: 'var(--color-panel)', color: 'var(--color-text-muted)',
    borderBottom: '1px solid var(--color-border)', position: 'sticky', top: 0, whiteSpace: 'nowrap',
    fontWeight: 500, fontSize: 11, zIndex: 1, overflow: 'visible',
  },
  columnTitle: { display: 'flex', alignItems: 'center', position: 'relative', gap: 5, padding: '4px 7px 2px' },
  columnSortControl: {
    minWidth: 0, flex: 1, display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer',
    color: 'var(--color-text-muted)', outline: 0,
  },
  sortBadge: {
    flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 1,
    color: 'var(--color-accent-hover)', fontWeight: 700,
  },
  sortPriority: { fontSize: 9, lineHeight: 1, fontVariantNumeric: 'tabular-nums' },
  filterHelp: {
    padding: '8px 10px', color: 'var(--color-text-muted)', background: 'var(--color-panel)',
    borderBottom: '1px solid var(--color-border)', fontSize: 11, flexShrink: 0,
    maxHeight: 'min(360px, 45vh)', overflow: 'auto',
  },
  filterHelpHeader: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 },
  filterHelpQuick: { lineHeight: 1.8 },
  filterHelpGrid: {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
    gap: 7, marginTop: 9,
  },
  filterHelpExample: {
    minWidth: 0, padding: '7px 8px', border: '1px solid var(--color-border)',
    borderRadius: 3, background: 'var(--color-input-soft)',
  },
  filterHelpExampleTitle: { display: 'block', color: 'var(--color-text)', marginBottom: 4 },
  filterHelpExamplePath: {
    display: 'block', color: 'var(--color-text-faint)', marginBottom: 4,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  },
  filterHelpExampleCode: {
    display: 'block', overflowX: 'auto', padding: '4px 6px', borderRadius: 2,
    background: 'var(--color-input)', color: 'var(--color-warning-text)',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', whiteSpace: 'nowrap',
  },
  resizeHandle: {
    position: 'absolute', top: 0, right: -3, width: 7, height: '100%', cursor: 'col-resize', zIndex: 3,
  },
  td: {
    padding: '3px 8px', borderBottom: '1px solid var(--color-border)', maxWidth: 340,
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  row: { cursor: 'pointer' },
  selectedRow: { background: 'var(--color-selected)' },
  bulkSelectedRow: { boxShadow: 'inset 3px 0 var(--color-accent)' },
  rowNumber: { color: 'var(--color-text-faint)', fontSize: 10, width: 68 },
  selectionCell: { display: 'flex', alignItems: 'center', gap: 7 },
  empty: { flex: 1, padding: 28, color: 'var(--color-text-faint)', fontSize: 12, textAlign: 'center' },
  emptyTableCell: {
    height: 86, padding: 20, color: 'var(--color-text-faint)', fontSize: 12,
    textAlign: 'center', borderBottom: '1px solid var(--color-border)',
  },
  editorPanel: {
    minHeight: 120, display: 'flex', flexDirection: 'column',
    borderTop: '1px solid var(--color-border)', background: 'var(--color-app)', flexShrink: 0,
  },
  documentPanelResizer: {
    height: 5, flexShrink: 0, cursor: 'row-resize', background: 'var(--color-panel-raised)',
    borderTop: '1px solid var(--color-border)', borderBottom: '1px solid var(--color-border)',
  },
  editorHeader: {
    display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px', background: 'var(--color-panel)',
    borderBottom: '1px solid var(--color-border)', fontSize: 11,
  },
  bulkControls: {
    display: 'flex', alignItems: 'center', gap: 8, padding: '7px 8px',
    background: 'var(--color-panel-raised)', borderBottom: '1px solid var(--color-border)',
    fontSize: 11, flexWrap: 'wrap',
  },
  bulkSelect: {
    border: '1px solid var(--color-border-strong)', borderRadius: 3,
    background: 'var(--color-input-soft)', color: 'var(--color-text)', padding: '4px 7px', fontSize: 11,
  },
  bulkFailures: {
    padding: '6px 10px', color: '#f7b3b3', background: 'var(--color-danger-surface)',
    borderBottom: '1px solid #6f2929', fontSize: 11, maxHeight: 150, overflow: 'auto',
  },
  editor: {
    flex: 1, resize: 'none', border: 0, outline: 0, padding: 10, background: 'var(--color-input)',
    color: 'var(--color-text)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: 12, lineHeight: 1.45,
  },
  status: {
    display: 'flex', justifyContent: 'space-between', gap: 10, padding: '3px 8px', fontSize: 11,
    color: 'var(--color-text-muted)', background: 'var(--color-panel)', borderTop: '1px solid var(--color-border)', flexShrink: 0,
  },
  pageSizeLabel: {
    display: 'inline-flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap',
  },
  pageSizeSelect: {
    height: 23, minWidth: 82, padding: '1px 22px 1px 7px', borderRadius: 3,
    border: '1px solid var(--color-border-strong)', background: 'var(--color-input-soft)',
    color: 'var(--color-text)', fontSize: 11, outline: 'none', cursor: 'pointer',
  },
};

const EMPTY_FILTER = '{}';
const COLUMN_DRAG_MIME = 'application/x-mongog-collection-column';

interface DocumentRow {
  key: string;
  absoluteIndex: number;
  envelope: EjsonEnvelope;
  value: Record<string, unknown> | null;
}

type EditorMode = 'view' | 'edit' | 'new';

interface BulkEditorState {
  originals: DocumentRow[];
  mode: 'field' | 'replace';
  fieldPath: string;
  fieldOperation: 'set' | 'unset';
  fieldValueText: string;
  fullDocumentsText: string;
  validationError: string | null;
}

interface BulkFailureState {
  operation: 'update' | 'delete';
  summary: string;
  errors: Array<{ rowNumber: number; message: string }>;
}

interface LoadDocumentsOptions {
  pageSize?: number;
  targetPageIndex?: number;
  preserveDocumentIds?: Set<string>;
}

interface ActiveDocumentFetch {
  operationId: string;
  cursorId: string | null;
  cancelled: boolean;
}

interface DocumentFetchState {
  operationId: string;
  label: string;
  cancelling: boolean;
}

export function CollectionView({ tab, active }: { tab: WorkspaceTab; active: boolean }) {
  const setCollectionView = useWorkspaceStore((state) => state.setCollectionView);
  const view = tab.collectionViewMode ?? 'documents';
  const namespace = `${tab.database ?? 'admin'}.${tab.collection ?? ''}`;

  return (
    <div style={s.workspace}>
      <div style={s.contextBar}>
        <span style={s.contextNamespace}>{namespace}</span>
        {(['documents', 'query', 'sql'] as const).map((candidate) => (
          <button
            key={candidate}
            style={{ ...s.viewButton, ...(view === candidate ? s.viewButtonActive : {}) }}
            aria-pressed={view === candidate}
            onClick={() => setCollectionView(tab.id, candidate)}
          >
            {candidate === 'documents' ? 'Documents' : candidate === 'query' ? 'Query' : 'SQL'}
            {candidate === 'sql' && (
              <span style={{ ...s.betaBadge, marginLeft: 5 }} aria-hidden="true">beta</span>
            )}
          </button>
        ))}
      </div>

      <div style={{ ...s.surface, display: view === 'documents' ? 'flex' : 'none' }}>
        <CollectionBrowser key={tab.id} tab={tab} />
      </div>

      {active && view === 'query' && (
        <div style={{ ...s.surface, display: 'flex', flexDirection: 'column' }}>
          <QueryWorkspace contextLocked />
        </div>
      )}

      {active && view === 'sql' && (
        <div style={{ ...s.surface, display: 'flex', flexDirection: 'column' }}>
          <SqlWorkspace contextLocked />
        </div>
      )}
    </div>
  );
}

function CollectionBrowser({ tab }: { tab: WorkspaceTab }) {
  const profiles = useConnectionStore((state) => state.profiles);
  const connected = useConnectionStore((state) => state.connected);
  const runtimeEpochs = useConnectionStore((state) => state.runtimeEpochs);
  const connect = useConnectionStore((state) => state.connect);
  const updateTab = useWorkspaceStore((state) => state.updateTab);
  const displayMode = useSettingsStore((state) => state.settings.ejson.defaultMode);
  const configuredPageSize = useSettingsStore((state) => state.settings.execution.pageSize);
  const tableColumnOrder = useSettingsStore((state) => state.settings.table.columnOrder);
  const connectionId = tab.connectionId ?? '';
  const runtimeEpoch = runtimeEpochs[connectionId] ?? 0;
  const database = tab.database ?? 'admin';
  const collection = tab.collection ?? '';
  const documentsOwnerId = collectionDocumentsOwnerId(tab.id);
  const readOnly = profiles.find((profile) => profile.id === connectionId)?.readOnly ?? true;
  const isConnected = !!connected[connectionId];
  const documentsState = tab.documentsState ?? emptyDocumentCriteriaState();
  const draftFilter = documentsState.draft.filter;
  const draftSort = documentsState.draft.sort;
  const draftProjection = documentsState.draft.projection;
  const criteria = documentsState.applied;
  const pageSizeOverride = tab.documentsPageSizeOverride;
  const effectivePageSize = pageSizeOverride ?? configuredPageSize;
  const pageSizeOptions = useMemo(
    () => collectionPageSizeOptions(configuredPageSize),
    [configuredPageSize],
  );

  const setDraftCriteria = (partial: Partial<DocumentCriteriaText>) => {
    updateTab(tab.id, {
      documentsState: {
        ...documentsState,
        draft: { ...documentsState.draft, ...partial },
      },
      ...(tab.savedItemId ? { dirty: true } : {}),
    });
  };
  const criteriaOpen = tab.documentsCriteriaOpen ?? true;
  const setCriteriaOpen = (open: boolean) => updateTab(tab.id, { documentsCriteriaOpen: open });
  const [criteriaErrors, setCriteriaErrors] = useState<Record<CriteriaKind, string | null>>({
    filter: null,
    sort: null,
    projection: null,
  });
  const latestPageSize = useRef(effectivePageSize);
  const [cursorPageSize, setCursorPageSize] = useState(effectivePageSize);
  const [cursorId, setCursorId] = useState<string | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [rows, setRows] = useState<DocumentRow[]>([]);
  const [selected, setSelected] = useState<DocumentRow | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<Set<string>>(() => new Set());
  const [bulkEditor, setBulkEditor] = useState<BulkEditorState | null>(null);
  const [bulkFailure, setBulkFailure] = useState<BulkFailureState | null>(null);
  const [editorMode, setEditorMode] = useState<EditorMode>('view');
  const [editorText, setEditorText] = useState('');
  const [editorValidationError, setEditorValidationError] = useState<string | null>(null);
  const [fetchState, setFetchState] = useState<DocumentFetchState | null>(null);
  const activeFetchRef = useRef<ActiveDocumentFetch | null>(null);
  const observedRuntimeEpoch = useRef(runtimeEpoch);
  const [editorBusy, setEditorBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);

  useEffect(() => {
    latestPageSize.current = effectivePageSize;
  }, [effectivePageSize]);

  useEffect(() => {
    if (observedRuntimeEpoch.current === runtimeEpoch) return;
    observedRuntimeEpoch.current = runtimeEpoch;
    const active = activeFetchRef.current;
    if (active) active.cancelled = true;
    activeFetchRef.current = null;
    setFetchState(null);
    setCursorId(null);
    setHasMore(false);
    setSelectedRowKeys(new Set());
    setBulkEditor(null);
    setBulkFailure(null);
    setError(null);
    setNotice('Connection restarted after query cancellation. Refresh to open a new cursor.');
  }, [runtimeEpoch]);

  const sortIndicators = useMemo(() => {
    try {
      return readColumnSortIndicators(criteria.sort);
    } catch {
      return [];
    }
  }, [criteria.sort]);
  const requiredSortColumns = useMemo(
    () => sortIndicators
      .map((indicator) => indicator.column)
      .filter((column) => !column.includes('.')),
    [sortIndicators],
  );
  const discoveredColumns = useMemo(
    () => extractCollectionColumns(
      rows.map((row) => row.value).filter(isDocumentValue),
      tableColumnOrder,
      requiredSortColumns,
    ),
    [requiredSortColumns, rows, tableColumnOrder],
  );
  const columnOrder = tab.documentsColumnOrder ?? [];
  const columnsManuallyReordered = tab.documentsColumnOrderManual ?? false;
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({});
  const [columnFilterErrors, setColumnFilterErrors] = useState<Record<string, string>>({});
  const [columnFilterHelpOpen, setColumnFilterHelpOpen] = useState(false);
  const [columnFilterExamplesOpen, setColumnFilterExamplesOpen] = useState(false);
  const [documentPanelHeight, setDocumentPanelHeight] = useState<number | null>(null);
  const collectionContainerRef = useRef<HTMLDivElement>(null);
  const documentsRegionRef = useRef<HTMLDivElement>(null);
  const documentPanelRef = useRef<HTMLDivElement>(null);
  const documentPanelResizeCleanup = useRef<(() => void) | null>(null);
  const [draggedColumn, setDraggedColumn] = useState<string | null>(null);
  const columns = useMemo(
    () => reconcileCollectionColumns(columnOrder, discoveredColumns, columnsManuallyReordered),
    [columnOrder, columnsManuallyReordered, discoveredColumns],
  );
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [countLoading, setCountLoading] = useState(false);
  const [countError, setCountError] = useState<string | null>(null);
  const countRequestGeneration = useRef(0);
  const loading = fetchState !== null;
  const selectedRows = useMemo(
    () => rows.filter((row) => selectedRowKeys.has(row.key)),
    [rows, selectedRowKeys],
  );
  const allRowsSelected = rows.length > 0 && selectedRows.length === rows.length;
  const sortIndicatorByColumn = useMemo(() => new Map(
    sortIndicators.map((indicator) => [indicator.column, indicator] as const),
  ), [sortIndicators]);

  useEffect(() => () => {
    documentPanelResizeCleanup.current?.();
  }, []);

  const maximumDocumentPanelHeight = () => {
    const container = collectionContainerRef.current;
    const region = documentsRegionRef.current;
    const panel = documentPanelRef.current;
    if (!container || !region || !panel) return null;
    const containerHeight = container.getBoundingClientRect().height;
    const regionHeight = region.getBoundingClientRect().height;
    const panelHeight = panel.getBoundingClientRect().height;
    if (containerHeight <= 0 || regionHeight <= 0 || panelHeight <= 0) return null;

    let fixedHeight = 0;
    for (const child of Array.from(container.children)) {
      if (child === region || child === panel || (child as HTMLElement).dataset.testid === 'document-panel-resizer') {
        continue;
      }
      const element = child as HTMLElement;
      const position = window.getComputedStyle(element).position;
      if (position === 'fixed' || position === 'absolute') continue;
      fixedHeight += element.getBoundingClientRect().height;
    }
    const resizerHeight = container.querySelector<HTMLElement>('[data-testid="document-panel-resizer"]')
      ?.getBoundingClientRect().height ?? 0;
    return Math.max(120, Math.floor(containerHeight - fixedHeight - resizerHeight - 120));
  };

  useEffect(() => {
    if (documentPanelHeight === null || typeof ResizeObserver === 'undefined') return undefined;
    const region = documentsRegionRef.current;
    const panel = documentPanelRef.current;
    if (!region || !panel) return undefined;

    const clampPanel = () => {
      const maximum = maximumDocumentPanelHeight();
      if (maximum !== null) setDocumentPanelHeight((current) => (
        current === null || current <= maximum ? current : maximum
      ));
    };
    const observer = new ResizeObserver(clampPanel);
    observer.observe(region);
    observer.observe(panel);
    clampPanel();
    return () => observer.disconnect();
  }, [
    documentPanelHeight,
    selected,
    editorMode,
    bulkEditor,
    criteriaOpen,
    columnFilterHelpOpen,
    columnFilterExamplesOpen,
    error,
    notice,
    isConnected,
    readOnly,
  ]);

  useEffect(() => {
    if (sameColumnOrder(columnOrder, columns)) return;
    updateTab(tab.id, { documentsColumnOrder: columns });
  }, [columnOrder, columns, tab.id, updateTab]);

  useEffect(() => {
    countRequestGeneration.current += 1;
    setTotalCount(null);
    setCountLoading(false);
    setCountError(null);
  }, [connectionId, database, collection, criteria.filter]);

  useEffect(() => {
    if (selected && editorMode === 'view') {
      setEditorText(renderDocumentEnvelope(selected.envelope, displayMode));
    }
  }, [displayMode, editorMode, selected]);

  const applyPage = useCallback((
    page: DocumentsPage,
    pageSize: number,
    preserveDocumentIds?: Set<string>,
  ) => {
    const nextRows = page.documents.map((envelope, index) =>
      createDocumentRow(envelope, page.pageIndex * pageSize + index),
    );
    setRows(nextRows);
    setPageIndex(page.pageIndex);
    setHasMore(page.hasMore);
    setSelected(null);
    setSelectedRowKeys(preserveDocumentIds
      ? new Set(nextRows
        .filter((row) => {
          const id = documentRowId(row);
          return id !== null && preserveDocumentIds.has(id);
        })
        .map((row) => row.key))
      : new Set());
    setEditorText('');
    setEditorMode('view');
    setBulkEditor(null);
  }, []);

  const loadInitial = useCallback(async (options: LoadDocumentsOptions = {}) => {
    if (!connectionId || !collection || !isConnected) {
      setCursorId(null);
      setHasMore(false);
      return;
    }
    const operation: ActiveDocumentFetch = {
      operationId: crypto.randomUUID(),
      cursorId: null,
      cancelled: false,
    };
    const previous = activeFetchRef.current;
    if (previous) {
      previous.cancelled = true;
      void window.mongog.query.cancelFetch(connectionId, previous.operationId).catch(() => undefined);
    }
    activeFetchRef.current = operation;
    setFetchState({ operationId: operation.operationId, label: 'Loading documents…', cancelling: false });
    setError(null);
    setNotice(null);
    try {
      const pageSize = options.pageSize ?? latestPageSize.current;
      let page = await window.mongog.query.collectionFind({
        connectionId,
        database,
        collection,
        tabId: documentsOwnerId,
        operationId: operation.operationId,
        filterEjson: criteria.filter || EMPTY_FILTER,
        ...(criteria.sort ? { sortEjson: criteria.sort } : {}),
        ...(criteria.projection ? { projectionEjson: criteria.projection } : {}),
        pageSize,
      });
      if (operation.cancelled || activeFetchRef.current !== operation) {
        await window.mongog.query.cursorClose(connectionId, page.cursorId).catch(() => undefined);
        return;
      }
      operation.cursorId = page.cursorId;
      const targetPageIndex = Math.max(0, Math.trunc(options.targetPageIndex ?? 0));
      while (page.pageIndex < targetPageIndex && page.hasMore) {
        operation.operationId = crypto.randomUUID();
        setFetchState({
          operationId: operation.operationId,
          label: `Reloading page ${Math.min(targetPageIndex + 1, page.pageIndex + 2)}…`,
          cancelling: false,
        });
        page = {
          ...(await window.mongog.query.cursorFetchNext(
            connectionId,
            page.cursorId,
            page.pageSize,
            operation.operationId,
          )),
          cursorId: page.cursorId,
          pageSize: page.pageSize,
        };
        if (operation.cancelled || activeFetchRef.current !== operation) return;
      }
      setCursorId(page.cursorId);
      setCursorPageSize(page.pageSize);
      applyPage(page, page.pageSize, options.preserveDocumentIds);
    } catch (caught) {
      if (!operation.cancelled && !isCancellationError(caught)) {
        setRows([]);
        setCursorId(null);
        setError(errorMessage(caught));
      }
    } finally {
      if (activeFetchRef.current === operation) {
        activeFetchRef.current = null;
        setFetchState(null);
      }
    }
  }, [connectionId, database, collection, documentsOwnerId, criteria, applyPage, isConnected]);

  const loadInitialRef = useRef(loadInitial);
  useEffect(() => {
    loadInitialRef.current = loadInitial;
  }, [loadInitial]);

  const changePageSize = async (value: string) => {
    const nextOverride = value === 'default' ? undefined : Number(value);
    const nextPageSize = nextOverride ?? configuredPageSize;
    latestPageSize.current = nextPageSize;
    updateTab(tab.id, { documentsPageSizeOverride: nextOverride });
    setPageIndex(0);
    setHasMore(false);
    setSelected(null);
    setEditorText('');
    setEditorMode('view');
    setBulkFailure(null);
    await loadInitial({ pageSize: nextPageSize });
  };

  useEffect(() => {
    void loadInitialRef.current();
    return () => {
      const active = activeFetchRef.current;
      if (active) {
        active.cancelled = true;
        void window.mongog.query.cancelFetch(connectionId, active.operationId).catch(() => undefined);
      }
      if (connectionId) void window.mongog.query.closeOwner(connectionId, documentsOwnerId);
    };
  }, [
    connectionId,
    database,
    collection,
    documentsOwnerId,
    criteria.filter,
    criteria.sort,
    criteria.projection,
  ]);

  const applyCriteria = () => {
    if (bulkEditor) return;
    const compiledColumns = compileColumnFilters(columnFilters);
    setColumnFilterErrors(compiledColumns.errors);
    if (Object.keys(compiledColumns.errors).length > 0) return;
    const next = {
      filter: draftFilter.trim() || EMPTY_FILTER,
      sort: draftSort.trim(),
      projection: draftProjection.trim(),
    };
    const errors = validateCriteria(next);
    setCriteriaErrors(errors);
    if (Object.values(errors).some(Boolean)) return;
    updateTab(tab.id, {
      documentsState: { draft: { ...next }, applied: { ...next } },
      ...(tab.savedItemId ? { dirty: true } : {}),
    });
  };

  const clearCriteria = () => {
    if (bulkEditor) return;
    setColumnFilters({});
    setColumnFilterErrors({});
    setCriteriaErrors({ filter: null, sort: null, projection: null });
    const cleared = { filter: EMPTY_FILTER, sort: '', projection: '' };
    updateTab(tab.id, {
      documentsState: { draft: { ...cleared }, applied: { ...cleared } },
      ...(tab.savedItemId ? { dirty: true } : {}),
    });
  };

  const updateColumnFilter = (column: string, value: string) => {
    const next = { ...columnFilters, [column]: value };
    if (!value) delete next[column];
    setColumnFilters(next);
    const compiled = compileColumnFilters(next);
    setColumnFilterErrors(compiled.errors);
    if (Object.keys(compiled.errors).length === 0) {
      setDraftCriteria({ filter: compiled.expression });
      setCriteriaErrors((current) => ({ ...current, filter: null }));
    }
  };

  const beginDocumentPanelResize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const region = documentsRegionRef.current;
    const panel = documentPanelRef.current;
    if (!region || !panel) return;

    const startY = event.clientY;
    const startPanelHeight = panel.getBoundingClientRect().height;
    const startRegionHeight = region.getBoundingClientRect().height;
    if (startPanelHeight <= 0 || startRegionHeight <= 0) return;
    const maximumPanelHeight = maximumDocumentPanelHeight() ?? Math.max(
      120,
      startPanelHeight + startRegionHeight - 120,
    );

    documentPanelResizeCleanup.current?.();
    const onMove = (moveEvent: PointerEvent) => {
      const next = startPanelHeight + startY - moveEvent.clientY;
      setDocumentPanelHeight(Math.round(Math.max(120, Math.min(maximumPanelHeight, next))));
    };
    const cleanup = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', cleanup);
      window.removeEventListener('pointercancel', cleanup);
      window.removeEventListener('blur', cleanup);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      if (documentPanelResizeCleanup.current === cleanup) documentPanelResizeCleanup.current = null;
    };
    documentPanelResizeCleanup.current = cleanup;
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', cleanup, { once: true });
    window.addEventListener('pointercancel', cleanup, { once: true });
    window.addEventListener('blur', cleanup, { once: true });
  };

  const applyColumnSort = (column: string) => {
    if (bulkEditor) return;
    try {
      const next = cycleColumnSort(draftSort, column);
      setCriteriaErrors((current) => ({ ...current, sort: null }));
      updateTab(tab.id, {
        documentsState: {
          draft: { ...documentsState.draft, sort: next.source },
          // Header sorting is immediate, but must not apply pending Filter or Projection drafts.
          applied: { ...documentsState.applied, sort: next.source },
        },
        ...(tab.savedItemId ? { dirty: true } : {}),
      });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setCriteriaErrors((current) => ({ ...current, sort: message }));
    }
  };

  const moveColumn = (source: string, target: string) => {
    if (source === target) return;
    const order = columnOrder.length > 0 ? [...columnOrder] : [...columns];
    updateTab(tab.id, {
      documentsColumnOrder: reorderColumns(order, source, target),
      documentsColumnOrderManual: true,
    });
  };

  const beginColumnResize = (event: React.PointerEvent, column: string) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = columnWidths[column] ?? (column === '_id' ? 220 : 180);
    const onMove = (moveEvent: PointerEvent) => {
      const width = Math.max(90, Math.min(720, startWidth + moveEvent.clientX - startX));
      setColumnWidths((current) => ({ ...current, [column]: width }));
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
  };

  const calculateTotalCount = async () => {
    const generation = ++countRequestGeneration.current;
    setCountLoading(true);
    setCountError(null);
    try {
      const result = await window.mongog.query.collectionCount({
        connectionId,
        database,
        collection,
        filterEjson: criteria.filter || EMPTY_FILTER,
      });
      if (generation !== countRequestGeneration.current) return;
      setTotalCount(result.count);
    } catch (caught) {
      if (generation !== countRequestGeneration.current) return;
      setCountError(errorMessage(caught));
    } finally {
      if (generation === countRequestGeneration.current) setCountLoading(false);
    }
  };

  const fetchPage = async (direction: 'next' | 'previous') => {
    if (!cursorId || bulkEditor) return;
    const operation: ActiveDocumentFetch = {
      operationId: crypto.randomUUID(),
      cursorId,
      cancelled: false,
    };
    activeFetchRef.current = operation;
    setFetchState({
      operationId: operation.operationId,
      label: direction === 'next' ? 'Loading next page…' : 'Loading previous page…',
      cancelling: false,
    });
    setError(null);
    try {
      const page = direction === 'next'
        ? await window.mongog.query.cursorFetchNext(connectionId, cursorId, cursorPageSize, operation.operationId)
        : await window.mongog.query.cursorFetchPrev(connectionId, cursorId, operation.operationId);
      if (operation.cancelled || activeFetchRef.current !== operation) return;
      applyPage(page, cursorPageSize);
    } catch (caught) {
      if (!operation.cancelled && !isCancellationError(caught)) setError(errorMessage(caught));
    } finally {
      if (activeFetchRef.current === operation) {
        activeFetchRef.current = null;
        setFetchState(null);
      }
    }
  };

  const cancelFetch = async () => {
    const operation = activeFetchRef.current;
    if (!operation || operation.cancelled) return;
    operation.cancelled = true;
    setFetchState((current) => current?.operationId === operation.operationId
      ? { ...current, label: 'Cancelling…', cancelling: true }
      : current);
    setCursorId(null);
    setHasMore(false);
    try {
      await window.mongog.query.cancelFetch(connectionId, operation.operationId);
      if (operation.cursorId) {
        await window.mongog.query.cursorClose(connectionId, operation.cursorId).catch(() => undefined);
      }
    } finally {
      if (activeFetchRef.current === operation) {
        activeFetchRef.current = null;
        setFetchState(null);
      }
    }
  };

  const selectRow = async (row: DocumentRow) => {
    if (bulkEditor) return;
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
      setEditorText(renderDocumentEnvelope(envelope, displayMode));
      setEditorValidationError(null);
      setEditorMode('view');
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setEditorBusy(false);
    }
  };

  const toggleRowSelection = (row: DocumentRow) => {
    if (bulkEditor || busy) return;
    setBulkFailure(null);
    setSelectedRowKeys((current) => {
      const next = new Set(current);
      if (next.has(row.key)) next.delete(row.key);
      else next.add(row.key);
      return next;
    });
  };

  const toggleAllRows = () => {
    if (bulkEditor || busy) return;
    setBulkFailure(null);
    setSelectedRowKeys(allRowsSelected ? new Set() : new Set(rows.map((row) => row.key)));
  };

  const loadCompleteSelectedRows = async (): Promise<DocumentRow[]> => {
    const completeRows: DocumentRow[] = [];
    for (const row of selectedRows) {
      let envelope = row.envelope;
      if (envelope.truncated) {
        if (!cursorId || !envelope.fullValueId) {
          throw new Error('A selected document is too large and its full value is unavailable. Refresh or select fewer documents.');
        }
        envelope = await window.mongog.query.cursorFetchFull(
          connectionId,
          cursorId,
          envelope.fullValueId,
        );
      }
      const complete = createDocumentRow(envelope, row.absoluteIndex);
      if (!complete.value) throw new Error(`Document ${row.absoluteIndex + 1} could not be decoded.`);
      completeRows.push({ ...complete, key: row.key });
    }
    return completeRows;
  };

  const openBulkEditor = async () => {
    if (selectedRows.length === 0 || readOnly || projectionActive || !isConnected || busy) return;
    setEditorBusy(true);
    setError(null);
    setNotice(null);
    setBulkFailure(null);
    try {
      const completeRows = await loadCompleteSelectedRows();
      const editableDocuments = completeRows.map((row) => row.value!);
      setSelected(null);
      setEditorText('');
      setEditorMode('view');
      setBulkEditor({
        originals: completeRows,
        mode: 'field',
        fieldPath: columns.find((column) => column !== '_id') ?? '',
        fieldOperation: 'set',
        fieldValueText: 'null',
        fullDocumentsText: renderBson(editableDocuments, displayMode, true, 'editable'),
        validationError: null,
      });
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setEditorBusy(false);
    }
  };

  const saveBulkUpdate = async () => {
    if (!bulkEditor || readOnly || projectionActive || !isConnected || editorBusy) return;
    let change: CollectionBulkUpdateInput['change'];
    try {
      if (bulkEditor.mode === 'field') {
        const path = bulkEditor.fieldPath.trim();
        const pathError = bulkFieldPathError(path);
        if (pathError) throw new Error(pathError);
        change = bulkEditor.fieldOperation === 'set'
          ? {
            kind: 'field',
            path,
            operation: 'set',
            valueEjson: parseValueExpression(bulkEditor.fieldValueText, 'Field value').json,
          }
          : { kind: 'field', path, operation: 'unset' };
      } else {
        const parsed = parseDocumentArrayExpression(bulkEditor.fullDocumentsText, 'Documents');
        const edited = parseDocumentArrayJson(parsed.json);
        const ordered = alignBulkReplacementDocuments(bulkEditor.originals, edited);
        change = {
          kind: 'replace',
          documentsEjson: ordered.map((document) => renderBson(document, 'canonical', true)),
        };
      }
    } catch (caught) {
      const message = errorMessage(caught);
      setBulkEditor((current) => current ? { ...current, validationError: message } : current);
      setError(message);
      return;
    }

    const operationSummary = change.kind === 'field'
      ? `${change.operation === 'set' ? 'Set' : 'Remove'} field "${change.path}"`
      : 'Replace full documents';
    if (!window.confirm(`${operationSummary} for ${bulkEditor.originals.length} selected document(s)?`)) return;

    const targetPageIndex = pageIndex;
    setEditorBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await window.mongog.query.collectionBulkUpdate({
        connectionId,
        database,
        collection,
        originalDocumentsEjson: bulkEditor.originals.map((row) => row.envelope.ejson),
        change,
      });
      const failedItems = result.items.filter(
        (item): item is Extract<CollectionBulkUpdateResult['items'][number], { status: 'error' }> => (
          item.status === 'error'
        ),
      );
      const failedIds = new Set(failedItems.flatMap((item) => {
        const row = bulkEditor.originals[item.index];
        const id = row ? documentRowId(row) : null;
        return id ? [id] : [];
      }));
      if (result.matchedCount > 0) {
        useSchemaCache.getState().invalidate(connectionId, database, collection);
      }
      setBulkEditor(null);
      await loadInitial({ targetPageIndex, preserveDocumentIds: failedIds });
      const summary = bulkUpdateSummary(result);
      setNotice(failedItems.length === 0 ? summary : null);
      setBulkFailure(failedItems.length > 0 ? {
        operation: 'update',
        summary,
        errors: failedItems.map((item) => ({
          rowNumber: (bulkEditor.originals[item.index]?.absoluteIndex ?? item.index) + 1,
          message: item.error.message,
        })),
      } : null);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setEditorBusy(false);
    }
  };

  const deleteSelectedDocuments = async () => {
    if (selectedRows.length === 0 || readOnly || projectionActive || !isConnected || busy || bulkEditor) return;
    const targetPageIndex = pageIndex;
    setEditorBusy(true);
    setError(null);
    setNotice(null);
    setBulkFailure(null);
    try {
      const completeRows = await loadCompleteSelectedRows();
      const noun = completeRows.length === 1 ? 'document' : 'documents';
      const confirmed = window.confirm(
        `Delete ${completeRows.length} selected ${noun} from ${database}.${collection}? This operation cannot be undone.`,
      );
      if (!confirmed) return;

      const result = await window.mongog.query.collectionBulkDelete({
        connectionId,
        database,
        collection,
        originalDocumentsEjson: completeRows.map((row) => row.envelope.ejson),
      });
      const failedItems = result.items.filter(
        (item): item is Extract<CollectionBulkDeleteResult['items'][number], { status: 'error' }> => (
          item.status === 'error'
        ),
      );
      const failedIds = new Set(failedItems.flatMap((item) => {
        const row = completeRows[item.index];
        const id = row ? documentRowId(row) : null;
        return id ? [id] : [];
      }));
      if (result.deletedCount > 0) {
        useSchemaCache.getState().invalidate(connectionId, database, collection);
      }
      await loadInitial({ targetPageIndex, preserveDocumentIds: failedIds });
      const summary = bulkDeleteSummary(result);
      setNotice(failedItems.length === 0 ? summary : null);
      setBulkFailure(failedItems.length > 0 ? {
        operation: 'delete',
        summary,
        errors: failedItems.map((item) => ({
          rowNumber: (completeRows[item.index]?.absoluteIndex ?? item.index) + 1,
          message: item.error.message,
        })),
      } : null);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setEditorBusy(false);
    }
  };

  const openNewDocument = () => {
    setSelected(null);
    setSelectedRowKeys(new Set());
    setBulkEditor(null);
    setBulkFailure(null);
    setEditorMode('new');
    setEditorText('{\n  \n}');
    setEditorValidationError(null);
    setError(null);
    setNotice(null);
  };

  const saveDocument = async () => {
    if (readOnly || editorMode === 'view' || editorValidationError) return;
    let preparedDocument: PreparedDocumentMutation;
    try {
      preparedDocument = prepareDocumentMutation(editorText, 'Document');
      if (editorMode === 'edit' && selected) {
        const immutableIdError = immutableDocumentIdError(selected.envelope.ejson, preparedDocument);
        if (immutableIdError) throw new Error(immutableIdError);
      }
    } catch (caught) {
      setEditorValidationError(errorMessage(caught));
      setError(errorMessage(caught));
      return;
    }
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
          documentEjson: preparedDocument.documentEjson,
        });
        successMessage = 'Document inserted.';
      } else {
        if (!selected) throw new Error('No document selected.');
        await window.mongog.query.collectionReplace({
          connectionId,
          database,
          collection,
          originalDocumentEjson: selected.envelope.ejson,
          documentEjson: preparedDocument.documentEjson,
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
  const canBulkEdit = !readOnly && isConnected && !projectionActive && selectedRows.length > 0;
  const canBulkDelete = !readOnly && isConnected && !projectionActive && selectedRows.length > 0;
  const documentPanelOpen = !!bulkEditor || !!selected || editorMode === 'new';
  const normalizedDraft = {
    filter: draftFilter.trim() || EMPTY_FILTER,
    sort: draftSort.trim(),
    projection: draftProjection.trim(),
  };
  const unappliedCriteria = !sameCriteria(criteria, normalizedDraft);
  const invalidCriteria = Object.values(criteriaErrors).some(Boolean) ||
    Object.keys(columnFilterErrors).length > 0;
  const criteriaCount = [
    criteria.filter.trim() !== EMPTY_FILTER,
    criteria.sort.length > 0,
    criteria.projection.length > 0,
  ].filter(Boolean).length;
  const criteriaSummary = `Criteria · ${criteriaCount}${
    unappliedCriteria ? ' · edited' : ''
  }${invalidCriteria ? ' · invalid' : ''}`;
  const firstColumnError = Object.entries(columnFilterErrors)[0];
  const criteriaError = firstColumnError
    ? `${firstColumnError[0]}: ${firstColumnError[1]}`
    : Object.values(criteriaErrors).find(Boolean) ?? null;

  const handleCriteriaValidation = (kind: CriteriaKind, message: string | null) => {
    setCriteriaErrors((current) => current[kind] === message
      ? current
      : { ...current, [kind]: message });
  };

  const startExport = async (format: ExportFormat, scope: ExportScope) => {
    if (!cursorId || !connectionId) return;
    setExportBusy(true);
    setError(null);
    try {
      const result = await window.mongog.exports.startCollection({
        connectionId,
        database,
        collection,
        cursorId,
        scope,
        format,
        filterEjson: criteria.filter || EMPTY_FILTER,
        ...(criteria.sort ? { sortEjson: criteria.sort } : {}),
        ...(criteria.projection ? { projectionEjson: criteria.projection } : {}),
        bsonMode: displayMode,
        columnOrder: columns,
      });
      useExportJobsStore.getState().register(connectionId, result);
      setExportOpen(false);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setExportBusy(false);
    }
  };

  if (!collection) {
    return <div style={s.empty}>This saved view has no collection. Edit its saved details to assign a namespace.</div>;
  }

  return (
    <div ref={collectionContainerRef} style={s.container}>
      <div style={s.toolbar}>
        <SavedActions tab={tab} surface="documents" />
        <button
          style={{ ...s.secondaryButton, ...(criteriaOpen ? { borderColor: theme.colors.accentHover } : {}) }}
          aria-expanded={criteriaOpen}
          aria-controls={`criteria-${tab.id}`}
          onClick={() => setCriteriaOpen(!criteriaOpen)}
        >
          {criteriaSummary}
        </button>
        <button
          type="button"
          style={{ ...s.secondaryButton, ...(columnFilterHelpOpen ? { borderColor: theme.colors.accentHover } : {}) }}
          aria-label="Show column filter syntax"
          aria-expanded={columnFilterHelpOpen}
          title={columnFilterHelpText()}
          onClick={() => setColumnFilterHelpOpen((open) => !open)}
        >
          Filter syntax &amp; examples
        </button>
        <ToolbarButton secondary onClick={() => setExportOpen(true)} disabled={busy || !cursorId}>Export…</ToolbarButton>
        <ToolbarButton secondary onClick={() => useDataTransferStore.getState().open({
          mode: 'file-import',
          targetConnectionId: connectionId,
          sourceDatabase: database,
          sourceCollection: collection,
        })} disabled={busy || readOnly || !isConnected}>Import…</ToolbarButton>
        <ToolbarButton secondary onClick={() => useDataTransferStore.getState().open({
          mode: 'connection-copy',
          sourceConnectionId: connectionId,
          sourceDatabase: database,
          sourceCollection: collection,
          filterSource: criteria.filter || EMPTY_FILTER,
        })} disabled={busy || !isConnected}>Transfer matching documents…</ToolbarButton>
        {!isConnected && connectionId && (
          <ToolbarButton onClick={() => void connect(connectionId)} disabled={busy}>Connect</ToolbarButton>
        )}
        <ToolbarButton
          secondary
          onClick={() => void openBulkEditor()}
          disabled={!canBulkEdit || busy || !!bulkEditor}
        >
          Edit selected ({selectedRows.length})
        </ToolbarButton>
        <ToolbarButton
          danger
          onClick={() => void deleteSelectedDocuments()}
          disabled={!canBulkDelete || busy || !!bulkEditor}
        >
          Delete selected ({selectedRows.length})
        </ToolbarButton>
        <ToolbarButton onClick={openNewDocument} disabled={readOnly || busy || !!bulkEditor}>New</ToolbarButton>
        <ToolbarButton
          secondary
          onClick={() => useWorkspaceStore.getState().openSql({
            connectionId,
            database,
            title: `${database}.${collection} SQL`,
            editorContent: sqlQueryTemplate(collection, effectivePageSize),
          })}
          disabled={busy}
        >
          Open in SQL
        </ToolbarButton>
      </div>

      {exportOpen && (
        <ExportDialog
          title={`Export ${database}.${collection}`}
          allowAllMatching
          unappliedCriteria={unappliedCriteria}
          busy={exportBusy}
          onCancel={() => setExportOpen(false)}
          onExport={(format, scope) => void startExport(format, scope)}
        />
      )}

      {columnFilterHelpOpen && (
        <div style={s.filterHelp} role="note">
          <div style={s.filterHelpHeader}>
            <strong style={{ color: 'var(--color-text)' }}>Column filter syntax</strong>
            <span style={{ flex: 1 }} />
            <button
              type="button"
              style={s.secondaryButton}
              aria-expanded={columnFilterExamplesOpen}
              onClick={() => setColumnFilterExamplesOpen((open) => !open)}
            >
              {columnFilterExamplesOpen ? 'Fewer examples' : 'More examples'}
            </button>
          </div>
          <div style={s.filterHelpQuick}>
            <strong>Quick:</strong>{' '}
            exact text · <code>{'""'}</code> empty string · <code>*text*</code> · <code>&lt;&gt; 10</code> · <code>100..200</code> ·{' '}
            <code>has *Com*</code> · <code>!has *Com*</code> · <code>len = 3</code> ·{' '}
            <code>AND</code> / <code>OR</code>
            <br />
            <strong>Nested:</strong>{' '}
            object <code>{'{field}: value'}</code> · array object <code>{'[{field}]: value'}</code> ·{' '}
            repeat selectors for deeper paths.
          </div>
          {columnFilterExamplesOpen && (
            <div style={s.filterHelpGrid} data-testid="column-filter-examples">
              <FilterSyntaxExample
                title="Empty string"
                path="status"
                source={'""'}
              />
              <FilterSyntaxExample
                title="Nested empty string"
                path="profile.nickname"
                source={'{nickname}: ""'}
              />
              <FilterSyntaxExample
                title="Empty string inside an array"
                path="tags[]"
                source={'has ""'}
              />
              <FilterSyntaxExample
                title="Nested object field"
                path="location.address.street1"
                source="{address}{street1}: *Monte Vista*"
              />
              <FilterSyntaxExample
                title="Value inside a scalar array"
                path="location.geo.coordinates[]"
                source="{geo}{coordinates}: has -121.96328"
              />
              <FilterSyntaxExample
                title="Exact scalar array"
                path="location.geo.coordinates"
                source="{geo}{coordinates}: [-121.96328, 38.367649]"
              />
              <FilterSyntaxExample
                title="Array of objects"
                path="products[].name"
                source="[{name}]: *Com*"
              />
              <FilterSyntaxExample
                title="Nested arrays of objects"
                path="orders[].items[].sku"
                source="[{items}][{sku}]: A-42"
              />
              <FilterSyntaxExample
                title="Object then array of objects"
                path="container.items[].price"
                source="{items}[{price}]: 100..200"
              />
              <FilterSyntaxExample
                title="Same array element"
                path="products[].name + products[].price"
                source="[{name}]: *Com* AND [{price}]: < 200"
              />
              <FilterSyntaxExample
                title="Nested array length and membership"
                path="orders[].items[].tags"
                source="[{items}][{tags}]: len >= 2 AND has *wifi*"
              />
            </div>
          )}
        </div>
      )}

      {criteriaOpen && (
        <div id={`criteria-${tab.id}`} style={s.criteriaPanel}>
          <div style={s.criteriaHeader}>
            <span>Mongo object syntax · Cmd/Ctrl+Enter to apply</span>
            <span style={{ flex: 1 }} />
            {criteriaError && <span style={s.criteriaError} role="alert">{criteriaError}</span>}
            <div role="group" aria-label="Criteria actions" style={s.criteriaActions}>
              <ToolbarButton secondary onClick={clearCriteria} disabled={busy || !!bulkEditor}>Clear</ToolbarButton>
              <ToolbarButton onClick={applyCriteria} disabled={busy || !!bulkEditor || invalidCriteria}>Apply</ToolbarButton>
              <ToolbarButton secondary onClick={() => void loadInitial()} disabled={busy || !!bulkEditor}>Refresh</ToolbarButton>
            </div>
          </div>
          <CollectionCriteriaEditor
            tabId={tab.id}
            kind="filter"
            label="Filter"
            value={draftFilter}
            connectionId={connectionId}
            database={database}
            collection={collection}
            placeholder="{ bikeid: 17827 }"
            onChange={(value) => setDraftCriteria({ filter: value })}
            onApply={applyCriteria}
            onValidationChange={handleCriteriaValidation}
          />
          <div style={s.criteriaGrid}>
            <CollectionCriteriaEditor
              tabId={tab.id}
              kind="sort"
              label="Sort"
              value={draftSort}
              connectionId={connectionId}
              database={database}
              collection={collection}
              placeholder="{ createdAt: -1 }"
              onChange={(value) => setDraftCriteria({ sort: value })}
              onApply={applyCriteria}
              onValidationChange={handleCriteriaValidation}
            />
            <CollectionCriteriaEditor
              tabId={tab.id}
              kind="projection"
              label="Projection"
              value={draftProjection}
              connectionId={connectionId}
              database={database}
              collection={collection}
              placeholder="{ name: 1, status: 1 }"
              onChange={(value) => setDraftCriteria({ projection: value })}
              onApply={applyCriteria}
              onValidationChange={handleCriteriaValidation}
            />
          </div>
        </div>
      )}

      {error && (
        <div style={s.error} role="alert">
          <span>{error}</span>
          <button style={s.secondaryButton} onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}
      {bulkFailure && (
        <div
          style={s.bulkFailures}
          role="alert"
          data-testid={`bulk-${bulkFailure.operation}-failures`}
        >
          <strong>{bulkFailure.summary}</strong>
          <ul style={{ margin: '5px 0 0', paddingLeft: 20 }}>
            {bulkFailure.errors.map((item, index) => (
              <li key={`${item.rowNumber}:${index}`}>Row {item.rowNumber}: {item.message}</li>
            ))}
          </ul>
        </div>
      )}
      {notice && <div style={s.notice}>{notice}</div>}
      {!connectionId && (
        <div style={s.notice}>Assign a connection from this saved item’s details before loading documents.</div>
      )}
      {connectionId && !isConnected && (
        <div style={s.notice}>Connection is offline. Connect to run this saved document view.</div>
      )}
      {readOnly && <div style={s.notice}>Read-only connection — document changes are disabled.</div>}

      <div
        ref={documentsRegionRef}
        aria-busy={loading}
        style={{
          position: 'relative', display: 'flex', flexDirection: 'column', flex: 1,
          minHeight: documentPanelOpen ? 120 : 0, overflow: 'hidden',
        }}
      >
        {rows.length === 0 && !loading && columns.length === 0 ? (
          <div style={s.empty}>No documents found</div>
        ) : (
        <div style={s.tableWrap}>
          <table
            data-testid="collection-documents-table"
            style={{
              ...s.table,
              width: `max(100%, ${70 + columns.reduce((total, column) => total + (columnWidths[column] ?? (column === '_id' ? 220 : 180)), 0)}px)`,
            }}
          >
            <colgroup>
              <col style={{ width: 70 }} />
              {columns.map((column) => (
                <col key={column} style={{ width: columnWidths[column] ?? (column === '_id' ? 220 : 180) }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th style={s.th}>
                  <div style={s.columnTitle}>
                    <SelectionCheckbox
                      ariaLabel="Select all documents on this page"
                      checked={allRowsSelected}
                      indeterminate={selectedRows.length > 0 && !allRowsSelected}
                      disabled={busy || !!bulkEditor || rows.length === 0}
                      onChange={toggleAllRows}
                    />
                    <span>#</span>
                  </div>
                </th>
                {columns.map((column) => (
                  <th
                    key={column}
                    className="collection-column-header"
                    data-dragging={draggedColumn === column ? 'true' : 'false'}
                    style={s.th}
                    aria-sort={sortIndicatorByColumn.get(column)?.direction === 1
                      ? 'ascending'
                      : sortIndicatorByColumn.get(column)?.direction === -1
                        ? 'descending'
                        : undefined}
                    onDragOver={(event) => {
                      if (event.dataTransfer.types.includes(COLUMN_DRAG_MIME)) {
                        event.preventDefault();
                        event.dataTransfer.dropEffect = 'move';
                      }
                    }}
                    onDrop={(event) => {
                      if (!event.dataTransfer.types.includes(COLUMN_DRAG_MIME)) return;
                      event.preventDefault();
                      const source = event.dataTransfer.getData(COLUMN_DRAG_MIME);
                      if (source) moveColumn(source, column);
                      setDraggedColumn(null);
                    }}
                  >
                    <div style={{ ...s.columnTitle, opacity: draggedColumn === column ? 0.55 : 1 }}>
                      <span
                        role="button"
                        tabIndex={0}
                        data-sort-column={column}
                        style={s.columnSortControl}
                        aria-label={columnSortLabel(column, sortIndicatorByColumn.get(column))}
                        title={`${column} — click to sort`}
                        onClick={() => applyColumnSort(column)}
                        onKeyDown={(event) => {
                          if (event.key !== 'Enter' && event.key !== ' ') return;
                          event.preventDefault();
                          event.stopPropagation();
                          applyColumnSort(column);
                        }}
                      >
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{column}</span>
                        {sortIndicatorByColumn.get(column) && (
                          <span style={s.sortBadge} aria-hidden="true">
                            <ColumnSortIcon direction={sortIndicatorByColumn.get(column)!.direction} />
                            <span style={s.sortPriority}>{sortIndicatorByColumn.get(column)!.priority}</span>
                          </span>
                        )}
                      </span>
                      <button
                        type="button"
                        className="collection-column-drag-handle"
                        data-column-drag-handle={column}
                        draggable
                        aria-label={`Drag to reorder ${column} column`}
                        title={`Drag to reorder ${column} column`}
                        onDragStart={(event) => {
                          setDraggedColumn(column);
                          event.dataTransfer.effectAllowed = 'move';
                          event.dataTransfer.setData(COLUMN_DRAG_MIME, column);
                          event.dataTransfer.setData('text/plain', column);
                        }}
                        onDragEnd={() => setDraggedColumn(null)}
                      >
                        <ColumnDragGripIcon />
                      </button>
                      <span
                        aria-label={`Resize ${column} column`}
                        role="separator"
                        style={s.resizeHandle}
                        onPointerDown={(event) => beginColumnResize(event, column)}
                      />
                    </div>
                    <ColumnFilterInput
                      connectionId={connectionId}
                      database={database}
                      collection={collection}
                      column={column}
                      value={columnFilters[column] ?? ''}
                      error={columnFilterErrors[column]}
                      onChange={(value) => updateColumnFilter(column, value)}
                      onApply={applyCriteria}
                    />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && !loading ? (
                <tr>
                  <td colSpan={columns.length + 1} style={s.emptyTableCell}>No documents found</td>
                </tr>
              ) : rows.map((row) => (
                <tr
                  key={row.key}
                  aria-selected={selectedRowKeys.has(row.key)}
                  style={{
                    ...s.row,
                    ...(selected?.key === row.key ? s.selectedRow : {}),
                    ...(selectedRowKeys.has(row.key) ? s.bulkSelectedRow : {}),
                  }}
                  onClick={() => void selectRow(row)}
                >
                  <td style={{ ...s.td, ...s.rowNumber, width: 70 }}>
                    <div style={s.selectionCell}>
                      <input
                        type="checkbox"
                        aria-label={`Select document row ${row.absoluteIndex + 1}`}
                        checked={selectedRowKeys.has(row.key)}
                        disabled={busy || !!bulkEditor}
                        onClick={(event) => event.stopPropagation()}
                        onChange={() => toggleRowSelection(row)}
                      />
                      <span>{row.absoluteIndex + 1}</span>
                    </div>
                  </td>
                  {columns.map((column) => (
                    <td
                      key={column}
                      style={{ ...s.td, width: columnWidths[column] ?? (column === '_id' ? 220 : 180) }}
                    >
                      <BsonTableCell
                        field={resolveBsonTableField(row.value, column)}
                        mode={displayMode}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        )}
        {fetchState && (
          <LoadingOverlay
            label={fetchState.label}
            cancelling={fetchState.cancelling}
            onCancel={() => void cancelFetch()}
          />
        )}
      </div>

      {documentPanelOpen && (
        <>
          <div
            data-testid="document-panel-resizer"
            role="separator"
            aria-label="Resize document panel"
            aria-orientation="horizontal"
            title="Drag to resize document panel · double-click to reset"
            style={s.documentPanelResizer}
            onPointerDown={beginDocumentPanelResize}
            onDoubleClick={() => setDocumentPanelHeight(null)}
          />
          <div
            ref={documentPanelRef}
            data-testid="document-panel"
            style={{ ...s.editorPanel, height: documentPanelHeight ?? '38%' }}
          >
          {bulkEditor ? (
            <>
              <div style={s.editorHeader}>
                <strong>Edit {bulkEditor.originals.length} selected document(s)</strong>
                <ToolbarButton secondary={bulkEditor.mode !== 'field'} onClick={() => setBulkEditor((current) => (
                  current ? { ...current, mode: 'field', validationError: null } : current
                ))}>Field</ToolbarButton>
                <ToolbarButton secondary={bulkEditor.mode !== 'replace'} onClick={() => setBulkEditor((current) => (
                  current ? { ...current, mode: 'replace', validationError: null } : current
                ))}>Full documents</ToolbarButton>
                <span style={{ flex: 1, color: 'var(--color-text-muted)' }}>{displayModeLabel(displayMode)}</span>
                {bulkEditor.validationError && (
                  <span role="alert" title={bulkEditor.validationError} style={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: theme.colors.danger }}>
                    Invalid bulk update
                  </span>
                )}
                <ToolbarButton
                  onClick={() => void saveBulkUpdate()}
                  disabled={editorBusy || !!bulkEditor.validationError || (
                    bulkEditor.mode === 'field' && !!bulkFieldPathError(bulkEditor.fieldPath)
                  )}
                >Save</ToolbarButton>
                <ToolbarButton secondary onClick={() => setBulkEditor(null)} disabled={editorBusy}>Cancel</ToolbarButton>
              </div>
              {bulkEditor.mode === 'field' && (
                <div style={s.bulkControls}>
                  <label htmlFor={`bulk-field-path-${tab.id}`}>Field path</label>
                  <BulkFieldPathCombobox
                    id={`bulk-field-path-${tab.id}`}
                    columns={columns}
                    value={bulkEditor.fieldPath}
                    disabled={editorBusy}
                    invalid={!!bulkFieldPathError(bulkEditor.fieldPath)}
                    onChange={(value) => setBulkEditor((current) => current ? {
                      ...current,
                      fieldPath: value,
                      validationError: null,
                    } : current)}
                  />
                  <label htmlFor={`bulk-field-operation-${tab.id}`}>Operation</label>
                  <select
                    id={`bulk-field-operation-${tab.id}`}
                    aria-label="Bulk update field operation"
                    style={s.bulkSelect}
                    value={bulkEditor.fieldOperation}
                    disabled={editorBusy}
                    onChange={(event) => setBulkEditor((current) => current ? {
                      ...current,
                      fieldOperation: event.target.value as 'set' | 'unset',
                      validationError: null,
                    } : current)}
                  >
                    <option value="set">Set value</option>
                    <option value="unset">Remove field</option>
                  </select>
                  {bulkFieldPathError(bulkEditor.fieldPath) && (
                    <span role="alert" style={{ color: theme.colors.danger }}>
                      {bulkFieldPathError(bulkEditor.fieldPath)}
                    </span>
                  )}
                </div>
              )}
              {bulkEditor.mode === 'field' && bulkEditor.fieldOperation === 'unset' ? (
                <div style={{ ...s.empty, textAlign: 'left' }}>
                  The selected field will be removed from every matching document.
                </div>
              ) : (
                <DocumentBsonEditor
                  key={bulkEditor.mode}
                  tabId={`${tab.id}:bulk`}
                  value={bulkEditor.mode === 'field'
                    ? bulkEditor.fieldValueText
                    : bulkEditor.fullDocumentsText}
                  readOnly={false}
                  validationKind={bulkEditor.mode === 'field' ? 'value' : 'document-array'}
                  ariaLabel={bulkEditor.mode === 'field' ? 'Bulk field BSON value' : 'Bulk documents BSON editor'}
                  onChange={(value) => setBulkEditor((current) => current ? {
                    ...current,
                    ...(current.mode === 'field'
                      ? { fieldValueText: value }
                      : { fullDocumentsText: value }),
                  } : current)}
                  onSave={() => void saveBulkUpdate()}
                  onValidationChange={(message) => setBulkEditor((current) => (
                    current && current.validationError !== message
                      ? { ...current, validationError: message }
                      : current
                  ))}
                />
              )}
            </>
          ) : (
            <>
              <div style={s.editorHeader}>
                <strong>{editorMode === 'new' ? 'New document' : editorMode === 'edit' ? 'Edit document' : 'Document'}</strong>
                <span style={{ flex: 1, color: 'var(--color-text-muted)' }}>
                  {displayModeLabel(displayMode)}{projectionActive ? ' — projected documents cannot be edited' : ''}
                </span>
                {editorValidationError && editorMode !== 'view' && (
                  <span role="alert" title={editorValidationError} style={{ maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: theme.colors.danger }}>
                    {editorValidationError}
                  </span>
                )}
                {editorMode === 'view' ? (
                  <>
                    <ToolbarButton secondary onClick={() => {
                      if (selected) {
                        setEditorText(renderDocumentEnvelope(selected.envelope, displayMode, true));
                      }
                      setEditorMode('edit');
                    }} disabled={!canEditSelection || editorBusy}>Edit</ToolbarButton>
                    <ToolbarButton danger onClick={() => void deleteDocument()} disabled={!canEditSelection || editorBusy}>Delete</ToolbarButton>
                    <ToolbarButton secondary onClick={() => { setSelected(null); setEditorText(''); }}>Close</ToolbarButton>
                  </>
                ) : (
                  <>
                    <ToolbarButton onClick={() => void saveDocument()} disabled={editorBusy || !!editorValidationError}>Save</ToolbarButton>
                    <ToolbarButton secondary onClick={() => {
                      if (selected) {
                        setEditorText(renderDocumentEnvelope(selected.envelope, displayMode));
                        setEditorMode('view');
                      } else {
                        setEditorText('');
                        setEditorMode('view');
                      }
                    }} disabled={editorBusy}>Cancel</ToolbarButton>
                  </>
                )}
              </div>
              <DocumentBsonEditor
                tabId={tab.id}
                value={editorText}
                readOnly={editorMode === 'view'}
                onChange={setEditorText}
                onSave={() => void saveDocument()}
                onValidationChange={setEditorValidationError}
                originalDocumentEjson={editorMode === 'edit' ? selected?.envelope.ejson : undefined}
              />
            </>
          )}
          </div>
        </>
      )}

      <div style={s.status}>
        <span>{loading || editorBusy
          ? 'Working…'
          : `${rows.length} document(s) · ${selectedRows.length} selected`}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span>Page {pageIndex + 1}</span>
          <button
            type="button"
            aria-label="Calculate total document count"
            aria-busy={countLoading}
            style={{
              ...s.secondaryButton,
              ...(busy || countLoading ? s.disabled : {}),
              color: countError ? theme.colors.danger : totalCount === null ? 'var(--color-text)' : theme.colors.success,
            }}
            disabled={busy || countLoading}
            onClick={() => void calculateTotalCount()}
          >
            {countLoading
              ? 'Total count: calculating…'
              : totalCount === null
                ? countError ? 'Total count: retry' : 'Total count: calculate'
                : `Total count: ${totalCount.toLocaleString()}`}
          </button>
          {countError && (
            <span role="alert" style={{ color: theme.colors.danger, maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={countError}>
              Count failed: {countError}
            </span>
          )}
          <label style={s.pageSizeLabel} title="Applies only to this collection tab">
            <span>Page size</span>
            <select
              aria-label="Documents page size"
              value={pageSizeOverride === undefined ? 'default' : String(pageSizeOverride)}
              disabled={busy || !!bulkEditor || editorMode !== 'view'}
              onChange={(event) => void changePageSize(event.target.value)}
              style={{
                ...s.pageSizeSelect,
                ...(busy || !!bulkEditor || editorMode !== 'view' ? s.disabled : {}),
              }}
            >
              {pageSizeOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <ToolbarButton secondary onClick={() => void fetchPage('previous')} disabled={busy || !!bulkEditor || pageIndex === 0}>Previous</ToolbarButton>
          <ToolbarButton secondary onClick={() => void fetchPage('next')} disabled={busy || !!bulkEditor || !hasMore}>Next</ToolbarButton>
        </span>
      </div>
    </div>
  );
}

function FilterSyntaxExample({
  title,
  path,
  source,
}: {
  title: string;
  path: string;
  source: string;
}) {
  return (
    <div style={s.filterHelpExample}>
      <strong style={s.filterHelpExampleTitle}>{title}</strong>
      <span style={s.filterHelpExamplePath}>{path}</span>
      <code style={s.filterHelpExampleCode}>{source}</code>
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

function SelectionCheckbox({
  ariaLabel,
  checked,
  indeterminate,
  disabled,
  onChange,
}: {
  ariaLabel: string;
  checked: boolean;
  indeterminate: boolean;
  disabled: boolean;
  onChange: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <input
      ref={ref}
      type="checkbox"
      aria-label={ariaLabel}
      checked={checked}
      disabled={disabled}
      onChange={onChange}
    />
  );
}

function ColumnSortIcon({ direction }: { direction: ColumnSortDirection }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {direction === 1 ? (
        <path d="M8 13V3m0 0L4.5 6.5M8 3l3.5 3.5" />
      ) : (
        <path d="M8 3v10m0 0l-3.5-3.5M8 13l3.5-3.5" />
      )}
    </svg>
  );
}

function ColumnDragGripIcon() {
  return (
    <svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor" aria-hidden="true">
      <circle cx="3" cy="4" r="1" />
      <circle cx="7" cy="4" r="1" />
      <circle cx="3" cy="8" r="1" />
      <circle cx="7" cy="8" r="1" />
      <circle cx="3" cy="12" r="1" />
      <circle cx="7" cy="12" r="1" />
    </svg>
  );
}

function columnSortLabel(
  column: string,
  indicator?: { direction: ColumnSortDirection; priority: number },
): string {
  if (!indicator) return `Sort ${column} ascending`;
  const direction = indicator.direction === 1 ? 'ascending' : 'descending';
  const next = indicator.direction === 1 ? 'descending' : 'remove sort';
  return `${column}, sorted ${direction}, priority ${indicator.priority}; activate to ${next}`;
}

function createDocumentRow(envelope: EjsonEnvelope, absoluteIndex: number): DocumentRow {
  const value = envelope.truncated ? null : parseDocumentValue(envelope);
  const id = value && Object.hasOwn(value, '_id') ? renderBson(value._id, 'canonical', false) : null;
  return {
    key: id ? `${id}:${absoluteIndex}` : `document:${absoluteIndex}`,
    absoluteIndex,
    envelope,
    value,
  };
}

function documentRowId(row: DocumentRow): string | null {
  return row.value && Object.hasOwn(row.value, '_id')
    ? renderBson(row.value._id, 'canonical', false)
    : null;
}

function parseDocumentArrayJson(source: string): Record<string, unknown>[] {
  const value = parseEjson<unknown>({
    ejson: source,
    byteSize: source.length,
    truncated: false,
  });
  if (!Array.isArray(value) || value.some((entry) => !isDocumentValue(entry))) {
    throw new Error('Documents must be an array of document objects.');
  }
  return value as Record<string, unknown>[];
}

function alignBulkReplacementDocuments(
  originals: DocumentRow[],
  edited: Record<string, unknown>[],
): Record<string, unknown>[] {
  if (edited.length !== originals.length) {
    throw new Error('Full document edit must keep exactly one document for every selected row.');
  }
  const editedById = new Map<string, Record<string, unknown>>();
  for (const document of edited) {
    if (!Object.hasOwn(document, '_id')) throw new Error('Every edited document must keep its _id field.');
    const id = renderBson(document._id, 'canonical', false);
    if (editedById.has(id)) throw new Error('Edited documents cannot contain duplicate _id values.');
    editedById.set(id, document);
  }
  return originals.map((row) => {
    const id = documentRowId(row);
    if (!id) throw new Error('Every selected document must include an _id field.');
    const replacement = editedById.get(id);
    if (!replacement) throw new Error('Full document edit must preserve the original _id set.');
    return replacement;
  });
}

function bulkUpdateSummary(result: CollectionBulkUpdateResult): string {
  return `Bulk update complete: ${result.matchedCount} matched, ${result.modifiedCount} modified, ${result.unchangedCount} unchanged, ${result.failedCount} failed.`;
}

function bulkDeleteSummary(result: CollectionBulkDeleteResult): string {
  return `Bulk delete complete: ${result.deletedCount} deleted, ${result.failedCount} failed.`;
}

function parseDocumentValue(envelope: EjsonEnvelope): Record<string, unknown> | null {
  try {
    const value = parseEjson(envelope);
    if (isDocumentValue(value)) return value;
  } catch {
    // The runtime owns validation; an invalid preview is displayed as opaque.
  }
  return null;
}

function renderDocumentEnvelope(
  envelope: EjsonEnvelope,
  mode: BsonDisplayMode,
  editable = false,
): string {
  try {
    return renderBson(parseEjson(envelope), mode, true, editable ? 'editable' : 'display');
  } catch {
    return envelope.ejson;
  }
}

function displayModeLabel(mode: BsonDisplayMode): string {
  if (mode === 'mongosh') return 'MongoDB Shell BSON';
  return mode === 'relaxed' ? 'Relaxed Extended JSON' : 'Canonical Extended JSON';
}

function isDocumentValue(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sameColumnOrder(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((column, index) => column === right[index]);
}

function sameCriteria(left: DocumentCriteriaText, right: DocumentCriteriaText): boolean {
  return left.filter === right.filter &&
    left.sort === right.sort &&
    left.projection === right.projection;
}

function validateCriteria(criteria: DocumentCriteriaText): Record<CriteriaKind, string | null> {
  const errors: Record<CriteriaKind, string | null> = {
    filter: null,
    sort: null,
    projection: null,
  };
  for (const kind of ['filter', 'sort', 'projection'] as const) {
    const source = criteria[kind];
    if (!source && kind !== 'filter') continue;
    try {
      parseDocumentExpression(source, kind.charAt(0).toUpperCase() + kind.slice(1));
    } catch (error) {
      errors[kind] = error instanceof Error ? error.message : String(error);
    }
  }
  return errors;
}

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    const category = 'category' in error ? `[${String(error.category)}] ` : '';
    return `${category}${String(error.message)}`;
  }
  return String(error);
}

function isCancellationError(error: unknown): boolean {
  return typeof error === 'object' && error !== null &&
    'category' in error && error.category === 'Cancellation';
}
