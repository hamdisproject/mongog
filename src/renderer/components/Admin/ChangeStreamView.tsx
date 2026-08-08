import { useEffect, useRef, useState } from 'react';
import type { WorkspaceTab } from '../../../shared/domain/index.js';
import type { EjsonEnvelope } from '../../../shared/ejson/index.js';
import { theme } from '../../theme.js';

const PIPELINE_PRESETS = [
  { label: 'All events', value: '[]' },
  { label: 'Inserts', value: '[\n  { "$match": { "operationType": "insert" } }\n]' },
  { label: 'Updates', value: '[\n  { "$match": { "operationType": { "$in": ["update", "replace"] } } }\n]' },
  { label: 'Deletes', value: '[\n  { "$match": { "operationType": "delete" } }\n]' },
  {
    label: 'Status field changes',
    value: '[\n  {\n    "$match": {\n      "updateDescription.updatedFields.status": { "$exists": true }\n    }\n  }\n]',
  },
] as const;

const ui: Record<string, React.CSSProperties> = {
  root: { flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: theme.colors.app },
  header: { display: 'flex', alignItems: 'center', gap: 10, padding: '9px 13px', borderBottom: `1px solid ${theme.colors.border}`, background: theme.colors.panel },
  body: { flex: 1, minHeight: 0, overflow: 'auto', padding: 16 },
  content: { width: '100%', maxWidth: 1100, margin: '0 auto' },
  card: { border: `1px solid ${theme.colors.border}`, borderRadius: theme.radius, background: theme.colors.panel, padding: 12, marginBottom: 10 },
  textarea: { boxSizing: 'border-box', width: '100%', minHeight: 150, resize: 'vertical', border: `1px solid ${theme.colors.borderStrong}`, borderRadius: theme.radius, background: theme.colors.input, color: theme.colors.text, padding: 9, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12, lineHeight: 1.45 },
  row: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  button: { border: 0, borderRadius: theme.radius, background: theme.colors.accent, color: '#fff', padding: '6px 11px', fontSize: 12, cursor: 'pointer' },
  secondary: { border: `1px solid ${theme.colors.borderStrong}`, borderRadius: theme.radius, background: theme.colors.inputSoft, color: theme.colors.text, padding: '5px 9px', fontSize: 11, cursor: 'pointer' },
  danger: { border: 0, borderRadius: theme.radius, background: 'var(--color-danger-button)', color: '#fff', padding: '6px 11px', fontSize: 12, cursor: 'pointer' },
  select: { border: `1px solid ${theme.colors.borderStrong}`, borderRadius: theme.radius, background: theme.colors.input, color: theme.colors.text, padding: '5px 7px', fontSize: 12 },
  muted: { color: theme.colors.textMuted, fontSize: 11 },
  pre: { margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11, lineHeight: 1.45 },
  status: { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11 },
  stoppedDot: { boxSizing: 'border-box', width: 8, height: 8, borderRadius: '50%', border: `1px solid ${theme.colors.textMuted}`, flexShrink: 0 },
};

