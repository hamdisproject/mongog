import { useExportJobsStore } from '../../stores/exports.js';
import { useToastStore } from '../../stores/toasts.js';

const panel: React.CSSProperties = {
  position: 'fixed', right: 16, bottom: 16, width: 340, maxWidth: 'calc(100vw - 32px)',
  display: 'flex', flexDirection: 'column', gap: 8, zIndex: 1200, pointerEvents: 'none',
};

export function ExportProgressOverlay() {
  const jobs = useExportJobsStore((state) => state.jobs);
  const notifications = useToastStore((state) => state.notifications);
  const cancel = useExportJobsStore((state) => state.cancel);
  const dismiss = useExportJobsStore((state) => state.dismiss);
  const visible = Object.values(jobs).slice(-4);
  if (visible.length === 0 && notifications.length === 0) return null;
  return (
    <div style={panel} aria-live="polite">
      {visible.map((job) => {
        const terminal = job.status !== 'running';
        const color = job.status === 'completed'
          ? 'var(--color-success-text)'
          : job.status === 'error'
            ? 'var(--color-danger)'
            : 'var(--color-text)';
        const progress = job.totalRows && job.totalRows > 0
          ? Math.min(100, Math.round((job.processedRows / job.totalRows) * 100))
          : null;
        return (
          <div key={job.jobId} style={notificationCardStyle}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <strong style={{ color, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {job.filename}
              </strong>
              <span style={{ marginLeft: 'auto', color: 'var(--color-text-muted)', textTransform: 'capitalize' }}>
                {job.status === 'running' ? job.phase : job.status}
              </span>
            </div>
            <div style={{ marginTop: 6, color: 'var(--color-text-muted)' }}>
              {job.processedRows.toLocaleString()} row(s){progress === null ? '' : ` · ${progress}%`}
              {job.warningCount > 0 ? ` · ${job.warningCount.toLocaleString()} warning(s)` : ''}
            </div>
            {job.status === 'running' && (
              <div style={{ height: 3, marginTop: 7, background: 'var(--color-input-soft)', overflow: 'hidden' }}>
                <div style={{
                  height: '100%', width: progress === null ? '35%' : `${progress}%`,
                  background: 'var(--color-accent)', transition: 'width .2s ease',
                }} />
              </div>
            )}
            {job.message && <div style={{ marginTop: 6, color }}>{job.message}</div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 7 }}>
              {terminal ? (
                <button style={buttonStyle} onClick={() => dismiss(job.jobId)}>Dismiss</button>
              ) : (
                <button style={buttonStyle} onClick={() => void cancel(job.jobId)}>Cancel</button>
              )}
            </div>
          </div>
        );
      })}
      {notifications.map((notification) => (
        <div
          key={notification.id}
          data-testid="toast-notification"
          role={notification.tone === 'error' ? 'alert' : 'status'}
          aria-atomic="true"
          style={{
            ...notificationCardStyle,
            color: notification.tone === 'error'
              ? 'var(--color-danger)'
              : 'var(--color-success-text)',
          }}
        >
          <strong>{notification.message}</strong>
        </div>
      ))}
    </div>
  );
}

const notificationCardStyle: React.CSSProperties = {
  pointerEvents: 'auto', padding: '10px 12px', borderRadius: 4,
  border: '1px solid var(--color-border-strong)', background: 'var(--color-panel-raised)',
  boxShadow: '0 8px 30px rgba(0,0,0,.35)', fontSize: 11,
};

const buttonStyle: React.CSSProperties = {
  border: '1px solid var(--color-border-strong)', background: 'var(--color-input-soft)',
  color: 'var(--color-text)', borderRadius: 2, padding: '3px 9px', cursor: 'pointer', fontSize: 11,
};
