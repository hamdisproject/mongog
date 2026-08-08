import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AuditBucket,
  AuditFilter,
  AuditListPage,
  AuditLogEntry,
  AuditSummary,
} from '../../../shared/domain/index.js';
import { AUDIT_CATEGORIES, AUDIT_ORIGINS, AUDIT_STATUSES } from '../../../shared/domain/index.js';
import { useConnectionStore } from '../../stores/connections.js';
import { theme } from '../../theme.js';

const PAGE_SIZE = 75;
const EMPTY_PAGE: AuditListPage = { entries: [], total: 0, limit: PAGE_SIZE, offset: 0 };
const EMPTY_SUMMARY: AuditSummary = {
  total: 0,
  reads: 0,
  writes: 0,
  connections: 0,
  errors: 0,
  averageDurationMs: 0,
  byCategory: [],
  byConnection: [],
  timeline: [],
  health: { healthy: true },
};

type ViewMode = 'overview' | 'logs';
type TimeRange = '24h' | '7d' | '30d' | 'all';

export function ActivityLogView() {
  const profiles = useConnectionStore((state) => state.profiles);
  const [view, setView] = useState<ViewMode>('overview');
  const [filter, setFilter] = useState<AuditFilter>({});
  const [timeRange, setTimeRange] = useState<TimeRange>('7d');
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<AuditListPage>(EMPTY_PAGE);
  const [summary, setSummary] = useState<AuditSummary>(EMPTY_SUMMARY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const requestRef = useRef(0);

  const effectiveFilter = useMemo(() => {
    const fromTs = rangeStart(timeRange);
    return { ...filter, ...(fromTs ? { fromTs } : {}) };
  }, [filter, timeRange]);
  const bucket: AuditBucket = timeRange === '24h' ? 'hour' : 'day';

  const load = useCallback(async () => {
    const request = ++requestRef.current;
    setLoading(true);
    setError(null);
    try {
      const [nextPage, nextSummary] = await Promise.all([
        window.mongog.audit.list(effectiveFilter, { limit: PAGE_SIZE, offset }),
        window.mongog.audit.summary(effectiveFilter, bucket),
      ]);
      if (request !== requestRef.current) return;
      setPage(nextPage);
      setSummary(nextSummary);
    } catch (reason) {
      if (request !== requestRef.current) return;
      setError(errorMessage(reason));
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }, [effectiveFilter, offset, bucket]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    let timer: number | undefined;
    const unsubscribe = window.mongog.events.onAuditChanged(() => {
      if (timer !== undefined) window.clearTimeout(timer);
      timer = window.setTimeout(() => void load(), 500);
    });
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
      unsubscribe();
    };
  }, [load]);

  const patchFilter = (partial: Partial<AuditFilter>) => {
    setOffset(0);
    setFilter((current) => compactFilter({ ...current, ...partial }));
  };

  const deleteEntry = async (entry: AuditLogEntry) => {
    if (!window.confirm(`Delete the activity log entry "${entry.action}"?`)) return;
    try {
      await window.mongog.audit.deleteEntry(entry.id);
      if (expandedId === entry.id) setExpandedId(null);
      await load();
    } catch (reason) {
      setError(errorMessage(reason));
    }
  };

  const clearFiltered = async () => {
    if (page.total === 0) return;
    if (!window.confirm(`Permanently delete ${page.total.toLocaleString()} log entries matching the active filters?`)) return;
    try {
      await window.mongog.audit.clear({ scope: 'filtered', filter: effectiveFilter });
      setOffset(0);
      setExpandedId(null);
      await load();
    } catch (reason) {
      setError(errorMessage(reason));
    }
  };

  const clearAll = async () => {
    if (!window.confirm('Permanently delete all MongoDB activity logs? This cannot be undone.')) return;
    try {
      await window.mongog.audit.clear({ scope: 'all' });
      setOffset(0);
      setExpandedId(null);
      await load();
    } catch (reason) {
      setError(errorMessage(reason));
    }
  };

  return (
    <main data-testid="activity-log-view" style={styles.root}>
      <header style={styles.header}>
        <div>
          <div style={styles.eyebrow}>Local observability</div>
          <h1 style={styles.title}>Activity Log</h1>
          <p style={styles.subtitle}>MongoDB operations performed by MongoG, stored only in your local SQLite database.</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button type="button" style={styles.button} onClick={() => void load()} disabled={loading}>Refresh</button>
          <button type="button" style={styles.dangerButton} onClick={() => void clearAll()}>Clear all…</button>
        </div>
      </header>

      {!summary.health.healthy && (
        <div role="alert" style={styles.healthWarning}>
          <strong>Logging degraded.</strong> MongoDB operations continue normally, but some activity may be missing.
          {summary.health.message ? ` ${summary.health.message}` : ''}
        </div>
      )}

      <div style={styles.viewBar}>
        <SegmentButton active={view === 'overview'} onClick={() => setView('overview')}>Overview</SegmentButton>
        <SegmentButton active={view === 'logs'} onClick={() => setView('logs')}>Log table</SegmentButton>
        <span style={{ flex: 1 }} />
        <select
          aria-label="Activity time range"
          value={timeRange}
          onChange={(event) => { setTimeRange(event.target.value as TimeRange); setOffset(0); }}
          style={styles.select}
        >
          <option value="24h">Last 24 hours</option>
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
          <option value="all">All time</option>
        </select>
      </div>

      <FilterBar filter={filter} profiles={profiles} patchFilter={patchFilter} onClear={() => {
        setFilter({}); setTimeRange('7d'); setOffset(0);
      }} />

      {error && <div role="alert" style={styles.error}>{error}</div>}

      <div style={styles.content} aria-busy={loading}>
        {view === 'overview'
          ? <Overview summary={summary} />
          : (
            <LogTable
              page={page}
              expandedId={expandedId}
              setExpandedId={setExpandedId}
              deleteEntry={deleteEntry}
              offset={offset}
              setOffset={setOffset}
              clearFiltered={clearFiltered}
            />
          )}
        {loading && <div style={styles.loading}>Refreshing activity…</div>}
      </div>
    </main>
  );
}

