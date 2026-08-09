import { useDataTransferStore } from '../../stores/data-transfer.js';

export function DataTransferProgressOverlay() {
  const jobsById = useDataTransferStore((state) => state.jobs);
  const jobs = Object.values(jobsById);
  const dismiss = useDataTransferStore((state) => state.dismiss);
  if (jobs.length === 0) return null;
  return (
    <div style={{
      position: 'fixed', right: 16, bottom: 16, zIndex: 4000,
      width: 360, display: 'grid', gap: 8, pointerEvents: 'none',
    }} aria-label="Data transfer jobs">
      {jobs.slice(-3).map((job) => {
        const terminal = job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled';
        return (
          <div key={job.jobId} style={{
            pointerEvents: 'auto', border: '1px solid var(--color-border)', borderRadius: 7,
            background: 'var(--color-panel-raised)', boxShadow: '0 10px 28px rgba(0,0,0,.34)',
            padding: 12, color: 'var(--color-text)', fontSize: 12,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
              <strong>{job.kind === 'file-import' ? 'File import' : 'Connection copy'}</strong>
              <span style={{ color: statusColor(job.status), textTransform: 'capitalize' }}>{job.status}</span>
            </div>
            <div style={{ marginTop: 5, color: 'var(--color-text-muted)' }}>
              {job.datasetName ?? 'Preparing datasets'} · {job.rowsRead.toLocaleString()} read
            </div>
            <div style={{ marginTop: 4, color: 'var(--color-text-faint)' }}>
              {job.inserted.toLocaleString()} inserted · {job.updated.toLocaleString()} updated · {job.skipped.toLocaleString()} skipped
            </div>
            {job.message && <div style={{ marginTop: 6, color: job.status === 'failed' ? 'var(--color-danger)' : 'var(--color-text-muted)' }}>{job.message}</div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
              {!terminal && <button type="button" style={buttonStyle} onClick={() => void window.mongog.dataTransfer.cancel(job.jobId)}>Cancel</button>}
              {job.hasErrorReport && <button type="button" style={buttonStyle} onClick={() => void window.mongog.dataTransfer.saveErrorReport(job.jobId)}>Save error report</button>}
              {terminal && <button type="button" style={buttonStyle} onClick={() => dismiss(job.jobId)}>Dismiss</button>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

const buttonStyle: React.CSSProperties = {
  border: '1px solid var(--color-border)', borderRadius: 4, padding: '4px 8px',
  background: 'var(--color-input)', color: 'var(--color-text)', cursor: 'pointer', fontSize: 11,
};

function statusColor(status: string): string {
  if (status === 'completed') return 'var(--color-success)';
  if (status === 'failed') return 'var(--color-danger)';
  if (status === 'cancelled') return 'var(--color-warning)';
  return 'var(--color-accent)';
}
