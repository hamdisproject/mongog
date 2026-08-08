import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { theme } from '../../theme.js';

export function ActionDialog({
  title,
  description,
  inputLabel,
  initialValue = '',
  requiredValue,
  confirmLabel,
  danger = false,
  busy = false,
  error,
  onCancel,
  onConfirm,
}: {
  title: string;
  description: string;
  inputLabel: string;
  initialValue?: string;
  requiredValue?: string;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  error?: string | null;
  onCancel: () => void;
  onConfirm: (value: string) => void;
}) {
  const [value, setValue] = useState(initialValue);
  const valid = value.trim().length > 0 && (requiredValue === undefined || value === requiredValue);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [busy, onCancel]);

  return createPortal(
    <div
      role="presentation"
      style={{
        position: 'fixed', inset: 0, zIndex: 20_000, display: 'grid', placeItems: 'center',
        background: 'rgba(0,0,0,.58)', padding: 24,
      }}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{
          width: 'min(460px, 100%)', border: `1px solid ${theme.colors.borderStrong}`,
          borderRadius: 6, background: theme.colors.panel, color: theme.colors.text,
          boxShadow: '0 18px 50px rgba(0,0,0,.55)', fontFamily: 'system-ui',
        }}
        onSubmit={(event) => {
          event.preventDefault();
          if (valid && !busy) onConfirm(value);
        }}
      >
        <div style={{ padding: '14px 16px 9px', borderBottom: `1px solid ${theme.colors.border}` }}>
          <strong style={{ fontSize: 14 }}>{title}</strong>
        </div>
        <div style={{ padding: 16 }}>
          <div style={{ color: theme.colors.textMuted, fontSize: 12, lineHeight: 1.5, marginBottom: 13 }}>{description}</div>
          <label style={{ display: 'block', color: theme.colors.textMuted, fontSize: 11, marginBottom: 5 }}>{inputLabel}</label>
          <input
            autoFocus
            value={value}
            disabled={busy}
            onChange={(event) => setValue(event.target.value)}
            style={{
              boxSizing: 'border-box', width: '100%', border: `1px solid ${theme.colors.borderStrong}`,
              borderRadius: theme.radius, background: theme.colors.input, color: theme.colors.text,
              padding: '7px 9px', outline: 0, fontSize: 12,
            }}
          />
          {error && <div role="alert" style={{ color: theme.colors.danger, fontSize: 11, marginTop: 9 }}>{error}</div>}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '10px 16px', borderTop: `1px solid ${theme.colors.border}` }}>
          <button type="button" disabled={busy} onClick={onCancel} style={buttonStyle(false, false)}>Cancel</button>
          <button type="submit" disabled={!valid || busy} style={buttonStyle(danger, !valid || busy)}>
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}

function buttonStyle(danger: boolean, disabled: boolean): React.CSSProperties {
  return {
    border: `1px solid ${danger ? '#a53a43' : theme.colors.borderStrong}`,
    borderRadius: theme.radius,
    background: danger ? '#8b2f36' : theme.colors.inputSoft,
    color: theme.colors.text,
    padding: '5px 11px', fontSize: 12,
    cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1,
  };
}
