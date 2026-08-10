import { useCallback, useEffect, useRef } from 'react';
import type * as Monaco from 'monaco-editor';
import { bootMonaco } from '../../monaco/setup.js';
import { useWorkspaceStore } from '../../stores/workspace.js';
import { useConnectionStore } from '../../stores/connections.js';
import { useEditorContext } from '../../stores/editor-context.js';
import { useSettingsStore } from '../../stores/settings.js';
import { getMonacoTheme } from '../../theme.js';
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
  status: { fontSize: 11, color: 'var(--color-text-muted)', marginLeft: 'auto' },
  error: { fontSize: 11, color: 'var(--color-danger)', maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis' },
  editor: { flex: 1, width: '100%', minWidth: 0, minHeight: 0, overflow: 'hidden' },
};

const DEFAULT_CODE = `// Select a connection, then run with Cmd/Ctrl+Enter.
// If text is selected, only the selection is executed.
const coll = db.collection("mycollection");
coll.find({}).limit(5);
`;

export function QueryEditor({ contextLocked = false }: { contextLocked?: boolean }) {
  const editorHost = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const runRef = useRef<() => Promise<void>>(async () => undefined);
  const cancelRef = useRef<() => Promise<void>>(async () => undefined);

  const {
    activeTabId,
    tabs,
    results,
    updateTab,
    prepareExecution,
    setExecutionId,
    requestCancellation,
    failExecution,
    clearResults,
  } = useWorkspaceStore();
  const { connected, databases, profiles, loadDatabases, connect } = useConnectionStore();
  const globalPageSize = useSettingsStore((state) => state.settings.execution.pageSize);

  const activeTab = tabs.find((tab) => tab.id === activeTabId);
  const selectedConnId = activeTab?.connectionId ?? null;
  const selectedDb = activeTab?.database ?? null;
  const execution = activeTab ? results[activeTab.id] : undefined;
  const querySurfaceActive = activeTab?.kind === 'query' || (
    activeTab?.kind === 'collection' && activeTab.collectionViewMode === 'query'
  );
  const isBusy = execution?.status === 'starting' ||
    execution?.status === 'running' ||
    execution?.status === 'cancelling';
  const selectedIsConnected = !!(selectedConnId && connected[selectedConnId]);

  useEffect(() => {
    useEditorContext.getState().setContext(selectedConnId, selectedDb);
    if (selectedConnId) void loadDatabases(selectedConnId);
  }, [selectedConnId, selectedDb, loadDatabases]);

  const handleRun = useCallback(async () => {
    if (!activeTab || !querySurfaceActive || !selectedConnId || !selectedIsConnected) return;
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (!editor || !model) return;

    const selection = editor.getSelection();
    const hasSelection = selection !== null && !selection.isEmpty();
    const source = hasSelection && selection
      ? model.getValueInRange(selection)
      : model.getValue();
    if (!source.trim()) return;

    const tabId = activeTab.id;
    const runId = crypto.randomUUID();
    const previous = useWorkspaceStore.getState().results[tabId];
    if (
      previous?.executionId &&
      previous.connectionId &&
      (previous.status === 'starting' ||
        previous.status === 'running' ||
        previous.status === 'cancelling')
    ) {
      await window.mongog.query.cancel(previous.connectionId, previous.executionId).catch(() => undefined);
    }
    if (previous?.connectionId) {
      await window.mongog.query.closeOwner(previous.connectionId, tabId).catch(() => undefined);
    }

    prepareExecution(tabId, selectedConnId, runId);
    const profile = profiles.find((candidate) => candidate.id === selectedConnId);
    const database = activeTab.database ?? profile?.defaultDatabase ?? 'admin';
    const sourceOffset = hasSelection && selection
      ? { line: selection.startLineNumber - 1, column: selection.startColumn - 1 }
      : { line: 0, column: 0 };

    try {
      const response = await window.mongog.query.execute({
        connectionId: selectedConnId,
        tabId,
        runId,
        database,
        mode: activeTab.mode ?? 'query',
        source,
        sourceOffset,
        readOnly: profile?.readOnly ?? false,
        pageSize: globalPageSize,
      });
      setExecutionId(tabId, runId, response.executionId);
      if (!activeTab.customTitle && activeTab.title === 'Untitled') {
        updateTab(tabId, { title: `${database} query` });
      }
    } catch (err) {
      failExecution(tabId, runId, errorMessage(err));
    }
  }, [
    activeTab,
    querySurfaceActive,
    selectedConnId,
    selectedIsConnected,
    profiles,
    globalPageSize,
    prepareExecution,
    setExecutionId,
    updateTab,
    failExecution,
  ]);

  const handleCancel = useCallback(async () => {
    if (!activeTab) return;
    const current = useWorkspaceStore.getState().results[activeTab.id];
    if (!current?.executionId || !current.connectionId) return;
    requestCancellation(activeTab.id);
    try {
      await window.mongog.query.cancel(current.connectionId, current.executionId);
    } catch (err) {
      failExecution(activeTab.id, current.runId ?? '', errorMessage(err));
    }
  }, [activeTab, requestCancellation, failExecution]);

  runRef.current = handleRun;
  cancelRef.current = handleCancel;

  useEffect(() => {
    let disposed = false;
    let editor: Monaco.editor.IStandaloneCodeEditor | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let layoutFrame: number | null = null;
    void bootMonaco().then((monaco) => {
      if (disposed || !editorHost.current) return;
      const tab = useWorkspaceStore.getState().tabs
        .find((candidate) => candidate.id === activeTabId);
      editor = monaco.editor.create(editorHost.current, {
        value: tab?.editorContent ?? DEFAULT_CODE,
        language: 'typescript',
        theme: getMonacoTheme(),
        automaticLayout: true,
        minimap: { enabled: false },
        fontSize: 13,
        scrollBeyondLastLine: false,
      });
      editor.addCommand(
        monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter,
        () => void runRef.current(),
      );
      editor.addCommand(monaco.KeyCode.Escape, () => void cancelRef.current());
      editor.onDidChangeModelContent(() => {
        if (!tab) return;
        updateTab(tab.id, { editorContent: editor!.getValue(), dirty: true });
      });
      editorRef.current = editor;
      resizeObserver = new ResizeObserver(() => editor?.layout());
      resizeObserver.observe(editorHost.current);
      const shouldAutoExecute = tab?.autoExecuteOnOpen === true;
      if (shouldAutoExecute && tab) {
        updateTab(tab.id, { autoExecuteOnOpen: undefined });
      }
      const connectedAtOpen = !!(
        shouldAutoExecute &&
        tab?.connectionId &&
        useConnectionStore.getState().connected[tab.connectionId]
      );
      layoutFrame = requestAnimationFrame(() => {
        editor?.layout();
        if (connectedAtOpen) void runRef.current();
      });
      editor.focus();
    });
    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      if (layoutFrame !== null) cancelAnimationFrame(layoutFrame);
      editor?.dispose();
      if (editorRef.current === editor) editorRef.current = null;
    };
  }, [activeTabId, updateTab]);

  useEffect(() => {
    if (!editorRef.current || activeTab?.editorContent === undefined) return;
    const current = editorRef.current.getValue();
    if (current !== activeTab.editorContent) {
      editorRef.current.setValue(activeTab.editorContent);
    }
  }, [activeTab?.editorContent]);

  useEffect(() => {
    let disposed = false;
    void bootMonaco().then((monaco) => {
      if (disposed) return;
      const model = editorRef.current?.getModel();
      if (!model) return;
      const errorMarkers: Monaco.editor.IMarkerData[] = (execution?.statementErrors ?? []).map((item) => ({
        severity: monaco.MarkerSeverity.Error,
        message: `${item.error.category}: ${item.error.message}${
          item.error.hint ? `\n${item.error.hint}` : ''
        }`,
        startLineNumber: Math.max(1, item.range.startLine),
        startColumn: Math.max(1, item.range.startCol),
        endLineNumber: Math.max(item.range.startLine, item.range.endLine),
        endColumn: item.range.startLine === item.range.endLine
          ? Math.max(item.range.startCol + 1, item.range.endCol)
          : Math.max(1, item.range.endCol),
      }));
      const warningMarkers: Monaco.editor.IMarkerData[] = (execution?.statementWarnings ?? []).map((item) => ({
        severity: monaco.MarkerSeverity.Warning,
        source: 'MongoG',
        ...(item.fix ? { code: item.code } : {}),
        message: `${item.message}${item.hint ? `\n${item.hint}` : ''}`,
        startLineNumber: Math.max(1, item.range.startLine),
        startColumn: Math.max(1, item.range.startCol),
        endLineNumber: Math.max(item.range.startLine, item.range.endLine),
        endColumn: item.range.startLine === item.range.endLine
          ? Math.max(item.range.startCol + 1, item.range.endCol)
          : Math.max(1, item.range.endCol),
      }));
      monaco.editor.setModelMarkers(
        model,
        'mongog-query-execution',
        [...errorMarkers, ...warningMarkers],
      );
    });
    return () => {
      disposed = true;
    };
  }, [activeTabId, execution?.statementErrors, execution?.statementWarnings]);

  const handleConnectionChange = (connectionId: string) => {
    if (!activeTab || contextLocked) return;
    const oldConnectionId = activeTab.connectionId;
    if (oldConnectionId) {
      void window.mongog.query.closeOwner(oldConnectionId, activeTab.id);
    }
    clearResults(activeTab.id);
    const profile = profiles.find((candidate) => candidate.id === connectionId);
    updateTab(activeTab.id, {
      connectionId: connectionId || null,
      database: profile?.defaultDatabase ?? 'admin',
      ...(activeTab.savedItemId ? { dirty: true } : {}),
    });
    if (connectionId) void loadDatabases(connectionId);
  };

  const selectedQueryText = () => {
    const editor = editorRef.current;
    const selection = editor?.getSelection();
    const model = editor?.getModel();
    if (!selection || selection.isEmpty() || !model) return null;
    return model.getValueInRange(selection);
  };

  return (
    <div data-testid="query-editor" style={s.container}>
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
          {profiles.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.name}{connected[profile.id] ? '' : ' (offline)'}
            </option>
          ))}
        </select>

        {selectedConnId && (
          <select
            aria-label="Database"
            style={s.select}
            value={activeTab?.database ?? 'admin'}
            onChange={(event) => {
              if (!contextLocked) updateTab(activeTab!.id, {
                database: event.target.value,
                ...(activeTab?.savedItemId ? { dirty: true } : {}),
              });
            }}
            disabled={contextLocked || isBusy}
            title={contextLocked ? 'Database is locked to this collection' : undefined}
          >
            <option value="admin">admin</option>
            {activeTab?.database && activeTab.database !== 'admin' && !(databases[selectedConnId] ?? []).some((database) => database.name === activeTab.database) && (
              <option value={activeTab.database}>{activeTab.database}</option>
            )}
            {(databases[selectedConnId] ?? [])
              .filter((database) => database.name !== 'admin')
              .map((database) => (
                <option key={database.name} value={database.name}>{database.name}</option>
              ))}
          </select>
        )}

        <select
          aria-label="Execution mode"
          style={s.select}
          value={activeTab?.mode ?? 'query'}
          onChange={(event) => {
            if (!activeTab) return;
            const mode = event.target.value as 'query' | 'trusted';
            if (
              mode === 'trusted' &&
              !window.confirm(
                'Trusted mode is equivalent to running trusted local code; it is not a security sandbox. Continue?',
              )
            ) return;
            updateTab(activeTab.id, { mode, ...(activeTab.savedItemId ? { dirty: true } : {}) });
          }}
          disabled={isBusy}
        >
          <option value="query">Query mode</option>
          <option value="trusted">Trusted mode</option>
        </select>

        {activeTab && <SavedActions tab={activeTab} surface="query" getSelection={selectedQueryText} />}

        {selectedConnId && !selectedIsConnected && (
          <button
            style={s.btn}
            onClick={() => void connect(selectedConnId)}
            disabled={isBusy}
          >
            Connect
          </button>
        )}

        <button
          style={{ ...s.btn, ...((!selectedIsConnected || isBusy) ? s.btnDisabled : {}) }}
          onClick={() => void handleRun()}
          disabled={!selectedIsConnected || isBusy}
          title="Runs the current selection, or the full editor when there is no selection"
        >
          Run (⌘⏎)
        </button>
        <button
          style={{ ...s.btn, ...s.btnDanger, ...(!isBusy ? s.btnDisabled : {}) }}
          onClick={() => void handleCancel()}
          disabled={!isBusy}
        >
          Cancel (Esc)
        </button>

        {execution?.error && <span style={s.error} title={execution.error}>{execution.error}</span>}
        <span style={s.status}>{execution?.status ?? 'idle'}</span>
      </div>
      <div data-testid="query-editor-surface" ref={editorHost} style={s.editor} />
    </div>
  );
}

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}
