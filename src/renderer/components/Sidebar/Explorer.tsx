import { useEffect, useState } from 'react';
import { useConnectionStore } from '../../stores/connections.js';
import { useWorkspaceStore } from '../../stores/workspace.js';
import { collectionQueryTemplate } from '../../collection-workspace.js';
import { ActionDialog } from '../Common/ActionDialog.js';
import { ContextMenu, type ContextMenuItem } from '../Common/ContextMenu.js';

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
  searchWrap: { padding: '7px 8px', borderBottom: '1px solid #333' },
  search: {
    boxSizing: 'border-box', width: '100%', background: '#181818', color: '#ddd',
    border: '1px solid #444', borderRadius: 3, padding: '5px 8px', fontSize: 11, outline: 0,
  },
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
    deleteGroup, connect, disconnect, loadDatabases, loadCollections,
    createGroup,
  } = useConnectionStore();
  const { openWelcome, openConnections } = useWorkspaceStore();

  const [showNewGroup, setShowNewGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [profileError, setProfileError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const normalizedSearch = search.trim().toLocaleLowerCase();

  const matchesProfile = (profileId: string, profileName: string) => {
    if (!normalizedSearch) return true;
    if (profileName.toLocaleLowerCase().includes(normalizedSearch)) return true;
    return (databases[profileId] ?? []).some((database) => {
      if (database.name.toLocaleLowerCase().includes(normalizedSearch)) return true;
      return (collections[`${profileId}:${database.name}`] ?? [])
        .some((collection) => collection.name.toLocaleLowerCase().includes(normalizedSearch));
    });
  };
  const ungrouped = profiles.filter((profile) => !profile.groupId && matchesProfile(profile.id, profile.name));

  useEffect(() => {
    if (!normalizedSearch) return;
    for (const profileId of Object.keys(connected)) void loadDatabases(profileId);
  }, [normalizedSearch, connected, loadDatabases]);

  useEffect(() => {
    if (!normalizedSearch) return;
    for (const profileId of Object.keys(connected)) {
      for (const database of databases[profileId] ?? []) {
        void loadCollections(profileId, database.name);
      }
    }
  }, [normalizedSearch, connected, databases, loadCollections]);

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

      <div style={s.searchWrap}>
        <input
          aria-label="Search connections"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search connections, databases, collections"
          style={s.search}
        />
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
          const groupMatches = normalizedSearch && g.name.toLocaleLowerCase().includes(normalizedSearch);
          const groupProfiles = profiles.filter((profile) => (
            profile.groupId === g.id && (groupMatches || matchesProfile(profile.id, profile.name))
          ));
          if (normalizedSearch && !groupMatches && groupProfiles.length === 0) return null;
          const isExpanded = normalizedSearch ? true : expandedGroupIds.has(g.id);
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
                      search={normalizedSearch}
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
            search={normalizedSearch}
          />
        ))}
      </div>
    </div>
  );
}

interface ProfileNodeProps {
  profile: { id: string; name: string; color: string | null; readOnly: boolean };
  isConnected: boolean;
  isSelected: boolean;
  isExpanded: boolean;
  onSelect: () => void;
  onConnectionToggle: () => Promise<void>;
  onToggle: () => void;
  onEdit: () => void;
  search: string;
}

type NamespaceAction =
  | { kind: 'rename-collection'; database: string; collection: string }
  | { kind: 'drop-collection'; database: string; collection: string }
  | { kind: 'drop-database'; database: string };

