interface LoadingOverlayProps {
  label: string;
  cancelling?: boolean;
  onCancel: () => void;
}

export function LoadingOverlay({ label, cancelling = false, onCancel }: LoadingOverlayProps) {
  return (
    <div
      className="loading-overlay"
      role="status"
      aria-live="polite"
      aria-label={label}
      data-testid="loading-overlay"
    >
      <div className="loading-overlay-card">
        <span className="loading-overlay-spinner" aria-hidden="true" />
        <span className="loading-overlay-label">{label}</span>
        <button
          type="button"
          className="loading-overlay-cancel"
          disabled={cancelling}
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
