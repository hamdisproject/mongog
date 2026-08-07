import { useEffect, useRef, useCallback } from 'react';
import { Explorer } from './components/Sidebar/Explorer.js';
import { TabBar } from './components/TabBar/TabBar.js';
import { QueryEditor } from './components/Editor/QueryEditor.js';
import { ResultsPanel } from './components/Results/ResultsPanel.js';
import { CollectionView } from './components/Results/CollectionView.js';
import { AdminView } from './components/Admin/AdminView.js';
import type { WorkspaceTab } from '../shared/domain/index.js';
import { useWorkspaceStore } from './stores/workspace.js';
import { useConnectionStore } from './stores/connections.js';
import { useSchemaCache } from './stores/schema-cache.js';

let saveTimer: ReturnType<typeof setTimeout> | null = null;

export default function App() {
  const { createTab, activeTabId, tabs, restore } = useWorkspaceStore();
  const { load } = useConnectionStore();
  const engineSubRef = useRef<(() => void) | null>(null);

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
    load();
    void window.mongog.workspace.load().then((saved) => {
      if (saved && saved.tabs.length > 0) {
        restore(saved);
      } else if (useWorkspaceStore.getState().tabs.length === 0) {
        createTab('query', null);
      }
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
      display: 'flex', height: '100vh', background: '#1e1e1e', color: '#ddd', fontFamily: 'system-ui',
    }}>
      <Explorer />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <TabBar />
        {renderTabContent(activeTabId, tabs)}
      </div>
    </div>
  );
}

function renderTabContent(activeTabId: string | null, tabs: WorkspaceTab[]) {
  const activeTab = tabs.find((t) => t.id === activeTabId);

  if (!activeTab) {
    return <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#666' }}>
      Select or create a tab to begin
    </div>;
  }

  switch (activeTab.kind) {
    case 'query':
      return (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ flex: 1, minHeight: 0 }}><QueryEditor /></div>
          <div style={{ height: '40%', minHeight: 120 }}><ResultsPanel /></div>
        </div>
      );
    case 'collection':
      return (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <CollectionView />
        </div>
      );
    case 'admin':
      return <AdminView tab={activeTab} />;
    default:
      return <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#666' }}>
        {activeTab.kind} tab
      </div>;
  }
}
