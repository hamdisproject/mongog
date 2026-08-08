import { useRef, useState } from 'react';
import { useWorkspaceStore } from '../../stores/workspace.js';
import { theme } from '../../theme.js';
import { ResultsPanel } from '../Results/ResultsPanel.js';
import { QueryEditor } from './QueryEditor.js';

export function QueryWorkspace({ contextLocked = false }: { contextLocked?: boolean }) {
  const workspaceRef = useRef<HTMLDivElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const [resultsHeight, setResultsHeight] = useState<number | null>(null);
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

  const beginResize = (event: React.PointerEvent) => {
    event.preventDefault();
    const workspace = workspaceRef.current;
    const results = resultsRef.current;
    if (!workspace || !results) return;
    const startY = event.clientY;
    const startHeight = results.getBoundingClientRect().height;
    const availableHeight = workspace.getBoundingClientRect().height;
    const onMove = (moveEvent: PointerEvent) => {
      const next = startHeight + startY - moveEvent.clientY;
      setResultsHeight(Math.round(Math.max(100, Math.min(availableHeight - 150, next))));
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
  };

  return (
    <div
      data-testid="query-workspace"
      ref={workspaceRef}
      style={{
        display: 'flex', flex: 1, flexDirection: 'column', width: '100%', height: '100%',
        minWidth: 0, minHeight: 0, overflow: 'hidden',
      }}
    >
      <div style={{ display: 'flex', flex: 1, width: '100%', minWidth: 0, minHeight: 0, overflow: 'hidden' }}>
        <QueryEditor contextLocked={contextLocked} />
      </div>
      {showResults && (
        <>
          <div
            data-testid="query-results-resizer"
            role="separator"
            aria-label="Resize query results"
            aria-orientation="horizontal"
            title="Drag to resize results · double-click to reset"
            onPointerDown={beginResize}
            onDoubleClick={() => setResultsHeight(null)}
            style={{
              height: 5, flexShrink: 0, cursor: 'row-resize', background: theme.colors.panelRaised,
              borderTop: `1px solid ${theme.colors.border}`, borderBottom: `1px solid ${theme.colors.border}`,
            }}
          />
          <div
            ref={resultsRef}
            data-testid="query-results-region"
            style={{
              width: '100%', minWidth: 0, height: resultsHeight ?? '40%', minHeight: 100,
              overflow: 'hidden', flexShrink: 0,
            }}
          >
            <ResultsPanel />
          </div>
        </>
      )}
    </div>
  );
}
