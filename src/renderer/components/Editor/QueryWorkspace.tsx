import { useWorkspaceStore } from '../../stores/workspace.js';
import { ResultsPanel } from '../Results/ResultsPanel.js';
import { QueryEditor } from './QueryEditor.js';

export function QueryWorkspace({ contextLocked = false }: { contextLocked?: boolean }) {
  const showResults = useWorkspaceStore((state) => {
    const execution = state.activeTabId ? state.results[state.activeTabId] : undefined;
    if (!execution) return false;

    return execution.status !== 'idle' ||
      execution.statementResults.length > 0 ||
      execution.statementErrors.length > 0 ||
      execution.consoleEntries.length > 0 ||
      execution.skippedStatements.length > 0 ||
      execution.error !== null;
  });

  return (
    <div
      data-testid="query-workspace"
      style={{
        display: 'flex', flex: 1, flexDirection: 'column', width: '100%', height: '100%',
        minWidth: 0, minHeight: 0, overflow: 'hidden',
      }}
    >
      <div style={{ display: 'flex', flex: 1, width: '100%', minWidth: 0, minHeight: 0, overflow: 'hidden' }}>
        <QueryEditor contextLocked={contextLocked} />
      </div>
      {showResults && (
        <div
          data-testid="query-results-region"
          style={{ width: '100%', minWidth: 0, height: '40%', minHeight: 120, overflow: 'hidden', flexShrink: 0 }}
        >
          <ResultsPanel />
        </div>
      )}
    </div>
  );
}
