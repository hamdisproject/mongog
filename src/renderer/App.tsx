import { useEffect, useRef, useCallback, useState } from 'react';
import { Explorer } from './components/Sidebar/Explorer.js';
import { TabBar } from './components/TabBar/TabBar.js';
import { QueryWorkspace } from './components/Editor/QueryWorkspace.js';
import { SqlWorkspace } from './components/Sql/SqlWorkspace.js';
import { CollectionView } from './components/Results/CollectionView.js';
import { AdminView } from './components/Admin/AdminView.js';
import { ChangeStreamView } from './components/Admin/ChangeStreamView.js';
import { WelcomeView } from './components/Welcome/WelcomeView.js';
import { ConnectionsView } from './components/Connections/ConnectionsView.js';
import { SettingsView } from './components/Settings/SettingsView.js';
import { ReleaseNotesView } from './components/ReleaseNotes/ReleaseNotesView.js';
import { UpdatesView } from './components/Updates/UpdatesView.js';
import { ActivityLogView } from './components/Activity/ActivityLogView.js';
import { CommandPalette } from './components/CommandPalette/CommandPalette.js';
import type { WorkspaceTab } from '../shared/domain/index.js';
import { useWorkspaceStore } from './stores/workspace.js';
import { useConnectionStore } from './stores/connections.js';
import { useSchemaCache } from './stores/schema-cache.js';
import { getMonacoTheme, theme } from './theme.js';
import { useSettingsStore } from './stores/settings.js';
import { useSavedLibraryStore } from './stores/saved.js';
import { bootMonaco } from './monaco/setup.js';
import { ExportProgressOverlay } from './components/Export/ExportProgressOverlay.js';
import { useExportJobsStore } from './stores/exports.js';
import { DataTransferView } from './components/DataTransfer/DataTransferView.js';
import { DataTransferProgressOverlay } from './components/DataTransfer/DataTransferProgressOverlay.js';
import { useDataTransferStore } from './stores/data-transfer.js';
import { useUpdatesStore } from './stores/updates.js';
import { DatabaseRenameProgressOverlay } from './components/Database/DatabaseRenameProgressOverlay.js';
import { useDatabaseRenameJobsStore } from './stores/database-renames.js';

let saveTimer: ReturnType<typeof setTimeout> | null = null;

