import { useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { theme } from '../../theme.js';

export interface ContextMenuItem {
  label: string;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  separatorBefore?: boolean;
  onSelect: () => void;
}

export function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}) {
  useLayoutEffect(() => {
    const close = () => onClose();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('blur', close);
    window.addEventListener('resize', close);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('blur', close);
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  const left = Math.max(6, Math.min(x, window.innerWidth - 230));
  const top = Math.max(6, Math.min(y, window.innerHeight - Math.min(items.length * 31 + 16, 420)));

  return createPortal(
    <div
      role="menu"
      aria-label="Context menu"
      style={{
        position: 'fixed', left, top, zIndex: 10_000, width: 220,
        padding: '5px 0', background: theme.colors.panelRaised,
        border: `1px solid ${theme.colors.borderStrong}`, borderRadius: theme.radius,
        boxShadow: '0 8px 24px rgba(0,0,0,.45)', color: theme.colors.text,
        fontFamily: 'system-ui', fontSize: 12,
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      {items.map((item, index) => (
        <div key={`${item.label}:${index}`}>
          {item.separatorBefore && <div style={{ borderTop: `1px solid ${theme.colors.border}`, margin: '4px 0' }} />}
          <button
            type="button"
            role="menuitem"
            disabled={item.disabled}
            onClick={() => {
              if (item.disabled) return;
              onClose();
              item.onSelect();
            }}
            style={{
              display: 'flex', width: '100%', alignItems: 'center', gap: 10,
              border: 0, background: 'transparent', padding: '6px 10px',
              color: item.disabled
                ? theme.colors.textFaint
                : item.danger
                  ? theme.colors.danger
                  : theme.colors.text,
              cursor: item.disabled ? 'default' : 'pointer', textAlign: 'left', fontSize: 12,
            }}
            onMouseEnter={(event) => {
              if (!item.disabled) event.currentTarget.style.background = theme.colors.selected;
            }}
            onMouseLeave={(event) => { event.currentTarget.style.background = 'transparent'; }}
          >
            <span style={{ flex: 1 }}>{item.label}</span>
            {item.shortcut && <span style={{ color: theme.colors.textFaint, fontSize: 10 }}>{item.shortcut}</span>}
          </button>
        </div>
      ))}
    </div>,
    document.body,
  );
}
