import { useCallback, useEffect, useRef, useState } from 'react';
import type * as Monaco from 'monaco-editor';
import type { SqlTranslation } from '../../../features/sql-translator/index.js';
import type { WorkspaceTab } from '../../../shared/domain/index.js';
import { bootMonaco } from '../../monaco/setup.js';
import { attachQueryWheelZoom } from '../../monaco/query-wheel-zoom.js';
import { useWorkspaceStore } from '../../stores/workspace.js';
import { useConnectionStore } from '../../stores/connections.js';
import { useSettingsStore } from '../../stores/settings.js';
import { orderCatalogEntries } from '../../catalog-order.js';
import { sqlQueryTemplate } from '../../collection-workspace.js';
import { getMonacoTheme } from '../../theme.js';
import { ResultsPanel } from '../Results/ResultsPanel.js';
import { cancelQueryExecution } from '../../query-cancellation.js';
import { SavedActions } from '../Saved/SavedActions.js';

const s: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex', flexDirection: 'column', width: '100%', height: '100%',
    minWidth: 0, minHeight: 0, overflow: 'hidden',
  },
  toolbar: {
    display: 'flex', gap: 6, padding: '4px 8px', background: 'var(--color-panel-raised)',
    borderBottom: '1px solid var(--color-border)', alignItems: 'center', flexShrink: 0,
  },
  select: {
    background: 'var(--color-input-soft)', color: 'var(--color-text)', border: '1px solid var(--color-border-strong)',
    padding: '2px 6px', borderRadius: 2, fontSize: 12,
  },
  btn: {
    background: 'var(--color-accent)', color: '#fff', border: 'none', padding: '3px 10px',
    borderRadius: 2, fontSize: 12, cursor: 'pointer',
  },
  btnDisabled: { opacity: 0.45, cursor: 'default' },
  btnDanger: { background: '#6b3030' },
  ghostBtn: {
    background: 'var(--color-input-soft)', color: 'var(--color-text)', border: '1px solid var(--color-border-strong)',
    padding: '3px 10px', borderRadius: 2, fontSize: 12, cursor: 'pointer',
  },
  status: { fontSize: 11, color: 'var(--color-text-muted)', marginLeft: 'auto' },
  error: { fontSize: 11, color: 'var(--color-danger)', maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis' },
  editor: { flex: 1, width: '100%', minWidth: 0, minHeight: 120, overflow: 'hidden' },
  preview: {
    flexShrink: 0, borderTop: '1px solid var(--color-border)', background: 'var(--color-panel)',
    display: 'flex', flexDirection: 'column', minHeight: 0,
  },
  previewHeader: {
    display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px', fontSize: 11,
    color: 'var(--color-text-muted)', cursor: 'pointer', userSelect: 'none',
  },
  previewBody: {
    margin: 0, padding: '6px 10px', overflow: 'auto', maxHeight: 220,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11,
    color: 'var(--color-warning-text)', whiteSpace: 'pre', borderTop: '1px solid var(--color-border)',
  },
  previewError: {
    padding: '6px 10px', fontSize: 11, color: '#f7b3b3',
    background: 'var(--color-danger-surface)', borderTop: '1px solid #6f2929',
  },
  previewHint: { display: 'block', marginTop: 4, color: 'var(--color-text-muted)' },
  warning: {
    padding: '4px 10px', fontSize: 11, color: 'var(--color-warning-text)',
    background: 'var(--color-panel)', borderTop: '1px solid var(--color-border)',
  },
};

const DEFAULT_SQL = `-- Write SQL, preview the MongoDB translation, then Run with Cmd/Ctrl+Enter.
-- SELECT (WHERE, ORDER BY, GROUP BY, HAVING, DISTINCT, JOIN, LIMIT) plus
-- INSERT, UPDATE and DELETE are translated to find/aggregate/write calls.
SELECT * FROM mycollection LIMIT 50;
`;

type TranslationState =
  | { status: 'pending' }
  | { status: 'ok'; value: SqlTranslation }
  | {
      status: 'error';
      message: string;
      hint: string;
      range?: { startLine: number; startCol: number; endLine: number; endCol: number };
    };

type TranslationWorkerResponse =
  | { id: number; ok: true; value: SqlTranslation }
  | {
      id: number;
      ok: false;
      message: string;
      hint: string;
      range?: { startLine: number; startCol: number; endLine: number; endCol: number };
    };

