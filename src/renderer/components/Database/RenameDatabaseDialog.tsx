import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { databaseNameError } from '../../../shared/domain/namespaces.js';
import { theme } from '../../theme.js';

export function RenameDatabaseDialog({ sourceDatabase, busy, error, onCancel, onConfirm }: {
  sourceDatabase: string;
  busy: boolean;
  error?: string | null;
  onCancel: () => void;
  onConfirm: (newDatabase: string) => void;
}) {
  const [newDatabase, setNewDatabase] = useState(sourceDatabase);
  const [confirmation, setConfirmation] = useState('');
  const nameError = databaseNameError(newDatabase.trim());
  const validation = nameError ?? (
    newDatabase.trim().toLowerCase() === sourceDatabase.toLowerCase()
      ? 'The new database name must be different.'
      : null
  );
  const valid = !nameError
    && newDatabase.trim().toLowerCase() !== sourceDatabase.toLowerCase()
    && confirmation === sourceDatabase;

  useEffect(() => {
    const listener = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) onCancel(); };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [busy, onCancel]);

  return createPortal(
    <div role="presentation" style={styles.backdrop} onPointerDown={(event) => {
      if (event.target === event.currentTarget && !busy) onCancel();
    }}>
      <form role="dialog" aria-modal="true" aria-label="Rename database" style={styles.dialog} onSubmit={(event) => {
        event.preventDefault();
        if (valid && !busy) onConfirm(newDatabase.trim());
      }}>
        <div style={styles.title}><strong>Rename database</strong></div>
        <div style={styles.body}>
          <div style={styles.warning}>
            MongoDB has no atomic database rename. Collections will be moved one at a time, open cursors and change streams will be invalidated, and the operation may take a long time. Do not close the app or write to this database until it finishes. MongoG cannot prevent other applications from writing during the operation.
          </div>
          <Field label="New database name" value={newDatabase} disabled={busy} autoFocus onChange={setNewDatabase} />
          <Field label={`Type "${sourceDatabase}" to confirm`} value={confirmation} disabled={busy} onChange={setConfirmation} />
          {(error || (newDatabase && validation)) && <div role="alert" style={styles.error}>{error ?? validation}</div>}
        </div>
        <div style={styles.actions}>
          <button type="button" disabled={busy} onClick={onCancel} style={buttonStyle(false, busy)}>Cancel</button>
          <button type="submit" disabled={!valid || busy} style={buttonStyle(true, !valid || busy)}>{busy ? 'Starting…' : 'Rename database'}</button>
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
  dialog: { width: 'min(520px, 100%)', border: `1px solid ${theme.colors.borderStrong}`, borderRadius: 6, background: theme.colors.panel, color: theme.colors.text, boxShadow: '0 18px 50px rgba(0,0,0,.55)', fontFamily: 'system-ui' },
  title: { padding: '14px 16px 9px', borderBottom: `1px solid ${theme.colors.border}`, fontSize: 14 },
  body: { padding: 16 },
  warning: { color: theme.colors.warning, background: 'rgba(196, 140, 45, .09)', border: `1px solid ${theme.colors.warning}`, borderRadius: 4, padding: 10, fontSize: 12, lineHeight: 1.5 },
  label: { display: 'grid', gap: 5, color: theme.colors.textMuted, fontSize: 11, marginTop: 12 },
  input: { boxSizing: 'border-box', width: '100%', border: `1px solid ${theme.colors.borderStrong}`, borderRadius: theme.radius, background: theme.colors.input, color: theme.colors.text, padding: '7px 9px', outline: 0, fontSize: 12 },
  error: { color: theme.colors.danger, fontSize: 11, marginTop: 9 },
  actions: { display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '10px 16px', borderTop: `1px solid ${theme.colors.border}` },
};

function buttonStyle(danger: boolean, disabled: boolean): React.CSSProperties {
  return { border: `1px solid ${danger ? '#a53a43' : theme.colors.borderStrong}`, borderRadius: theme.radius, background: danger ? '#8b2f36' : theme.colors.inputSoft, color: theme.colors.text, padding: '5px 11px', fontSize: 12, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1 };
}
