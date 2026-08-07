import { useState } from 'react';
import { useConnectionStore } from '../../stores/connections.js';
import { useWorkspaceStore } from '../../stores/workspace.js';

const s: Record<string, React.CSSProperties> = {
  sidebar: {
    width: '100%', height: '100%', background: '#252526', color: '#ccc',
    display: 'flex', flexDirection: 'column', borderRight: '1px solid #333',
    fontFamily: 'system-ui', fontSize: 13, userSelect: 'none', overflow: 'hidden',
  },
  header: {
    padding: '8px 12px', fontWeight: 600, fontSize: 11, textTransform: 'uppercase',
    letterSpacing: '0.5px', color: '#888', borderBottom: '1px solid #333',
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  },
  tree: { flex: 1, overflow: 'auto', padding: '4px 0' },
  treeItem: {
    display: 'flex', alignItems: 'center', gap: 4, padding: '3px 8px 3px 4px',
    cursor: 'pointer', borderRadius: 3, margin: '0 4px',
  },
  treeItemSelected: { background: '#094771' },
  groupChildren: { marginLeft: 16 },
  dbChildren: { marginLeft: 20 },
  colChildren: { marginLeft: 36 },
  dot: { width: 8, height: 8, borderRadius: '50%', flexShrink: 0 },
  dotConnected: { background: '#4ec9b0' },
  dotDisconnected: { background: '#666' },
  name: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  actions: {
    fontSize: 16, lineHeight: '16px', cursor: 'pointer', opacity: 0.5, padding: '0 2px',
  },
  connectionButton: {
    minWidth: 62, border: '1px solid #555', borderRadius: 3, background: '#333',
    padding: '2px 6px', color: '#ccc', fontSize: 10, lineHeight: '14px',
    cursor: 'pointer', flexShrink: 0,
  },
  settingsButton: {
    width: 22, height: 22, border: 0, borderRadius: 3, background: 'transparent',
    color: '#aaa', padding: 0, fontSize: 13, lineHeight: '22px', cursor: 'pointer',
    flexShrink: 0,
  },
};

