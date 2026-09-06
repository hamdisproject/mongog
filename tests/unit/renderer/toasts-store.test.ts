import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_TOAST_DURATION_MS,
  useToastStore,
} from '../../../src/renderer/stores/toasts.js';

describe('toast store', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useToastStore.setState({ notifications: [] });
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    useToastStore.setState({ notifications: [] });
    vi.useRealTimers();
  });

  it('shows a success notification and removes it after three seconds', () => {
    const id = useToastStore.getState().show('Console output copied.');

    expect(useToastStore.getState().notifications).toEqual([
      { id, message: 'Console output copied.', tone: 'success' },
    ]);

    vi.advanceTimersByTime(DEFAULT_TOAST_DURATION_MS - 1);
    expect(useToastStore.getState().notifications).toHaveLength(1);

    vi.advanceTimersByTime(1);
    expect(useToastStore.getState().notifications).toEqual([]);
  });

  it('preserves the error tone and supports early dismissal', () => {
    const id = useToastStore.getState().show('Could not copy console output.', 'error');

    expect(useToastStore.getState().notifications[0]).toMatchObject({ tone: 'error' });
    useToastStore.getState().dismiss(id);
    expect(useToastStore.getState().notifications).toEqual([]);
  });
});
