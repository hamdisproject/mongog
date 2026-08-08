import { useState } from 'react';
import { useWorkspaceStore } from '../../stores/workspace.js';
import type { WorkspaceTab } from '../../../shared/domain/index.js';
import { ContextMenu, type ContextMenuItem } from '../Common/ContextMenu.js';
import { useCommandPaletteStore } from '../../stores/command-palette.js';

const s: Record<string, React.CSSProperties> = {
  bar: {
    display: 'flex', background: '#2d2d2d', borderBottom: '1px solid #333',
    minHeight: 32, overflowX: 'auto', overflowY: 'hidden', flexShrink: 0,
  },
  tab: {
    display: 'flex', alignItems: 'center', gap: 6, padding: '4px 12px',
    fontSize: 12, cursor: 'pointer', borderRight: '1px solid #333',
    whiteSpace: 'nowrap', color: '#999', minWidth: 0, flexShrink: 0,
  },
  tabActive: { background: '#1e1e1e', color: '#ddd' },
  closeBtn: {
    fontSize: 14, lineHeight: '14px', cursor: 'pointer', opacity: 0.4,
    padding: '0 2px', borderRadius: 2,
  },
  dirtyDot: { width: 6, height: 6, borderRadius: '50%', background: '#e5c07b', flexShrink: 0 },
  newBtn: {
    padding: '4px 11px', cursor: 'pointer', color: '#ccc', fontSize: 12,
    display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0,
    border: 0, borderRight: '1px solid #3a3a3a', background: '#252526',
  },
};

const kindIcon: Record<string, string> = {
  welcome: '⌂',
  query: '>_',
  collection: '{ }',
  history: 'H',
  'connection-settings': 'C',
  admin: 'A',
  'change-stream': '⇄',
};

export function TabBar() {
  const { tabs, activeTabId, closeTabs, openQuery } = useWorkspaceStore();
  const openGlobalSearch = useCommandPaletteStore((state) => state.open);
  const [menu, setMenu] = useState<{ tabId: string; x: number; y: number } | null>(null);

  const handleNewTab = () => {
    openQuery();
  };

  const menuItems = (tabId: string): ContextMenuItem[] => {
    const index = tabs.findIndex((tab) => tab.id === tabId);
    const left = tabs.slice(0, index).map((tab) => tab.id);
    const right = tabs.slice(index + 1).map((tab) => tab.id);
    return [
      { label: 'Close', onSelect: () => closeTabs([tabId]) },
      { label: 'Close Others', disabled: tabs.length <= 1, onSelect: () => closeTabs(tabs.filter((tab) => tab.id !== tabId).map((tab) => tab.id)) },
      { label: 'Close Tabs to the Left', disabled: left.length === 0, onSelect: () => closeTabs(left) },
      { label: 'Close Tabs to the Right', disabled: right.length === 0, onSelect: () => closeTabs(right) },
      { label: 'Close All Tabs', danger: true, separatorBefore: true, onSelect: () => closeTabs(tabs.map((tab) => tab.id)) },
    ];
  };

  return (
    <div style={s.bar}>
      <button type="button" onClick={handleNewTab} style={s.newBtn} title="New query tab">
        <span style={{ color: '#4ec9b0', fontSize: 15 }}>+</span> Query
      </button>
      <button
        type="button"
        aria-label="Open global search"
        onClick={openGlobalSearch}
        style={s.newBtn}
        title="Global search (Cmd/Ctrl+K)"
      >
        <span style={{ color: '#4ec9b0', fontSize: 15 }} aria-hidden="true">⌕</span>
        Search
        <span style={{ color: '#777', fontSize: 9, marginLeft: 2 }}>⌘/Ctrl K</span>
      </button>
      {tabs.map((tab) => (
        <Tab
          key={tab.id}
          tab={tab}
          active={tab.id === activeTabId}
          onContextMenu={(event) => {
            event.preventDefault();
            setMenu({ tabId: tab.id, x: event.clientX, y: event.clientY });
          }}
        />
      ))}
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItems(menu.tabId)}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}

interface TabProps {
  tab: WorkspaceTab;
  active: boolean;
  onContextMenu: (event: React.MouseEvent) => void;
}

function Tab({ tab, active, onContextMenu }: TabProps) {
  const { setActiveTab, closeTab } = useWorkspaceStore();

  return (
    <div
      style={{ ...s.tab, ...(active ? s.tabActive : {}) }}
      onClick={() => setActiveTab(tab.id)}
      onContextMenu={onContextMenu}
      title={`${tab.kind}: ${tab.title}${tab.dirty ? ' (modified)' : ''}`}
    >
      <span style={{ fontSize: 10, opacity: 0.6 }}>{kindIcon[tab.kind] ?? '?'}</span>
      <span style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {tab.title}
      </span>
      {tab.dirty && <div style={s.dirtyDot} title="Modified" />}
      <span
        style={s.closeBtn}
        onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }}
      >&#x2715;</span>
    </div>
  );
}