function ExplorerTree() {
  const {
    groups, profiles, connected, selectedProfileId, selectedGroupId,
    expandedGroupIds, expandedProfileIds, expandedDatabaseIds,
    databases, collections, loading,
    selectGroup, selectProfile, toggleGroup, toggleProfile, toggleDatabase,
    deleteGroup, connect, disconnect,
    createGroup,
  } = useConnectionStore();
  const { openWelcome, openConnections } = useWorkspaceStore();

  const [showNewGroup, setShowNewGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [profileError, setProfileError] = useState<string | null>(null);

  const ungrouped = profiles.filter((p) => !p.groupId);

  const handleNewGroup = async () => {
    if (!newGroupName.trim()) return;
    await createGroup(newGroupName.trim());
    setNewGroupName('');
    setShowNewGroup(false);
  };

  const handleDoubleClick = async (pid: string) => {
    setProfileError(null);
    try {
      if (connected[pid]) await disconnect(pid);
      else await connect(pid);
    } catch (err) {
      setProfileError((err as { message?: string }).message ?? String(err));
    }
  };

  return (
    <div style={s.sidebar}>
      <div style={s.header}>
        <span>Connections</span>
        <div style={{ display: 'flex', gap: 4 }}>
          <span style={{ ...s.actions, fontSize: 13 }} title="Welcome" onClick={() => openWelcome()}>&#x2302;</span>
          <span style={s.actions} title="New connection" onClick={() => openConnections({ mode: 'create' })}>+</span>
          <span style={s.actions} title="New group" onClick={() => setShowNewGroup((v) => !v)}>&#x1F4C1;</span>
        </div>
      </div>

      {showNewGroup && (
        <div style={{ padding: '4px 8px', display: 'flex', gap: 4 }}>
          <input autoFocus placeholder="Group name" value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleNewGroup()}
            style={{ flex: 1, background: '#3c3c3c', color: '#ddd', border: '1px solid #555', padding: '2px 6px', borderRadius: 2, fontSize: 12 }}
          />
          <button
            style={{ background: '#0e639c', color: '#fff', border: 'none', padding: '2px 8px', borderRadius: 2, fontSize: 11, cursor: 'pointer' }}
            onClick={handleNewGroup}
          >Add</button>
        </div>
      )}

      <div style={s.tree}>
        {profileError && (
          <div style={{ padding: '4px 8px', fontSize: 11, color: '#f44747', borderBottom: '1px solid #333' }}>
            {profileError}
          </div>
        )}
        {loading && <div style={{ padding: '8px 12px', color: '#888', fontSize: 12 }}>Loading...</div>}

        {!loading && groups.length === 0 && profiles.length === 0 && (
          <div style={{ padding: '8px 12px', color: '#666', fontSize: 12 }}>No connections. Click + to add.</div>
        )}

        {groups.map((g) => {
          const isExpanded = expandedGroupIds.has(g.id);
          const groupProfiles = profiles.filter((p) => p.groupId === g.id);
          return (
            <div key={g.id}>
              <div
                style={{ ...s.treeItem, ...(selectedGroupId === g.id ? s.treeItemSelected : {}) }}
                onClick={() => selectGroup(g.id)}
                onDoubleClick={() => toggleGroup(g.id)}
              >
                <span style={{ fontSize: 10, width: 14, textAlign: 'center' }}>{isExpanded ? '▼' : '▶'}</span>
                <span style={{ fontSize: 11, opacity: 0.6 }}>&#x1F4C1;</span>
                <span style={s.name}>{g.name}</span>
                <span style={{ ...s.actions, fontSize: 12 }}
                  onClick={(e) => { e.stopPropagation(); deleteGroup(g.id); }} title="Delete group">&#x2715;</span>
              </div>
              {isExpanded && (
                <div style={s.groupChildren}>
                  {groupProfiles.map((p) => (
                    <ProfileNode key={p.id} profile={p}
                      isConnected={!!connected[p.id]}
                      isSelected={selectedProfileId === p.id}
                      isExpanded={expandedProfileIds.has(p.id)}
                      onSelect={() => selectProfile(p.id)}
                      onConnectionToggle={() => handleDoubleClick(p.id)}
                      onToggle={() => toggleProfile(p.id)}
                      onEdit={() => openConnections({ mode: 'edit', profileId: p.id })}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {ungrouped.map((p) => (
          <ProfileNode key={p.id} profile={p}
            isConnected={!!connected[p.id]}
            isSelected={selectedProfileId === p.id}
            isExpanded={expandedProfileIds.has(p.id)}
            onSelect={() => selectProfile(p.id)}
            onConnectionToggle={() => handleDoubleClick(p.id)}
            onToggle={() => toggleProfile(p.id)}
            onEdit={() => openConnections({ mode: 'edit', profileId: p.id })}
          />
        ))}
      </div>
    </div>
  );
}

interface ProfileNodeProps {
  profile: { id: string; name: string; color: string | null };
  isConnected: boolean;
  isSelected: boolean;
  isExpanded: boolean;
  onSelect: () => void;
  onConnectionToggle: () => Promise<void>;
  onToggle: () => void;
  onEdit: () => void;
}

function ProfileNode({ profile, isConnected, isSelected, isExpanded, onSelect, onConnectionToggle, onToggle, onEdit }: ProfileNodeProps) {
  const { databases, expandedDatabaseIds, toggleDatabase, collections, loadCollections } = useConnectionStore();
  const { createTab, updateTab } = useWorkspaceStore();
  const [connectionBusy, setConnectionBusy] = useState(false);
  const connDbs = databases[profile.id] ?? [];
  const handleConnectionAction = async () => {
    if (connectionBusy) return;
    setConnectionBusy(true);
    try {
      await onConnectionToggle();
    } finally {
      setConnectionBusy(false);
    }
  };
  const handleCollectionClick = (dbName: string, colName: string, colType?: string) => {
    const tabId = createTab('collection', profile.id);
    updateTab(tabId, {
      title: `${dbName}.${colName}`,
      database: dbName,
      collection: colName,
      collectionViewMode: 'documents',
    });
  };

  return (
    <div>
      <div
        style={{ ...s.treeItem, ...(isSelected ? s.treeItemSelected : {}) }}
        onClick={onSelect}
        onDoubleClick={() => void handleConnectionAction()}
        title={isConnected ? 'Double-click to disconnect' : 'Double-click to connect'}
      >
        <span
          style={{ fontSize: 10, width: 14, textAlign: 'center' }}
          title={isConnected ? (isExpanded ? 'Collapse databases' : 'Expand databases') : undefined}
          onClick={(e) => { e.stopPropagation(); onToggle(); }}
        >
          {isConnected ? (isExpanded ? '▼' : '▶') : ''}
        </span>
        <div style={{ ...s.dot, ...(isConnected ? s.dotConnected : s.dotDisconnected), ...(profile.color ? { background: profile.color } : {}) }} />
        <span style={s.name}>{profile.name}</span>
        <button
          style={{
            ...s.connectionButton,
            color: isConnected ? '#e5c07b' : '#4ec9b0',
            ...(connectionBusy ? { opacity: 0.55, cursor: 'default' } : {}),
          }}
          disabled={connectionBusy}
          onClick={(event) => { event.stopPropagation(); void handleConnectionAction(); }}
          onDoubleClick={(event) => event.stopPropagation()}
        >
          {isConnected ? 'Disconnect' : 'Connect'}
        </button>
        <button
          style={s.settingsButton}
          aria-label={`Connection settings for ${profile.name}`}
          title="Edit connection"
          onClick={(event) => { event.stopPropagation(); onEdit(); }}
          onDoubleClick={(event) => event.stopPropagation()}
        >
          &#x2699;
        </button>
      </div>

      {isExpanded && isConnected && (
        <div style={s.dbChildren}>
          {connDbs.map((db) => {
            const dbKey = `${profile.id}:${db.name}`;
            const dbExpanded = expandedDatabaseIds.has(dbKey);
            const dbCols = collections[dbKey] ?? [];
            return (
              <div key={db.name}>
                <div
                  style={{ ...s.treeItem, paddingLeft: 4, fontSize: 12 }}
                  title={`${dbExpanded ? 'Collapse' : 'Expand'} database ${db.name}`}
                  onClick={() => toggleDatabase(profile.id, db.name)}
                >
                  <span style={{ fontSize: 10, width: 12, textAlign: 'center' }}>{dbExpanded ? '▼' : '▶'}</span>
                  <span style={{ fontSize: 11 }}>&#x1F4E6;</span>
                  <span style={s.name}>{db.name}</span>
                </div>
                {dbExpanded && (
                  <div style={s.colChildren}>
                    {dbCols.map((col) => (
                      <div
                        key={col.name}
                        style={{ ...s.treeItem, paddingLeft: 2, fontSize: 12, color: '#aaa' }}
                        onClick={() => handleCollectionClick(db.name, col.name, col.type)}
                        title={`Open ${db.name}.${col.name}`}
                      >
                        <span style={{ fontSize: 11 }}>{col.type === 'view' ? 'V' : '{ }'}</span>
                        <span style={s.name}>{col.name}</span>
                      </div>
                    ))}
                    {dbCols.length === 0 && (
                      <div style={{ padding: '2px 8px', fontSize: 11, color: '#666' }}>(empty)</div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function Explorer() {
  return (
    <nav
      aria-label="Connection explorer"
      style={{ width: 260, height: '100%', minHeight: 0, flexShrink: 0, overflow: 'hidden' }}
    >
      <ExplorerTree />
    </nav>
  );
}
