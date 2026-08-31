interface QueryWheelZoomOptions {
  isMac: boolean;
  getPreferences: () => { fontSize: number; enabled: boolean };
  setFontSize: (fontSize: number) => void;
}

/** Scoped font zoom: Monaco's built-in wheel zoom also scales unrelated editors. */
export function attachQueryWheelZoom(host: HTMLElement, options: QueryWheelZoomOptions): () => void {
  let accumulatedDelta = 0;
  let lastEventTime = 0;
  const onWheel = (event: WheelEvent) => {
    const modifier = options.isMac
      ? event.metaKey && !event.ctrlKey
      : event.ctrlKey && !event.metaKey;
    if (!modifier || event.altKey || event.shiftKey) {
      accumulatedDelta = 0;
      return;
    }

    // Also suppress browser zoom when this preference is disabled.
    event.preventDefault();
    event.stopPropagation();
    const { fontSize, enabled } = options.getPreferences();
    if (!enabled || !Number.isFinite(event.deltaY) || event.deltaY === 0) {
      accumulatedDelta = 0;
      return;
    }

    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? host.clientHeight : 1);
    if (event.timeStamp - lastEventTime > 150 || Math.sign(delta) !== Math.sign(accumulatedDelta)) {
      accumulatedDelta = 0;
    }
    lastEventTime = event.timeStamp;
    accumulatedDelta += delta;
    // Accumulate fine trackpad movement, but limit each wheel event to one px.
    if (Math.abs(accumulatedDelta) < 40) return;
    const next = Math.max(8, Math.min(72, fontSize - Math.sign(accumulatedDelta)));
    accumulatedDelta = 0;
    if (next !== fontSize) options.setFontSize(next);
  };
  host.addEventListener('wheel', onWheel, { capture: true, passive: false });
  return () => host.removeEventListener('wheel', onWheel, { capture: true });
}
