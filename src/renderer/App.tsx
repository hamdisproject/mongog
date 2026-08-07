import { useEffect, useRef, useCallback } from 'react';
import { Explorer } from './components/Sidebar/Explorer.js';
import { TabBar } from './components/TabBar/TabBar.js';
import { QueryWorkspace } from './components/Editor/QueryWorkspace.js';
import { CollectionView } from './components/Results/CollectionView.js';
import { AdminView } from './components/Admin/AdminView.js';
import { WelcomeView } from './components/Welcome/WelcomeView.js';
import { ConnectionsView } from './components/Connections/ConnectionsView.js';
import type { WorkspaceTab } from '../shared/domain/index.js';
import { useWorkspaceStore } from './stores/workspace.js';
import { useConnectionStore } from './stores/connections.js';
import { useSchemaCache } from './stores/schema-cache.js';
import { theme } from './theme.js';

let saveTimer: ReturnType<typeof setTimeout> | null = null;

export default function App() {
  const { activeTabId, tabs, restore } = useWorkspaceStore();
  const { load } = useConnectionStore();
  const engineSubRef = useRef<(() => void) | null>(null);
  const initializedRef = useRef(false);

  // Save workspace state (debounced).
  const persist = useCallback(() => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const { tabs: t, activeTabId: a } = useWorkspaceStore.getState();
      void window.mongog.workspace.save({ tabs: t, activeTabId: a });
    }, 500);
  }, []);

  // Load workspace state on startup.
  useEffect(() => {
    // React StrictMode intentionally re-runs effects in development. A second
    // restore can otherwise race with the user's first interaction and bring
    // Welcome back to the foreground after they have opened Connections.
    if (initializedRef.current) return;
    initializedRef.current = true;
    void load();
    void window.mongog.workspace.load().then((saved) => {
      if (saved && saved.tabs.length > 0) {
        restore(saved);
      }
    }).catch(() => undefined).finally(() => {
      useWorkspaceStore.getState().openWelcome();
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
            : 'Connection closed while the query was running.';
        useWorkspaceStore.getState().failExecutionsForConnection(state.connectionId, message);
      }
    });
  }, []);

  // Persist workspace state on tab changes.
  useEffect(() => {
    persist();
  }, [tabs, activeTabId]);

  // Save on window close.
  useEffect(() => {
    const onUnload = () => {
      const { tabs: t, activeTabId: a } = useWorkspaceStore.getState();
      void window.mongog.workspace.save({ tabs: t, activeTabId: a });
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
      <div style={{
        flex: 1, minWidth: 0, minHeight: 0, display: 'flex',
        flexDirection: 'column', overflow: 'hidden',
      }}>
        <TabBar />
        {renderTabContent(activeTabId, tabs)}
      </div>
    </div>
  );
}

function renderTabContent(activeTabId: string | null, tabs: WorkspaceTab[]) {
  const activeTab = tabs.find((t) => t.id === activeTabId);

  if (!activeTab) {
    return <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#666' }}>
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
    case 'connection-settings':
      return <ConnectionsView tab={activeTab} />;
    default:
      return <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#666' }}>
        {activeTab.kind} tab
      </div>;
  }
}
