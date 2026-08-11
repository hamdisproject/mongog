import { Fragment, useEffect, useRef, useState } from 'react';
import {
  bulkClosableTabIds,
  isTabRenameable,
  useWorkspaceStore,
} from '../../stores/workspace.js';
import type { WorkspaceTab } from '../../../shared/domain/index.js';
import { ContextMenu, type ContextMenuItem } from '../Common/ContextMenu.js';
import { useCommandPaletteStore } from '../../stores/command-palette.js';
import { useDataTransferStore } from '../../stores/data-transfer.js';

const TAB_DRAG_MIME = 'application/x-mongog-workspace-tab';

const s: Record<string, React.CSSProperties> = {
  bar: {
    display: 'flex', background: 'var(--color-panel-raised)', borderBottom: '1px solid var(--color-border)',
    minHeight: 32, overflowX: 'auto', overflowY: 'hidden', flexShrink: 0,
  },
  tab: {
    position: 'relative', display: 'flex', alignItems: 'center', gap: 2, padding: '3px 4px',
    fontSize: 12, borderRight: '1px solid var(--color-border)',
    whiteSpace: 'nowrap', color: 'var(--color-text-muted)', minWidth: 0, flexShrink: 0,
  },
  tabActive: { background: 'var(--color-app)', color: 'var(--color-text)' },
  tabIdentity: {
    height: 24, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6,
  },
  tabSelect: {
    height: 24, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6,
    padding: '0 4px', border: 0, borderRadius: 3, background: 'transparent',
    color: 'inherit', font: 'inherit', whiteSpace: 'nowrap', cursor: 'pointer',
  },
  tabTitle: {
    maxWidth: 160, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis',
  },
  dirtyDot: { width: 6, height: 6, borderRadius: '50%', background: 'var(--color-warning)', flexShrink: 0 },
  newBtn: {
    padding: '4px 11px', cursor: 'pointer', color: 'var(--color-text)', fontSize: 12,
    display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0,
    border: 0, borderRight: '1px solid var(--color-border)', background: 'var(--color-panel)',
  },
  pinnedDivider: {
    width: 1, alignSelf: 'stretch', flexShrink: 0, margin: '4px 3px',
    background: 'var(--color-border-strong)',
  },
  dropBefore: {
    position: 'absolute', left: -1, top: 3, bottom: 3, width: 2,
    borderRadius: 2, background: 'var(--color-focus)', zIndex: 4,
  },
  dropAfter: {
    position: 'absolute', right: -1, top: 3, bottom: 3, width: 2,
    borderRadius: 2, background: 'var(--color-focus)', zIndex: 4,
  },
  renameInput: {
    width: 130, minWidth: 72, border: '1px solid var(--color-focus)', borderRadius: 2,
    outline: 0, background: 'var(--color-input)', color: 'var(--color-text)',
    padding: '2px 5px', font: 'inherit', lineHeight: '16px',
  },
};

const kindIcon: Record<string, string> = {
  welcome: '⌂',
  query: '>_',
  collection: '{ }',
  history: '◷',
  'connection-settings': 'C',
  settings: '⚙',
  admin: 'A',
  'change-stream': '⇄',
  'data-transfer': '⇥',
};

interface DropTarget {
  tabId: string;
  position: 'before' | 'after';
}

