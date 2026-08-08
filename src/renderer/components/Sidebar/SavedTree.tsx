import { useMemo, useState } from 'react';
import type {
  CreateSavedItemInput,
  SavedFolder,
  SavedItem,
  UpdateSavedItemInput,
} from '../../../shared/domain/index.js';
import { savedFolderPath } from '../../saved-item-utils.js';
import { useConnectionStore } from '../../stores/connections.js';
import { savedRootNodeId, useSavedLibraryStore } from '../../stores/saved.js';
import { useWorkspaceStore } from '../../stores/workspace.js';
import { theme } from '../../theme.js';
import { ActionDialog } from '../Common/ActionDialog.js';
import { ContextMenu, type ContextMenuItem } from '../Common/ContextMenu.js';
import { SaveItemDialog } from '../Saved/SaveItemDialog.js';

const SAVED_ITEM_MIME = 'application/x-mongog-saved-item';
const SAVED_FOLDER_MIME = 'application/x-mongog-saved-folder';

interface SavedTreeProps {
  connectionId: string | null;
  connectionLabel: string;
  parentTreeKey?: string;
  level: number;
  search?: string;
  rootLabel?: string;
}

type FolderAction =
  | { kind: 'create'; parentId: string | null; label: string }
  | { kind: 'rename'; folder: SavedFolder }
  | { kind: 'delete'; folder: SavedFolder };

type ItemAction = { kind: 'delete'; item: SavedItem };

