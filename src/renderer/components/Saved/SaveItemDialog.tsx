import { useMemo, useState } from 'react';
import type { CreateSavedItemInput, SavedItem } from '../../../shared/domain/index.js';
import { savedFolderPath } from '../../saved-item-utils.js';
import { useConnectionStore } from '../../stores/connections.js';
import { useSavedLibraryStore } from '../../stores/saved.js';
import { theme } from '../../theme.js';

interface SaveItemDialogProps {
  input: CreateSavedItemInput;
  existingId?: string;
  title?: string;
  onClose: () => void;
  onSaved: (item: SavedItem) => void;
}

const fieldStyle: React.CSSProperties = {
  boxSizing: 'border-box', width: '100%', padding: '6px 8px', borderRadius: 3,
  border: `1px solid ${theme.colors.borderStrong}`, background: theme.colors.input,
  color: theme.colors.text, fontSize: 12, outline: 0,
};

export function SaveItemDialog({ input, existingId, title, onClose, onSaved }: SaveItemDialogProps) {
  const profiles = useConnectionStore((state) => state.profiles);
  const { folders, createFolder, createItem, updateItem } = useSavedLibraryStore();
  const [name, setName] = useState(input.name);
  const [connectionId, setConnectionId] = useState<string | null>(input.connectionId);
  const [folderId, setFolderId] = useState<string | null>(input.folderId);
  const [database, setDatabase] = useState(input.database ?? '');
  const [collection, setCollection] = useState(input.collection ?? '');
  const [tags, setTags] = useState(input.tags.join(', '));
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const compatibleFolders = useMemo(() => folders
    .filter((folder) => folder.connectionId === connectionId)
    .sort((left, right) => (
      savedFolderPath(left.id, folders).localeCompare(savedFolderPath(right.id, folders))
    )), [folders, connectionId]);

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const next = {
        ...input,
        name: trimmed,
        connectionId,
        folderId,
        database: database.trim() || null,
        collection: collection.trim() || null,
        tags: tags.split(',').map((tag) => tag.trim()).filter(Boolean),
      } as CreateSavedItemInput;
      const item = existingId
        ? await updateItem({ ...next, id: existingId })
        : await createItem(next);
      onSaved(item);
      onClose();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const addFolder = async () => {
    if (!newFolderName.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const folder = await createFolder({
        name: newFolderName.trim(),
        connectionId,
        parentId: folderId,
      });
      setFolderId(folder.id);
      setNewFolderName('');
      setNewFolderOpen(false);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="presentation"
      style={{
        position: 'fixed', inset: 0, zIndex: 20_000, display: 'grid', placeItems: 'center',
        background: 'rgba(0,0,0,.5)', padding: 24,
      }}
      onPointerDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title ?? (existingId ? 'Edit saved item' : 'Save item')}
        style={{
          width: 'min(520px, calc(100vw - 40px))', maxHeight: 'calc(100vh - 48px)', overflow: 'auto',
          background: theme.colors.panel, color: theme.colors.text,
          border: `1px solid ${theme.colors.borderStrong}`, borderRadius: 5,
          boxShadow: '0 16px 50px rgba(0,0,0,.42)', padding: 16,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 14 }}>
          <strong style={{ fontSize: 14 }}>{title ?? (existingId ? 'Edit saved item' : `Save ${itemTypeLabel(input.type)}`)}</strong>
          <span style={{ marginLeft: 'auto', color: theme.colors.textFaint, fontSize: 11 }}>{itemTypeLabel(input.type)}</span>
        </div>

        <Field label="Name">
          <input aria-label="Saved item name" autoFocus maxLength={120} style={fieldStyle} value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field label="Connection">
          <select
            aria-label="Saved item connection"
            style={fieldStyle}
            value={connectionId ?? ''}
            onChange={(event) => {
              const next = event.target.value || null;
              setConnectionId(next);
              if (!folders.some((folder) => folder.id === folderId && folder.connectionId === next)) setFolderId(null);
            }}
          >
            <option value="">Unassigned</option>
            {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
          </select>
        </Field>
        <Field label="Folder">
          <div style={{ display: 'flex', gap: 6 }}>
            <select aria-label="Saved item folder" style={fieldStyle} value={folderId ?? ''} onChange={(event) => setFolderId(event.target.value || null)}>
              <option value="">Saved root</option>
              {compatibleFolders.map((folder) => (
                <option key={folder.id} value={folder.id}>{savedFolderPath(folder.id, folders)}</option>
              ))}
            </select>
            <button type="button" style={secondaryButton} onClick={() => setNewFolderOpen((open) => !open)}>+ Folder</button>
          </div>
          {newFolderOpen && (
            <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
              <input
                aria-label="New saved folder name"
                maxLength={120}
                style={fieldStyle}
                value={newFolderName}
                placeholder={folderId ? 'New subfolder' : 'New folder'}
                onChange={(event) => setNewFolderName(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void addFolder(); } }}
              />
              <button type="button" style={secondaryButton} disabled={busy || !newFolderName.trim()} onClick={() => void addFolder()}>Create</button>
            </div>
          )}
        </Field>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Field label="Database">
            <input aria-label="Saved item database" maxLength={255} style={fieldStyle} value={database} onChange={(event) => setDatabase(event.target.value)} />
          </Field>
          <Field label="Collection">
            <input aria-label="Saved item collection" maxLength={255} style={fieldStyle} value={collection} onChange={(event) => setCollection(event.target.value)} />
          </Field>
        </div>
        <Field label="Tags">
          <input aria-label="Saved item tags" style={fieldStyle} value={tags} placeholder="report, read-only" onChange={(event) => setTags(event.target.value)} />
        </Field>

        {error && <div role="alert" style={{ color: theme.colors.danger, fontSize: 11, marginTop: 8 }}>{error}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 7, marginTop: 16 }}>
          <button type="button" style={secondaryButton} disabled={busy} onClick={onClose}>Cancel</button>
          <button type="button" style={primaryButton} disabled={busy || !name.trim()} onClick={() => void submit()}>
            {busy ? 'Saving…' : existingId ? 'Save Changes' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block', marginBottom: 10, color: theme.colors.textMuted, fontSize: 11 }}>
      <span style={{ display: 'block', marginBottom: 4 }}>{label}</span>
      {children}
    </label>
  );
}

const secondaryButton: React.CSSProperties = {
  border: `1px solid ${theme.colors.borderStrong}`, borderRadius: 3, background: theme.colors.inputSoft,
  color: theme.colors.text, padding: '5px 9px', fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap',
};

const primaryButton: React.CSSProperties = {
  ...secondaryButton, background: theme.colors.accent, color: '#fff', borderColor: theme.colors.accentHover,
};

function itemTypeLabel(type: CreateSavedItemInput['type']): string {
  if (type === 'documents') return 'Document View';
  if (type === 'tab') return 'Tab Template';
  return 'Query';
}

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) return String(error.message);
  return String(error);
}

