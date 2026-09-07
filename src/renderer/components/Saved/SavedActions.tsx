import { useEffect, useMemo, useState } from 'react';
import type { CreateSavedItemInput, SavedItem, SavedItemType, WorkspaceTab } from '../../../shared/domain/index.js';
import { savedInputForTab } from '../../saved-item-utils.js';
import { useSavedLibraryStore } from '../../stores/saved.js';
import { useWorkspaceStore } from '../../stores/workspace.js';
import { ContextMenu, type ContextMenuItem } from '../Common/ContextMenu.js';
import { SaveItemDialog } from './SaveItemDialog.js';

interface SavedActionsProps {
  tab: WorkspaceTab;
  surface: 'query' | 'sql' | 'documents';
  getSelection?: () => string | null;
}

interface DialogRequest {
  input: CreateSavedItemInput;
  linkTab: boolean;
  title?: string;
}

export function SavedActions({ tab, surface, getSelection }: SavedActionsProps) {
  const items = useSavedLibraryStore((state) => state.items);
  const updateItem = useSavedLibraryStore((state) => state.updateItem);
  const updateTab = useWorkspaceStore((state) => state.updateTab);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [dialog, setDialog] = useState<DialogRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const existing = items.find((item) => item.id === tab.savedItemId);
  const defaultType: SavedItemType = surface === 'documents' ? 'documents' : surface === 'sql' ? 'tab' : 'query';

  const activeSurface = tab.kind !== 'collection' || (
    surface === 'documents'
      ? (tab.collectionViewMode ?? 'documents') === 'documents'
      : surface === 'sql'
        ? tab.collectionViewMode === 'sql'
        : tab.collectionViewMode === 'query'
  );

  const openCreate = (
    type: SavedItemType,
    options: { selection?: boolean; saveAs?: boolean } = {},
  ) => {
    const selection = options.selection ? getSelection?.() : undefined;
    const source = selection?.trim() ? selection : undefined;
    const seed = savedInputForTab(tab, type, options.saveAs ? existing : undefined, source);
    const input = options.selection
      ? { ...seed, name: `${seed.name} selection`.slice(0, 120) } as CreateSavedItemInput
      : options.saveAs
        ? { ...seed, name: `${seed.name} copy`.slice(0, 120) } as CreateSavedItemInput
        : seed;
    setError(null);
    setDialog({
      input,
      linkTab: !options.selection,
      title: options.selection ? 'Save Selection as Query' : undefined,
    });
  };

  const savePrimary = async () => {
    if (busy) return;
    if (!existing) {
      openCreate(defaultType);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const input = savedInputForTab(tab, existing.type, existing);
      const saved = await updateItem({ ...input, id: existing.id });
      updateTab(tab.id, { savedItemId: saved.id, dirty: false });
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!activeSurface || !(event.metaKey || event.ctrlKey) || event.key.toLocaleLowerCase() !== 's') return;
      event.preventDefault();
      if (event.shiftKey) openCreate(existing?.type ?? defaultType, { saveAs: true });
      else void savePrimary();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeSurface, existing, defaultType, tab, getSelection]);

  const menuItems = useMemo<ContextMenuItem[]>(() => {
    const result: ContextMenuItem[] = [];
    if (existing) {
      result.push({ label: 'Save As…', onSelect: () => openCreate(existing.type, { saveAs: true }) });
    }
    if (surface === 'query') {
      result.push(
        { label: 'Save Query…', separatorBefore: result.length > 0, onSelect: () => openCreate('query') },
        {
          label: 'Save Selection as Query…',
          disabled: !getSelection?.()?.trim(),
          onSelect: () => openCreate('query', { selection: true }),
        },
        { label: 'Save Tab…', onSelect: () => openCreate('tab') },
      );
    } else if (surface === 'documents') {
      result.push(
        { label: 'Save Document View…', separatorBefore: result.length > 0, onSelect: () => openCreate('documents') },
        { label: 'Save Tab…', onSelect: () => openCreate('tab') },
      );
    } else result.push({ label: 'Save SQL Tab…', separatorBefore: result.length > 0, onSelect: () => openCreate('tab') });
    return result;
  }, [existing, surface, getSelection, tab]);

  const handleSaved = (item: SavedItem) => {
    if (dialog?.linkTab) updateTab(tab.id, { savedItemId: item.id, dirty: false });
  };

  return (
    <>
      <div style={{ display: 'inline-flex', alignItems: 'stretch' }}>
        <button
          type="button"
          data-testid={`save-${surface}`}
          style={{ ...buttonStyle, borderRadius: '2px 0 0 2px', opacity: busy ? 0.55 : 1 }}
          disabled={busy}
          title={existing ? `Save changes to ${existing.name} (Cmd/Ctrl+S)` : 'Save locally (Cmd/Ctrl+S)'}
          onClick={() => void savePrimary()}
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          aria-label="More save options"
          style={{ ...buttonStyle, borderLeft: 0, borderRadius: '0 2px 2px 0', paddingInline: 5 }}
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            setMenu({ x: rect.left, y: rect.bottom + 2 });
          }}
        >
          ▾
        </button>
      </div>
      {existing && <span style={{ fontSize: 10, color: 'var(--color-success-text)' }}>Saved · {existing.name}</span>}
      {error && <span role="alert" title={error} style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--color-danger)', fontSize: 10 }}>{error}</span>}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />}
      {dialog && (
        <SaveItemDialog
          input={dialog.input}
          onClose={() => setDialog(null)}
          onSaved={handleSaved}
        />
      )}
    </>
  );
}

const buttonStyle: React.CSSProperties = {
  background: 'var(--color-input-soft)', color: 'var(--color-text)',
  border: '1px solid var(--color-border-strong)', padding: '3px 8px',
  fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap',
};

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) return String(error.message);
  return String(error);
}