export function SqlWorkspace({ contextLocked = false }: { contextLocked?: boolean }) {
  const editorHost = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const runRef = useRef<() => Promise<void>>(async () => undefined);
  const cancelRef = useRef<() => Promise<void>>(async () => undefined);
  const translationWorkerRef = useRef<Worker | null>(null);
  const translationRequestRef = useRef(0);
  const [previewOpen, setPreviewOpen] = useState(true);
  const [translation, setTranslation] = useState<TranslationState>({ status: 'pending' });
  const [localError, setLocalError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const {
    activeTabId,
    tabs,
    results,
    updateTab,
    prepareExecution,
    setExecutionId,
    failExecution,
    clearResults,
  } = useWorkspaceStore();
  const { connected, databases, profiles, loadDatabases, connect } = useConnectionStore();
  const globalPageSize = useSettingsStore((state) => state.settings.execution.pageSize);
  const editorFontSize = useSettingsStore((state) => state.settings.editor.fontSize);
  const databaseOrder = useSettingsStore((state) => state.settings.catalog.databaseOrder);

  const activeTab = tabs.find((tab) => tab.id === activeTabId);
  const sqlTab = contextLocked
    ? (activeTab?.kind === 'collection' ? activeTab : undefined)
    : (activeTab?.kind === 'sql' ? activeTab : undefined);
  // Locked collection SQL keeps its own source so it never clobbers the
  // Query view's editorContent (and vice versa).
  const contentKey: 'sqlEditorContent' | 'editorContent' = contextLocked
    ? 'sqlEditorContent'
    : 'editorContent';
  const fallbackSql = sqlTab?.collection
    ? sqlQueryTemplate(sqlTab.collection, globalPageSize)
    : DEFAULT_SQL;
  const sqlSource = sqlTab?.[contentKey] ?? fallbackSql;
  const hasStoredContent = sqlTab?.[contentKey] !== undefined;
  const selectedConnId = sqlTab?.connectionId ?? null;
  const selectedDb = sqlTab?.database ?? null;
  const orderedDatabases = selectedConnId
    ? orderCatalogEntries(databases[selectedConnId] ?? [], databaseOrder)
    : [];
  const execution = sqlTab ? results[sqlTab.id] : undefined;
  const isBusy = execution?.status === 'starting' ||
    execution?.status === 'running' ||
    execution?.status === 'cancelling';
  const selectedIsConnected = !!(selectedConnId && connected[selectedConnId]);
  const profile = profiles.find((candidate) => candidate.id === selectedConnId);

  useEffect(() => {
    const worker = new Worker(new URL('../../workers/sql-translation.worker.ts', import.meta.url), { type: 'module' });
    translationWorkerRef.current = worker;
    worker.onmessage = (event: MessageEvent<TranslationWorkerResponse>) => {
      if (event.data.id !== translationRequestRef.current) return;
      setTranslation(event.data.ok
        ? { status: 'ok', value: event.data.value }
        : {
            status: 'error',
            message: event.data.message,
            hint: event.data.hint,
            ...(event.data.range ? { range: event.data.range } : {}),
          });
    };
    worker.onerror = () => setTranslation({
      status: 'error',
      message: 'The SQL translation worker stopped unexpectedly.',
      hint: 'Edit the statement to retry, or reopen the SQL tab.',
    });
    return () => {
      translationWorkerRef.current = null;
      worker.terminate();
    };
  }, []);

  useEffect(() => {
    const id = translationRequestRef.current + 1;
    translationRequestRef.current = id;
    setTranslation({ status: 'pending' });
    const timer = window.setTimeout(() => {
      translationWorkerRef.current?.postMessage({ id, source: sqlSource });
    }, 200);
    return () => window.clearTimeout(timer);
  }, [sqlSource]);

  useEffect(() => {
    if (selectedConnId) void loadDatabases(selectedConnId);
  }, [selectedConnId, loadDatabases]);

  const handleRun = useCallback(async () => {
    if (!sqlTab || !selectedConnId || !selectedIsConnected) return;
    setLocalError(null);
    if (translation.status !== 'ok') {
      if (translation.status === 'error') setLocalError(translation.message);
      return;
    }
    const translated = translation.value;
    if ((profile?.readOnly ?? false) && translated.isWrite) {
      setLocalError('This connection is read-only; INSERT, UPDATE and DELETE are blocked.');
      return;
    }
    // Locked collection SQL always runs against the tab namespace, even when
    // the statement names another database (surfaced as a preview warning).
    const database = contextLocked
      ? (sqlTab.database ?? 'admin')
      : (translated.database ?? sqlTab.database ?? profile?.defaultDatabase ?? 'admin');
    if (contextLocked && translated.database !== undefined && translated.database !== database) {
      setLocalError(`This collection view is locked to "${database}"; remove the "${translated.database}" qualifier.`);
      return;
    }

    const editor = editorRef.current;
    const model = editor?.getModel();
    if (!editor || !model) return;
    const tabId = sqlTab.id;
    const runId = crypto.randomUUID();
    const previous = useWorkspaceStore.getState().results[tabId];
    if (
      previous?.executionId &&
      previous.connectionId &&
      (previous.status === 'starting' || previous.status === 'running' || previous.status === 'cancelling')
    ) {
      await window.mongog.query.cancel(previous.connectionId, previous.executionId).catch(() => undefined);
    }
    if (previous?.connectionId) {
      await window.mongog.query.closeOwner(previous.connectionId, tabId).catch(() => undefined);
    }

    prepareExecution(tabId, selectedConnId, runId);
    try {
      const request = {
        connectionId: selectedConnId,
        tabId,
        runId,
        database,
        source: sqlSource,
        pageSize: globalPageSize,
      };
      let response = await window.mongog.query.executeSql(request);
      if (response.status === 'confirmation-required') {
        const target = `${database}.${response.preview.collection}`;
        const accepted = window.confirm(
          `${response.preview.kind.toUpperCase()} targets every document in ${target}.\n\n` +
          'MongoDB multi-document writes are atomic per document, not as one SQL transaction. Continue?',
        );
        if (!accepted) {
          clearResults(tabId);
          return;
        }
        response = await window.mongog.query.executeSql({
          ...request,
          confirmationToken: response.confirmationToken,
        });
        if (response.status === 'confirmation-required') {
          throw new Error('The destructive-write confirmation expired. Run the SQL again.');
        }
      }
      setExecutionId(tabId, runId, response.executionId);
      const latest = useWorkspaceStore.getState().results[tabId];
      if (latest?.status === 'cancelling') await cancelQueryExecution(tabId);
      if (!contextLocked && !sqlTab.customTitle && sqlTab.title === 'SQL') {
        updateTab(tabId, { title: `${database} SQL` });
      }
    } catch (err) {
      failExecution(tabId, runId, errorMessage(err));
    }
  }, [
    sqlTab,
    selectedConnId,
    selectedIsConnected,
    translation,
    sqlSource,
    profile,
    contextLocked,
    globalPageSize,
    prepareExecution,
    setExecutionId,
    updateTab,
    failExecution,
  ]);

  const handleCancel = useCallback(async () => {
    if (!sqlTab) return;
    await cancelQueryExecution(sqlTab.id);
  }, [sqlTab]);

  runRef.current = handleRun;
  cancelRef.current = handleCancel;

  useEffect(() => {
    let disposed = false;
    let editor: Monaco.editor.IStandaloneCodeEditor | null = null;
    let model: Monaco.editor.ITextModel | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let layoutFrame: number | null = null;
    let disposeWheelZoom: (() => void) | null = null;
    void bootMonaco().then((monaco) => {
      if (disposed || !editorHost.current) return;
      const tab = useWorkspaceStore.getState().tabs.find((candidate) => candidate.id === activeTabId);
      model = monaco.editor.createModel(
        tab?.[contentKey] ?? fallbackSql,
        'sql',
        monaco.Uri.parse(`mongog-sql://editor/${encodeURIComponent(activeTabId ?? 'new')}.sql`),
      );
      editor = monaco.editor.create(editorHost.current, {
        model,
        theme: getMonacoTheme(),
        automaticLayout: true,
        minimap: { enabled: false },
        fontSize: useSettingsStore.getState().settings.editor.fontSize,
        mouseWheelZoom: false,
        scrollBeyondLastLine: false,
      });
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => void runRef.current());
      editor.addCommand(monaco.KeyCode.Escape, () => void cancelRef.current());
      editor.onDidChangeModelContent(() => {
        if (!tab) return;
        setLocalError(null);
        const partial: Partial<WorkspaceTab> = { dirty: true };
        partial[contentKey] = editor!.getValue();
        updateTab(tab.id, partial);
      });
      editorRef.current = editor;
      disposeWheelZoom = attachQueryWheelZoom(editorHost.current, {
        isMac: /Mac/i.test(navigator.platform),
        getPreferences: () => {
          const state = useSettingsStore.getState();
          return { fontSize: state.settings.editor.fontSize, enabled: state.loaded && state.settings.editor.mouseWheelZoom };
        },
        setFontSize: (fontSize) => { void useSettingsStore.getState().setEditorFontSize(fontSize); },
      });
      resizeObserver = new ResizeObserver(() => editor?.layout());
      resizeObserver.observe(editorHost.current);
      layoutFrame = requestAnimationFrame(() => editor?.layout());
      editor.focus();
    });
    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      disposeWheelZoom?.();
      if (layoutFrame !== null) cancelAnimationFrame(layoutFrame);
      editor?.dispose();
      model?.dispose();
      if (editorRef.current === editor) editorRef.current = null;
    };
  }, [activeTabId, contentKey, fallbackSql, updateTab]);

  useEffect(() => {
    editorRef.current?.updateOptions({ fontSize: editorFontSize });
  }, [editorFontSize]);

  useEffect(() => {
    if (!editorRef.current || !hasStoredContent) return;
    const current = editorRef.current.getValue();
    if (current !== sqlSource) {
      editorRef.current.setValue(sqlSource);
    }
  }, [sqlSource, hasStoredContent]);

  useEffect(() => {
    let disposed = false;
    void bootMonaco().then((monaco) => {
      if (disposed) return;
      const model = editorRef.current?.getModel();
      if (!model) return;
      const markers: Monaco.editor.IMarkerData[] = translation.status !== 'error'
        ? []
        : [{
          severity: monaco.MarkerSeverity.Error,
          message: `${translation.message}\n${translation.hint}`,
          startLineNumber: translation.range?.startLine ?? 1,
          startColumn: translation.range?.startCol ?? 1,
          endLineNumber: translation.range?.endLine ?? 1,
          endColumn: translation.range?.endCol ?? 2,
        }];
      monaco.editor.setModelMarkers(model, 'mongog-sql-translation', markers);
    });
    return () => {
      disposed = true;
    };
  }, [activeTabId, translation]);

  const handleConnectionChange = (connectionId: string) => {
    if (!sqlTab || contextLocked) return;
    const oldConnectionId = sqlTab.connectionId;
    if (oldConnectionId) {
      void window.mongog.query.closeOwner(oldConnectionId, sqlTab.id);
    }
    clearResults(sqlTab.id);
    const next = profiles.find((candidate) => candidate.id === connectionId);
    updateTab(sqlTab.id, {
      connectionId: connectionId || null,
      database: next?.defaultDatabase ?? 'admin',
      ...(sqlTab.savedItemId ? { dirty: true } : {}),
    });
    if (connectionId) void loadDatabases(connectionId);
  };

  const copyMongosh = async () => {
    if (translation.status !== 'ok') return;
    try {
      await navigator.clipboard.writeText(translation.value.mongosh);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setLocalError('Could not copy to clipboard.');
    }
  };

  if (!sqlTab) return null;

  const lockedDbWarning = contextLocked &&
    translation.status === 'ok' &&
    translation.value.database !== undefined &&
    translation.value.database !== (sqlTab.database ?? 'admin')
    ? `SQL names database "${translation.value.database}" but this view is locked to "${sqlTab.database ?? 'admin'}"; execution is blocked.`
    : null;

  const showResults = !!execution && (
    execution.status !== 'idle' ||
    execution.statementResults.length > 0 ||
    execution.statementErrors.length > 0 ||
    execution.consoleEntries.length > 0 ||
    execution.skippedStatements.length > 0 ||
    execution.error !== null
  );
  const runDisabled = !selectedIsConnected || isBusy || translation.status !== 'ok' ||
    ((profile?.readOnly ?? false) && translation.status === 'ok' && translation.value.isWrite);

  return (
    <div data-testid="sql-workspace" style={s.container}>
      <div style={s.toolbar}>
        <select
          aria-label="Connection"
          style={s.select}
          value={selectedConnId ?? ''}
          onChange={(event) => handleConnectionChange(event.target.value)}
          disabled={contextLocked || isBusy}
          title={contextLocked ? 'Connection is locked to this collection' : undefined}
        >
          <option value="">-- connection --</option>
          {profiles.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}{connected[item.id] ? '' : ' (offline)'}
            </option>
          ))}
        </select>

        {selectedConnId && (
          <select
            aria-label="Database"
            style={s.select}
            value={sqlTab.database ?? 'admin'}
            onChange={(event) => {
              if (!contextLocked) updateTab(sqlTab.id, {
                database: event.target.value,
                ...(sqlTab.savedItemId ? { dirty: true } : {}),
              });
            }}
            disabled={contextLocked || isBusy}
            title={contextLocked ? 'Database is locked to this collection' : undefined}
          >
            <option value="admin">admin</option>
            {sqlTab.database && sqlTab.database !== 'admin' && !orderedDatabases.some((database) => database.name === sqlTab.database) && (
              <option value={sqlTab.database}>{sqlTab.database}</option>
            )}
            {orderedDatabases
              .filter((database) => database.name !== 'admin')
              .map((database) => (
                <option key={database.name} value={database.name}>{database.name}</option>
              ))}
          </select>
        )}

        {selectedConnId && !selectedIsConnected && (
          <button style={s.btn} onClick={() => void connect(selectedConnId)} disabled={isBusy}>
            Connect
          </button>
        )}

        <button
          style={{ ...s.btn, ...(runDisabled ? s.btnDisabled : {}) }}
          onClick={() => void handleRun()}
          disabled={runDisabled}
          title="Translate the SQL to MongoDB and run it (Cmd/Ctrl+Enter)"
        >
          Run SQL (⌘⏎)
        </button>
        <button
          style={{ ...s.btn, ...s.btnDanger, ...(!isBusy ? s.btnDisabled : {}) }}
          onClick={() => void handleCancel()}
          disabled={!isBusy}
        >
          Cancel (Esc)
        </button>

        <SavedActions tab={sqlTab} surface="sql" />

        {(execution?.error || localError) && (
          <span style={s.error} title={execution?.error ?? localError ?? ''}>{execution?.error ?? localError}</span>
        )}
        <span style={s.status}>{execution?.status ?? 'idle'}</span>
      </div>

      <div data-testid="sql-editor-surface" ref={editorHost} style={s.editor} />

      <div style={s.preview}>
        <div
          style={s.previewHeader}
          role="button"
          tabIndex={0}
          aria-expanded={previewOpen}
          onClick={() => setPreviewOpen((open) => !open)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              setPreviewOpen((open) => !open);
            }
          }}
        >
          <span aria-hidden="true">{previewOpen ? '▾' : '▸'}</span>
          <strong>MongoDB translation</strong>
          {translation.status === 'ok' && (
            <span>
              {translation.value.execution} · {translation.value.collection}
              {translation.value.isWrite ? ' · write' : ''}
            </span>
          )}
          <span style={{ flex: 1 }} />
          {translation.status === 'ok' && (
            <button
              type="button"
              style={s.ghostBtn}
              onClick={(event) => {
                event.stopPropagation();
                void copyMongosh();
              }}
            >
              {copied ? 'Copied' : 'Copy mongosh'}
            </button>
          )}
        </div>
        {previewOpen && translation.status === 'ok' && (
          <pre style={s.previewBody}>{translation.value.mongosh}</pre>
        )}
        {previewOpen && translation.status === 'pending' && (
          <div style={s.warning} role="status">Translating SQL…</div>
        )}
        {previewOpen && translation.status === 'error' && (
          <div style={s.previewError} role="alert">
            {translation.message}
            <span style={s.previewHint}>{translation.hint}</span>
          </div>
        )}
        {previewOpen && translation.status === 'ok' && translation.value.warnings.map((warning) => (
          <div key={warning} style={s.warning} role="note">{warning}</div>
        ))}
        {previewOpen && lockedDbWarning && (
          <div style={s.warning} role="note">{lockedDbWarning}</div>
        )}
      </div>

      {showResults && (
        <div
          data-testid="sql-results-region"
          style={{ width: '100%', minWidth: 0, height: '40%', minHeight: 100, overflow: 'hidden', flexShrink: 0 }}
        >
          <ResultsPanel />
        </div>
      )}
    </div>
  );
}

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}
