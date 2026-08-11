import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { parseDocumentExpression } from '../../../features/script-analysis/index.js';
import type {
  DocumentCriteriaText,
  DocumentsPage,
  ExportFormat,
  ExportScope,
  WorkspaceTab,
} from '../../../shared/domain/index.js';
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
import { CollectionCriteriaEditor } from './CollectionCriteriaEditor.js';
import type { CriteriaKind } from '../../monaco/object-expression.js';
import { SavedActions } from '../Saved/SavedActions.js';
import { DocumentBsonEditor } from './DocumentBsonEditor.js';
import { BsonSyntaxText } from '../Common/BsonSyntaxText.js';
import { ExportDialog } from '../Export/ExportDialog.js';
import { useExportJobsStore } from '../../stores/exports.js';
import { useDataTransferStore } from '../../stores/data-transfer.js';

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
  columnFilter: {
    boxSizing: 'border-box', display: 'block', width: 'calc(100% - 10px)', margin: '1px 5px 5px',
    border: '1px solid var(--color-border)', borderRadius: 2, background: 'var(--color-input)', color: 'var(--color-text)',
    padding: '3px 5px', fontSize: 10, outline: 0, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  },
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
  rowNumber: { color: 'var(--color-text-faint)', fontSize: 10, width: 45 },
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

interface DocumentRow {
  key: string;
  absoluteIndex: number;
  envelope: EjsonEnvelope;
  value: Record<string, unknown> | null;
}

type EditorMode = 'view' | 'edit' | 'new';

export function CollectionView() {
  const { activeTabId, tabs, setCollectionView } = useWorkspaceStore();
  const tab = tabs.find((candidate) => candidate.id === activeTabId);
  if (!tab || tab.kind !== 'collection') return null;
  const view = tab.collectionViewMode ?? 'documents';
  const namespace = `${tab.database ?? 'admin'}.${tab.collection ?? ''}`;

  return (
    <div style={s.workspace}>
      <div style={s.contextBar}>
        <span style={s.contextNamespace}>{namespace}</span>
        {(['documents', 'query'] as const).map((candidate) => (
          <button
            key={candidate}
            style={{ ...s.viewButton, ...(view === candidate ? s.viewButtonActive : {}) }}
            aria-pressed={view === candidate}
            onClick={() => setCollectionView(tab.id, candidate)}
          >
            {candidate === 'documents' ? 'Documents' : 'Query'}
          </button>
        ))}
      </div>

      <div style={{ ...s.surface, display: view === 'documents' ? 'flex' : 'none' }}>
        <CollectionBrowser key={tab.id} tab={tab} />
      </div>

      {view === 'query' && (
        <div style={{ ...s.surface, display: 'flex', flexDirection: 'column' }}>
          <QueryWorkspace contextLocked />
        </div>
      )}
    </div>
  );
}

