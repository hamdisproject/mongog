import { create } from 'zustand';
import type { UpdateDelivery, UpdatePhase, UpdateStatusPayload } from '../../shared/ipc/index.js';

interface UpdatesState {
  phase: UpdatePhase;
  delivery: UpdateDelivery;
  currentVersion: string | null;
  availableVersion: string | null;
  progress: number | null;
  error: string | null;
  lastCheckedAt: number | null;
  check: () => Promise<void>;
  install: () => Promise<void>;
  dismiss: () => Promise<void>;
  applyPayload: (payload: UpdateStatusPayload) => void;
  reset: () => void;
}

export const useUpdatesStore = create<UpdatesState>()((set) => ({
  phase: 'idle',
  delivery: 'in-app',
  currentVersion: null,
  availableVersion: null,
  progress: null,
  error: null,
  lastCheckedAt: null,

  applyPayload: (payload) => {
    const retainVersion = payload.phase === 'available' || payload.phase === 'downloading' || payload.phase === 'downloaded';
    set((state) => ({
      phase: payload.phase,
      delivery: payload.delivery,
      availableVersion: payload.version ?? (retainVersion ? state.availableVersion : null),
      progress: payload.phase === 'downloading' ? (payload.progress ?? state.progress) : null,
      error: payload.error ?? null,
    }));
  },

  check: async () => {
    set({ phase: 'checking', error: null, progress: null, lastCheckedAt: Date.now() });
    try {
      const result = await window.mongog.updates.check();
      set({
        phase: result.phase,
        delivery: result.delivery,
        availableVersion: result.version ?? null,
        error: result.error ?? null,
        progress: result.progress ?? null,
        currentVersion: result.currentVersion,
      });
    } catch (error) {
      set({ phase: 'error', error: errorMessage(error) });
    }
  },

  install: async () => {
    try {
      await window.mongog.updates.install();
    } catch (error) {
      set({ phase: 'error', error: errorMessage(error) });
    }
  },

  dismiss: async () => {
    set({ phase: 'idle', availableVersion: null, progress: null, error: null });
    try {
      await window.mongog.updates.dismiss();
    } catch {
      // Dismiss is best-effort; the UI is already cleared.
    }
  },

  reset: () => set({
    phase: 'idle',
    delivery: 'in-app',
    currentVersion: null,
    availableVersion: null,
    progress: null,
    error: null,
    lastCheckedAt: null,
  }),
}));

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) return String(error.message);
  return String(error);
}
