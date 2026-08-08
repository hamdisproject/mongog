import { useSettingsStore } from '../../stores/settings.js';
import { theme, type ThemePreference } from '../../theme.js';

const options: Array<{
  id: ThemePreference;
  label: string;
  description: string;
  preview: { app: string; panel: string; text: string; accent: string };
}> = [
  {
    id: 'dark',
    label: 'Dark',
    description: 'MongoG’s focused dark workspace.',
    preview: { app: '#1e1e1e', panel: '#2d2d2d', text: '#ddd', accent: '#0e639c' },
  },
  {
    id: 'light',
    label: 'Light',
    description: 'A clear, high-contrast light workspace.',
    preview: { app: '#f7f8fa', panel: '#e6e9ef', text: '#202733', accent: '#0969a5' },
  },
  {
    id: 'system',
    label: 'System',
    description: 'Follow the operating system appearance.',
    preview: { app: '#f7f8fa', panel: '#252526', text: '#5f6978', accent: '#0e639c' },
  },
];

export function SettingsView() {
  const { settings, loaded, saving, error, setTheme } = useSettingsStore();

  return (
    <main
      data-testid="settings-view"
      style={{
        flex: 1, minWidth: 0, minHeight: 0, overflow: 'auto',
        background: theme.colors.app, color: theme.colors.text,
      }}
    >
      <div style={{ width: 'min(880px, calc(100% - 48px))', margin: '0 auto', padding: '34px 0 56px' }}>
        <div style={{ marginBottom: 28 }}>
          <div style={{ color: theme.colors.success, fontSize: 11, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase' }}>
            Application
          </div>
          <h1 style={{ margin: '7px 0 8px', fontSize: 25, fontWeight: 650 }}>Settings</h1>
          <p style={{ margin: 0, maxWidth: 620, color: theme.colors.textMuted, fontSize: 13, lineHeight: 1.55 }}>
            Personalize how MongoG looks. Theme changes apply immediately and are saved for your next session.
          </p>
        </div>

        <section style={{ border: `1px solid ${theme.colors.border}`, borderRadius: 7, background: theme.colors.panel, overflow: 'hidden' }}>
          <div style={{ padding: '15px 17px', borderBottom: `1px solid ${theme.colors.border}` }}>
            <h2 style={{ margin: 0, fontSize: 14 }}>Appearance</h2>
            <div style={{ marginTop: 5, color: theme.colors.textMuted, fontSize: 11 }}>Choose the color theme used across the workspace and editors.</div>
          </div>

          <div role="radiogroup" aria-label="Application theme" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12, padding: 16 }}>
            {options.map((option) => {
              const selected = settings.theme === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={`${option.label} theme`}
                  disabled={!loaded || saving}
                  onClick={() => void setTheme(option.id)}
                  style={{
                    border: `1px solid ${selected ? theme.colors.accentHover : theme.colors.borderStrong}`,
                    borderRadius: 6, background: selected ? theme.colors.selected : theme.colors.input,
                    color: theme.colors.text, padding: 0, overflow: 'hidden', textAlign: 'left',
                    cursor: !loaded || saving ? 'default' : 'pointer', opacity: !loaded ? 0.65 : 1,
                    boxShadow: selected ? `0 0 0 1px ${theme.colors.accentHover}` : 'none',
                  }}
                >
                  <ThemePreview {...option.preview} />
                  <span style={{ display: 'flex', alignItems: 'flex-start', gap: 9, padding: '11px 12px 13px' }}>
                    <span aria-hidden="true" style={{ marginTop: 2, width: 13, height: 13, borderRadius: '50%', border: `1px solid ${selected ? theme.colors.accentHover : theme.colors.borderStrong}`, background: selected ? theme.colors.accent : 'transparent', boxShadow: selected ? `inset 0 0 0 3px ${theme.colors.input}` : 'none', flexShrink: 0 }} />
                    <span>
                      <strong style={{ display: 'block', fontSize: 12 }}>{option.label}</strong>
                      <span style={{ display: 'block', marginTop: 4, color: theme.colors.textMuted, fontSize: 10, lineHeight: 1.4 }}>{option.description}</span>
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <div aria-live="polite" style={{ minHeight: 20, marginTop: 10, color: error ? theme.colors.danger : theme.colors.textMuted, fontSize: 11 }}>
          {error ? error : saving ? 'Saving theme…' : loaded ? 'Theme preference is saved automatically.' : 'Loading settings…'}
        </div>
      </div>
    </main>
  );
}

function ThemePreview({ app, panel, text, accent }: { app: string; panel: string; text: string; accent: string }) {
  return (
    <span aria-hidden="true" style={{ display: 'flex', height: 76, background: app, borderBottom: '1px solid #0002' }}>
      <span style={{ width: '27%', background: panel, borderRight: '1px solid #0002', padding: '12px 7px' }}>
        <span style={{ display: 'block', width: '72%', height: 4, borderRadius: 3, background: text, opacity: 0.45, marginBottom: 7 }} />
        <span style={{ display: 'block', width: '88%', height: 4, borderRadius: 3, background: accent, opacity: 0.85, marginBottom: 7 }} />
        <span style={{ display: 'block', width: '60%', height: 4, borderRadius: 3, background: text, opacity: 0.32 }} />
      </span>
      <span style={{ flex: 1, padding: '13px 11px' }}>
        <span style={{ display: 'block', width: '42%', height: 5, borderRadius: 3, background: accent, marginBottom: 10 }} />
        <span style={{ display: 'block', width: '90%', height: 4, borderRadius: 3, background: text, opacity: 0.52, marginBottom: 7 }} />
        <span style={{ display: 'block', width: '72%', height: 4, borderRadius: 3, background: text, opacity: 0.32 }} />
      </span>
    </span>
  );
}
