import { useEffect, useState } from 'react';
import { LATEST_RELEASE, RELEASE_NOTES, type ReleaseNoteSectionKind } from '../../release-notes.js';
import { theme } from '../../theme.js';
import { MongoGBrand } from '../Brand/MongoGBrand.js';

const sectionAppearance: Record<ReleaseNoteSectionKind, { label: string; color: string; background: string }> = {
  added: { label: 'Added', color: theme.colors.success, background: 'var(--color-success-surface)' },
  improved: { label: 'Improved', color: theme.colors.accentHover, background: theme.colors.selected },
  fixed: { label: 'Fixed', color: theme.colors.warning, background: 'var(--color-warning-surface)' },
};

export function ReleaseNotesView() {
  const [installedVersion, setInstalledVersion] = useState<string>(LATEST_RELEASE.version);

  useEffect(() => {
    void window.mongog.system.info()
      .then((info) => setInstalledVersion(info.appVersion))
      .catch(() => undefined);
  }, []);

  return (
    <main
      data-testid="release-notes-view"
      style={{
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        overflow: 'auto',
        background: theme.colors.app,
        color: theme.colors.text,
      }}
    >
      <div style={{ width: 'min(900px, calc(100% - 48px))', margin: '0 auto', padding: '38px 0 58px' }}>
        <header style={{ display: 'grid', gap: 20, marginBottom: 30 }}>
          <MongoGBrand size="compact" testId="release-notes-mongog-brand" />
          <div>
            <div style={{ color: theme.colors.brand, fontSize: 11, fontWeight: 750, letterSpacing: 1.2, textTransform: 'uppercase' }}>
              Product updates
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 12px', marginTop: 7 }}>
              <h1 style={{ margin: 0, fontSize: 29, lineHeight: 1.2 }}>Release Notes</h1>
              <span style={{ border: `1px solid ${theme.colors.borderStrong}`, borderRadius: 999, background: theme.colors.panel, color: theme.colors.textMuted, padding: '4px 9px', fontSize: 10 }}>
                Installed v{installedVersion}
              </span>
            </div>
            <p style={{ maxWidth: 660, margin: '10px 0 0', color: theme.colors.textMuted, fontSize: 13, lineHeight: 1.6 }}>
              See what changed in MongoG. This history is bundled with the application and remains available offline.
            </p>
          </div>
        </header>

        <div aria-label="MongoG release history" style={{ display: 'grid', gap: 16 }}>
          {RELEASE_NOTES.map((release, index) => (
            <article
              key={release.version}
              data-release-version={release.version}
              style={{
                border: `1px solid ${index === 0 ? theme.colors.brand : theme.colors.border}`,
                borderRadius: 9,
                overflow: 'hidden',
                background: theme.colors.panel,
                boxShadow: index === 0 ? '0 8px 28px rgb(0 0 0 / 14%)' : 'none',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 18, padding: '17px 19px', borderBottom: `1px solid ${theme.colors.border}` }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                    <h2 style={{ margin: 0, fontSize: 17 }}>MongoG {release.version}</h2>
                    {index === 0 && (
                      <span style={{ borderRadius: 999, background: theme.colors.brand, color: '#10220e', padding: '3px 8px', fontSize: 9, fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase' }}>
                        Latest
                      </span>
                    )}
                  </div>
                  <strong style={{ display: 'block', marginTop: 6, color: theme.colors.text, fontSize: 12 }}>{release.title}</strong>
                  <p style={{ margin: '6px 0 0', color: theme.colors.textMuted, fontSize: 11, lineHeight: 1.55 }}>{release.summary}</p>
                </div>
                <time dateTime={release.releasedAt} style={{ flexShrink: 0, color: theme.colors.textFaint, fontSize: 10 }}>
                  {formatReleaseDate(release.releasedAt)}
                </time>
              </div>

              <div style={{ display: 'grid', gap: 14, padding: '16px 19px 19px' }}>
                {release.sections.map((section) => {
                  const appearance = sectionAppearance[section.kind];
                  return (
                    <section key={section.kind} aria-label={`${appearance.label} in ${release.version}`}>
                      <span style={{ display: 'inline-flex', borderRadius: 4, background: appearance.background, color: appearance.color, padding: '3px 7px', fontSize: 9, fontWeight: 750, letterSpacing: 0.55, textTransform: 'uppercase' }}>
                        {appearance.label}
                      </span>
                      <ul style={{ display: 'grid', gap: 7, margin: '9px 0 0', paddingLeft: 19, color: theme.colors.textMuted, fontSize: 11, lineHeight: 1.55 }}>
                        {section.items.map((item) => <li key={item}>{item}</li>)}
                      </ul>
                    </section>
                  );
                })}
              </div>
            </article>
          ))}
        </div>
      </div>
    </main>
  );
}

function formatReleaseDate(value: string): string {
  return new Intl.DateTimeFormat('en', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${value}T00:00:00.000Z`));
}
