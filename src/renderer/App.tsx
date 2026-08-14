import { useEffect, useRef, useCallback } from 'react';
import { Explorer } from './components/Sidebar/Explorer.js';
import { TabBar } from './components/TabBar/TabBar.js';
import { QueryWorkspace } from './components/Editor/QueryWorkspace.js';
import { CollectionView } from './components/Results/CollectionView.js';
import { AdminView } from './components/Admin/AdminView.js';
import { ChangeStreamView } from './components/Admin/ChangeStreamView.js';
import { WelcomeView } from './components/Welcome/WelcomeView.js';
import { ConnectionsView } from './components/Connections/ConnectionsView.js';
import { SettingsView } from './components/Settings/SettingsView.js';
import { ReleaseNotesView } from './components/ReleaseNotes/ReleaseNotesView.js';
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

let saveTimer: ReturnType<typeof setTimeout> | null = null;

export default function App() {
  const { activeTabId, tabs, sidebarWidth, restore } = useWorkspaceStore();
  const { load } = useConnectionStore();
  const loadSettings = useSettingsStore((state) => state.load);
  const engineSubRef = useRef<(() => void) | null>(null);
  const initializedRef = useRef(false);
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
    void loadSettings();
    void window.mongog.workspace.load().then((saved) => {
      if (saved && saved.tabs.length > 0) {
        restore(saved);
      }
    }).catch(() => undefined).finally(() => {
      void useSavedLibraryStore.getState().load();
      useWorkspaceStore.getState().openWelcome();
      const current = useWorkspaceStore.getState();
      workspaceMetadataRef.current = workspaceMetadataFingerprint(current.tabs, current.activeTabId);
      workspaceReadyRef.current = true;
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
      }
    });
  }, []);

  useEffect(() => window.mongog.events.onExportProgress((event) => {
    useExportJobsStore.getState().apply(event);
  }), []);

  useEffect(() => window.mongog.events.onDataJobProgress((event) => {
    useDataTransferStore.getState().applyProgress(event);
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
      <div style={{
        flex: 1, minWidth: 0, minHeight: 0, display: 'flex',
        flexDirection: 'column', overflow: 'hidden',
      }}>
        <TabBar />
        {renderWorkspaceContent(activeTabId, tabs)}
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
 * Change streams keep polling while another tab is active. Keeping those
 * surfaces mounted also means their existing unmount cleanup remains the
 * single owner of closing a stream when its tab is actually removed.
 */
function renderWorkspaceContent(activeTabId: string | null, tabs: WorkspaceTab[]) {
  const activeTab = tabs.find((tab) => tab.id === activeTabId);
  const changeStreamTabs = tabs.filter((tab) => tab.kind === 'change-stream');

  return (
    <>
      {activeTab?.kind !== 'change-stream' && renderTabContent(activeTabId, tabs)}
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

function workspaceMetadataFingerprint(tabs: WorkspaceTab[], activeTabId: string | null): string {
  return JSON.stringify({
    activeTabId,
    tabs: tabs.map(({
      editorContent: _editorContent,
      documentsState: _documentsState,
      documentsPageSizeOverride: _documentsPageSizeOverride,
      documentsColumnOrder: _documentsColumnOrder,
      documentsColumnOrderManual: _documentsColumnOrderManual,
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
    case 'collection':
      return (
        <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <CollectionView />
        </div>
      );
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