export function SavedTree({
  connectionId,
  connectionLabel,
  parentTreeKey,
  level,
  search = '',
  rootLabel = 'Saved',
}: SavedTreeProps) {
  const {
    folders,
    items,
    expandedNodeIds,
    toggleNode,
    setNodeExpanded,
    createFolder,
    updateFolder,
    deleteFolder,
    updateItem,
    deleteItem,
    openItem,
    error: storeError,
    clearError,
  } = useSavedLibraryStore();
  const [menu, setMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  const [folderAction, setFolderAction] = useState<FolderAction | null>(null);
  const [itemAction, setItemAction] = useState<ItemAction | null>(null);
  const [editingItem, setEditingItem] = useState<SavedItem | null>(null);
  const [movingFolder, setMovingFolder] = useState<SavedFolder | null>(null);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const rootKey = savedRootNodeId(connectionId);
  const rootExpanded = normalizedSearch ? true : expandedNodeIds.has(rootKey);

  const scopedFolders = useMemo(
    () => folders.filter((folder) => folder.connectionId === connectionId),
    [folders, connectionId],
  );
  const scopedItems = useMemo(
    () => items.filter((item) => item.connectionId === connectionId),
    [items, connectionId],
  );
  const visibleFolder = (folder: SavedFolder): boolean => {
    if (!normalizedSearch) return true;
    if (folder.name.toLocaleLowerCase().includes(normalizedSearch)) return true;
    const descendants = descendantFolderIds(folder.id, scopedFolders);
    return scopedFolders.some((candidate) => (
      descendants.has(candidate.id) && candidate.name.toLocaleLowerCase().includes(normalizedSearch)
    )) || scopedItems.some((item) => (
      (item.folderId === folder.id || (item.folderId && descendants.has(item.folderId))) && itemMatches(item, normalizedSearch)
    ));
  };
  const rootFolders = scopedFolders
    .filter((folder) => folder.parentId === null && visibleFolder(folder))
    .sort(byName);
  const rootItems = scopedItems
    .filter((item) => item.folderId === null && (!normalizedSearch || itemMatches(item, normalizedSearch)))
    .sort(byName);

  const showMenu = (event: React.MouseEvent, menuItems: ContextMenuItem[]) => {
    event.preventDefault();
    event.stopPropagation();
    setMenu({ x: event.clientX, y: event.clientY, items: menuItems });
  };

  const rootMenu = (event: React.MouseEvent) => showMenu(event, [{
    label: 'New Folder…',
    onSelect: () => setFolderAction({ kind: 'create', parentId: null, label: rootLabel }),
  }]);

  const folderMenu = (event: React.MouseEvent, folder: SavedFolder) => showMenu(event, [
    { label: 'New Subfolder…', onSelect: () => setFolderAction({ kind: 'create', parentId: folder.id, label: folder.name }) },
    { label: 'Rename…', onSelect: () => setFolderAction({ kind: 'rename', folder }) },
    { label: 'Move…', onSelect: () => setMovingFolder(folder) },
    { label: 'Delete…', separatorBefore: true, danger: true, onSelect: () => setFolderAction({ kind: 'delete', folder }) },
  ]);

  const itemMenu = (event: React.MouseEvent, item: SavedItem) => showMenu(event, [
    { label: 'Open', onSelect: () => { openItem(item.id); } },
    { label: 'Edit Details…', separatorBefore: true, onSelect: () => setEditingItem(item) },
    { label: 'Rename…', onSelect: () => setEditingItem(item) },
    { label: 'Move…', onSelect: () => setEditingItem(item) },
    { label: 'Delete…', separatorBefore: true, danger: true, onSelect: () => setItemAction({ kind: 'delete', item }) },
  ]);

  const performFolderAction = async (value: string) => {
    if (!folderAction || busy) return;
    setBusy(true);
    setLocalError(null);
    clearError();
    try {
      if (folderAction.kind === 'create') {
        const folder = await createFolder({ name: value.trim(), connectionId, parentId: folderAction.parentId });
        setNodeExpanded(folderAction.parentId ?? rootKey, true);
        setNodeExpanded(folder.id, true);
      } else if (folderAction.kind === 'rename') {
        await updateFolder({
          id: folderAction.folder.id,
          name: value.trim(),
          connectionId: folderAction.folder.connectionId,
          parentId: folderAction.folder.parentId,
        });
      } else {
        await deleteFolder(folderAction.folder.id);
      }
      setFolderAction(null);
    } catch (error) {
      setLocalError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const performItemDelete = async (value: string) => {
    if (!itemAction || value !== itemAction.item.name || busy) return;
    setBusy(true);
    setLocalError(null);
    try {
      await deleteItem(itemAction.item.id);
      setItemAction(null);
    } catch (error) {
      setLocalError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const moveDroppedNode = async (
    event: React.DragEvent,
    targetFolderId: string | null,
    targetConnectionId: string | null,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    setDropTarget(null);
    const itemId = event.dataTransfer.getData(SAVED_ITEM_MIME);
    const folderId = event.dataTransfer.getData(SAVED_FOLDER_MIME);
    try {
      if (itemId) {
        const item = items.find((candidate) => candidate.id === itemId);
        if (item) await updateItem(toUpdateItem(item, { folderId: targetFolderId, connectionId: targetConnectionId }));
      } else if (folderId) {
        const folder = folders.find((candidate) => candidate.id === folderId);
        if (folder) await updateFolder({
          id: folder.id,
          name: folder.name,
          connectionId: targetConnectionId,
          parentId: targetFolderId,
        });
      }
      setNodeExpanded(targetFolderId ?? savedRootNodeId(targetConnectionId), true);
    } catch (error) {
      setLocalError(errorMessage(error));
    }
  };

  const dropProps = (targetId: string, targetFolderId: string | null): React.HTMLAttributes<HTMLDivElement> => ({
    onDragOver: (event) => {
      if (!hasSavedDrag(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      setDropTarget(targetId);
    },
    onDragLeave: (event) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(null);
    },
    onDrop: (event) => void moveDroppedNode(event, targetFolderId, connectionId),
  });

  const renderFolder = (folder: SavedFolder, parentKey: string, folderLevel: number): React.ReactNode => {
    const key = `saved-folder:${folder.id}`;
    const expanded = normalizedSearch ? true : expandedNodeIds.has(folder.id);
    const children = scopedFolders.filter((candidate) => candidate.parentId === folder.id && visibleFolder(candidate)).sort(byName);
    const childItems = scopedItems
      .filter((item) => item.folderId === folder.id && (!normalizedSearch || itemMatches(item, normalizedSearch)))
      .sort(byName);
    return (
      <div key={folder.id}>
        <div
          className="explorer-tree-item"
          role="treeitem"
          aria-label={`Saved folder ${folder.name}`}
          aria-level={folderLevel}
          aria-expanded={expanded}
          tabIndex={0}
          draggable
          data-tree-node-key={key}
          data-tree-parent-key={parentKey}
          style={{ ...treeItemStyle, ...(dropTarget === key ? dropStyle : {}) }}
          onClick={() => toggleNode(folder.id)}
          onContextMenu={(event) => folderMenu(event, folder)}
          onKeyDown={(event) => handleSavedTreeKeyDown(event, {
            key, parentKey, expanded, expandable: true,
            onExpand: () => setNodeExpanded(folder.id, true),
            onCollapse: () => setNodeExpanded(folder.id, false),
            onActivate: () => toggleNode(folder.id),
          })}
          onDragStart={(event) => {
            event.stopPropagation();
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData(SAVED_FOLDER_MIME, folder.id);
            event.dataTransfer.setData('text/plain', folder.name);
          }}
          {...dropProps(key, folder.id)}
        >
          <span style={chevronStyle}>{expanded ? '▼' : '▶'}</span>
          <SavedFolderIcon />
          <span style={nameStyle}>{folder.name}</span>
        </div>
        {expanded && (
          <div role="group" style={{ marginLeft: 14 }}>
            {children.map((child) => renderFolder(child, key, folderLevel + 1))}
            {childItems.map((item) => renderItem(item, key, folderLevel + 1))}
            {children.length === 0 && childItems.length === 0 && <EmptySaved />}
          </div>
        )}
      </div>
    );
  };

  const renderItem = (item: SavedItem, parentKey: string, itemLevel: number) => {
    const key = `saved-item:${item.id}`;
    return (
      <div
        key={item.id}
        className="explorer-tree-item"
        role="treeitem"
        aria-label={`Saved ${itemTypeLabel(item.type)} ${item.name}`}
        aria-level={itemLevel}
        tabIndex={0}
        draggable
        data-tree-node-key={key}
        data-tree-parent-key={parentKey}
        data-saved-item-type={item.type}
        style={treeItemStyle}
        title={`${itemTypeLabel(item.type)} · ${item.database ?? 'no database'}${item.collection ? `.${item.collection}` : ''}`}
        onClick={() => { openItem(item.id); }}
        onContextMenu={(event) => itemMenu(event, item)}
        onKeyDown={(event) => handleSavedTreeKeyDown(event, {
          key, parentKey, expanded: false, expandable: false, onActivate: () => { openItem(item.id); },
        })}
        onDragStart={(event) => {
          event.stopPropagation();
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData(SAVED_ITEM_MIME, item.id);
          event.dataTransfer.setData('text/plain', item.name);
        }}
      >
        <span style={{ ...chevronStyle, opacity: 0 }} aria-hidden="true">▶</span>
        <SavedItemIcon type={item.type} />
        <span style={nameStyle}>{item.name}</span>
      </div>
    );
  };

  const descendantCounts = folderAction?.kind === 'delete'
    ? folderDeleteCounts(folderAction.folder.id, scopedFolders, scopedItems)
    : null;
  const combinedError = localError ?? storeError;

  return (
    <>
      <div
        className="explorer-tree-item"
        role="treeitem"
        aria-label={`${rootLabel} for ${connectionLabel}`}
        aria-level={level}
        aria-expanded={rootExpanded}
        tabIndex={0}
        data-tree-node-key={rootKey}
        data-tree-parent-key={parentTreeKey}
        style={{ ...treeItemStyle, ...(dropTarget === rootKey ? dropStyle : {}) }}
        onClick={() => toggleNode(rootKey)}
        onContextMenu={rootMenu}
        onKeyDown={(event) => handleSavedTreeKeyDown(event, {
          key: rootKey, parentKey: parentTreeKey, expanded: rootExpanded, expandable: true,
          onExpand: () => setNodeExpanded(rootKey, true),
          onCollapse: () => setNodeExpanded(rootKey, false),
          onActivate: () => toggleNode(rootKey),
        })}
        {...dropProps(rootKey, null)}
      >
        <span style={chevronStyle}>{rootExpanded ? '▼' : '▶'}</span>
        <SavedRootIcon />
        <span style={nameStyle}>{rootLabel}</span>
        <span style={{ marginLeft: 'auto', color: theme.colors.textFaint, fontSize: 9 }}>{scopedItems.length}</span>
      </div>
      {rootExpanded && (
        <div role="group" style={{ marginLeft: 14 }}>
          {rootFolders.map((folder) => renderFolder(folder, rootKey, level + 1))}
          {rootItems.map((item) => renderItem(item, rootKey, level + 1))}
          {rootFolders.length === 0 && rootItems.length === 0 && <EmptySaved />}
        </div>
      )}

      {combinedError && <div role="alert" style={{ padding: '3px 8px', color: theme.colors.danger, fontSize: 10 }}>{combinedError}</div>}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
      {folderAction && (
        <ActionDialog
          title={folderAction.kind === 'create' ? 'New saved folder' : folderAction.kind === 'rename' ? 'Rename saved folder' : 'Delete saved folder'}
          description={folderAction.kind === 'create'
            ? `Create a folder inside ${folderAction.label}.`
            : folderAction.kind === 'rename'
              ? `Rename ${folderAction.folder.name}. Its contents will stay in place.`
              : `Delete ${folderAction.folder.name} and all ${descendantCounts?.folders ?? 0} folder(s) and ${descendantCounts?.items ?? 0} saved item(s) inside it.`}
          inputLabel={folderAction.kind === 'delete' ? `Type "${folderAction.folder.name}" to confirm` : 'Folder name'}
          initialValue={folderAction.kind === 'rename' ? folderAction.folder.name : ''}
          requiredValue={folderAction.kind === 'delete' ? folderAction.folder.name : undefined}
          confirmLabel={folderAction.kind === 'delete' ? 'Delete folder tree' : folderAction.kind === 'rename' ? 'Rename' : 'Create'}
          danger={folderAction.kind === 'delete'}
          busy={busy}
          error={localError}
          onCancel={() => { if (!busy) { setFolderAction(null); setLocalError(null); } }}
          onConfirm={(value) => void performFolderAction(value)}
        />
      )}
      {itemAction && (
        <ActionDialog
          title="Delete saved item"
          description={`Delete ${itemAction.item.name}. Any open tab will remain available as an unsaved tab.`}
          inputLabel={`Type "${itemAction.item.name}" to confirm`}
          initialValue=""
          requiredValue={itemAction.item.name}
          confirmLabel="Delete saved item"
          danger
          busy={busy}
          error={localError}
          onCancel={() => { if (!busy) setItemAction(null); }}
          onConfirm={(value) => void performItemDelete(value)}
        />
      )}
      {editingItem && (
        <SaveItemDialog
          input={toCreateItem(editingItem)}
          existingId={editingItem.id}
          title="Edit Saved Item"
          onClose={() => setEditingItem(null)}
          onSaved={(item) => {
            syncOpenTab(item);
            setEditingItem(null);
          }}
        />
      )}
      {movingFolder && (
        <MoveFolderDialog folder={movingFolder} onClose={() => setMovingFolder(null)} />
      )}
    </>
  );
}

function MoveFolderDialog({ folder, onClose }: { folder: SavedFolder; onClose: () => void }) {
  const profiles = useConnectionStore((state) => state.profiles);
  const { folders, updateFolder } = useSavedLibraryStore();
  const [connectionId, setConnectionId] = useState<string | null>(folder.connectionId);
  const [parentId, setParentId] = useState<string | null>(folder.parentId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const excluded = descendantFolderIds(folder.id, folders);
  excluded.add(folder.id);
  const targets = folders.filter((candidate) => candidate.connectionId === connectionId && !excluded.has(candidate.id)).sort(byName);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await updateFolder({ id: folder.id, name: folder.name, connectionId, parentId });
      onClose();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div role="presentation" style={overlayStyle}>
      <div role="dialog" aria-modal="true" aria-label="Move saved folder" style={dialogStyle}>
        <strong style={{ fontSize: 14 }}>Move {folder.name}</strong>
        <label style={labelStyle}>Connection
          <select style={inputStyle} value={connectionId ?? ''} onChange={(event) => { setConnectionId(event.target.value || null); setParentId(null); }}>
            <option value="">Unassigned</option>
            {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
          </select>
        </label>
        <label style={labelStyle}>Destination
          <select style={inputStyle} value={parentId ?? ''} onChange={(event) => setParentId(event.target.value || null)}>
            <option value="">Saved root</option>
            {targets.map((target) => <option key={target.id} value={target.id}>{savedFolderPath(target.id, folders)}</option>)}
          </select>
        </label>
        {error && <div role="alert" style={{ color: theme.colors.danger, fontSize: 11 }}>{error}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 7, marginTop: 14 }}>
          <button style={secondaryButton} disabled={busy} onClick={onClose}>Cancel</button>
          <button style={primaryButton} disabled={busy} onClick={() => void submit()}>{busy ? 'Moving…' : 'Move'}</button>
        </div>
      </div>
    </div>
  );
}

export function SavedItemIcon({ type }: { type: SavedItem['type'] }) {
  return (
    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      {type === 'query' && <><path d="m3 4 3 4-3 4" /><path d="M8 12h5" /></>}
      {type === 'documents' && <><path d="M3 2.5h7l3 3v8H3z" /><path d="M10 2.5v3h3" /><path d="M5.5 8h5M5.5 10.5h3" /></>}
      {type === 'tab' && <><path d="M2.5 4h4l1-1.5h6v11h-11z" /><path d="M2.5 5.5h11" /></>}
    </svg>
  );
}

function SavedFolderIcon() {
  return <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinejoin="round"><path d="M1.75 4.25h4.5l1.35 1.5h6.65v7H1.75z" /></svg>;
}

function SavedRootIcon() {
  return <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3h10v10H3z" /><path d="M5.5 6h5M5.5 8.5h5M5.5 11h3" /></svg>;
}

function EmptySaved() {
  return <div style={{ padding: '3px 8px 3px 24px', color: theme.colors.textFaint, fontSize: 10 }}>(empty)</div>;
}

function toCreateItem(item: SavedItem): CreateSavedItemInput {
  return {
    name: item.name,
    type: item.type,
    folderId: item.folderId,
    connectionId: item.connectionId,
    database: item.database,
    collection: item.collection,
    tags: [...item.tags],
    payload: structuredClone(item.payload),
  } as CreateSavedItemInput;
}

function toUpdateItem(item: SavedItem, partial: Pick<SavedItem, 'folderId' | 'connectionId'>): UpdateSavedItemInput {
  return { ...toCreateItem(item), id: item.id, ...partial } as UpdateSavedItemInput;
}

function syncOpenTab(item: SavedItem): void {
  const store = useWorkspaceStore.getState();
  const tab = store.tabs.find((candidate) => candidate.savedItemId === item.id);
  if (!tab) return;
  store.updateTab(tab.id, {
    connectionId: item.connectionId,
    database: item.database ?? undefined,
    collection: item.collection ?? undefined,
    title: item.payload.type === 'tab' ? item.payload.template.title : item.name,
    dirty: false,
  });
}

function descendantFolderIds(id: string, folders: SavedFolder[]): Set<string> {
  const result = new Set<string>();
  const queue = [id];
  while (queue.length > 0) {
    const parent = queue.shift()!;
    for (const folder of folders) {
      if (folder.parentId === parent && !result.has(folder.id)) {
        result.add(folder.id);
        queue.push(folder.id);
      }
    }
  }
  return result;
}

function folderDeleteCounts(id: string, folders: SavedFolder[], items: SavedItem[]) {
  const descendants = descendantFolderIds(id, folders);
  descendants.add(id);
  return {
    folders: descendants.size,
    items: items.filter((item) => !!item.folderId && descendants.has(item.folderId)).length,
  };
}

function itemMatches(item: SavedItem, search: string): boolean {
  return [item.name, item.database ?? '', item.collection ?? '', ...item.tags]
    .join(' ').toLocaleLowerCase().includes(search);
}

function itemTypeLabel(type: SavedItem['type']): string {
  return type === 'documents' ? 'Document View' : type === 'tab' ? 'Tab Template' : 'Query';
}

function byName<T extends { name: string }>(left: T, right: T): number {
  return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
}

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) return String(error.message);
  return String(error);
}

function hasSavedDrag(event: React.DragEvent): boolean {
  return event.dataTransfer.types.includes(SAVED_ITEM_MIME) || event.dataTransfer.types.includes(SAVED_FOLDER_MIME);
}

interface SavedTreeKeyOptions {
  key: string;
  parentKey?: string;
  expanded: boolean;
  expandable: boolean;
  onExpand?: () => void;
  onCollapse?: () => void;
  onActivate: () => void;
}

function handleSavedTreeKeyDown(event: React.KeyboardEvent<HTMLElement>, options: SavedTreeKeyOptions) {
  if (event.target !== event.currentTarget) return;
  const tree = event.currentTarget.closest<HTMLElement>('[role="tree"]');
  if (!tree) return;
  const visible = Array.from(tree.querySelectorAll<HTMLElement>('[role="treeitem"]'))
    .filter((item) => item.getClientRects().length > 0 && item.dataset.treeNodeKey);
  const index = visible.indexOf(event.currentTarget);
  const focus = (item?: HTMLElement) => { item?.focus(); item?.scrollIntoView({ block: 'nearest' }); };
  if (event.key === 'ArrowDown') { event.preventDefault(); focus(visible[index + 1]); }
  else if (event.key === 'ArrowUp') { event.preventDefault(); focus(visible[index - 1]); }
  else if (event.key === 'ArrowRight') {
    event.preventDefault();
    if (options.expandable && !options.expanded) options.onExpand?.();
    else if (options.expandable) focus(visible.find((item) => item.dataset.treeParentKey === options.key));
  } else if (event.key === 'ArrowLeft') {
    event.preventDefault();
    if (options.expandable && options.expanded) options.onCollapse?.();
    else if (options.parentKey) focus(visible.find((item) => item.dataset.treeNodeKey === options.parentKey));
  } else if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    options.onActivate();
  }
}

const treeItemStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 4, padding: '3px 8px 3px 2px',
  cursor: 'pointer', borderRadius: 3, margin: '0 4px', color: theme.colors.textMuted, fontSize: 11,
};
const dropStyle: React.CSSProperties = { background: theme.colors.selected, outline: `1px solid ${theme.colors.accentHover}`, outlineOffset: -1 };
const chevronStyle: React.CSSProperties = { width: 14, flexShrink: 0, textAlign: 'center', fontSize: 9 };
const nameStyle: React.CSSProperties = { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
const overlayStyle: React.CSSProperties = { position: 'fixed', inset: 0, zIndex: 20_000, display: 'grid', placeItems: 'center', background: 'rgba(0,0,0,.5)', padding: 24 };
const dialogStyle: React.CSSProperties = { width: 'min(440px, calc(100vw - 40px))', background: theme.colors.panel, border: `1px solid ${theme.colors.borderStrong}`, borderRadius: 5, boxShadow: '0 16px 50px rgba(0,0,0,.42)', padding: 16 };
const labelStyle: React.CSSProperties = { display: 'block', marginTop: 12, color: theme.colors.textMuted, fontSize: 11 };
const inputStyle: React.CSSProperties = { display: 'block', boxSizing: 'border-box', width: '100%', marginTop: 4, padding: '6px 8px', background: theme.colors.input, color: theme.colors.text, border: `1px solid ${theme.colors.borderStrong}`, borderRadius: 3 };
const secondaryButton: React.CSSProperties = { border: `1px solid ${theme.colors.borderStrong}`, borderRadius: 3, background: theme.colors.inputSoft, color: theme.colors.text, padding: '5px 9px', fontSize: 11, cursor: 'pointer' };
const primaryButton: React.CSSProperties = { ...secondaryButton, background: theme.colors.accent, color: '#fff', borderColor: theme.colors.accentHover };