export function ChangeStreamView({ tab }: { tab: WorkspaceTab }) {
  const connectionId = tab.connectionId ?? '';
  const database = tab.database ?? '';
  const collection = tab.collection;
  const namespace = collection ? `${database}.${collection}` : database;
  const [pipeline, setPipeline] = useState<string>(PIPELINE_PRESETS[0].value);
  const [fullDocument, setFullDocument] = useState<'default' | 'updateLookup' | 'whenAvailable' | 'required'>('updateLookup');
  const [streamId, setStreamId] = useState<string | null>(null);
  const [events, setEvents] = useState<EjsonEnvelope[]>([]);
  const [error, setError] = useState<string | null>(null);
  const polling = useRef(false);

  useEffect(() => {
    if (!streamId || !connectionId) return;
    let live = true;
    const poll = async () => {
      if (!live || polling.current) return;
      polling.current = true;
      try {
        const result = await window.mongog.admin.pollChangeStream(connectionId, streamId, 50);
        if (result.events.length > 0) {
          setEvents((current) => [...result.events, ...current].slice(0, 250));
        }
        if (result.closed) setStreamId(null);
      } catch (cause) {
        if (live) {
          setError(errorMessage(cause));
          setStreamId(null);
        }
      } finally {
        polling.current = false;
      }
    };
    const timer = window.setInterval(() => void poll(), 1_000);
    void poll();
    return () => {
      live = false;
      window.clearInterval(timer);
      void window.mongog.admin.closeChangeStream(connectionId, streamId).catch(() => undefined);
    };
  }, [connectionId, streamId]);

  const start = async () => {
    if (!connectionId || !database) return;
    setError(null);
    setEvents([]);
    try {
      const result = await window.mongog.admin.startChangeStream({
        connectionId,
        database,
        ...(collection ? { collection } : {}),
        tabId: tab.id,
        pipelineEjson: pipeline,
        fullDocument,
      });
      setStreamId(result.streamId);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };

  const stop = async () => {
    if (!streamId || !connectionId) return;
    await window.mongog.admin.closeChangeStream(connectionId, streamId).catch(() => undefined);
    setStreamId(null);
  };

  if (!connectionId || !database) {
    return <div style={{ padding: 24, color: theme.colors.textMuted }}>The change stream tab is missing its database context.</div>;
  }

  return (
    <div style={ui.root}>
      <div style={ui.header}>
        <strong style={{ fontSize: 13 }}>Change Stream</strong>
        <span style={{ color: 'var(--color-warning-text)', fontFamily: 'monospace', fontSize: 12 }}>{namespace}</span>
        <span style={{ flex: 1 }} />
        <span
          role="status"
          aria-live="polite"
          aria-label={streamId ? 'Change stream live' : 'Change stream stopped'}
          style={{ ...ui.status, color: streamId ? theme.colors.danger : theme.colors.textMuted }}
        >
          {streamId ? (
            <span
              className="change-stream-live-dot"
              data-testid="change-stream-live-dot"
              aria-hidden="true"
            />
          ) : (
            <span style={ui.stoppedDot} aria-hidden="true" />
          )}
          {streamId ? 'Live' : 'Stopped'}
        </span>
      </div>
      <div style={ui.body}>
        <div style={ui.content}>
          <div style={{ ...ui.muted, marginBottom: 10 }}>
            Change streams require a replica set or sharded cluster. Choose a starter filter, adjust it, then start listening.
          </div>
          <div style={ui.card}>
            <div style={{ ...ui.row, marginBottom: 9 }}>
              <span style={ui.muted}>Examples</span>
              {PIPELINE_PRESETS.map((preset) => (
                <button
                  type="button"
                  key={preset.label}
                  style={ui.secondary}
                  disabled={!!streamId}
                  onClick={() => setPipeline(preset.value)}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <label style={{ ...ui.muted, display: 'block', marginBottom: 5 }}>Aggregation pipeline (Extended JSON)</label>
            <textarea
              aria-label="Change stream pipeline"
              style={ui.textarea}
              value={pipeline}
              readOnly={!!streamId}
              spellCheck={false}
              onChange={(event) => setPipeline(event.target.value)}
            />
            <div style={{ ...ui.row, marginTop: 9 }}>
              <label style={ui.muted}>Full document&nbsp;
                <select
                  aria-label="Full document mode"
                  style={ui.select}
                  value={fullDocument}
                  disabled={!!streamId}
                  onChange={(event) => setFullDocument(event.target.value as typeof fullDocument)}
                >
                  <option value="default">default</option>
                  <option value="updateLookup">updateLookup</option>
                  <option value="whenAvailable">whenAvailable</option>
                  <option value="required">required</option>
                </select>
              </label>
              {!streamId ? (
                <button type="button" style={ui.button} onClick={() => void start()}>Start stream</button>
              ) : (
                <button type="button" style={ui.danger} onClick={() => void stop()}>Stop stream</button>
              )}
              {events.length > 0 && (
                <button type="button" style={ui.secondary} onClick={() => setEvents([])}>Clear events</button>
              )}
            </div>
          </div>
          {error && <div role="alert" style={{ ...ui.card, color: theme.colors.danger, borderColor: 'var(--color-danger-button)' }}>{error}</div>}
          {events.length === 0 && streamId && <div style={{ ...ui.card, ...ui.muted }}>Waiting for matching changes…</div>}
          {events.map((event, index) => (
            <div key={`${event.byteSize}:${index}`} style={ui.card}>
              <pre style={ui.pre}>{prettyEnvelope(event)}</pre>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function prettyEnvelope(envelope: EjsonEnvelope): string {
  try {
    return JSON.stringify(JSON.parse(envelope.ejson), null, 2);
  } catch {
    return envelope.ejson;
  }
}

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) return String(error.message);
  return String(error);
}
