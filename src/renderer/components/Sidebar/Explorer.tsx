import { useEffect, useState } from 'react';
import { useConnectionStore } from '../../stores/connections.js';
import { useWorkspaceStore } from '../../stores/workspace.js';
import { collectionQueryTemplate } from '../../collection-workspace.js';
import type { ConnectionGroup } from '../../../shared/domain/connections.js';
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
  treeItemDropTarget: { background: '#264f78', outline: '1px solid #3794ff', outlineOffset: -1 },
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
  collapseButton: {
    width: 18, height: 18, flexShrink: 0, border: 0, borderRadius: 2,
    background: 'transparent', color: '#aaa', padding: 0, fontSize: 10,
    lineHeight: '18px', cursor: 'pointer', textAlign: 'center',
  },
};

type GroupAction = {
  kind: 'rename' | 'delete';
  group: ConnectionGroup;
};

function ExplorerTree() {
  const {
    groups, profiles, connected, selectedProfileId, selectedGroupId,
    expandedGroupIds, expandedProfileIds, expandedDatabaseIds,
    databases, collections, loading,
    selectGroup, selectProfile, toggleGroup, toggleProfile, toggleDatabase,
    updateGroup, deleteGroup, connect, disconnect, loadDatabases, loadCollections,
    createGroup, moveProfileToGroup,
  } = useConnectionStore();
  const { openWelcome, openConnections } = useWorkspaceStore();

  const [showNewGroup, setShowNewGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [profileError, setProfileError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [draggingProfileId, setDraggingProfileId] = useState<string | null>(null);
  const [dragOverGroupId, setDragOverGroupId] = useState<string | null>(null);
  const [groupContextMenu, setGroupContextMenu] = useState<{
    x: number;
    y: number;
    group: ConnectionGroup;
  } | null>(null);
  const [groupAction, setGroupAction] = useState<GroupAction | null>(null);
  const [groupActionBusy, setGroupActionBusy] = useState(false);
  const [groupActionError, setGroupActionError] = useState<string | null>(null);
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

  const moveProfile = async (profileId: string, groupId: string | null) => {
    setProfileError(null);
    try {
      await moveProfileToGroup(profileId, groupId);
      if (groupId && !expandedGroupIds.has(groupId)) toggleGroup(groupId);
    } catch (error) {
      setProfileError(errorMessage(error));
    } finally {
      setDraggingProfileId(null);
      setDragOverGroupId(null);
    }
  };

  const showGroupMenu = (event: React.MouseEvent, group: ConnectionGroup) => {
    event.preventDefault();
    event.stopPropagation();
    selectGroup(group.id);
    setGroupContextMenu({ x: event.clientX, y: event.clientY, group });
  };

  const performGroupAction = async (value: string) => {
    if (!groupAction || groupActionBusy) return;
    setGroupActionBusy(true);
    setGroupActionError(null);
    try {
      if (groupAction.kind === 'rename') {
        await updateGroup({ ...groupAction.group, name: value.trim() });
      } else {
        await deleteGroup(groupAction.group.id);
      }
      setGroupAction(null);
    } catch (error) {
      setGroupActionError(errorMessage(error));
    } finally {
      setGroupActionBusy(false);
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

      <div style={s.tree} role="tree" aria-label="MongoDB connections">
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
          const groupKey = `group:${g.id}`;
          return (
            <div key={g.id}>
              <div
                className="explorer-tree-item"
                role="treeitem"
                aria-label={`Group ${g.name}`}
                aria-level={1}
                aria-expanded={isExpanded}
                tabIndex={0}
                data-tree-node-key={groupKey}
                style={{
                  ...s.treeItem,
                  ...(selectedGroupId === g.id ? s.treeItemSelected : {}),
                  ...(dragOverGroupId === g.id ? s.treeItemDropTarget : {}),
                }}
                onClick={() => selectGroup(g.id)}
                onDoubleClick={() => toggleGroup(g.id)}
                onContextMenu={(event) => showGroupMenu(event, g)}
                onKeyDown={(event) => handleTreeKeyDown(event, {
                  key: groupKey,
                  expanded: isExpanded,
                  expandable: true,
                  onExpand: () => { if (!isExpanded) toggleGroup(g.id); },
                  onCollapse: () => { if (isExpanded) toggleGroup(g.id); },
                  onActivate: () => toggleGroup(g.id),
                })}
                onDragOver={(event) => {
                  if (!draggingProfileId) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'move';
                  setDragOverGroupId(g.id);
                }}
                onDragLeave={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                    setDragOverGroupId((current) => current === g.id ? null : current);
                  }
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  const profileId = event.dataTransfer.getData('application/x-mongog-profile') || draggingProfileId;
                  if (profileId) void moveProfile(profileId, g.id);
                }}
              >
                <button
                  type="button"
                  style={s.collapseButton}
                  aria-label={`${isExpanded ? 'Collapse' : 'Expand'} group ${g.name}`}
                  title={`${isExpanded ? 'Collapse' : 'Expand'} group ${g.name}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (!normalizedSearch) toggleGroup(g.id);
                  }}
                  onDoubleClick={(event) => event.stopPropagation()}
                >
                  {isExpanded ? '▼' : '▶'}
                </button>
                <span style={{ fontSize: 11, opacity: 0.6 }}>&#x1F4C1;</span>
                <span style={s.name}>{g.name}</span>
              </div>
              {isExpanded && (
                <div style={s.groupChildren} role="group">
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
                      parentKey={groupKey}
                      onDragStart={(profileId) => setDraggingProfileId(profileId)}
                      onDragEnd={() => { setDraggingProfileId(null); setDragOverGroupId(null); }}
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
            onDragStart={(profileId) => setDraggingProfileId(profileId)}
            onDragEnd={() => { setDraggingProfileId(null); setDragOverGroupId(null); }}
          />
        ))}
        {draggingProfileId && (
          <div
            role="treeitem"
            aria-label="Move connection out of group"
            aria-level={1}
            tabIndex={-1}
            style={{
              ...s.treeItem, marginTop: 7, border: '1px dashed #555', color: '#999',
              justifyContent: 'center', fontSize: 11,
              ...(dragOverGroupId === '__ungrouped__' ? s.treeItemDropTarget : {}),
            }}
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
              setDragOverGroupId('__ungrouped__');
            }}
            onDrop={(event) => {
              event.preventDefault();
              const profileId = event.dataTransfer.getData('application/x-mongog-profile') || draggingProfileId;
              if (profileId) void moveProfile(profileId, null);
            }}
          >
            Drop here to remove from group
          </div>
        )}
      </div>
      {groupContextMenu && (
        <ContextMenu
          x={groupContextMenu.x}
          y={groupContextMenu.y}
          items={[
            {
              label: 'Rename Group…',
              onSelect: () => {
                setGroupActionError(null);
                setGroupAction({ kind: 'rename', group: groupContextMenu.group });
              },
            },
            {
              label: 'Delete Group…',
              separatorBefore: true,
              danger: true,
              onSelect: () => {
                setGroupActionError(null);
                setGroupAction({ kind: 'delete', group: groupContextMenu.group });
              },
            },
          ]}
          onClose={() => setGroupContextMenu(null)}
        />
      )}
      {groupAction && (
        <ActionDialog
          title={groupAction.kind === 'rename' ? 'Rename group' : 'Delete group'}
          description={groupAction.kind === 'rename'
            ? `Rename group ${groupAction.group.name}. Connections inside the group will be preserved.`
            : `Delete group ${groupAction.group.name}. Connections inside it will be moved out of the group and will not be deleted.`}
          inputLabel={groupAction.kind === 'rename'
            ? 'Group name'
            : `Type "${groupAction.group.name}" to confirm`}
          initialValue={groupAction.kind === 'rename' ? groupAction.group.name : ''}
          requiredValue={groupAction.kind === 'delete' ? groupAction.group.name : undefined}
          confirmLabel={groupAction.kind === 'rename' ? 'Rename' : 'Delete group'}
          danger={groupAction.kind === 'delete'}
          busy={groupActionBusy}
          error={groupActionError}
          onCancel={() => { if (!groupActionBusy) setGroupAction(null); }}
          onConfirm={(value) => void performGroupAction(value)}
        />
      )}
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
  parentKey?: string;
  onDragStart: (profileId: string) => void;
  onDragEnd: () => void;
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
  parentKey,
  onDragStart,
  onDragEnd,
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
  const profileKey = `profile:${profile.id}`;
  const profileExpanded = !!search || isExpanded;
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
        className="explorer-tree-item"
        role="treeitem"
        aria-label={`Connection ${profile.name}`}
        aria-level={parentKey ? 2 : 1}
        aria-expanded={isConnected ? profileExpanded : undefined}
        tabIndex={0}
        draggable
        data-tree-node-key={profileKey}
        data-tree-parent-key={parentKey}
        style={{ ...s.treeItem, ...(isSelected ? s.treeItemSelected : {}) }}
        onClick={onSelect}
        onDoubleClick={() => void handleConnectionAction()}
        onKeyDown={(event) => handleTreeKeyDown(event, {
          key: profileKey,
          parentKey,
          expanded: profileExpanded,
          expandable: isConnected,
          onExpand: () => { if (!profileExpanded) onToggle(); },
          onCollapse: () => { if (profileExpanded && !search) onToggle(); },
          onActivate: onSelect,
        })}
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('application/x-mongog-profile', profile.id);
          event.dataTransfer.setData('text/plain', profile.name);
          onDragStart(profile.id);
        }}
        onDragEnd={onDragEnd}
        title={isConnected ? 'Double-click to disconnect' : 'Double-click to connect'}
      >
        <span
          style={{ fontSize: 10, width: 14, textAlign: 'center' }}
          title={isConnected ? (isExpanded ? 'Collapse databases' : 'Expand databases') : undefined}
          onClick={(e) => { e.stopPropagation(); onToggle(); }}
        >
          {isConnected ? (profileExpanded ? '▼' : '▶') : ''}
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

      {profileExpanded && isConnected && (
        <div style={s.dbChildren} role="group">
          {visibleDatabases.map((db) => {
            const dbKey = `${profile.id}:${db.name}`;
            const dbExpanded = search ? true : expandedDatabaseIds.has(dbKey);
            const dbCols = collections[dbKey] ?? [];
            const databaseMatches = !!search && db.name.toLocaleLowerCase().includes(search);
            const visibleCollections = !search || profileNameMatches || databaseMatches
              ? dbCols
              : dbCols.filter((collection) => collection.name.toLocaleLowerCase().includes(search));
            const databaseKey = `database:${profile.id}:${encodeURIComponent(db.name)}`;
            return (
              <div key={db.name}>
                <div
                  className="explorer-tree-item"
                  role="treeitem"
                  aria-label={`Database ${db.name}`}
                  aria-level={parentKey ? 3 : 2}
                  aria-expanded={dbExpanded}
                  tabIndex={0}
                  data-tree-node-key={databaseKey}
                  data-tree-parent-key={profileKey}
                  style={{ ...s.treeItem, paddingLeft: 4, fontSize: 12 }}
                  title={`${dbExpanded ? 'Collapse' : 'Expand'} database ${db.name}`}
                  onClick={() => toggleDatabase(profile.id, db.name)}
                  onContextMenu={(event) => showDatabaseMenu(event, db.name)}
                  onKeyDown={(event) => handleTreeKeyDown(event, {
                    key: databaseKey,
                    parentKey: profileKey,
                    expanded: dbExpanded,
                    expandable: true,
                    onExpand: () => { if (!dbExpanded) toggleDatabase(profile.id, db.name); },
                    onCollapse: () => { if (dbExpanded && !search) toggleDatabase(profile.id, db.name); },
                    onActivate: () => toggleDatabase(profile.id, db.name),
                  })}
                >
                  <span style={{ fontSize: 10, width: 12, textAlign: 'center' }}>{dbExpanded ? '▼' : '▶'}</span>
                  <span style={{ fontSize: 11 }}>&#x1F4E6;</span>
                  <span style={s.name}>{db.name}</span>
                </div>
                {dbExpanded && (
                  <div style={s.colChildren} role="group">
                    {visibleCollections.map((col) => (
                      <div
                        key={col.name}
                        className="explorer-tree-item"
                        role="treeitem"
                        aria-label={`Collection ${db.name}.${col.name}`}
                        aria-level={parentKey ? 4 : 3}
                        tabIndex={0}
                        data-tree-node-key={`collection:${profile.id}:${encodeURIComponent(db.name)}:${encodeURIComponent(col.name)}`}
                        data-tree-parent-key={databaseKey}
                        style={{ ...s.treeItem, paddingLeft: 2, fontSize: 12, color: '#aaa' }}
                        onClick={() => handleCollectionClick(db.name, col.name)}
                        onContextMenu={(event) => showCollectionMenu(event, db.name, col.name)}
                        onKeyDown={(event) => handleTreeKeyDown(event, {
                          key: `collection:${profile.id}:${encodeURIComponent(db.name)}:${encodeURIComponent(col.name)}`,
                          parentKey: databaseKey,
                          expanded: false,
                          expandable: false,
                          onActivate: () => handleCollectionClick(db.name, col.name),
                        })}
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

interface TreeKeyOptions {
  key: string;
  parentKey?: string;
  expanded: boolean;
  expandable: boolean;
  onExpand?: () => void;
  onCollapse?: () => void;
  onActivate: () => void;
}

function handleTreeKeyDown(
  event: React.KeyboardEvent<HTMLElement>,
  options: TreeKeyOptions,
): void {
  if (event.target !== event.currentTarget) return;
  const tree = event.currentTarget.closest<HTMLElement>('[role="tree"]');
  if (!tree) return;
  const isVisible = (item: HTMLElement) => item.getClientRects().length > 0;
  const visibleItems = Array.from(tree.querySelectorAll<HTMLElement>('[role="treeitem"]'))
    .filter((item) => isVisible(item) && item.dataset.treeNodeKey);
  const currentIndex = visibleItems.indexOf(event.currentTarget);
  const focusItem = (item: HTMLElement | undefined) => {
    if (!item) return;
    item.focus();
    item.scrollIntoView({ block: 'nearest' });
  };
  const focusChild = () => {
    const child = Array.from(tree.querySelectorAll<HTMLElement>('[role="treeitem"]'))
      .find((item) => isVisible(item) && item.dataset.treeParentKey === options.key);
    focusItem(child);
  };

  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault();
      focusItem(visibleItems[currentIndex + 1]);
      break;
    case 'ArrowUp':
      event.preventDefault();
      focusItem(visibleItems[currentIndex - 1]);
      break;
    case 'Home':
      event.preventDefault();
      focusItem(visibleItems[0]);
      break;
    case 'End':
      event.preventDefault();
      focusItem(visibleItems.at(-1));
      break;
    case 'ArrowRight':
      event.preventDefault();
      if (options.expandable && !options.expanded) {
        options.onExpand?.();
      } else if (options.expandable) {
        focusChild();
      }
      break;
    case 'ArrowLeft':
      event.preventDefault();
      if (options.expandable && options.expanded) {
        options.onCollapse?.();
      } else if (options.parentKey) {
        focusItem(visibleItems.find((item) => item.dataset.treeNodeKey === options.parentKey));
      }
      break;
    case 'Enter':
    case ' ':
      event.preventDefault();
      options.onActivate();
      break;
  }
}

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) return String(error.message);
  return String(error);
}
