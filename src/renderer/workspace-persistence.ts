import type { WorkspaceTab } from '../shared/domain/index.js';
import { workspaceSaveSchema } from '../shared/ipc/index.js';

export interface PersistedWorkspaceInput {
  tabs: WorkspaceTab[];
  activeTabId: string | null;
  sidebarWidth: number;
}

/**
 * Exactly what main stores: the save schema strips renderer-only tab fields
 * (column order, page size, criteria visibility…). When only those change,
 * a save would serialize every editor buffer and write SQLite for nothing.
 * Null means main would reject the state, so the caller still saves.
 */
export function persistedWorkspaceFingerprint(state: PersistedWorkspaceInput): string | null {
  const parsed = workspaceSaveSchema.safeParse({ state });
  return parsed.success ? JSON.stringify(parsed.data) : null;
}