function CollectionBrowser({ tab }: { tab: WorkspaceTab }) {
  const profiles = useConnectionStore((state) => state.profiles);
  const connected = useConnectionStore((state) => state.connected);
  const connect = useConnectionStore((state) => state.connect);
  const updateTab = useWorkspaceStore((state) => state.updateTab);
  const displayMode = useSettingsStore((state) => state.settings.ejson.defaultMode);
  const configuredPageSize = useSettingsStore((state) => state.settings.execution.pageSize);
  const tableColumnOrder = useSettingsStore((state) => state.settings.table.columnOrder);
  const connectionId = tab.connectionId ?? '';
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
  const [criteriaOpen, setCriteriaOpen] = useState(true);
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
  const [editorMode, setEditorMode] = useState<EditorMode>('view');
  const [editorText, setEditorText] = useState('');
  const [editorValidationError, setEditorValidationError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [editorBusy, setEditorBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);

  useEffect(() => {
    latestPageSize.current = effectivePageSize;
  }, [effectivePageSize]);

  const discoveredColumns = useMemo(
    () => extractCollectionColumns(
      rows.map((row) => row.value).filter(isDocumentValue),
      tableColumnOrder,
    ),
    [rows, tableColumnOrder],
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
  const suppressSortClick = useRef(false);
  const columns = useMemo(
    () => reconcileCollectionColumns(columnOrder, discoveredColumns, columnsManuallyReordered),
    [columnOrder, columnsManuallyReordered, discoveredColumns],
  );
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [countLoading, setCountLoading] = useState(false);
  const [countError, setCountError] = useState<string | null>(null);
  const countRequestGeneration = useRef(0);
  const sortIndicators = useMemo(() => {
    try {
      return readColumnSortIndicators(criteria.sort);
    } catch {
      return [];
    }
  }, [criteria.sort]);
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

  const applyPage = useCallback((page: DocumentsPage, pageSize: number) => {
    const nextRows = page.documents.map((envelope, index) =>
      createDocumentRow(envelope, page.pageIndex * pageSize + index),
    );
    setRows(nextRows);
    setPageIndex(page.pageIndex);
    setHasMore(page.hasMore);
    setSelected(null);
    setEditorText('');
    setEditorMode('view');
  }, []);

  const loadInitial = useCallback(async (requestedPageSize?: number) => {
    if (!connectionId || !collection || !isConnected) {
      setRows([]);
      setCursorId(null);
      return;
    }
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const pageSize = requestedPageSize ?? latestPageSize.current;
      const page = await window.mongog.query.collectionFind({
        connectionId,
        database,
        collection,
        tabId: documentsOwnerId,
        filterEjson: criteria.filter || EMPTY_FILTER,
        ...(criteria.sort ? { sortEjson: criteria.sort } : {}),
        ...(criteria.projection ? { projectionEjson: criteria.projection } : {}),
        pageSize,
      });
      setCursorId(page.cursorId);
      setCursorPageSize(page.pageSize);
      applyPage(page, page.pageSize);
    } catch (caught) {
      setRows([]);
      setCursorId(null);
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [connectionId, database, collection, documentsOwnerId, criteria, applyPage, isConnected]);

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
    await loadInitial(nextPageSize);
  };

  useEffect(() => {
    void loadInitial();
    return () => {
      if (connectionId) void window.mongog.query.closeOwner(connectionId, documentsOwnerId);
    };
  }, [connectionId, documentsOwnerId, loadInitial]);

  const applyCriteria = () => {
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
    if (suppressSortClick.current) return;
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
    if (!cursorId) return;
    setLoading(true);
    setError(null);
    try {
      const page = direction === 'next'
        ? await window.mongog.query.cursorFetchNext(connectionId, cursorId, cursorPageSize)
        : await window.mongog.query.cursorFetchPrev(connectionId, cursorId);
      applyPage(page, cursorPageSize);
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
      setEditorText(renderDocumentEnvelope(envelope, displayMode));
      setEditorValidationError(null);
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
    setEditorValidationError(null);
    setError(null);
    setNotice(null);
  };

  const saveDocument = async () => {
    if (readOnly || editorMode === 'view' || editorValidationError) return;
    try {
      parseDocumentExpression(editorText, 'Document');
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
  const documentPanelOpen = !!selected || editorMode === 'new';
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
          onClick={() => setCriteriaOpen((open) => !open)}
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
        <ToolbarButton secondary onClick={() => void loadInitial()} disabled={busy}>Refresh</ToolbarButton>
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
        <ToolbarButton onClick={openNewDocument} disabled={readOnly || busy}>New</ToolbarButton>
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
            <ToolbarButton secondary onClick={clearCriteria} disabled={busy}>Clear</ToolbarButton>
            <ToolbarButton onClick={applyCriteria} disabled={busy || invalidCriteria}>Apply</ToolbarButton>
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
      {notice && <div style={s.notice}>{notice}</div>}
      {!connectionId && (
        <div style={s.notice}>Assign a connection from this saved item’s details before loading documents.</div>
      )}
      {connectionId && !isConnected && (
        <div style={s.notice}>Connection is offline. Connect to run this saved document view.</div>
      )}
      {readOnly && <div style={s.notice}>Read-only connection — document changes are disabled.</div>}

      {rows.length === 0 && !loading && columns.length === 0 ? (
        <div ref={documentsRegionRef} style={{ ...s.empty, minHeight: documentPanelOpen ? 120 : 0 }}>No documents found</div>
      ) : (
        <div ref={documentsRegionRef} style={{ ...s.tableWrap, minHeight: documentPanelOpen ? 120 : 0 }}>
          <table
            data-testid="collection-documents-table"
            style={{
              ...s.table,
              width: `max(100%, ${46 + columns.reduce((total, column) => total + (columnWidths[column] ?? (column === '_id' ? 220 : 180)), 0)}px)`,
            }}
          >
            <colgroup>
              <col style={{ width: 46 }} />
              {columns.map((column) => (
                <col key={column} style={{ width: columnWidths[column] ?? (column === '_id' ? 220 : 180) }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th style={s.th}><div style={s.columnTitle}>#</div></th>
                {columns.map((column) => (
                  <th
                    key={column}
                    style={s.th}
                    aria-sort={sortIndicatorByColumn.get(column)?.direction === 1
                      ? 'ascending'
                      : sortIndicatorByColumn.get(column)?.direction === -1
                        ? 'descending'
                        : undefined}
                    draggable
                    onDragStart={(event) => {
                      suppressSortClick.current = true;
                      setDraggedColumn(column);
                      event.dataTransfer.effectAllowed = 'move';
                      event.dataTransfer.setData('text/plain', column);
                    }}
                    onDragEnd={() => {
                      setDraggedColumn(null);
                      window.setTimeout(() => { suppressSortClick.current = false; }, 0);
                    }}
                    onDragOver={(event) => {
                      if (draggedColumn && draggedColumn !== column) event.preventDefault();
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      const source = draggedColumn ?? event.dataTransfer.getData('text/plain');
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
                        title={`${column} — click to sort; drag to reorder`}
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
                      <span
                        aria-label={`Resize ${column} column`}
                        role="separator"
                        style={s.resizeHandle}
                        onPointerDown={(event) => beginColumnResize(event, column)}
                      />
                    </div>
                    <input
                      aria-label={`Filter ${column} column`}
                      draggable={false}
                      style={{
                        ...s.columnFilter,
                        ...(columnFilterErrors[column] ? { borderColor: theme.colors.danger } : {}),
                      }}
                      value={columnFilters[column] ?? ''}
                      placeholder="exact, {field}: value, [{field}]: value"
                      aria-invalid={columnFilterErrors[column] ? 'true' : undefined}
                      title={columnFilterErrors[column] ?? columnFilterHelpText()}
                      onDragStart={(event) => event.stopPropagation()}
                      onPointerDown={(event) => event.stopPropagation()}
                      onChange={(event) => updateColumnFilter(column, event.target.value)}
                      onKeyDown={(event) => {
                        event.stopPropagation();
                        if (event.key === 'Enter') applyCriteria();
                      }}
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
                  style={{ ...s.row, ...(selected?.key === row.key ? s.selectedRow : {}) }}
                  onClick={() => void selectRow(row)}
                >
                  <td style={{ ...s.td, ...s.rowNumber, width: 46 }}>{row.absoluteIndex + 1}</td>
                  {columns.map((column) => (
                    <td
                      key={column}
                      style={{ ...s.td, width: columnWidths[column] ?? (column === '_id' ? 220 : 180) }}
                    >
                      <CollectionBsonCell value={row.value?.[column]} mode={displayMode} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

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
          <div style={s.editorHeader}>
            <strong>{editorMode === 'new' ? 'New document' : editorMode === 'edit' ? 'Edit document' : 'Document'}</strong>
            <span style={{ flex: 1, color: 'var(--color-text-muted)' }}>
              {displayModeLabel(displayMode)}{projectionActive ? ' — projected documents cannot be edited' : ''}
            </span>
            {editorValidationError && editorMode !== 'view' && (
              <span role="alert" title={editorValidationError} style={{ maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: theme.colors.danger }}>
                Invalid BSON syntax
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
          />
          </div>
        </>
      )}

      <div style={s.status}>
        <span>{loading || editorBusy ? 'Working…' : `${rows.length} document(s)`}</span>
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
              disabled={busy || editorMode !== 'view'}
              onChange={(event) => void changePageSize(event.target.value)}
              style={{
                ...s.pageSizeSelect,
                ...(busy || editorMode !== 'view' ? s.disabled : {}),
              }}
            >
              {pageSizeOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <ToolbarButton secondary onClick={() => void fetchPage('previous')} disabled={busy || pageIndex === 0}>Previous</ToolbarButton>
          <ToolbarButton secondary onClick={() => void fetchPage('next')} disabled={busy || !hasMore}>Next</ToolbarButton>
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

function CollectionBsonCell({ value, mode }: { value: unknown; mode: BsonDisplayMode }) {
  const fullText = formatCellValue(value, mode);
  return <BsonSyntaxText text={truncate(fullText, 100)} title={fullText} />;
}

function formatCellValue(value: unknown, mode: BsonDisplayMode): string {
  if (value === null || value === undefined) return 'null';
  try {
    return renderBson(value, mode, false);
  } catch {
    return String(value);
  }
}

function displayModeLabel(mode: BsonDisplayMode): string {
  if (mode === 'mongosh') return 'MongoDB Shell BSON';
  return mode === 'relaxed' ? 'Relaxed Extended JSON' : 'Canonical Extended JSON';
}

function truncate(value: string, length: number): string {
  return value.length > length ? `${value.slice(0, length)}…` : value;
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
