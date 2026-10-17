/**
 * Coalesces bursts of engine events (a script printing in a loop sends one IPC
 * message per console entry) into one flush per animation frame, so the store
 * update and React render happen once per frame instead of once per event.
 * A timer fallback keeps events flowing while a hidden window pauses frames.
 */

export interface FrameScheduler {
  requestFrame(callback: () => void): number;
  cancelFrame(handle: number): void;
  setTimer(callback: () => void, ms: number): number;
  clearTimer(handle: number): void;
}

export interface FrameBatcher<T> {
  push(item: T): void;
  flush(): void;
  dispose(): void;
}

const browserScheduler: FrameScheduler = {
  requestFrame: (callback) => requestAnimationFrame(() => callback()),
  cancelFrame: (handle) => cancelAnimationFrame(handle),
  setTimer: (callback, ms) => window.setTimeout(callback, ms),
  clearTimer: (handle) => window.clearTimeout(handle),
};

export function createFrameBatcher<T>(
  apply: (items: T[]) => void,
  scheduler: FrameScheduler = browserScheduler,
  fallbackMs = 100,
): FrameBatcher<T> {
  let queue: T[] = [];
  let frame: number | null = null;
  let timer: number | null = null;

  const cancelScheduled = () => {
    if (frame !== null) scheduler.cancelFrame(frame);
    if (timer !== null) scheduler.clearTimer(timer);
    frame = null;
    timer = null;
  };

  const flush = () => {
    cancelScheduled();
    if (queue.length === 0) return;
    const items = queue;
    queue = [];
    apply(items);
  };

  return {
    push(item) {
      queue.push(item);
      if (frame !== null) return;
      frame = scheduler.requestFrame(flush);
      timer = scheduler.setTimer(flush, fallbackMs);
    },
    flush,
    dispose() {
      cancelScheduled();
      queue = [];
    },
  };
}
