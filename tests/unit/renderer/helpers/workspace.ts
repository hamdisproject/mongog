import { DEFAULT_SETTINGS, SIDEBAR_DEFAULT_WIDTH } from '../../../../src/shared/domain/workspace.js';
import { useSettingsStore } from '../../../../src/renderer/stores/settings.js';
import { useWorkspaceStore } from '../../../../src/renderer/stores/workspace.js';

export const statementRange = { startLine: 1, startCol: 1, endLine: 1, endCol: 10 };

export function resetWorkspaceStores(): void {
  useWorkspaceStore.setState({
    tabs: [],
    activeTabId: null,
    sidebarWidth: SIDEBAR_DEFAULT_WIDTH,
    results: {},
  });
  useSettingsStore.setState({
    settings: structuredClone(DEFAULT_SETTINGS),
    loaded: true,
    saving: false,
    error: null,
  });
}
