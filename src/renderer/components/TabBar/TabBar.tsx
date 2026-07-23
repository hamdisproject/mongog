import { useWorkspaceStore } from '../../stores/workspace.js';
import type { WorkspaceTab } from '../../../shared/domain/index.js';

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
    padding: '4px 10px', cursor: 'pointer', color: '#888', fontSize: 16,
    display: 'flex', alignItems: 'center', flexShrink: 0,
  },
};

const kindIcon: Record<string, string> = {
  query: '>_',
  collection: '{ }',
  history: 'H',
  'connection-settings': 'C',
};

export function TabBar() {
  const { tabs, activeTabId, setActiveTab, closeTab, createTab } = useWorkspaceStore();

  const handleNewTab = () => {
    createTab('query', null);
  };

  return (
    <div style={s.bar}>
      {tabs.map((tab) => (
        <Tab key={tab.id} tab={tab} active={tab.id === activeTabId} />
      ))}
      <div onClick={handleNewTab} style={s.newBtn} title="New query tab">+</div>
    </div>
  );
}

interface TabProps {
  tab: WorkspaceTab;
  active: boolean;
}

function Tab({ tab, active }: TabProps) {
  const { setActiveTab, closeTab } = useWorkspaceStore();

  return (
    <div
      style={{ ...s.tab, ...(active ? s.tabActive : {}) }}
      onClick={() => setActiveTab(tab.id)}
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
