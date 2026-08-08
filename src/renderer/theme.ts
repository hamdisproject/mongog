import type { ApplicationSettings } from '../shared/domain/index.js';

export type ThemePreference = ApplicationSettings['theme'];
export type ResolvedTheme = 'dark' | 'light';

export const theme = {
  colors: {
    app: 'var(--color-app)',
    panel: 'var(--color-panel)',
    panelRaised: 'var(--color-panel-raised)',
    input: 'var(--color-input)',
    inputSoft: 'var(--color-input-soft)',
    border: 'var(--color-border)',
    borderStrong: 'var(--color-border-strong)',
    text: 'var(--color-text)',
    textMuted: 'var(--color-text-muted)',
    textFaint: 'var(--color-text-faint)',
    accent: 'var(--color-accent)',
    accentHover: 'var(--color-accent-hover)',
    selected: 'var(--color-selected)',
    success: 'var(--color-success)',
    warning: 'var(--color-warning)',
    danger: 'var(--color-danger)',
    dangerSurface: 'var(--color-danger-surface)',
  },
  radius: 4,
} as const;

let activePreference: ThemePreference = 'dark';
let resolvedTheme: ResolvedTheme = 'dark';
let removeSystemListener: (() => void) | null = null;

export function getResolvedTheme(): ResolvedTheme {
  return resolvedTheme;
}

export function getMonacoTheme(): 'vs' | 'vs-dark' {
  return resolvedTheme === 'light' ? 'vs' : 'vs-dark';
}

export function applyThemePreference(preference: ThemePreference): ResolvedTheme {
  activePreference = preference;
  removeSystemListener?.();
  removeSystemListener = null;

  if (typeof window !== 'undefined' && preference === 'system' && typeof window.matchMedia === 'function') {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => applyResolvedTheme(media.matches ? 'dark' : 'light');
    media.addEventListener('change', handleChange);
    removeSystemListener = () => media.removeEventListener('change', handleChange);
    handleChange();
    return resolvedTheme;
  }

  applyResolvedTheme(preference === 'light' ? 'light' : 'dark');
  return resolvedTheme;
}

function applyResolvedTheme(next: ResolvedTheme): void {
  resolvedTheme = next;
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = next;
  document.documentElement.style.colorScheme = next;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('mongog-theme-change', {
      detail: { preference: activePreference, resolved: next },
    }));
  }
}
