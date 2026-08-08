import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useConnectionStore } from '../../stores/connections.js';
import { useWorkspaceStore } from '../../stores/workspace.js';
import { useCommandPaletteStore } from '../../stores/command-palette.js';
import { theme } from '../../theme.js';
import { useSavedLibraryStore } from '../../stores/saved.js';
import { savedFolderPath } from '../../saved-item-utils.js';
import { SavedItemIcon } from '../Sidebar/SavedTree.js';

interface PaletteItem {
  id: string;
  icon: React.ReactNode;
  label: string;
  detail: string;
  keywords: string;
  action: () => void;
}

export function CommandPalette() {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const { isOpen, close, toggle } = useCommandPaletteStore();
  const { profiles, connected, databases, collections, loadDatabases, loadCollections } = useConnectionStore();
  const { openQuery, openCollection, openAdmin, openConnections, openWelcome } = useWorkspaceStore();
  const savedItems = useSavedLibraryStore((state) => state.items);
  const savedFolders = useSavedLibraryStore((state) => state.folders);
  const openSavedItem = useSavedLibraryStore((state) => state.openItem);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === 'k') {
        event.preventDefault();
        toggle();
      }
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [close, toggle]);

  useEffect(() => {
    if (!isOpen) return;
    setQuery('');
    setSelectedIndex(0);
    window.setTimeout(() => inputRef.current?.focus(), 0);
    for (const connectionId of Object.keys(connected)) void loadDatabases(connectionId);
  }, [isOpen, connected, loadDatabases]);

  useEffect(() => {
    if (!isOpen) return;
    for (const connectionId of Object.keys(connected)) {
      for (const database of databases[connectionId] ?? []) {
        void loadCollections(connectionId, database.name);
      }
    }
  }, [isOpen, connected, databases, loadCollections]);

  const items = useMemo<PaletteItem[]>(() => {
    const closeAfter = (action: () => void) => () => {
      action();
      close();
    };
    const result: PaletteItem[] = [
      {
        id: 'command:new-query', icon: '>_', label: 'New Query', detail: 'Command', keywords: 'new query script',
        action: closeAfter(() => openQuery()),
      },
      {
        id: 'command:connections', icon: 'C', label: 'Open Connections', detail: 'Command', keywords: 'connections settings',
        action: closeAfter(() => openConnections()),
      },
      {
        id: 'command:welcome', icon: '⌂', label: 'Open Welcome', detail: 'Command', keywords: 'home welcome',
        action: closeAfter(() => openWelcome()),
      },
    ];

    for (const connectionId of Object.keys(connected)) {
      const profile = profiles.find((candidate) => candidate.id === connectionId);
      if (!profile) continue;
      result.push({
        id: `connection:${connectionId}`,
        icon: '●',
        label: profile.name,
        detail: 'Connected profile · open query',
        keywords: `${profile.name} connection`,
        action: closeAfter(() => openQuery({
          connectionId,
          database: profile.defaultDatabase ?? 'admin',
          title: `${profile.name} query`,
        })),
      });
      for (const database of databases[connectionId] ?? []) {
        result.push({
          id: `database:${connectionId}:${database.name}`,
          icon: '▣',
          label: database.name,
          detail: `${profile.name} · database · new query`,
          keywords: `${profile.name} ${database.name} database db query`,
          action: closeAfter(() => openQuery({
            connectionId,
            database: database.name,
            title: `${database.name} query`,
          })),
        });
        result.push({
          id: `database-search:${connectionId}:${database.name}`,
          icon: '⌕',
          label: `Search in ${database.name}`,
          detail: `${profile.name} · database document search`,
          keywords: `${profile.name} ${database.name} global search data documents`,
          action: closeAfter(() => openAdmin({ connectionId, database: database.name, section: 'search' })),
        });
        for (const collection of collections[`${connectionId}:${database.name}`] ?? []) {
          result.push({
            id: `collection:${connectionId}:${database.name}:${collection.name}`,
            icon: collection.type === 'view' ? 'V' : '{ }',
            label: collection.name,
            detail: `${profile.name} · ${database.name} · ${collection.type === 'view' ? 'view' : 'collection'}`,
            keywords: `${profile.name} ${database.name} ${collection.name} collection documents`,
            action: closeAfter(() => openCollection({
              connectionId,
              database: database.name,
              collection: collection.name,
            })),
          });
        }
      }
    }
    for (const item of savedItems) {
      const profile = item.connectionId
        ? profiles.find((candidate) => candidate.id === item.connectionId)
        : undefined;
      const typeLabel = item.type === 'documents' ? 'Document View' : item.type === 'tab' ? 'Tab Template' : 'Query';
      result.push({
        id: `saved:${item.id}`,
        icon: <SavedItemIcon type={item.type} />,
        label: item.name,
        detail: `${profile?.name ?? 'Unassigned'} · ${savedFolderPath(item.folderId, savedFolders)} · ${typeLabel}`,
        keywords: `${profile?.name ?? 'unassigned'} ${savedFolderPath(item.folderId, savedFolders)} ${item.database ?? ''} ${item.collection ?? ''} ${item.tags.join(' ')} saved ${typeLabel}`,
        action: closeAfter(() => { openSavedItem(item.id); }),
      });
    }
    return result;
  }, [profiles, connected, databases, collections, savedItems, savedFolders, openQuery, openCollection, openAdmin, openConnections, openWelcome, openSavedItem, close]);

  const visibleItems = useMemo(() => {
    const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    const filtered = terms.length === 0
      ? items
      : items.filter((item) => terms.every((term) => (
        `${item.label} ${item.detail} ${item.keywords}`.toLocaleLowerCase().includes(term)
      )));
    return filtered.slice(0, 30);
  }, [items, query]);

  useEffect(() => {
    setSelectedIndex((current) => Math.min(current, Math.max(0, visibleItems.length - 1)));
  }, [visibleItems.length]);

  if (!isOpen) return null;

  return createPortal(
    <div
      role="presentation"
      style={{
        position: 'fixed', inset: 0, zIndex: 15_000, display: 'flex', justifyContent: 'center',
        alignItems: 'flex-start', paddingTop: '12vh', background: 'rgba(0,0,0,.42)',
      }}
      onPointerDown={(event) => { if (event.target === event.currentTarget) close(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Global quick open"
        style={{
          width: 'min(680px, calc(100vw - 40px))', maxHeight: '68vh', display: 'flex', flexDirection: 'column',
          background: theme.colors.panel, border: `1px solid ${theme.colors.borderStrong}`,
          borderRadius: 6, boxShadow: '0 20px 60px rgba(0,0,0,.58)', overflow: 'hidden',
          color: theme.colors.text, fontFamily: 'system-ui',
        }}
      >
        <input
          ref={inputRef}
          aria-label="Search databases and collections"
          value={query}
          placeholder="Search commands, connections, namespaces, or saved items…"
          onChange={(event) => { setQuery(event.target.value); setSelectedIndex(0); }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setSelectedIndex((current) => Math.min(current + 1, visibleItems.length - 1));
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setSelectedIndex((current) => Math.max(0, current - 1));
            } else if (event.key === 'Enter') {
              event.preventDefault();
              visibleItems[selectedIndex]?.action();
            }
          }}
          style={{
            border: 0, borderBottom: `1px solid ${theme.colors.border}`, outline: 0,
            background: theme.colors.input, color: theme.colors.text, padding: '13px 15px', fontSize: 14,
          }}
        />
        <div role="listbox" style={{ overflow: 'auto', padding: '5px 0' }}>
          {visibleItems.map((item, index) => (
            <button
              type="button"
              role="option"
              aria-selected={index === selectedIndex}
              key={item.id}
              onMouseEnter={() => setSelectedIndex(index)}
              onClick={item.action}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, width: '100%', border: 0,
                padding: '8px 13px', background: index === selectedIndex ? theme.colors.selected : 'transparent',
                color: theme.colors.text, cursor: 'pointer', textAlign: 'left',
              }}
            >
              <span style={{ width: 24, color: theme.colors.success, fontFamily: 'monospace', fontSize: 11 }}>{item.icon}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12 }}>{item.label}</span>
                <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: theme.colors.textMuted, fontSize: 10, marginTop: 2 }}>{item.detail}</span>
              </span>
            </button>
          ))}
          {visibleItems.length === 0 && <div style={{ padding: 20, textAlign: 'center', color: theme.colors.textMuted, fontSize: 12 }}>No matching command or namespace.</div>}
        </div>
        <div style={{ padding: '5px 11px', borderTop: `1px solid ${theme.colors.border}`, color: theme.colors.textFaint, fontSize: 10 }}>
          ↑↓ navigate · Enter open · Esc close · Cmd/Ctrl+K toggle
        </div>
      </div>
    </div>,
    document.body,
  );
}
