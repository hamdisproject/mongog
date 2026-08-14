import { useWorkspaceStore } from './stores/workspace.js';

/** Shared by Escape, the editor toolbar, and the results loading overlay. */
export async function cancelQueryExecution(tabId: string): Promise<void> {
  const store = useWorkspaceStore.getState();
  const current = store.results[tabId];
  if (!current || !['starting', 'running', 'cancelling'].includes(current.status)) return;

  store.requestCancellation(tabId);
  if (!current.executionId || !current.connectionId) return;

  try {
    await window.mongog.query.cancel(current.connectionId, current.executionId);
  } catch (error) {
    useWorkspaceStore.getState().failExecution(
      tabId,
      current.runId ?? '',
      errorMessage(error),
    );
  }
}

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}
