import { useEffect, useState } from 'react';
import { useSettingsStore } from '../../stores/settings.js';
import { useWorkspaceStore } from '../../stores/workspace.js';
import type { BsonDisplayMode } from '../../../shared/ejson/index.js';
import { theme, type ThemePreference } from '../../theme.js';
import { LATEST_RELEASE } from '../../release-notes.js';

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

const dataDisplayOptions: Array<{
  id: BsonDisplayMode;
  label: string;
  description: string;
  example: string;
}> = [
  {
    id: 'mongosh',
    label: 'MongoDB Shell',
    description: 'Compass-like values with readable numbers and BSON constructors where needed.',
    example: '{ price: 1492.00, count: 8,\n  createdAt: ISODate("…") }',
  },
  {
    id: 'relaxed',
    label: 'Relaxed EJSON',
    description: 'Human-friendly Extended JSON with native numbers and ISO dates.',
    example: '{ "count": 42,\n  "createdAt": { "$date": "…" } }',
  },
  {
    id: 'canonical',
    label: 'Canonical EJSON',
    description: 'Lossless Extended JSON with an explicit wrapper for every BSON type.',
    example: '{ "count": { "$numberLong": "42" },\n  "_id": { "$oid": "…" } }',
  },
];

const collectionViewOptions = [
  {
    id: 'documents' as const,
    label: 'Documents',
    description: 'Open collections in the table and document editor.',
  },
  {
    id: 'query' as const,
    label: 'Query',
    description: 'Open collections in a namespace-locked query editor.',
  },
];

const tableColumnOrderOptions = [
  {
    id: 'alphabetical' as const,
    label: 'Alphabetical',
    description: 'Keep _id first, then sort the remaining columns alphabetically.',
    example: '_id · amenities · price · sku',
  },
  {
    id: 'document' as const,
    label: 'Database document order',
    description: 'Follow field order in returned documents and append newly discovered fields.',
    example: '_id · sku · price · amenities',
  },
];

const connectionIdleOptions = [
  { value: 15 * 60 * 1000, label: '15 minutes' },
  { value: 30 * 60 * 1000, label: '30 minutes' },
  { value: 60 * 60 * 1000, label: '1 hour' },
  { value: 2 * 60 * 60 * 1000, label: '2 hours' },
  { value: 4 * 60 * 60 * 1000, label: '4 hours' },
  { value: 8 * 60 * 60 * 1000, label: '8 hours' },
  { value: 0, label: 'Never' },
] as const;

