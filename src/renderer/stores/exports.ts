import { create } from 'zustand';
import type { ExportProgressEvent, ExportStartResult } from '../../shared/domain/index.js';

interface ExportJobsState {
  jobs: Record<string, ExportProgressEvent>;
  apply: (event: ExportProgressEvent) => void;
  register: (connectionId: string, result: ExportStartResult) => void;
  dismiss: (jobId: string) => void;
  failConnection: (connectionId: string, message: string) => void;
  cancel: (jobId: string) => Promise<void>;
}

export const useExportJobsStore = create<ExportJobsState>()((set, get) => ({
  jobs: {},
  apply: (event) => set((state) => ({ jobs: { ...state.jobs, [event.jobId]: event } })),
  register: (connectionId, result) => {
    if (result.cancelled || get().jobs[result.jobId]) return;
    set((state) => ({
      jobs: {
        ...state.jobs,
        [result.jobId]: {
          jobId: result.jobId,
          connectionId,
          status: 'running',
          phase: 'preparing',
          processedRows: 0,
          filename: result.filename,
          warningCount: 0,
        },
      },
    }));
  },
  dismiss: (jobId) => set((state) => {
    const jobs = { ...state.jobs };
    delete jobs[jobId];
    return { jobs };
  }),
  failConnection: (connectionId, message) => set((state) => ({
    jobs: Object.fromEntries(Object.entries(state.jobs).map(([jobId, job]) => [
      jobId,
      job.connectionId === connectionId && job.status === 'running'
        ? { ...job, status: 'error' as const, phase: 'finalizing' as const, message }
        : job,
    ])),
  })),
  cancel: async (jobId) => {
    const job = get().jobs[jobId];
    if (!job || job.status !== 'running') return;
    await window.mongog.exports.cancel(job.connectionId, jobId);
  },
}));

