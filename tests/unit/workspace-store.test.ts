import { beforeEach, describe, expect, it } from 'vitest';
import type { EngineEvent } from '../../src/shared/domain/index.js';
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.js';

const range = { startLine: 1, startCol: 1, endLine: 1, endCol: 10 };

describe('workspace execution store', () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ tabs: [], activeTabId: null, results: {} });
  });

  it('routes early engine events by run token before execute IPC resolves', () => {
    const store = useWorkspaceStore.getState();
    const tabId = store.createTab('query', 'conn-1');
    useWorkspaceStore.getState().prepareExecution(tabId, 'conn-1', 'run-1');

    const started: EngineEvent = {
      type: 'execution-started',
      executionId: 'exec-1',
      statements: [{ index: 0, range, kind: 'expression' }],
    };
    useWorkspaceStore.getState().applyEngineEvent(
      tabId,
      'conn-1',
      'exec-1',
      'run-1',
      started,
    );

    const execution = useWorkspaceStore.getState().results[tabId]!;
    expect(execution.executionId).toBe('exec-1');
    expect(execution.status).toBe('running');
    expect(execution.statements).toHaveLength(1);
  });

  it('ignores stale events from a previous run in the same tab', () => {
    const tabId = useWorkspaceStore.getState().createTab('query', 'conn-1');
    useWorkspaceStore.getState().prepareExecution(tabId, 'conn-1', 'run-new');

    useWorkspaceStore.getState().applyEngineEvent(
      tabId,
      'conn-1',
      'exec-old',
      'run-old',
      {
        type: 'statement-error',
        index: 0,
        range,
        durationMs: 1,
        error: { category: 'Unknown', message: 'stale' },
      },
    );

    const execution = useWorkspaceStore.getState().results[tabId]!;
    expect(execution.executionId).toBeNull();
    expect(execution.statementErrors).toHaveLength(0);
    expect(execution.status).toBe('starting');
  });

  it('stores document pages and cursor state without flattening the cursor', () => {
    const tabId = useWorkspaceStore.getState().createTab('query', 'conn-1');
    useWorkspaceStore.getState().prepareExecution(tabId, 'conn-1', 'run-1');
    useWorkspaceStore.getState().applyEngineEvent(
      tabId,
      'conn-1',
      'exec-1',
      'run-1',
      {
        type: 'result',
        index: 0,
        range,
        durationMs: 4,
        result: {
          kind: 'documents',
          cursorId: 'cursor-1',
          documents: [{ ejson: '{"n":{"$numberInt":"1"}}', byteSize: 24, truncated: false }],
          pageSize: 1,
          hasMore: true,
        },
      },
    );

    useWorkspaceStore.getState().updateDocumentPage(tabId, 'cursor-1', {
      documents: [{ ejson: '{"n":{"$numberInt":"2"}}', byteSize: 24, truncated: false }],
      hasMore: false,
      pageIndex: 1,
      retainedBytes: 48,
    });
    useWorkspaceStore.getState().markCursorClosed(tabId, 'cursor-1');

    const item = useWorkspaceStore.getState().results[tabId]!.statementResults[0]!;
    expect(item.result.kind).toBe('documents');
    if (item.result.kind === 'documents') {
      expect(item.result.documents[0]!.ejson).toContain('"2"');
      expect(item.result.hasMore).toBe(false);
    }
    expect(item.pageIndex).toBe(1);
    expect(item.cursorClosed).toBe(true);
  });

  it('records completion status and duration', () => {
    const tabId = useWorkspaceStore.getState().createTab('query', 'conn-1');
    useWorkspaceStore.getState().prepareExecution(tabId, 'conn-1', 'run-1');
    useWorkspaceStore.getState().applyEngineEvent(
      tabId,
      'conn-1',
      'exec-1',
      'run-1',
      { type: 'execution-finished', status: 'completed', durationMs: 12.5 },
    );

    const execution = useWorkspaceStore.getState().results[tabId]!;
    expect(execution.status).toBe('completed');
    expect(execution.durationMs).toBe(12.5);
  });

  it('fails only active executions owned by a stopped connection', () => {
    const first = useWorkspaceStore.getState().createTab('query', 'conn-1');
    const second = useWorkspaceStore.getState().createTab('query', 'conn-2');
    useWorkspaceStore.getState().prepareExecution(first, 'conn-1', 'run-1');
    useWorkspaceStore.getState().prepareExecution(second, 'conn-2', 'run-2');

    useWorkspaceStore.getState().failExecutionsForConnection('conn-1', 'runtime stopped');

    expect(useWorkspaceStore.getState().results[first]).toMatchObject({
      status: 'error',
      error: 'runtime stopped',
      runningStatementIndex: null,
    });
    expect(useWorkspaceStore.getState().results[second]?.status).toBe('starting');
  });
});