export function SettingsView() {
  const {
    settings,
    loaded,
    saving,
    error,
    setTheme,
    setBsonDisplayMode,
    setCollectionDefaults,
    setTableColumnOrder,
    setConnectionIdleTimeout,
    setPageSize,
    setAuditSettings,
  } = useSettingsStore();
  const openActivityLog = useWorkspaceStore((state) => state.openActivityLog);
  const openReleaseNotes = useWorkspaceStore((state) => state.openReleaseNotes);
  const [auditMessage, setAuditMessage] = useState<string | null>(null);
  const [installedVersion, setInstalledVersion] = useState<string>(LATEST_RELEASE.version);
  const [pageSizeDraft, setPageSizeDraft] = useState(String(settings.execution.pageSize));
  const [pageSizeError, setPageSizeError] = useState<string | null>(null);

  useEffect(() => {
    setPageSizeDraft(String(settings.execution.pageSize));
    setPageSizeError(null);
  }, [settings.execution.pageSize]);

  useEffect(() => {
    void window.mongog.system.info()
      .then((info) => setInstalledVersion(info.appVersion))
      .catch(() => undefined);
  }, []);

  const savePageSize = () => {
    const value = Number(pageSizeDraft);
    if (!Number.isInteger(value) || value < 1 || value > 500) {
      setPageSizeError('Page size must be a whole number between 1 and 500.');
      return;
    }
    setPageSizeError(null);
    void setPageSize(value);
  };

  const clearAllLogs = async () => {
    if (!window.confirm('Permanently delete all MongoDB activity logs? This cannot be undone.')) return;
    try {
      const result = await window.mongog.audit.clear({ scope: 'all' });
      setAuditMessage(`${result.deleted.toLocaleString()} activity log entries deleted.`);
    } catch (reason) {
      setAuditMessage(reason && typeof reason === 'object' && 'message' in reason ? String(reason.message) : String(reason));
    }
  };

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
            Personalize MongoG’s appearance and how BSON data is shown. Changes apply immediately and persist across sessions.
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

        <section style={{ marginTop: 18, border: `1px solid ${theme.colors.border}`, borderRadius: 7, background: theme.colors.panel, overflow: 'hidden' }}>
          <div style={{ padding: '15px 17px', borderBottom: `1px solid ${theme.colors.border}` }}>
            <h2 style={{ margin: 0, fontSize: 14 }}>Data display</h2>
            <div style={{ marginTop: 5, color: theme.colors.textMuted, fontSize: 11, lineHeight: 1.45 }}>
              Choose one global BSON format for Documents, Query results, console output, and criteria editors. Stored data remains lossless Canonical EJSON.
            </div>
          </div>

          <div role="radiogroup" aria-label="BSON data display" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, padding: 16 }}>
            {dataDisplayOptions.map((option) => {
              const selected = settings.ejson.defaultMode === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={`${option.label} data display`}
                  disabled={!loaded || saving}
                  onClick={() => void setBsonDisplayMode(option.id)}
                  style={{
                    minWidth: 0, border: `1px solid ${selected ? theme.colors.accentHover : theme.colors.borderStrong}`,
                    borderRadius: 6, background: selected ? theme.colors.selected : theme.colors.input,
                    color: theme.colors.text, padding: 0, overflow: 'hidden', textAlign: 'left',
                    cursor: !loaded || saving ? 'default' : 'pointer', opacity: !loaded ? 0.65 : 1,
                    boxShadow: selected ? `0 0 0 1px ${theme.colors.accentHover}` : 'none',
                  }}
                >
                  <pre aria-hidden="true" style={{ boxSizing: 'border-box', height: 78, margin: 0, padding: '12px 13px', overflow: 'hidden', borderBottom: `1px solid ${theme.colors.border}`, background: theme.colors.app, color: option.id === 'mongosh' ? theme.colors.warning : theme.colors.textMuted, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 10, lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>
                    {option.example}
                  </pre>
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

          <div style={{ padding: '14px 17px 0', borderTop: `1px solid ${theme.colors.border}` }}>
            <strong style={{ display: 'block', fontSize: 12 }}>Table column order</strong>
            <span style={{ display: 'block', marginTop: 4, color: theme.colors.textMuted, fontSize: 10, lineHeight: 1.45 }}>
              Applies to Collection Documents and Query Results. A manually reordered Documents tab keeps its own order until closed.
            </span>
          </div>
          <div
            data-testid="table-column-order-settings"
            role="radiogroup"
            aria-label="Table column order"
            style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10, padding: 16 }}
          >
            {tableColumnOrderOptions.map((option) => {
              const selected = settings.table.columnOrder === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={`${option.label} table column order`}
                  disabled={!loaded || saving}
                  onClick={() => void setTableColumnOrder(option.id)}
                  style={{
                    minWidth: 0, minHeight: 82,
                    border: `1px solid ${selected ? theme.colors.accentHover : theme.colors.borderStrong}`,
                    borderRadius: 6, background: selected ? theme.colors.selected : theme.colors.input,
                    color: theme.colors.text, padding: '11px 12px', textAlign: 'left',
                    cursor: !loaded || saving ? 'default' : 'pointer',
                    boxShadow: selected ? `0 0 0 1px ${theme.colors.accentHover}` : 'none',
                  }}
                >
                  <span style={{ display: 'flex', alignItems: 'flex-start', gap: 9 }}>
                    <span aria-hidden="true" style={{ marginTop: 2, width: 13, height: 13, borderRadius: '50%', border: `1px solid ${selected ? theme.colors.accentHover : theme.colors.borderStrong}`, background: selected ? theme.colors.accent : 'transparent', boxShadow: selected ? `inset 0 0 0 3px ${theme.colors.input}` : 'none', flexShrink: 0 }} />
                    <span style={{ minWidth: 0 }}>
                      <strong style={{ display: 'block', fontSize: 12 }}>{option.label}</strong>
                      <span style={{ display: 'block', marginTop: 4, color: theme.colors.textMuted, fontSize: 10, lineHeight: 1.4 }}>{option.description}</span>
                      <code style={{ display: 'block', marginTop: 7, color: theme.colors.warning, fontSize: 9, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{option.example}</code>
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <section data-testid="collection-defaults-settings" style={{ marginTop: 18, border: `1px solid ${theme.colors.border}`, borderRadius: 7, background: theme.colors.panel, overflow: 'hidden' }}>
          <div style={{ padding: '15px 17px', borderBottom: `1px solid ${theme.colors.border}` }}>
            <h2 style={{ margin: 0, fontSize: 14 }}>Collection &amp; query defaults</h2>
            <div style={{ marginTop: 5, color: theme.colors.textMuted, fontSize: 11, lineHeight: 1.45 }}>
              Choose how newly opened collections start and how many documents each new result page reads.
            </div>
          </div>

          <div role="radiogroup" aria-label="Default collection view" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10, padding: '16px 16px 0' }}>
            {collectionViewOptions.map((option) => {
              const selected = settings.collection.defaultView === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={`${option.label} default collection view`}
                  disabled={!loaded || saving}
                  onClick={() => void setCollectionDefaults({
                    defaultView: option.id,
                    autoExecuteDefaultQuery: option.id === 'query'
                      ? settings.collection.autoExecuteDefaultQuery
                      : false,
                  })}
                  style={{
                    minHeight: 70,
                    border: `1px solid ${selected ? theme.colors.accentHover : theme.colors.borderStrong}`,
                    borderRadius: 6,
                    background: selected ? theme.colors.selected : theme.colors.input,
                    color: theme.colors.text,
                    padding: '12px 13px',
                    textAlign: 'left',
                    cursor: !loaded || saving ? 'default' : 'pointer',
                    boxShadow: selected ? `0 0 0 1px ${theme.colors.accentHover}` : 'none',
                  }}
                >
                  <strong style={{ display: 'block', fontSize: 12 }}>{option.label}</strong>
                  <span style={{ display: 'block', marginTop: 5, color: theme.colors.textMuted, fontSize: 10, lineHeight: 1.45 }}>
                    {option.description}
                  </span>
                </button>
              );
            })}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', alignItems: 'center', gap: '16px 24px', padding: 16 }}>
            <div>
              <strong style={{ display: 'block', fontSize: 12 }}>Run the default query automatically</strong>
              <span style={{ display: 'block', marginTop: 4, color: theme.colors.textMuted, fontSize: 10, lineHeight: 1.45 }}>
                Runs once only when a new collection opens in Query and its connection is already online.
              </span>
            </div>
            <button
              type="button"
              role="switch"
              aria-label="Run default collection query automatically"
              aria-checked={settings.collection.autoExecuteDefaultQuery}
              disabled={!loaded || saving || settings.collection.defaultView !== 'query'}
              onClick={() => void setCollectionDefaults({
                ...settings.collection,
                autoExecuteDefaultQuery: !settings.collection.autoExecuteDefaultQuery,
              })}
              style={{
                position: 'relative', width: 38, height: 21, border: `1px solid ${theme.colors.borderStrong}`,
                borderRadius: 12, padding: 0,
                background: settings.collection.autoExecuteDefaultQuery ? theme.colors.accent : theme.colors.input,
                cursor: !loaded || saving || settings.collection.defaultView !== 'query' ? 'default' : 'pointer',
                opacity: settings.collection.defaultView === 'query' ? 1 : 0.5,
              }}
            >
              <span aria-hidden="true" style={{
                position: 'absolute', top: 3, left: settings.collection.autoExecuteDefaultQuery ? 20 : 3,
                width: 13, height: 13, borderRadius: '50%', background: '#fff', transition: 'left 120ms ease',
              }} />
            </button>

            <div>
              <strong style={{ display: 'block', fontSize: 12 }}>Global page size</strong>
              <span style={{ display: 'block', marginTop: 4, color: theme.colors.textMuted, fontSize: 10, lineHeight: 1.45 }}>
                Used by new Documents cursors, Query result pages and generated collection query limits.
              </span>
              {pageSizeError && <span role="alert" style={{ display: 'block', marginTop: 5, color: theme.colors.danger, fontSize: 10 }}>{pageSizeError}</span>}
            </div>
            <label style={{ display: 'grid', gap: 4, color: theme.colors.textMuted, fontSize: 9 }}>
              PAGE SIZE
              <input
                aria-label="Global page size"
                aria-invalid={pageSizeError !== null}
                type="number"
                min={1}
                max={500}
                step={1}
                value={pageSizeDraft}
                disabled={!loaded || saving}
                onChange={(event) => {
                  setPageSizeDraft(event.target.value);
                  setPageSizeError(null);
                }}
                onBlur={savePageSize}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.currentTarget.blur();
                }}
                style={{
                  width: 112, height: 29, boxSizing: 'border-box',
                  border: `1px solid ${pageSizeError ? theme.colors.danger : theme.colors.borderStrong}`,
                  borderRadius: 4, background: theme.colors.input, color: theme.colors.text, padding: '0 8px',
                }}
              />
            </label>
          </div>
        </section>

        <section data-testid="connection-lifecycle-settings" style={{ marginTop: 18, border: `1px solid ${theme.colors.border}`, borderRadius: 7, background: theme.colors.panel, overflow: 'hidden' }}>
          <div style={{ padding: '15px 17px', borderBottom: `1px solid ${theme.colors.border}` }}>
            <h2 style={{ margin: 0, fontSize: 14 }}>Connection lifecycle</h2>
            <div style={{ marginTop: 5, color: theme.colors.textMuted, fontSize: 11, lineHeight: 1.45 }}>
              Control how long an unused MongoDB connection stays online. Running queries, exports, transfers and live Change Streams are never disconnected as idle.
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', alignItems: 'center', gap: '16px 24px', padding: 17 }}>
            <div>
              <strong style={{ display: 'block', fontSize: 12 }}>Disconnect idle connections after</strong>
              <span style={{ display: 'block', marginTop: 4, color: theme.colors.textMuted, fontSize: 10, lineHeight: 1.45 }}>
                {settings.connection.idleTimeoutMS === 0
                  ? 'Connections remain online until you disconnect them, the app closes or the runtime stops.'
                  : 'Saving a new duration restarts the idle timer for every currently open connection.'}
              </span>
            </div>
            <label style={{ display: 'grid', gap: 4, color: theme.colors.textMuted, fontSize: 9 }}>
              IDLE TIMEOUT
              <select
                aria-label="Disconnect idle connections after"
                value={settings.connection.idleTimeoutMS}
                disabled={!loaded || saving}
                onChange={(event) => void setConnectionIdleTimeout(Number(event.target.value))}
                style={{
                  width: 160, height: 30, boxSizing: 'border-box',
                  border: `1px solid ${theme.colors.borderStrong}`, borderRadius: 4,
                  background: theme.colors.input, color: theme.colors.text, padding: '0 8px',
                }}
              >
                {connectionIdleOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
          </div>
        </section>

        <section data-testid="audit-settings" style={{ marginTop: 18, border: `1px solid ${theme.colors.border}`, borderRadius: 7, background: theme.colors.panel, overflow: 'hidden' }}>
          <div style={{ padding: '15px 17px', borderBottom: `1px solid ${theme.colors.border}` }}>
            <h2 style={{ margin: 0, fontSize: 14 }}>Activity &amp; audit</h2>
            <div style={{ marginTop: 5, color: theme.colors.textMuted, fontSize: 11, lineHeight: 1.45 }}>
              Review MongoDB operations performed by MongoG. Logs stay on this device and never include credentials, document bodies or file paths.
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', alignItems: 'center', gap: '15px 24px', padding: 17 }}>
            <div>
              <strong style={{ display: 'block', fontSize: 12 }}>Retention policy</strong>
              <span style={{ display: 'block', marginTop: 4, color: theme.colors.textMuted, fontSize: 10, lineHeight: 1.45 }}>
                Oldest entries are pruned by age and entry count at startup and periodically while the app is running.
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <label style={{ display: 'grid', gap: 4, color: theme.colors.textMuted, fontSize: 9 }}>
                RETENTION DAYS
                <input
                  key={`audit-days-${settings.audit.retentionDays}`}
                  aria-label="Audit retention days"
                  type="number"
                  min={1}
                  max={36500}
                  defaultValue={settings.audit.retentionDays}
                  disabled={!loaded || saving}
                  onBlur={(event) => void setAuditSettings({ ...settings.audit, retentionDays: Number(event.target.value) })}
                  style={{ width: 112, height: 29, boxSizing: 'border-box', border: `1px solid ${theme.colors.borderStrong}`, borderRadius: 4, background: theme.colors.input, color: theme.colors.text, padding: '0 8px' }}
                />
              </label>
              <label style={{ display: 'grid', gap: 4, color: theme.colors.textMuted, fontSize: 9 }}>
                MAXIMUM ENTRIES
                <input
                  key={`audit-max-${settings.audit.maxEntries}`}
                  aria-label="Maximum audit entries"
                  type="number"
                  min={100}
                  max={1000000}
                  step={100}
                  defaultValue={settings.audit.maxEntries}
                  disabled={!loaded || saving}
                  onBlur={(event) => void setAuditSettings({ ...settings.audit, maxEntries: Number(event.target.value) })}
                  style={{ width: 140, height: 29, boxSizing: 'border-box', border: `1px solid ${theme.colors.borderStrong}`, borderRadius: 4, background: theme.colors.input, color: theme.colors.text, padding: '0 8px' }}
                />
              </label>
            </div>
            <div>
              <strong style={{ display: 'block', fontSize: 12 }}>Activity Log</strong>
              <span style={{ display: 'block', marginTop: 4, color: theme.colors.textMuted, fontSize: 10 }}>
                Explore reports, filter operations, inspect safe details and remove entries.
              </span>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                onClick={openActivityLog}
                style={{ minHeight: 30, border: `1px solid ${theme.colors.accentHover}`, borderRadius: 4, background: theme.colors.accent, color: '#fff', padding: '0 12px', cursor: 'pointer', fontSize: 11 }}
              >
                Open Activity Log
              </button>
              <button
                type="button"
                onClick={() => void clearAllLogs()}
                style={{ minHeight: 30, border: `1px solid ${theme.colors.danger}`, borderRadius: 4, background: 'transparent', color: theme.colors.danger, padding: '0 12px', cursor: 'pointer', fontSize: 11 }}
              >
                Clear All Logs…
              </button>
            </div>
          </div>
          {auditMessage && <div aria-live="polite" style={{ padding: '0 17px 14px', color: theme.colors.textMuted, fontSize: 10 }}>{auditMessage}</div>}
        </section>

        <section data-testid="about-updates-settings" style={{ marginTop: 18, border: `1px solid ${theme.colors.border}`, borderRadius: 7, background: theme.colors.panel, overflow: 'hidden' }}>
          <div style={{ padding: '15px 17px', borderBottom: `1px solid ${theme.colors.border}` }}>
            <h2 style={{ margin: 0, fontSize: 14 }}>About &amp; updates</h2>
            <div style={{ marginTop: 5, color: theme.colors.textMuted, fontSize: 11, lineHeight: 1.45 }}>
              Release history is bundled with MongoG and stays available without an internet connection.
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', alignItems: 'center', gap: '14px 24px', padding: 17 }}>
            <div>
              <strong style={{ display: 'block', fontSize: 12 }}>MongoG {installedVersion}</strong>
              <span style={{ display: 'block', marginTop: 4, color: theme.colors.textMuted, fontSize: 10, lineHeight: 1.45 }}>
                Read what was added, improved and fixed in this and earlier versions.
              </span>
            </div>
            <button
              type="button"
              onClick={openReleaseNotes}
              style={{ minHeight: 30, border: `1px solid ${theme.colors.accentHover}`, borderRadius: 4, background: theme.colors.accent, color: '#fff', padding: '0 12px', cursor: 'pointer', fontSize: 11 }}
            >
              Open Release Notes
            </button>
          </div>
        </section>

        <div aria-live="polite" style={{ minHeight: 20, marginTop: 10, color: error ? theme.colors.danger : theme.colors.textMuted, fontSize: 11 }}>
          {error ? error : saving ? 'Saving settings…' : loaded ? 'Preferences are saved automatically.' : 'Loading settings…'}
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
