import { useEffect, useState } from 'react';
import { useUpdatesStore } from '../../stores/updates.js';
import { useWorkspaceStore } from '../../stores/workspace.js';
import { theme } from '../../theme.js';
import { MongoGBrand } from '../Brand/MongoGBrand.js';
import { LATEST_RELEASE } from '../../release-notes.js';
import { MONGOG_RELEASES_URL } from '../../../shared/ipc/index.js';

export function UpdatesView() {
  const {
    phase,
    delivery,
    currentVersion,
    availableVersion,
    progress,
    error,
    lastCheckedAt,
    check,
    install,
    dismiss,
  } = useUpdatesStore();
  const openReleaseNotes = useWorkspaceStore((state) => state.openReleaseNotes);
  const [installedVersion, setInstalledVersion] = useState<string>(LATEST_RELEASE.version);

  useEffect(() => {
    void window.mongog.system.info()
      .then((info) => setInstalledVersion(info.appVersion))
      .catch(() => undefined);
  }, []);

  const downloadLabel = phase === 'downloaded'
    ? 'Restart & Install'
    : phase === 'downloading'
      ? 'Downloading…'
      : 'Download now';

  return (
    <main
      data-testid="updates-view"
      style={{
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        overflow: 'auto',
        background: theme.colors.app,
        color: theme.colors.text,
      }}
    >
      <div style={{ width: 'min(760px, calc(100% - 48px))', margin: '0 auto', padding: '38px 0 58px' }}>
        <header style={{ display: 'grid', gap: 20, marginBottom: 30 }}>
          <MongoGBrand size="compact" testId="updates-mongog-brand" />
          <div>
            <div style={{ color: theme.colors.brand, fontSize: 11, fontWeight: 750, letterSpacing: 1.2, textTransform: 'uppercase' }}>
              Application software
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 12px', marginTop: 7 }}>
              <h1 style={{ margin: 0, fontSize: 29, lineHeight: 1.2 }}>Updates</h1>
              <span style={{ border: `1px solid ${theme.colors.borderStrong}`, borderRadius: 999, background: theme.colors.panel, color: theme.colors.textMuted, padding: '4px 9px', fontSize: 10 }}>
                Installed v{installedVersion}
              </span>
            </div>
            <p style={{ maxWidth: 640, margin: '10px 0 0', color: theme.colors.textMuted, fontSize: 13, lineHeight: 1.6 }}>
              {delivery === 'website'
                ? 'Check for new MongoG versions here, then download Windows releases from mongog.com.'
                : 'Check for new MongoG versions and install them here. Downloading and installing requires an internet connection; you will be asked to restart the app once the download finishes.'}
            </p>
          </div>
        </header>

        <section
          style={{
            border: `1px solid ${theme.colors.border}`,
            borderRadius: 9,
            overflow: 'hidden',
            background: theme.colors.panel,
          }}
        >
          <div style={{ padding: '17px 19px', borderBottom: `1px solid ${theme.colors.border}` }}>
            <h2 style={{ margin: 0, fontSize: 14 }}>Status</h2>
          </div>
          <div style={{ padding: 19 }}>
            <StatusLine phase={phase} delivery={delivery} availableVersion={availableVersion} error={error} />
            {delivery === 'in-app' && phase === 'downloading' && progress != null && (
              <div style={{ marginTop: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: theme.colors.textMuted, fontSize: 10, marginBottom: 5 }}>
                  <span>Downloading update…</span>
                  <span>{Math.round(progress)}%</span>
                </div>
                <div style={{ height: 6, borderRadius: 999, background: theme.colors.selected, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${Math.max(0, Math.min(100, progress))}%`, background: theme.colors.accent, borderRadius: 999 }} />
                </div>
              </div>
            )}

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 18 }}>
              <button
                type="button"
                onClick={() => void check()}
                disabled={phase === 'checking' || phase === 'downloading'}
                style={buttonStyle({ secondary: true })}
              >
                {phase === 'checking' ? 'Checking…' : 'Check for updates'}
              </button>

              {delivery === 'in-app' && canUpdate(phase) && availableVersion && (
                <button
                  type="button"
                  onClick={() => void install()}
                  disabled={phase === 'downloading'}
                  style={buttonStyle({ accent: true })}
                >
                  {downloadLabel}
                </button>
              )}

              {delivery === 'website' && phase === 'available' && availableVersion && (
                <a
                  href={MONGOG_RELEASES_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    ...buttonStyle({ accent: true }),
                    display: 'inline-flex',
                    alignItems: 'center',
                    textDecoration: 'none',
                    boxSizing: 'border-box',
                  }}
                >
                  Download from mongog.com
                </a>
              )}

              {availableVersion && phase !== 'downloaded' && phase !== 'downloading' && (
                <button
                  type="button"
                  onClick={() => void dismiss()}
                  style={buttonStyle({ secondary: true })}
                >
                  Remind me later
                </button>
              )}
            </div>

            {lastCheckedAt != null && (
              <div style={{ marginTop: 14, color: theme.colors.textFaint, fontSize: 10 }}>
                Last checked {formatRelative(lastCheckedAt)}
              </div>
            )}
          </div>
        </section>

        {availableVersion && (
          <section style={{ marginTop: 18, border: `1px solid ${theme.colors.border}`, borderRadius: 9, overflow: 'hidden', background: theme.colors.panel }}>
            <div style={{ padding: '15px 19px', borderBottom: `1px solid ${theme.colors.border}` }}>
              <h2 style={{ margin: 0, fontSize: 14 }}>What's new in v{availableVersion}</h2>
            </div>
            <div style={{ padding: 17 }}>
              <div style={{ color: theme.colors.textMuted, fontSize: 11, lineHeight: 1.6 }}>
                Release notes are bundled with MongoG. If the latest bundled notes are older than the
                installed version, open the release history below.
              </div>
              <button
                type="button"
                onClick={openReleaseNotes}
                style={buttonStyle({ secondary: true })}
              >
                Open Release Notes
              </button>
            </div>
          </section>
        )}

        {currentVersion && availableVersion && currentVersion !== availableVersion && (
          <div style={{ marginTop: 18, color: theme.colors.textFaint, fontSize: 10, textAlign: 'center' }}>
            Installed v{currentVersion} · available v{availableVersion}
          </div>
        )}
      </div>
    </main>
  );
}

function canUpdate(phase: string): boolean {
  return phase === 'available' || phase === 'downloaded' || phase === 'downloading';
}

function StatusLine({
  phase,
  delivery,
  availableVersion,
  error,
}: {
  phase: string;
  delivery: 'in-app' | 'website';
  availableVersion: string | null;
  error: string | null;
}) {
  let text: string;
  let color: string = theme.colors.textMuted;
  switch (phase) {
    case 'checking':
      text = 'Checking for updates…';
      break;
    case 'up-to-date':
      color = theme.colors.success;
      text = 'You are up to date.';
      break;
    case 'available':
      color = theme.colors.accentHover;
      text = availableVersion
        ? `A new version (v${availableVersion}) is available.`
        : 'A new version is available.';
      break;
    case 'downloading':
      text = 'Downloading the update…';
      break;
    case 'downloaded':
      color = theme.colors.success;
      text = 'Download finished. Restart the app to install.';
      break;
    case 'not-supported':
      text = delivery === 'website'
        ? 'In-app updates are disabled on Windows. Check mongog.com for the latest release.'
        : 'Automatic updates are not available for this build. Check the website for the latest release.';
      break;
    case 'error':
      color = theme.colors.danger;
      text = error ?? 'An error occurred while checking for updates.';
      break;
    default:
      text = 'Press “Check for updates” to see if a newer version is available.';
  }
  return <div style={{ color, fontSize: 13 }}>{text}</div>;
}

function formatRelative(timestamp: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function buttonStyle({ accent, secondary }: { accent?: boolean; secondary?: boolean } = {}): React.CSSProperties {
  if (accent) {
    return {
      minHeight: 30,
      border: `1px solid ${theme.colors.accentHover}`,
      borderRadius: 4,
      background: theme.colors.accent,
      color: '#fff',
      padding: '0 12px',
      cursor: 'pointer',
      fontSize: 11,
    };
  }
  return {
    minHeight: 30,
    border: `1px solid ${theme.colors.borderStrong}`,
    borderRadius: 4,
    background: 'transparent',
    color: theme.colors.text,
    padding: '0 12px',
    cursor: 'pointer',
    fontSize: 11,
    ...(secondary ? {} : {}),
  };
}
