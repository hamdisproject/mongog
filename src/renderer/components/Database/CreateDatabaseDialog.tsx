import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { collectionNameError, databaseNameError, namespaceLengthError } from '../../../shared/domain/namespaces.js';
import { theme } from '../../theme.js';

export function CreateDatabaseDialog({ busy, error, onCancel, onConfirm }: {
  busy: boolean;
  error?: string | null;
  onCancel: () => void;
  onConfirm: (database: string, collection: string) => void;
}) {
  const [database, setDatabase] = useState('');
  const [collection, setCollection] = useState('');
  const validation = databaseNameError(database.trim())
    ?? collectionNameError(collection.trim())
    ?? namespaceLengthError(database.trim(), collection.trim());

  useEffect(() => {
    const listener = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) onCancel(); };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [busy, onCancel]);

  return createPortal(
    <div role="presentation" style={styles.backdrop} onPointerDown={(event) => {
      if (event.target === event.currentTarget && !busy) onCancel();
    }}>
      <form role="dialog" aria-modal="true" aria-label="Create database" style={styles.dialog} onSubmit={(event) => {
        event.preventDefault();
        if (!validation && !busy) onConfirm(database.trim(), collection.trim());
      }}>
        <div style={styles.title}><strong>Create database</strong></div>
        <div style={styles.body}>
          <div style={styles.description}>MongoDB creates a database when its first collection is created.</div>
          <Field label="Database name" value={database} disabled={busy} autoFocus onChange={setDatabase} />
          <Field label="Initial collection name" value={collection} disabled={busy} onChange={setCollection} />
          {(error || (database && collection && validation)) && <div role="alert" style={styles.error}>{error ?? validation}</div>}
        </div>
        <div style={styles.actions}>
          <button type="button" disabled={busy} onClick={onCancel} style={buttonStyle(false, busy)}>Cancel</button>
          <button type="submit" disabled={!!validation || busy} style={buttonStyle(false, !!validation || busy)}>{busy ? 'Creating…' : 'Create'}</button>
        </div>
      </form>
    </div>,
    document.body,
  );
}

function Field({ label, value, disabled, autoFocus, onChange }: {
  label: string; value: string; disabled: boolean; autoFocus?: boolean; onChange: (value: string) => void;
}) {
  return <label style={styles.label}>{label}<input autoFocus={autoFocus} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} style={styles.input} /></label>;
}

const styles: Record<string, React.CSSProperties> = {
  backdrop: { position: 'fixed', inset: 0, zIndex: 20_000, display: 'grid', placeItems: 'center', background: 'rgba(0,0,0,.58)', padding: 24 },
  dialog: { width: 'min(460px, 100%)', border: `1px solid ${theme.colors.borderStrong}`, borderRadius: 6, background: theme.colors.panel, color: theme.colors.text, boxShadow: '0 18px 50px rgba(0,0,0,.55)', fontFamily: 'system-ui' },
  title: { padding: '14px 16px 9px', borderBottom: `1px solid ${theme.colors.border}`, fontSize: 14 },
  body: { padding: 16 },
  description: { color: theme.colors.textMuted, fontSize: 12, lineHeight: 1.5, marginBottom: 13 },
  label: { display: 'grid', gap: 5, color: theme.colors.textMuted, fontSize: 11, marginTop: 10 },
  input: { boxSizing: 'border-box', width: '100%', border: `1px solid ${theme.colors.borderStrong}`, borderRadius: theme.radius, background: theme.colors.input, color: theme.colors.text, padding: '7px 9px', outline: 0, fontSize: 12 },
  error: { color: theme.colors.danger, fontSize: 11, marginTop: 9 },
  actions: { display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '10px 16px', borderTop: `1px solid ${theme.colors.border}` },
};

function buttonStyle(danger: boolean, disabled: boolean): React.CSSProperties {
  return { border: `1px solid ${danger ? '#a53a43' : theme.colors.borderStrong}`, borderRadius: theme.radius, background: danger ? '#8b2f36' : theme.colors.inputSoft, color: theme.colors.text, padding: '5px 11px', fontSize: 12, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1 };
}
