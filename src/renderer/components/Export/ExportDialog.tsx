import { useState } from 'react';
import type { ExportFormat, ExportScope } from '../../../shared/domain/index.js';

interface ExportDialogProps {
  title: string;
  allowAllMatching: boolean;
  unappliedCriteria?: boolean;
  busy?: boolean;
  onCancel: () => void;
  onExport: (format: ExportFormat, scope: ExportScope) => void;
}

export function ExportDialog({
  title,
  allowAllMatching,
  unappliedCriteria = false,
  busy = false,
  onCancel,
  onExport,
}: ExportDialogProps) {
  const [format, setFormat] = useState<ExportFormat>('xlsx');
  const [scope, setScope] = useState<ExportScope>('current-page');
  return (
    <div style={backdrop} role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onCancel();
    }}>
      <div role="dialog" aria-modal="true" aria-label={title} style={dialog}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>{title}</h3>
        <div style={sectionLabel}>Format</div>
        <div style={cards}>
          {([
            ['xlsx', 'Excel', '.xlsx'],
            ['csv', 'CSV', '.csv'],
            ['txt', 'Text', '.txt · tab-separated'],
          ] as const).map(([value, label, detail]) => (
            <button
              key={value}
              type="button"
              aria-pressed={format === value}
              style={{ ...card, ...(format === value ? selectedCard : {}) }}
              onClick={() => setFormat(value)}
              disabled={busy}
            >
              <strong>{label}</strong><span style={detailStyle}>{detail}</span>
            </button>
          ))}
        </div>
        {allowAllMatching && (
          <>
            <div style={sectionLabel}>Rows</div>
            <label style={radioLabel}>
              <input type="radio" checked={scope === 'current-page'} onChange={() => setScope('current-page')} />
              Current page <span style={detailStyle}>Export only the rows visible on this page</span>
            </label>
            <label style={radioLabel}>
              <input type="radio" checked={scope === 'all-matching'} onChange={() => setScope('all-matching')} />
              All matching documents <span style={detailStyle}>Read every page using the applied criteria</span>
            </label>
          </>
        )}
        {allowAllMatching && unappliedCriteria && scope === 'all-matching' && (
          <div style={warning}>Edited criteria are not applied. This export will use the last applied Filter, Sort and Projection.</div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 7, marginTop: 16 }}>
          <button style={secondaryButton} onClick={onCancel} disabled={busy}>Cancel</button>
          <button style={primaryButton} onClick={() => onExport(format, scope)} disabled={busy}>
            {busy ? 'Opening save dialog…' : 'Continue…'}
          </button>
        </div>
      </div>
    </div>
  );
}

const backdrop: React.CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: 'rgba(0,0,0,.55)', padding: 20,
};
const dialog: React.CSSProperties = {
  width: 520, maxWidth: '100%', border: '1px solid var(--color-border-strong)', borderRadius: 5,
  background: 'var(--color-panel)', color: 'var(--color-text)', padding: 16, boxShadow: '0 18px 55px rgba(0,0,0,.45)',
};
const sectionLabel: React.CSSProperties = { marginTop: 14, marginBottom: 6, color: 'var(--color-text-muted)', fontSize: 11, textTransform: 'uppercase' };
const cards: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 7 };
const card: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 3, textAlign: 'left', padding: '10px 9px', border: '1px solid var(--color-border)', borderRadius: 3, background: 'var(--color-input-soft)', color: 'var(--color-text)', cursor: 'pointer' };
const selectedCard: React.CSSProperties = { borderColor: 'var(--color-accent)', background: 'var(--color-selected)' };
const detailStyle: React.CSSProperties = { color: 'var(--color-text-muted)', fontSize: 10 };
const radioLabel: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 7, marginTop: 7, fontSize: 12 };
const warning: React.CSSProperties = { marginTop: 10, padding: 8, border: '1px solid var(--color-warning-border)', background: 'var(--color-warning-surface)', color: 'var(--color-warning-text)', fontSize: 11 };
const secondaryButton: React.CSSProperties = { border: '1px solid var(--color-border-strong)', background: 'var(--color-input-soft)', color: 'var(--color-text)', borderRadius: 2, padding: '5px 12px', cursor: 'pointer' };
const primaryButton: React.CSSProperties = { border: '1px solid var(--color-accent-hover)', background: 'var(--color-accent)', color: '#fff', borderRadius: 2, padding: '5px 12px', cursor: 'pointer' };

