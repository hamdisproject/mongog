import { describe, expect, it, vi } from 'vitest';
import { createFrameBatcher, type FrameScheduler } from '../../../src/renderer/engine-event-batcher.js';

function fakeScheduler() {
  const frames = new Map<number, () => void>();
  const timers = new Map<number, () => void>();
  let next = 1;
  const scheduler: FrameScheduler = {
    requestFrame: (callback) => { frames.set(next, callback); return next++; },
    cancelFrame: (handle) => { frames.delete(handle); },
    setTimer: (callback) => { timers.set(next, callback); return next++; },
    clearTimer: (handle) => { timers.delete(handle); },
  };
  const run = (queue: Map<number, () => void>) => [...queue.values()].forEach((callback) => callback());
  return { scheduler, frames, timers, runFrames: () => run(frames), runTimers: () => run(timers) };
}

describe('engine event frame batcher', () => {
  it('applies a burst of events once per frame, in order', () => {
    const fake = fakeScheduler();
    const apply = vi.fn();
    const batcher = createFrameBatcher<number>(apply, fake.scheduler);
    for (let index = 0; index < 1000; index += 1) batcher.push(index);

    expect(apply).not.toHaveBeenCalled();
    expect(fake.frames.size).toBe(1);
    fake.runFrames();
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith(Array.from({ length: 1000 }, (_, index) => index));
    expect(fake.timers.size).toBe(0);
  });

  it('flushes through the timer fallback while frames are paused in a hidden window', () => {
    const fake = fakeScheduler();
    const apply = vi.fn();
    const batcher = createFrameBatcher<string>(apply, fake.scheduler);
    batcher.push('a');
    batcher.push('b');
    fake.runTimers();
    expect(apply).toHaveBeenCalledWith(['a', 'b']);
    expect(fake.frames.size).toBe(0);
  });

  it('starts a new batch after each flush', () => {
    const fake = fakeScheduler();
    const apply = vi.fn();
    const batcher = createFrameBatcher<number>(apply, fake.scheduler);
    batcher.push(1);
    fake.runFrames();
    batcher.push(2);
    expect(fake.frames.size).toBe(1);
    fake.runFrames();
    expect(apply.mock.calls).toEqual([[[1]], [[2]]]);
  });

  it('drops pending events and scheduled callbacks on dispose', () => {
    const fake = fakeScheduler();
    const apply = vi.fn();
    const batcher = createFrameBatcher<number>(apply, fake.scheduler);
    batcher.push(1);
    batcher.dispose();
    expect(fake.frames.size).toBe(0);
    expect(fake.timers.size).toBe(0);
    batcher.flush();
    expect(apply).not.toHaveBeenCalled();
  });
});
