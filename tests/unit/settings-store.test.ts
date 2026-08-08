import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/shared/domain/workspace.js';
import { useSettingsStore } from '../../src/renderer/stores/settings.js';

const save = vi.fn();

describe('renderer settings store', () => {
  beforeEach(() => {
    save.mockReset();
    vi.stubGlobal('window', {
      mongog: {
        settings: {
          save,
          load: vi.fn(),
        },
      },
    });
    useSettingsStore.setState({
      settings: structuredClone(DEFAULT_SETTINGS),
      loaded: true,
      saving: false,
      error: null,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('persists Query collection defaults and the global page size', async () => {
    save.mockResolvedValue(undefined);

    await useSettingsStore.getState().setCollectionDefaults({
      defaultView: 'query',
      autoExecuteDefaultQuery: true,
    });
    await useSettingsStore.getState().setPageSize(125);

    expect(useSettingsStore.getState().settings.collection).toEqual({
      defaultView: 'query',
      autoExecuteDefaultQuery: true,
    });
    expect(useSettingsStore.getState().settings.execution.pageSize).toBe(125);
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('forces auto-run off for Documents', async () => {
    save.mockResolvedValue(undefined);
    useSettingsStore.setState((state) => ({
      settings: {
        ...state.settings,
        collection: { defaultView: 'query', autoExecuteDefaultQuery: true },
      },
    }));
    await useSettingsStore.getState().setCollectionDefaults({
      defaultView: 'documents',
      autoExecuteDefaultQuery: true,
    });

    expect(useSettingsStore.getState().settings.collection).toEqual({
      defaultView: 'documents',
      autoExecuteDefaultQuery: false,
    });
    expect(save).toHaveBeenCalledOnce();
  });

  it('rolls back an optimistic page-size change when persistence fails', async () => {
    save.mockRejectedValue(new Error('disk full'));
    await useSettingsStore.getState().setPageSize(100);

    expect(useSettingsStore.getState().settings.execution.pageSize).toBe(50);
    expect(useSettingsStore.getState().saving).toBe(false);
    expect(useSettingsStore.getState().error).toBe('disk full');
  });
});
