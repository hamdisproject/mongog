import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { parseDocumentExpression } from '../../../features/script-analysis/index.js';
import type { DocumentCriteriaText, DocumentsPage, WorkspaceTab } from '../../../shared/domain/index.js';
import type { EjsonEnvelope } from '../../../shared/ejson/index.js';
import { useConnectionStore } from '../../stores/connections.js';
import { useSchemaCache } from '../../stores/schema-cache.js';
import { useWorkspaceStore } from '../../stores/workspace.js';
import { collectionDocumentsOwnerId, emptyDocumentCriteriaState } from '../../collection-workspace.js';
import { buildColumnFilterExpression, reorderColumns } from '../../collection-column-filter.js';
import { theme } from '../../theme.js';
import { QueryWorkspace } from '../Editor/QueryWorkspace.js';
import { CollectionCriteriaEditor } from './CollectionCriteriaEditor.js';
import type { CriteriaKind } from '../../monaco/object-expression.js';
import { SavedActions } from '../Saved/SavedActions.js';

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
  columnFilter: {
    boxSizing: 'border-box', display: 'block', width: 'calc(100% - 10px)', margin: '1px 5px 5px',
    border: '1px solid var(--color-border)', borderRadius: 2, background: 'var(--color-input)', color: 'var(--color-text)',
    padding: '3px 5px', fontSize: 10, outline: 0, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
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
  editorPanel: {
    height: '38%', minHeight: 180, maxHeight: 440, display: 'flex', flexDirection: 'column',
    borderTop: '1px solid var(--color-border)', background: 'var(--color-app)', flexShrink: 0,
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
  select: {
    background: 'var(--color-input-soft)', color: 'var(--color-text)', border: '1px solid var(--color-border-strong)', fontSize: 11, borderRadius: 2,
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

  const discoveredColumns = useMemo(
    () => extractColumns(rows.map((row) => row.value).filter(isDocumentValue)),
    [rows],
  );
  const [columnOrder, setColumnOrder] = useState<string[]>([]);
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({});
  const [draggedColumn, setDraggedColumn] = useState<string | null>(null);
  const columns = useMemo(() => {
    const retained = columnOrder.filter((column) => discoveredColumns.includes(column));
    const added = discoveredColumns.filter((column) => !retained.includes(column));
    return [...retained, ...added];
  }, [columnOrder, discoveredColumns]);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [countLoading, setCountLoading] = useState(false);
  const [countError, setCountError] = useState<string | null>(null);
  const countRequestGeneration = useRef(0);

  useEffect(() => {
    setColumnOrder((current) => {
      const retained = current.filter((column) => discoveredColumns.includes(column));
      const next = [...retained, ...discoveredColumns.filter((column) => !retained.includes(column))];
      return next.length === current.length && next.every((column, index) => column === current[index])
        ? current
        : next;
    });
  }, [discoveredColumns]);

  useEffect(() => {
    countRequestGeneration.current += 1;
    setTotalCount(null);
    setCountLoading(false);
    setCountError(null);
  }, [connectionId, database, collection, criteria.filter]);

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
    if (!connectionId || !collection || !isConnected) {
      setRows([]);
      setCursorId(null);
      return;
    }
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
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
      applyPage(page);
    } catch (caught) {
      setRows([]);
      setCursorId(null);
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [connectionId, database, collection, documentsOwnerId, criteria, pageSize, applyPage, isConnected]);

  useEffect(() => {
    void loadInitial();
    return () => {
      if (connectionId) void window.mongog.query.closeOwner(connectionId, documentsOwnerId);
    };
  }, [connectionId, documentsOwnerId, loadInitial]);

  const applyCriteria = () => {
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
    setDraftCriteria({ filter: buildColumnFilterExpression(next) });
    setCriteriaErrors((current) => ({ ...current, filter: null }));
  };

  const moveColumn = (source: string, target: string) => {
    if (source === target) return;
    setColumnOrder((current) => {
      const order = current.length > 0 ? [...current] : [...columns];
      return reorderColumns(order, source, target);
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
  const normalizedDraft = {
    filter: draftFilter.trim() || EMPTY_FILTER,
    sort: draftSort.trim(),
    projection: draftProjection.trim(),
  };
  const unappliedCriteria = !sameCriteria(criteria, normalizedDraft);
  const invalidCriteria = Object.values(criteriaErrors).some(Boolean);
  const criteriaCount = [
    criteria.filter.trim() !== EMPTY_FILTER,
    criteria.sort.length > 0,
    criteria.projection.length > 0,
  ].filter(Boolean).length;
  const criteriaSummary = `Criteria · ${criteriaCount}${
    unappliedCriteria ? ' · edited' : ''
  }${invalidCriteria ? ' · invalid' : ''}`;
  const criteriaError = Object.values(criteriaErrors).find(Boolean) ?? null;

  const handleCriteriaValidation = (kind: CriteriaKind, message: string | null) => {
    setCriteriaErrors((current) => current[kind] === message
      ? current
      : { ...current, [kind]: message });
  };

  if (!collection) {
    return <div style={s.empty}>This saved view has no collection. Edit its saved details to assign a namespace.</div>;
  }

  return (
    <div style={s.container}>
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
        <ToolbarButton secondary onClick={() => void loadInitial()} disabled={busy}>Refresh</ToolbarButton>
        {!isConnected && connectionId && (
          <ToolbarButton onClick={() => void connect(connectionId)} disabled={busy}>Connect</ToolbarButton>
        )}
        <ToolbarButton onClick={openNewDocument} disabled={readOnly || busy}>New</ToolbarButton>
      </div>

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

      {rows.length === 0 && !loading ? (
        <div style={s.empty}>No documents found</div>
      ) : (
        <div style={s.tableWrap}>
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
                    draggable
                    onDragStart={(event) => {
                      setDraggedColumn(column);
                      event.dataTransfer.effectAllowed = 'move';
                      event.dataTransfer.setData('text/plain', column);
                    }}
                    onDragEnd={() => setDraggedColumn(null)}
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
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }} title={`${column} — drag to reorder`}>{column}</span>
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
                      style={s.columnFilter}
                      value={columnFilters[column] ?? ''}
                      placeholder="exact, *text*, >, <"
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
              {rows.map((row) => (
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
                      {formatCellValue(row.value?.[column])}
                    </td>
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
            <span style={{ flex: 1, color: 'var(--color-text-muted)' }}>
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