function FilterBar({
  filter,
  profiles,
  patchFilter,
  onClear,
}: {
  filter: AuditFilter;
  profiles: Array<{ id: string; name: string }>;
  patchFilter: (partial: Partial<AuditFilter>) => void;
  onClear: () => void;
}) {
  return (
    <div style={styles.filters}>
      <input
        aria-label="Search activity logs"
        placeholder="Search action, namespace or details"
        value={filter.text ?? ''}
        onChange={(event) => patchFilter({ text: event.target.value || undefined })}
        style={{ ...styles.input, flex: '1 1 230px' }}
      />
      <select aria-label="Filter by connection" value={filter.connectionId ?? ''} onChange={(event) => patchFilter({ connectionId: event.target.value || undefined })} style={styles.select}>
        <option value="">All connections</option>
        {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
      </select>
      <select aria-label="Filter by category" value={filter.category ?? ''} onChange={(event) => patchFilter({ category: (event.target.value || undefined) as AuditFilter['category'] })} style={styles.select}>
        <option value="">All categories</option>
        {AUDIT_CATEGORIES.map((category) => <option key={category} value={category}>{labelize(category)}</option>)}
      </select>
      <select aria-label="Filter by source" value={filter.origin ?? ''} onChange={(event) => patchFilter({ origin: (event.target.value || undefined) as AuditFilter['origin'] })} style={styles.select}>
        <option value="">All sources</option>
        {AUDIT_ORIGINS.map((origin) => <option key={origin} value={origin}>{labelize(origin)}</option>)}
      </select>
      <select aria-label="Filter by status" value={filter.status ?? ''} onChange={(event) => patchFilter({ status: (event.target.value || undefined) as AuditFilter['status'] })} style={styles.select}>
        <option value="">All statuses</option>
        {AUDIT_STATUSES.map((status) => <option key={status} value={status}>{labelize(status)}</option>)}
      </select>
      <input aria-label="Filter by database" placeholder="Database" value={filter.database ?? ''} onChange={(event) => patchFilter({ database: event.target.value || undefined })} style={{ ...styles.input, width: 120 }} />
      <input aria-label="Filter by collection" placeholder="Collection" value={filter.collection ?? ''} onChange={(event) => patchFilter({ collection: event.target.value || undefined })} style={{ ...styles.input, width: 125 }} />
      <input aria-label="Filter by action" placeholder="Exact action" value={filter.action ?? ''} onChange={(event) => patchFilter({ action: event.target.value || undefined })} style={{ ...styles.input, width: 145 }} />
      <button type="button" style={styles.button} onClick={onClear}>Reset</button>
    </div>
  );
}

function Overview({ summary }: { summary: AuditSummary }) {
  const cards = [
    ['Total operations', summary.total, theme.colors.text],
    ['Queries / reads', summary.reads, theme.colors.accentHover],
    ['Writes', summary.writes, theme.colors.warning],
    ['Connections', summary.connections, theme.colors.success],
    ['Errors', summary.errors, theme.colors.danger],
    ['Average duration', formatDuration(summary.averageDurationMs), theme.colors.text],
  ] as const;
  return (
    <div data-testid="activity-overview">
      <div style={styles.cards}>
        {cards.map(([label, value, color]) => (
          <section key={label} style={styles.card}>
            <div style={styles.cardLabel}>{label}</div>
            <div style={{ ...styles.cardValue, color }}>{typeof value === 'number' ? value.toLocaleString() : value}</div>
          </section>
        ))}
      </div>
      <div style={styles.chartGrid}>
        <section style={styles.chartCard}>
          <h2 style={styles.sectionTitle}>Operations over time</h2>
          <TimelineChart points={summary.timeline} />
        </section>
        <section style={styles.chartCard}>
          <h2 style={styles.sectionTitle}>By category</h2>
          <BarList items={summary.byCategory.map((item) => ({ label: labelize(item.key), count: item.count }))} />
        </section>
        <section style={styles.chartCard}>
          <h2 style={styles.sectionTitle}>By connection</h2>
          <BarList items={summary.byConnection.map((item) => ({ label: item.connectionName, count: item.count }))} />
        </section>
      </div>
    </div>
  );
}

function TimelineChart({ points }: { points: AuditSummary['timeline'] }) {
  if (!points.length) return <EmptyState />;
  const max = Math.max(1, ...points.map((point) => point.count));
  return (
    <div style={styles.timeline} aria-label="Operations timeline">
      {points.map((point) => (
        <div key={point.bucketStart} title={`${new Date(point.bucketStart).toLocaleString()}: ${point.count} operations, ${point.errors} errors`} style={{ flex: 1, minWidth: 3, display: 'flex', alignItems: 'flex-end', position: 'relative', height: '100%' }}>
          <span style={{ width: '100%', height: `${Math.max(3, point.count / max * 100)}%`, minHeight: 2, background: theme.colors.accent, borderRadius: '2px 2px 0 0', opacity: 0.84 }} />
          {point.errors > 0 && <span style={{ position: 'absolute', bottom: 0, width: '100%', height: `${Math.max(3, point.errors / max * 100)}%`, background: theme.colors.danger, borderRadius: '2px 2px 0 0' }} />}
        </div>
      ))}
    </div>
  );
}

function BarList({ items }: { items: Array<{ label: string; count: number }> }) {
  if (!items.length) return <EmptyState />;
  const max = Math.max(1, ...items.map((item) => item.count));
  return (
    <div style={{ display: 'grid', gap: 9 }}>
      {items.slice(0, 10).map((item) => (
        <div key={item.label}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 11, marginBottom: 4 }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.label}</span>
            <strong>{item.count.toLocaleString()}</strong>
          </div>
          <div style={{ height: 5, borderRadius: 3, overflow: 'hidden', background: theme.colors.inputSoft }}>
            <div style={{ height: '100%', width: `${item.count / max * 100}%`, background: theme.colors.accent, borderRadius: 3 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function LogTable({
  page,
  expandedId,
  setExpandedId,
  deleteEntry,
  offset,
  setOffset,
  clearFiltered,
}: {
  page: AuditListPage;
  expandedId: string | null;
  setExpandedId: (id: string | null) => void;
  deleteEntry: (entry: AuditLogEntry) => Promise<void>;
  offset: number;
  setOffset: (offset: number) => void;
  clearFiltered: () => Promise<void>;
}) {
  return (
    <section data-testid="activity-log-table" style={styles.tableCard}>
      <div style={styles.tableToolbar}>
        <strong>{page.total.toLocaleString()} entries</strong>
        <span style={{ flex: 1 }} />
        <button type="button" style={styles.dangerButton} disabled={!page.total} onClick={() => void clearFiltered()}>Delete filtered…</button>
      </div>
      <div style={{ overflow: 'auto', minHeight: 0 }}>
        <table style={styles.table}>
          <thead><tr>
            {['Timestamp', 'Status', 'Connection', 'Namespace', 'Action', 'Source', 'Duration', 'Result', ''].map((label) => <th key={label} style={styles.th}>{label}</th>)}
          </tr></thead>
          <tbody>
            {page.entries.map((entry) => {
              const expanded = expandedId === entry.id;
              return (
                <AuditRow key={entry.id} entry={entry} expanded={expanded} onToggle={() => setExpandedId(expanded ? null : entry.id)} onDelete={() => void deleteEntry(entry)} />
              );
            })}
          </tbody>
        </table>
        {!page.entries.length && <EmptyState />}
      </div>
      <div style={styles.pagination}>
        <span>{page.total ? `${offset + 1}–${Math.min(offset + page.entries.length, page.total)} of ${page.total.toLocaleString()}` : 'No entries'}</span>
        <span style={{ flex: 1 }} />
        <button type="button" style={styles.button} disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>Previous</button>
        <button type="button" style={styles.button} disabled={offset + page.entries.length >= page.total} onClick={() => setOffset(offset + PAGE_SIZE)}>Next</button>
      </div>
    </section>
  );
}

function AuditRow({ entry, expanded, onToggle, onDelete }: { entry: AuditLogEntry; expanded: boolean; onToggle: () => void; onDelete: () => void }) {
  const namespace = [entry.database, entry.collection].filter(Boolean).join('.');
  const result = entry.affectedCount ?? entry.resultCount;
  return (
    <>
      <tr data-audit-entry={entry.id} onClick={onToggle} style={{ cursor: 'pointer', background: expanded ? theme.colors.selected : 'transparent' }}>
        <td style={styles.td} title={new Date(entry.startedAt).toISOString()}>{new Date(entry.startedAt).toLocaleString()}</td>
        <td style={styles.td}><StatusBadge status={entry.status} /></td>
        <td style={styles.td}>{entry.connectionName}</td>
        <td style={styles.td} title={namespace}>{namespace || '—'}</td>
        <td style={{ ...styles.td, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{entry.action}</td>
        <td style={styles.td}>{labelize(entry.origin)}</td>
        <td style={styles.td}>{entry.durationMs === undefined ? '—' : formatDuration(entry.durationMs)}</td>
        <td style={styles.td}>{result === undefined ? '—' : result.toLocaleString()}</td>
        <td style={styles.td}><button aria-label={`Delete ${entry.action} log`} type="button" style={styles.iconButton} onClick={(event) => { event.stopPropagation(); onDelete(); }}>×</button></td>
      </tr>
      {expanded && (
        <tr><td colSpan={9} style={styles.detailCell}>
          <div style={styles.detailGrid}>
            <div><span style={styles.detailLabel}>Summary</span>{entry.summary}</div>
            <div><span style={styles.detailLabel}>Category</span>{labelize(entry.category)} · {labelize(entry.operationClass)}</div>
            {entry.correlationId && <div><span style={styles.detailLabel}>Correlation</span><code>{entry.correlationId}</code></div>}
            {entry.errorMessage && <div style={{ color: theme.colors.danger }}><span style={styles.detailLabel}>Error · {entry.errorCategory ?? 'Unknown'}</span>{entry.errorMessage}</div>}
          </div>
          {entry.detail && <pre style={styles.detailPre}>{JSON.stringify(entry.detail, null, 2)}</pre>}
        </td></tr>
      )}
    </>
  );
}

function StatusBadge({ status }: { status: AuditLogEntry['status'] }) {
  const color = status === 'success'
    ? theme.colors.success
    : status === 'running'
      ? theme.colors.accentHover
      : status === 'cancelled'
        ? theme.colors.warning
        : theme.colors.danger;
  return <span style={{ ...styles.badge, color, borderColor: color }}>{labelize(status)}</span>;
}

function SegmentButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return <button type="button" aria-pressed={active} onClick={onClick} style={{ ...styles.segment, ...(active ? styles.segmentActive : {}) }}>{children}</button>;
}

function EmptyState() {
  return <div style={{ minHeight: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', color: theme.colors.textFaint, fontSize: 12 }}>No activity for this filter.</div>;
}

function rangeStart(range: TimeRange): number | undefined {
  const hours = range === '24h' ? 24 : range === '7d' ? 24 * 7 : range === '30d' ? 24 * 30 : 0;
  return hours ? Date.now() - hours * 60 * 60 * 1000 : undefined;
}

function compactFilter(filter: AuditFilter): AuditFilter {
  return Object.fromEntries(Object.entries(filter).filter(([, value]) => value !== undefined && value !== '')) as AuditFilter;
}

function labelize(value: string): string {
  return value.split(/[-.]/).map((part) => part ? part[0]!.toUpperCase() + part.slice(1) : part).join(' ');
}

function formatDuration(ms: number): string {
  if (ms < 1) return `${ms.toFixed(2)} ms`;
  if (ms < 1_000) return `${Math.round(ms)} ms`;
  return `${(ms / 1_000).toFixed(ms < 10_000 ? 2 : 1)} s`;
}

function errorMessage(error: unknown): string {
  return error && typeof error === 'object' && 'message' in error ? String(error.message) : String(error);
}

const styles: Record<string, React.CSSProperties> = {
  root: { flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: theme.colors.app, color: theme.colors.text },
  header: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 20, padding: '24px 28px 17px', borderBottom: `1px solid ${theme.colors.border}`, background: theme.colors.panel },
  eyebrow: { color: theme.colors.success, fontSize: 10, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase' },
  title: { margin: '5px 0 4px', fontSize: 23, fontWeight: 650 },
  subtitle: { margin: 0, color: theme.colors.textMuted, fontSize: 12 },
  healthWarning: { margin: '12px 20px 0', padding: '9px 12px', border: `1px solid ${theme.colors.warning}`, borderRadius: 5, background: theme.colors.inputSoft, color: theme.colors.warning, fontSize: 11 },
  viewBar: { minHeight: 41, display: 'flex', alignItems: 'center', gap: 4, padding: '0 20px', borderBottom: `1px solid ${theme.colors.border}`, background: theme.colors.panelRaised },
  segment: { height: 29, padding: '0 12px', border: '1px solid transparent', borderRadius: 4, background: 'transparent', color: theme.colors.textMuted, cursor: 'pointer', fontSize: 11 },
  segmentActive: { borderColor: theme.colors.borderStrong, background: theme.colors.selected, color: theme.colors.text },
  filters: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 7, padding: '10px 20px', borderBottom: `1px solid ${theme.colors.border}`, background: theme.colors.panel },
  input: { height: 29, boxSizing: 'border-box', border: `1px solid ${theme.colors.borderStrong}`, borderRadius: 4, outline: 0, background: theme.colors.input, color: theme.colors.text, padding: '0 9px', fontSize: 11 },
  select: { height: 29, maxWidth: 190, border: `1px solid ${theme.colors.borderStrong}`, borderRadius: 4, background: theme.colors.input, color: theme.colors.text, padding: '0 8px', fontSize: 11 },
  button: { minHeight: 28, border: `1px solid ${theme.colors.borderStrong}`, borderRadius: 4, background: theme.colors.input, color: theme.colors.text, padding: '0 10px', cursor: 'pointer', fontSize: 11 },
  dangerButton: { minHeight: 28, border: `1px solid ${theme.colors.danger}`, borderRadius: 4, background: 'transparent', color: theme.colors.danger, padding: '0 10px', cursor: 'pointer', fontSize: 11 },
  iconButton: { width: 24, height: 24, border: 0, borderRadius: 3, background: 'transparent', color: theme.colors.textMuted, cursor: 'pointer', fontSize: 17 },
  error: { margin: '10px 20px 0', padding: '8px 10px', borderRadius: 4, background: theme.colors.dangerSurface, color: theme.colors.danger, fontSize: 11 },
  content: { flex: 1, minWidth: 0, minHeight: 0, overflow: 'auto', position: 'relative', padding: 20 },
  loading: { position: 'absolute', right: 28, top: 10, color: theme.colors.textFaint, fontSize: 10 },
  cards: { display: 'grid', gridTemplateColumns: 'repeat(6, minmax(120px, 1fr))', gap: 10 },
  card: { minWidth: 0, padding: '14px 15px', border: `1px solid ${theme.colors.border}`, borderRadius: 6, background: theme.colors.panel },
  cardLabel: { color: theme.colors.textMuted, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.55 },
  cardValue: { marginTop: 8, fontSize: 22, fontWeight: 650, fontVariantNumeric: 'tabular-nums' },
  chartGrid: { marginTop: 12, display: 'grid', gridTemplateColumns: 'minmax(320px, 2fr) repeat(2, minmax(220px, 1fr))', gap: 12 },
  chartCard: { minWidth: 0, minHeight: 240, padding: '15px 16px', border: `1px solid ${theme.colors.border}`, borderRadius: 6, background: theme.colors.panel },
  sectionTitle: { margin: '0 0 15px', fontSize: 12, fontWeight: 600 },
  timeline: { height: 168, display: 'flex', alignItems: 'flex-end', gap: 3, paddingTop: 8, borderBottom: `1px solid ${theme.colors.borderStrong}` },
  tableCard: { minWidth: 0, border: `1px solid ${theme.colors.border}`, borderRadius: 6, background: theme.colors.panel, overflow: 'hidden' },
  tableToolbar: { minHeight: 42, display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px', borderBottom: `1px solid ${theme.colors.border}`, fontSize: 11 },
  table: { width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', fontSize: 11 },
  th: { position: 'sticky', top: 0, zIndex: 1, height: 31, padding: '0 9px', textAlign: 'left', color: theme.colors.textMuted, background: theme.colors.panelRaised, borderBottom: `1px solid ${theme.colors.border}`, fontWeight: 600, whiteSpace: 'nowrap' },
  td: { height: 34, maxWidth: 220, padding: '0 9px', borderBottom: `1px solid ${theme.colors.border}`, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' },
  detailCell: { padding: '12px 18px 15px', borderBottom: `1px solid ${theme.colors.border}`, background: theme.colors.inputSoft },
  detailGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 10, fontSize: 11 },
  detailLabel: { display: 'block', marginBottom: 3, color: theme.colors.textFaint, fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.6 },
  detailPre: { maxHeight: 260, margin: '12px 0 0', padding: 11, overflow: 'auto', border: `1px solid ${theme.colors.border}`, borderRadius: 4, background: theme.colors.app, color: theme.colors.textMuted, fontSize: 10, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
  badge: { display: 'inline-flex', alignItems: 'center', minHeight: 18, padding: '0 6px', border: '1px solid', borderRadius: 10, fontSize: 9, fontWeight: 650 },
  pagination: { minHeight: 40, display: 'flex', alignItems: 'center', gap: 7, padding: '0 12px', borderTop: `1px solid ${theme.colors.border}`, color: theme.colors.textMuted, fontSize: 10 },
};
