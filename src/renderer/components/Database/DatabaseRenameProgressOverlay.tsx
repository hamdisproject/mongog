import { useDatabaseRenameJobsStore } from '../../stores/database-renames.js';

export function DatabaseRenameProgressOverlay() {
  const jobs = Object.values(useDatabaseRenameJobsStore((state) => state.jobs));
  const dismiss = useDatabaseRenameJobsStore((state) => state.dismiss);
  if (jobs.length === 0) return null;
  return (
    <div style={styles.root} aria-label="Database rename jobs">
      {jobs.slice(-3).map((job) => {
        const terminal = job.status === 'completed' || job.status === 'failed';
        return (
          <div key={job.jobId} style={styles.card}>
            <div style={styles.header}>
              <strong>Database rename</strong>
              <span style={{ color: job.status === 'failed' ? 'var(--color-danger)' : job.status === 'completed' ? 'var(--color-success)' : 'var(--color-accent)', textTransform: 'capitalize' }}>
                {job.status}
              </span>
            </div>
            <div style={styles.muted}>{job.sourceDatabase} → {job.targetDatabase}</div>
            <div style={styles.faint}>
              {job.currentCollection ? `${job.currentCollection} · ` : ''}{job.movedCount}/{job.collectionCount} collections moved
            </div>
            {job.message && <div style={{ ...styles.message, ...(job.status === 'failed' ? { color: 'var(--color-danger)' } : {}) }}>{job.message}</div>}
            {job.warning && <div style={{ ...styles.message, color: 'var(--color-warning)' }}>{job.warning}</div>}
            {job.status === 'failed' && job.movedCollections && job.movedCollections.length > 0 && (
              <div style={styles.report}>Moved: {summarize(job.movedCollections)}</div>
            )}
            {job.status === 'failed' && job.remainingCollections && job.remainingCollections.length > 0 && (
              <div style={styles.report}>Remaining: {summarize(job.remainingCollections)}</div>
            )}
            {terminal && (
              <div style={styles.actions}>
                <button type="button" style={styles.button} onClick={() => dismiss(job.jobId)}>Dismiss</button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function summarize(values: string[]): string {
  const visible = values.slice(0, 6);
  return `${visible.join(', ')}${values.length > visible.length ? ` (+${values.length - visible.length} more)` : ''}`;
}

const styles: Record<string, React.CSSProperties> = {
  root: { position: 'fixed', right: 16, bottom: 16, zIndex: 4100, width: 380, display: 'grid', gap: 8, pointerEvents: 'none' },
  card: { pointerEvents: 'auto', border: '1px solid var(--color-border)', borderRadius: 7, background: 'var(--color-panel-raised)', boxShadow: '0 10px 28px rgba(0,0,0,.34)', padding: 12, color: 'var(--color-text)', fontSize: 12 },
  header: { display: 'flex', justifyContent: 'space-between', gap: 10 },
  muted: { marginTop: 5, color: 'var(--color-text-muted)' },
  faint: { marginTop: 4, color: 'var(--color-text-faint)' },
  message: { marginTop: 6, color: 'var(--color-text-muted)', lineHeight: 1.4 },
  report: { marginTop: 5, color: 'var(--color-text-faint)', overflowWrap: 'anywhere' },
  actions: { display: 'flex', justifyContent: 'flex-end', marginTop: 8 },
  button: { border: '1px solid var(--color-border)', borderRadius: 4, padding: '4px 8px', background: 'var(--color-input)', color: 'var(--color-text)', cursor: 'pointer', fontSize: 11 },
};
