import { create } from 'zustand';
import type { DatabaseRenameProgressEvent } from '../../shared/domain/index.js';

interface DatabaseRenameJobsState {
  jobs: Record<string, DatabaseRenameProgressEvent>;
  apply: (event: DatabaseRenameProgressEvent) => void;
  dismiss: (jobId: string) => void;
  failConnection: (connectionId: string, message: string) => void;
}

export const useDatabaseRenameJobsStore = create<DatabaseRenameJobsState>()((set) => ({
  jobs: {},
  apply: (event) => set((state) => ({ jobs: { ...state.jobs, [event.jobId]: event } })),
  dismiss: (jobId) => set((state) => {
    const jobs = { ...state.jobs };
    delete jobs[jobId];
    return { jobs };
  }),
  failConnection: (connectionId, message) => set((state) => {
    const jobs = { ...state.jobs };
    for (const [jobId, job] of Object.entries(jobs)) {
      if (job.connectionId !== connectionId || isTerminal(job.status)) continue;
      jobs[jobId] = {
        ...job,
        status: 'failed',
        message,
        remainingCollections: job.remainingCollections ?? [],
      };
    }
    return { jobs };
  }),
}));

export function isDatabaseRenameActive(connectionId: string): boolean {
  return Object.values(useDatabaseRenameJobsStore.getState().jobs).some((job) => (
    job.connectionId === connectionId && !isTerminal(job.status)
  ));
}

function isTerminal(status: DatabaseRenameProgressEvent['status']): boolean {
  return status === 'completed' || status === 'failed';
}