export function TabBar() {
  const {
    tabs,
    activeTabId,
    closeTabs,
    openQuery,
    reorderTab,
    setTabPinned,
    renameTab,
  } = useWorkspaceStore();
  const openGlobalSearch = useCommandPaletteStore((state) => state.open);
  const openDataTransfer = useDataTransferStore((state) => state.open);
  const [menu, setMenu] = useState<{ tabId: string; x: number; y: number } | null>(null);
  const [draggingTabId, setDraggingTabId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const pinnedCount = tabs.filter((tab) => tab.pinned).length;

  const startRename = (tab: WorkspaceTab) => {
    if (!isTabRenameable(tab)) return;
    setRenamingTabId(tab.id);
    setRenameDraft(tab.title);
  };

  const commitRename = () => {
    if (renamingTabId) renameTab(renamingTabId, renameDraft);
    setRenamingTabId(null);
    setRenameDraft('');
  };

  const cancelRename = () => {
    setRenamingTabId(null);
    setRenameDraft('');
  };

  const menuItems = (tabId: string): ContextMenuItem[] => {
    const tab = tabs.find((candidate) => candidate.id === tabId);
    if (!tab) return [];
    const left = bulkClosableTabIds(tabs, tabId, 'left');
    const right = bulkClosableTabIds(tabs, tabId, 'right');
    const others = bulkClosableTabIds(tabs, tabId, 'others');
    const allUnpinned = bulkClosableTabIds(tabs, tabId, 'all');
    return [
      ...(isTabRenameable(tab) ? [{
        label: 'Rename Tab…',
        onSelect: () => startRename(tab),
      } satisfies ContextMenuItem] : []),
      {
        label: tab.pinned ? 'Unpin Tab' : 'Pin Tab',
        onSelect: () => setTabPinned(tab.id, !tab.pinned),
      },
      { label: 'Close', separatorBefore: true, onSelect: () => closeTabs([tabId]) },
      { label: 'Close Others', disabled: others.length === 0, onSelect: () => closeTabs(others) },
      { label: 'Close Tabs to the Left', disabled: left.length === 0, onSelect: () => closeTabs(left) },
      { label: 'Close Tabs to the Right', disabled: right.length === 0, onSelect: () => closeTabs(right) },
      { label: 'Close All Tabs', danger: true, separatorBefore: true, disabled: allUnpinned.length === 0, onSelect: () => closeTabs(allUnpinned) },
    ];
  };

  const handleDragOver = (event: React.DragEvent, target: WorkspaceTab) => {
    const source = tabs.find((tab) => tab.id === draggingTabId);
    if (!source || source.id === target.id || !!source.pinned !== !!target.pinned) {
      setDropTarget(null);
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const rect = event.currentTarget.getBoundingClientRect();
    setDropTarget({
      tabId: target.id,
      position: event.clientX < rect.left + rect.width / 2 ? 'before' : 'after',
    });
  };

  const finishDrag = () => {
    setDraggingTabId(null);
    setDropTarget(null);
  };

  return (
    <div className="workspace-tab-bar" style={s.bar} data-testid="workspace-tab-bar">
      <button type="button" onClick={() => openQuery()} style={s.newBtn} title="New query tab">
        <span style={{ color: 'var(--color-success)', fontSize: 15 }}>+</span> Query
      </button>
      <button
        type="button"
        aria-label="Open global search"
        onClick={openGlobalSearch}
        style={s.newBtn}
        title="Global search (Cmd/Ctrl+K)"
      >
        <span style={{ color: 'var(--color-success)', fontSize: 15 }} aria-hidden="true">⌕</span>
        Search
        <span style={{ color: 'var(--color-text-faint)', fontSize: 9, marginLeft: 2 }}>⌘/Ctrl K</span>
      </button>
      <button type="button" onClick={() => openDataTransfer()} style={s.newBtn} title="Import files or copy collections">
        <span style={{ color: 'var(--color-success)', fontSize: 14 }} aria-hidden="true">⇥</span>
        Transfer
      </button>
      {tabs.map((tab, index) => (
        <Fragment key={tab.id}>
          {pinnedCount > 0 && pinnedCount < tabs.length && index === pinnedCount && (
            <div style={s.pinnedDivider} data-testid="pinned-tab-divider" aria-hidden="true" />
          )}
          <Tab
            tab={tab}
            active={tab.id === activeTabId}
            dragging={tab.id === draggingTabId}
            dropPosition={dropTarget?.tabId === tab.id ? dropTarget.position : null}
            renaming={renamingTabId === tab.id}
            renameDraft={renameDraft}
            onRenameDraft={setRenameDraft}
            onStartRename={() => startRename(tab)}
            onCommitRename={commitRename}
            onCancelRename={cancelRename}
            onContextMenu={(event) => {
              event.preventDefault();
              setMenu({ tabId: tab.id, x: event.clientX, y: event.clientY });
            }}
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = 'move';
              event.dataTransfer.setData(TAB_DRAG_MIME, tab.id);
              event.dataTransfer.setData('text/plain', tab.title);
              setDraggingTabId(tab.id);
              setDropTarget(null);
            }}
            onDragOver={(event) => handleDragOver(event, tab)}
            onDrop={(event) => {
              event.preventDefault();
              const sourceId = event.dataTransfer.getData(TAB_DRAG_MIME) || draggingTabId;
              const source = tabs.find((candidate) => candidate.id === sourceId);
              if (source && source.id !== tab.id && !!source.pinned === !!tab.pinned) {
                const rect = event.currentTarget.getBoundingClientRect();
                reorderTab(
                  source.id,
                  tab.id,
                  event.clientX < rect.left + rect.width / 2 ? 'before' : 'after',
                );
              }
              finishDrag();
            }}
            onDragEnd={finishDrag}
          />
        </Fragment>
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
  dragging: boolean;
  dropPosition: 'before' | 'after' | null;
  renaming: boolean;
  renameDraft: string;
  onRenameDraft: (value: string) => void;
  onStartRename: () => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onContextMenu: (event: React.MouseEvent) => void;
  onDragStart: (event: React.DragEvent) => void;
  onDragOver: (event: React.DragEvent) => void;
  onDrop: (event: React.DragEvent) => void;
  onDragEnd: () => void;
}

function Tab({
  tab,
  active,
  dragging,
  dropPosition,
  renaming,
  renameDraft,
  onRenameDraft,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onContextMenu,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: TabProps) {
  const { setActiveTab, closeTab } = useWorkspaceStore();
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (!renaming) return;
    cancelledRef.current = false;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [renaming]);

  return (
    <div
      data-tab-id={tab.id}
      data-tab-kind={tab.kind}
      data-tab-pinned={tab.pinned ? 'true' : 'false'}
      data-tab-active={active ? 'true' : 'false'}
      style={{ ...s.tab, ...(active ? s.tabActive : {}), ...(dragging ? { opacity: 0.45 } : {}) }}
      onContextMenu={onContextMenu}
      onDragOver={onDragOver}
      onDrop={onDrop}
      title={`${tab.kind}: ${tab.title}${tab.dirty ? ' (modified)' : ''}`}
    >
      {dropPosition === 'before' && <span style={s.dropBefore} data-testid="tab-drop-before" />}
      {dropPosition === 'after' && <span style={s.dropAfter} data-testid="tab-drop-after" />}
      <span
        className="workspace-tab-drag-handle"
        data-tab-drag-handle
        draggable={!renaming}
        role="img"
        aria-label={`Drag to reorder ${tab.title} tab`}
        title="Drag to reorder tab"
        onDragStart={(event) => {
          if (renaming) {
            event.preventDefault();
            return;
          }
          onDragStart(event);
        }}
        onDragEnd={onDragEnd}
      >
        <DragGripIcon />
      </span>
      {renaming ? (
        <div style={s.tabIdentity}>
          <span style={{ fontSize: 10, opacity: 0.6 }}>{kindIcon[tab.kind] ?? '?'}</span>
          {tab.pinned && <PinIcon />}
          <input
            ref={inputRef}
            aria-label="Tab name"
            maxLength={120}
            value={renameDraft}
            style={s.renameInput}
            onChange={(event) => onRenameDraft(event.target.value)}
            onClick={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                onCommitRename();
              } else if (event.key === 'Escape') {
                event.preventDefault();
                cancelledRef.current = true;
                onCancelRename();
              }
            }}
            onBlur={() => {
              if (!cancelledRef.current) onCommitRename();
            }}
          />
          {tab.dirty && <span style={s.dirtyDot} title="Modified" />}
        </div>
      ) : (
        <button
          type="button"
          className="workspace-tab-select"
          data-tab-select
          aria-label={`Activate ${tab.title} tab`}
          aria-current={active ? 'page' : undefined}
          style={s.tabSelect}
          onClick={() => setActiveTab(tab.id)}
          onDoubleClick={(event) => {
            if (!isTabRenameable(tab)) return;
            event.preventDefault();
            event.stopPropagation();
            onStartRename();
          }}
        >
          <span style={{ fontSize: 10, opacity: 0.6 }}>{kindIcon[tab.kind] ?? '?'}</span>
          {tab.pinned && <PinIcon />}
          <span style={s.tabTitle}>{tab.title}</span>
          {tab.dirty && <span style={s.dirtyDot} title="Modified" />}
        </button>
      )}
      <button
        type="button"
        className="workspace-tab-close"
        data-tab-close
        aria-label={`Close ${tab.title}`}
        title={`Close ${tab.title}`}
        draggable={false}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => { event.stopPropagation(); closeTab(tab.id); }}
        onDragStart={(event) => event.preventDefault()}
      >&#x2715;</button>
    </div>
  );
}

function DragGripIcon() {
  return (
    <svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor" aria-hidden="true">
      <circle cx="3" cy="4" r="1" />
      <circle cx="7" cy="4" r="1" />
      <circle cx="3" cy="8" r="1" />
      <circle cx="7" cy="8" r="1" />
      <circle cx="3" cy="12" r="1" />
      <circle cx="7" cy="12" r="1" />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg
      aria-label="Pinned tab"
      role="img"
      data-testid="tab-pin-icon"
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{
        flexShrink: 0,
      }}
    >
      <title>Pinned tab</title>
      <path d="M5 2.5h6" />
      <path d="M6 2.5v3L4.5 8.75v1h7v-1L10 5.5v-3" />
      <path d="M8 9.75v3.75" />
    </svg>
  );
}