export default function App() {
  const { activeTabId, tabs, sidebarWidth, restore } = useWorkspaceStore();
  const { load } = useConnectionStore();
  const loadSettings = useSettingsStore((state) => state.load);
  const engineSubRef = useRef<(() => void) | null>(null);
  const initializedRef = useRef(false);
  const [startupReady, setStartupReady] = useState(false);
  const workspaceReadyRef = useRef(false);
  const workspaceMetadataRef = useRef('');

  // Save workspace state (debounced).
  const persist = useCallback((delayMs = 500) => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = null;
    const save = () => {
      const { tabs: t, activeTabId: a, sidebarWidth: width } = useWorkspaceStore.getState();
      void window.mongog.workspace.save({ tabs: t, activeTabId: a, sidebarWidth: width });
    };
    if (delayMs === 0) {
      save();
      return;
    }
    saveTimer = setTimeout(() => {
      saveTimer = null;
      save();
    }, delayMs);
  }, []);

  // Load workspace state on startup.
  useEffect(() => {
    // React StrictMode intentionally re-runs effects in development. A second
    // restore can otherwise race with the user's first interaction and bring
    // Welcome back to the foreground after they have opened Connections.
    if (initializedRef.current) return;
    initializedRef.current = true;
    void load();
    void useUpdatesStore.getState().check();
    void Promise.all([
      loadSettings(),
      window.mongog.workspace.load().catch(() => null),
    ]).then(([, saved]) => {
      if (saved && saved.tabs.length > 0) {
        restore(saved);
      }
    }).catch(() => undefined).finally(() => {
      void useSavedLibraryStore.getState().load();
      useWorkspaceStore.getState().openWelcome();
      const current = useWorkspaceStore.getState();
      workspaceMetadataRef.current = workspaceMetadataFingerprint(current.tabs, current.activeTabId);
      workspaceReadyRef.current = true;
      setStartupReady(true);
      persist(0);
    });
  }, []);

  // Subscribe to engine events.
  useEffect(() => {
    engineSubRef.current = window.mongog.events.onEngineEvent((payload) => {
      const store = useWorkspaceStore.getState();
      const routedTabId = payload.tabId && store.results[payload.tabId]
        ? payload.tabId
        : Object.entries(store.results)
          .find(([, result]) => result.executionId === payload.executionId)?.[0];

      if (!routedTabId) return;
      store.applyEngineEvent(
        routedTabId,
        payload.connectionId,
        payload.executionId,
        payload.runId,
        payload.event,
      );
    });

    return () => {
      engineSubRef.current?.();
    };
  }, []);

  useEffect(() => {
    return window.mongog.events.onConnectionState((state) => {
      useConnectionStore.getState().applyRuntimeState(state);
      if (state.status === 'restarting') {
        const message = 'Connection runtime restarted to cancel another query.';
        useSchemaCache.getState().invalidateConnection(state.connectionId);
        useWorkspaceStore.getState().handleRuntimeRestart(
          state.connectionId,
          state.executionId,
          message,
        );
        useExportJobsStore.getState().failConnection(state.connectionId, message);
        useDataTransferStore.getState().failConnection(state.connectionId, message);
        useDatabaseRenameJobsStore.getState().failConnection(state.connectionId, message);
        return;
      }
      if (
        state.status === 'disconnected' ||
        state.status === 'runtime-crashed' ||
        state.status === 'error'
      ) {
        useSchemaCache.getState().invalidateConnection(state.connectionId);
        const message = state.status === 'error'
          ? state.error.message
          : state.status === 'runtime-crashed'
            ? 'Query runtime stopped unexpectedly or was force-killed.'
            : state.reason === 'idle'
              ? `Connection closed after ${formatIdleDuration(state.idleTimeoutMS)} of inactivity. Reconnect to continue.`
              : 'Connection closed while the query was running.';
        useWorkspaceStore.getState().failExecutionsForConnection(state.connectionId, message);
        useExportJobsStore.getState().failConnection(state.connectionId, message);
        useDataTransferStore.getState().failConnection(state.connectionId, message);
        useDatabaseRenameJobsStore.getState().failConnection(state.connectionId, message);
      }
    });
  }, []);

  useEffect(() => window.mongog.events.onUpdateStatus((payload) => {
    useUpdatesStore.getState().applyPayload(payload);
  }), []);

  // Startup consent: when an update becomes available for the first time, ask the
  // user whether to install it now. Declining just silences the prompt and leaves
  // the sidebar badge + Updates tab available for later (phase stays 'available').
  const consentPromptedRef = useRef(false);
  const maybePrompt = () => {
    const state = useUpdatesStore.getState();
    if (state.phase === 'available' && state.availableVersion && !consentPromptedRef.current) {
      consentPromptedRef.current = true;
      if (window.confirm(`A new MongoG version (v${state.availableVersion}) is available. Download it now? You can choose when to restart.`)) {
        void useUpdatesStore.getState().install();
      }
    }
  };
  useEffect(() => {
    maybePrompt();
    const unsub = useUpdatesStore.subscribe(maybePrompt);
    return () => {
      unsub();
    };
  }, []);

  useEffect(() => window.mongog.events.onExportProgress((event) => {
    useExportJobsStore.getState().apply(event);
  }), []);

  useEffect(() => window.mongog.events.onDataJobProgress((event) => {
    useDataTransferStore.getState().applyProgress(event);
  }), []);

  useEffect(() => window.mongog.events.onDatabaseRenameProgress((event) => {
    useDatabaseRenameJobsStore.getState().apply(event);
    void useConnectionStore.getState().applyDatabaseRenameProgress(event);
  }), []);

  useEffect(() => {
    const applyEditorTheme = () => {
      void bootMonaco().then((monaco) => monaco.editor.setTheme(getMonacoTheme()));
    };
    window.addEventListener('mongog-theme-change', applyEditorTheme);
    return () => window.removeEventListener('mongog-theme-change', applyEditorTheme);
  }, []);

  // Persist workspace state on tab changes.
  useEffect(() => {
    if (!workspaceReadyRef.current) return;
    const metadata = workspaceMetadataFingerprint(tabs, activeTabId);
    const metadataChanged = metadata !== workspaceMetadataRef.current;
    workspaceMetadataRef.current = metadata;
    persist(metadataChanged ? 0 : 500);
  }, [tabs, activeTabId, sidebarWidth]);

  // Save on window close.
  useEffect(() => {
    const onUnload = () => {
      const { tabs: t, activeTabId: a, sidebarWidth: width } = useWorkspaceStore.getState();
      void window.mongog.workspace.save({ tabs: t, activeTabId: a, sidebarWidth: width });
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, []);

  if (!startupReady) {
    return <div role="status" style={{ padding: 24, color: theme.colors.textMuted }}>Loading workspace…</div>;
  }

  return (
    <div style={{
      display: 'flex', width: '100%', height: '100%', minWidth: 0, minHeight: 0,
      overflow: 'hidden', background: theme.colors.app, color: theme.colors.text,
      fontFamily: 'system-ui',
    }}>
      <Explorer />
      <CommandPalette />
      <ExportProgressOverlay />
      <DataTransferProgressOverlay />
      <DatabaseRenameProgressOverlay />
      <div style={{
        flex: 1, minWidth: 0, minHeight: 0, display: 'flex',
        flexDirection: 'column', overflow: 'hidden',
      }}>
        <TabBar />
        <WorkspaceContent activeTabId={activeTabId} tabs={tabs} />
      </div>
    </div>
  );
}

function formatIdleDuration(idleTimeoutMS?: number): string {
  if (!idleTimeoutMS) return 'the configured idle period';
  const minutes = Math.round(idleTimeoutMS / 60_000);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = minutes / 60;
  return `${hours} hour${hours === 1 ? '' : 's'}`;
}

/**
 * Change streams keep polling while another tab is active. Collection browsers
 * are mounted lazily and then retained so their page/cursor state survives tab
 * switches without mounting every restored collection at startup.
 */
function WorkspaceContent({
  activeTabId,
  tabs,
}: {
  activeTabId: string | null;
  tabs: WorkspaceTab[];
}) {
  const [activatedCollectionTabIds, setActivatedCollectionTabIds] = useState<Set<string>>(
    () => new Set(),
  );
  const activeTab = tabs.find((tab) => tab.id === activeTabId);
  const collectionTabs = tabs.filter((tab) => (
    tab.kind === 'collection' && (
      tab.id === activeTabId || activatedCollectionTabIds.has(tab.id)
    )
  ));
  const changeStreamTabs = tabs.filter((tab) => tab.kind === 'change-stream');

  useEffect(() => {
    setActivatedCollectionTabIds((current) => {
      const openCollectionTabIds = new Set(
        tabs.filter((tab) => tab.kind === 'collection').map((tab) => tab.id),
      );
      const next = new Set(
        Array.from(current).filter((tabId) => openCollectionTabIds.has(tabId)),
      );
      if (activeTab?.kind === 'collection') next.add(activeTab.id);
      if (setsEqual(current, next)) return current;
      return next;
    });
  }, [activeTab?.id, activeTab?.kind, tabs]);

  return (
    <>
      {activeTab?.kind !== 'change-stream' && activeTab?.kind !== 'collection' &&
        renderTabContent(activeTabId, tabs)}
      {collectionTabs.map((tab) => {
        const active = tab.id === activeTabId;
        return (
          <div
            key={tab.id}
            data-collection-surface={tab.id}
            aria-hidden={!active}
            style={{
              flex: 1,
              minWidth: 0,
              minHeight: 0,
              display: active ? 'flex' : 'none',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            <CollectionView tab={tab} active={active} />
          </div>
        );
      })}
      {changeStreamTabs.map((tab) => {
        const active = tab.id === activeTabId;
        return (
          <div
            key={tab.id}
            data-change-stream-surface={tab.id}
            aria-hidden={!active}
            style={{
              flex: 1,
              minWidth: 0,
              minHeight: 0,
              display: active ? 'flex' : 'none',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            <ChangeStreamView tab={tab} />
          </div>
        );
      })}
    </>
  );
}

function setsEqual(left: Set<string>, right: Set<string>): boolean {
  return left.size === right.size && Array.from(left).every((value) => right.has(value));
}

function workspaceMetadataFingerprint(tabs: WorkspaceTab[], activeTabId: string | null): string {
  return JSON.stringify({
    activeTabId,
    tabs: tabs.map(({
      editorContent: _editorContent,
      sqlEditorContent: _sqlEditorContent,
      documentsState: _documentsState,
      documentsPageSizeOverride: _documentsPageSizeOverride,
      documentsColumnOrder: _documentsColumnOrder,
      documentsColumnOrderManual: _documentsColumnOrderManual,
      documentsCriteriaOpen: _documentsCriteriaOpen,
      dirty: _dirty,
      ...metadata
    }) => metadata),
  });
}

function renderTabContent(activeTabId: string | null, tabs: WorkspaceTab[]) {
  const activeTab = tabs.find((t) => t.id === activeTabId);

  if (!activeTab) {
    return <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-faint)' }}>
      Select or create a tab to begin
    </div>;
  }

  switch (activeTab.kind) {
    case 'welcome':
      return <WelcomeView />;
    case 'query':
      return <QueryWorkspace />;
    case 'sql':
      return <SqlWorkspace />;
    case 'collection':
      return null;
    case 'admin':
      return <AdminView tab={activeTab} />;
    case 'change-stream':
      return null;
    case 'connection-settings':
      return <ConnectionsView tab={activeTab} />;
    case 'settings':
      return <SettingsView />;
    case 'release-notes':
      return <ReleaseNotesView />;
    case 'updates':
      return <UpdatesView />;
    case 'history':
      return <ActivityLogView />;
    case 'data-transfer':
      return <DataTransferView />;
    default:
      return <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-faint)' }}>
        {activeTab.kind} tab
      </div>;
  }
}