function ProfileNode({
  profile,
  isConnected,
  isSelected,
  isExpanded,
  onSelect,
  onConnectionToggle,
  onToggle,
  onEdit,
  search,
}: ProfileNodeProps) {
  const {
    databases,
    expandedDatabaseIds,
    toggleDatabase,
    collections,
    refreshCollections,
    renameCollection,
    dropCollection,
    dropDatabase,
  } = useConnectionStore();
  const { openCollection, openQuery, openAdmin, openChangeStream } = useWorkspaceStore();
  const [connectionBusy, setConnectionBusy] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  const [namespaceAction, setNamespaceAction] = useState<NamespaceAction | null>(null);
  const [namespaceBusy, setNamespaceBusy] = useState(false);
  const [namespaceError, setNamespaceError] = useState<string | null>(null);
  const connDbs = databases[profile.id] ?? [];
  const profileNameMatches = !!search && profile.name.toLocaleLowerCase().includes(search);
  const visibleDatabases = !search || profileNameMatches
    ? connDbs
    : connDbs.filter((database) => (
      database.name.toLocaleLowerCase().includes(search) ||
      (collections[`${profile.id}:${database.name}`] ?? [])
        .some((collection) => collection.name.toLocaleLowerCase().includes(search))
    ));
  const handleConnectionAction = async () => {
    if (connectionBusy) return;
    setConnectionBusy(true);
    try {
      await onConnectionToggle();
    } finally {
      setConnectionBusy(false);
    }
  };
  const handleCollectionClick = (database: string, collection: string) => {
    openCollection({ connectionId: profile.id, database, collection });
  };

  const showDatabaseMenu = (event: React.MouseEvent, database: string) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      items: [
        {
          label: 'New Query',
          onSelect: () => openQuery({ connectionId: profile.id, database, title: `${database} query` }),
        },
        {
          label: 'Search Database',
          onSelect: () => openAdmin({ connectionId: profile.id, database, section: 'search' }),
        },
        {
          label: 'Open GridFS',
          onSelect: () => openAdmin({ connectionId: profile.id, database, section: 'gridfs' }),
        },
        {
          label: 'Watch Changes',
          onSelect: () => openChangeStream({ connectionId: profile.id, database }),
        },
        {
          label: 'Refresh Collections',
          separatorBefore: true,
          onSelect: () => void refreshCollections(profile.id, database),
        },
        {
          label: 'Rename Database (not atomic in MongoDB)',
          disabled: true,
          onSelect: () => undefined,
        },
        {
          label: 'Drop Database…',
          danger: true,
          disabled: profile.readOnly,
          onSelect: () => { setNamespaceError(null); setNamespaceAction({ kind: 'drop-database', database }); },
        },
      ],
    });
  };

  const showCollectionMenu = (
    event: React.MouseEvent,
    database: string,
    collection: string,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      items: [
        {
          label: 'Open Documents',
          onSelect: () => openCollection({ connectionId: profile.id, database, collection }),
        },
        {
          label: 'New Query for Collection',
          onSelect: () => openQuery({
            connectionId: profile.id,
            database,
            title: `${database}.${collection} query`,
            editorContent: collectionQueryTemplate(collection),
          }),
        },
        {
          label: 'Indexes',
          separatorBefore: true,
          onSelect: () => openAdmin({ connectionId: profile.id, database, collection, section: 'indexes' }),
        },
        {
          label: 'Explain Query',
          onSelect: () => openAdmin({ connectionId: profile.id, database, collection, section: 'explain' }),
        },
        {
          label: 'Watch Changes',
          onSelect: () => openChangeStream({ connectionId: profile.id, database, collection }),
        },
        {
          label: 'Rename Collection…',
          separatorBefore: true,
          disabled: profile.readOnly,
          onSelect: () => { setNamespaceError(null); setNamespaceAction({ kind: 'rename-collection', database, collection }); },
        },
        {
          label: 'Drop Collection…',
          danger: true,
          disabled: profile.readOnly,
          onSelect: () => { setNamespaceError(null); setNamespaceAction({ kind: 'drop-collection', database, collection }); },
        },
      ],
    });
  };

  const performNamespaceAction = async (value: string) => {
    if (!namespaceAction) return;
    setNamespaceBusy(true);
    setNamespaceError(null);
    try {
      if (namespaceAction.kind === 'rename-collection') {
        await renameCollection(profile.id, namespaceAction.database, namespaceAction.collection, value.trim());
      } else if (namespaceAction.kind === 'drop-collection') {
        await dropCollection(profile.id, namespaceAction.database, namespaceAction.collection);
      } else {
        await dropDatabase(profile.id, namespaceAction.database);
      }
      setNamespaceAction(null);
    } catch (error) {
      setNamespaceError(errorMessage(error));
    } finally {
      setNamespaceBusy(false);
    }
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

      {(search || isExpanded) && isConnected && (
        <div style={s.dbChildren}>
          {visibleDatabases.map((db) => {
            const dbKey = `${profile.id}:${db.name}`;
            const dbExpanded = search ? true : expandedDatabaseIds.has(dbKey);
            const dbCols = collections[dbKey] ?? [];
            const databaseMatches = !!search && db.name.toLocaleLowerCase().includes(search);
            const visibleCollections = !search || profileNameMatches || databaseMatches
              ? dbCols
              : dbCols.filter((collection) => collection.name.toLocaleLowerCase().includes(search));
            return (
              <div key={db.name}>
                <div
                  style={{ ...s.treeItem, paddingLeft: 4, fontSize: 12 }}
                  title={`${dbExpanded ? 'Collapse' : 'Expand'} database ${db.name}`}
                  onClick={() => toggleDatabase(profile.id, db.name)}
                  onContextMenu={(event) => showDatabaseMenu(event, db.name)}
                >
                  <span style={{ fontSize: 10, width: 12, textAlign: 'center' }}>{dbExpanded ? '▼' : '▶'}</span>
                  <span style={{ fontSize: 11 }}>&#x1F4E6;</span>
                  <span style={s.name}>{db.name}</span>
                </div>
                {dbExpanded && (
                  <div style={s.colChildren}>
                    {visibleCollections.map((col) => (
                      <div
                        key={col.name}
                        style={{ ...s.treeItem, paddingLeft: 2, fontSize: 12, color: '#aaa' }}
                        onClick={() => handleCollectionClick(db.name, col.name)}
                        onContextMenu={(event) => showCollectionMenu(event, db.name, col.name)}
                        title={`Open ${db.name}.${col.name}`}
                      >
                        <span style={{ fontSize: 11 }}>{col.type === 'view' ? 'V' : '{ }'}</span>
                        <span style={s.name}>{col.name}</span>
                      </div>
                    ))}
                    {visibleCollections.length === 0 && (
                      <div style={{ padding: '2px 8px', fontSize: 11, color: '#666' }}>(empty)</div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.items}
          onClose={() => setContextMenu(null)}
        />
      )}
      {namespaceAction && (
        <ActionDialog
          title={namespaceAction.kind === 'rename-collection'
            ? 'Rename collection'
            : namespaceAction.kind === 'drop-collection'
              ? 'Drop collection'
              : 'Drop database'}
          description={namespaceAction.kind === 'rename-collection'
            ? `Rename ${namespaceAction.database}.${namespaceAction.collection}. Existing open tabs will follow the new namespace.`
            : namespaceAction.kind === 'drop-collection'
              ? `This permanently deletes ${namespaceAction.database}.${namespaceAction.collection} and closes related tabs.`
              : `This permanently deletes database ${namespaceAction.database}, all collections, and related open tabs.`}
          inputLabel={namespaceAction.kind === 'rename-collection'
            ? 'New collection name'
            : `Type "${namespaceAction.kind === 'drop-collection' ? namespaceAction.collection : namespaceAction.database}" to confirm`}
          initialValue={namespaceAction.kind === 'rename-collection' ? namespaceAction.collection : ''}
          requiredValue={namespaceAction.kind === 'rename-collection'
            ? undefined
            : namespaceAction.kind === 'drop-collection'
              ? namespaceAction.collection
              : namespaceAction.database}
          confirmLabel={namespaceAction.kind === 'rename-collection' ? 'Rename' : 'Drop permanently'}
          danger={namespaceAction.kind !== 'rename-collection'}
          busy={namespaceBusy}
          error={namespaceError}
          onCancel={() => { if (!namespaceBusy) setNamespaceAction(null); }}
          onConfirm={(value) => void performNamespaceAction(value)}
        />
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

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) return String(error.message);
  return String(error);
}
