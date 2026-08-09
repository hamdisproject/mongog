import { create } from 'zustand';
import type { DataJobProgressEvent } from '../../shared/domain/index.js';

export interface DataTransferLaunchContext {
  mode?: 'file-import' | 'connection-copy';
  sourceConnectionId?: string;
  targetConnectionId?: string;
  sourceDatabase?: string;
  sourceCollection?: string;
  filterSource?: string;
}

interface DataTransferState {
  launch: DataTransferLaunchContext;
  launchVersion: number;
  jobs: Record<string, DataJobProgressEvent>;
  open: (context?: DataTransferLaunchContext) => void;
  applyProgress: (event: DataJobProgressEvent) => void;
  dismiss: (jobId: string) => void;
  failConnection: (connectionId: string, message: string) => void;
}

export const useDataTransferStore = create<DataTransferState>()((set) => ({
  launch: {},
  launchVersion: 0,
  jobs: {},
  open: (context = {}) => {
    set((state) => ({ launch: context, launchVersion: state.launchVersion + 1 }));
    void import('./workspace.js').then(({ useWorkspaceStore }) => {
      useWorkspaceStore.getState().openDataTransfer();
    });
  },
  applyProgress: (event) => set((state) => ({
    jobs: { ...state.jobs, [event.jobId]: event },
  })),
  dismiss: (jobId) => set((state) => {
    const jobs = { ...state.jobs };
    delete jobs[jobId];
    return { jobs };
  }),
  failConnection: (connectionId, message) => set((state) => {
    const jobs = { ...state.jobs };
    for (const [jobId, job] of Object.entries(jobs)) {
      if (!job.connectionIds.includes(connectionId) || isTerminal(job.status)) continue;
      jobs[jobId] = { ...job, status: 'failed', phase: 'finalizing', message };
    }
    return { jobs };
  }),
}));

function isTerminal(status: DataJobProgressEvent['status']): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}
