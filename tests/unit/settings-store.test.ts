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

  it('persists editor and Criteria preferences without replacing other settings', async () => {
    save.mockResolvedValue(undefined);
    await useSettingsStore.getState().setEditorFontSize(18);
    await useSettingsStore.getState().setEditorMouseWheelZoom(false);
    await useSettingsStore.getState().setCriteriaOpenByDefault(false);
    await useSettingsStore.getState().setCollectionDefaults({ defaultView: 'query', autoExecuteDefaultQuery: true });
    expect(useSettingsStore.getState().settings.editor).toEqual({ ...DEFAULT_SETTINGS.editor, fontSize: 18, mouseWheelZoom: false });
    expect(useSettingsStore.getState().settings.collection).toEqual({
      ...DEFAULT_SETTINGS.collection, criteriaOpenByDefault: false, defaultView: 'query', autoExecuteDefaultQuery: true,
    });
    expect(save.mock.lastCall?.[0]).toEqual(useSettingsStore.getState().settings);
  });

  it('coalesces rapid font edits and serializes them with other preferences', async () => {
    const firstSave = deferredSave();
    save.mockReturnValueOnce(firstSave.promise).mockResolvedValue(undefined);
    const first = useSettingsStore.getState().setEditorFontSize(14);
    await Promise.resolve();
    const edits = [
      useSettingsStore.getState().setEditorFontSize(15),
      useSettingsStore.getState().setEditorFontSize(16),
      useSettingsStore.getState().setPageSize(125),
      useSettingsStore.getState().setEditorMouseWheelZoom(false),
    ];
    expect(save).toHaveBeenCalledOnce();
    expect(useSettingsStore.getState().settings.editor.fontSize).toBe(16);
    firstSave.resolve();
    await Promise.all([first, ...edits]);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.lastCall?.[0].editor).toEqual({ ...DEFAULT_SETTINGS.editor, fontSize: 16, mouseWheelZoom: false });
    expect(save.mock.lastCall?.[0].execution.pageSize).toBe(125);
    expect(useSettingsStore.getState().saving).toBe(false);
  });

  it('does not roll back newer edits when an older save fails', async () => {
    const firstSave = deferredSave();
    save.mockReturnValueOnce(firstSave.promise).mockResolvedValue(undefined);
    const first = useSettingsStore.getState().setEditorFontSize(14);
    await Promise.resolve();
    const newer = useSettingsStore.getState().setEditorFontSize(20);
    const criteria = useSettingsStore.getState().setCriteriaOpenByDefault(false);
    firstSave.reject(new Error('temporary failure'));
    await Promise.all([first, newer, criteria]);
    expect(save.mock.lastCall?.[0].editor.fontSize).toBe(20);
    expect(useSettingsStore.getState().settings.collection.criteriaOpenByDefault).toBe(false);
    expect(useSettingsStore.getState().error).toBeNull();
  });

  it('rolls back a failed final font save to the last confirmed snapshot', async () => {
    const firstSave = deferredSave();
    save.mockReturnValueOnce(firstSave.promise).mockRejectedValue(new Error('disk full'));
    const first = useSettingsStore.getState().setEditorFontSize(14);
    await Promise.resolve();
    const newer = useSettingsStore.getState().setEditorFontSize(20);
    firstSave.resolve();
    await Promise.all([first, newer]);
    expect(useSettingsStore.getState().settings.editor.fontSize).toBe(14);
    expect(useSettingsStore.getState().saving).toBe(false);
    expect(useSettingsStore.getState().error).toBe('disk full');
  });

  it('rejects invalid font sizes without saving', async () => {
    for (const fontSize of [7, 73, 12.5, NaN, Infinity]) {
      await useSettingsStore.getState().setEditorFontSize(fontSize);
    }
    expect(save).not.toHaveBeenCalled();
    expect(useSettingsStore.getState().settings.editor.fontSize).toBe(13);
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
      explorerOpenBehavior: 'reuse-existing',
      criteriaOpenByDefault: true,
    });
    expect(useSettingsStore.getState().settings.execution.pageSize).toBe(125);
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('persists the global table column order', async () => {
    save.mockResolvedValue(undefined);

    await useSettingsStore.getState().setTableColumnOrder('document');

    expect(useSettingsStore.getState().settings.table.columnOrder).toBe('document');
    expect(save).toHaveBeenCalledOnce();
    expect(save.mock.calls[0]?.[0].table).toEqual({ columnOrder: 'document' });
  });

  it('rolls back an optimistic table column order when persistence fails', async () => {
    save.mockRejectedValue(new Error('settings unavailable'));

    await useSettingsStore.getState().setTableColumnOrder('document');

    expect(useSettingsStore.getState().settings.table.columnOrder).toBe('alphabetical');
    expect(useSettingsStore.getState().saving).toBe(false);
    expect(useSettingsStore.getState().error).toBe('settings unavailable');
  });

  it('forces auto-run off for Documents', async () => {
    save.mockResolvedValue(undefined);
    useSettingsStore.setState((state) => ({
      settings: {
        ...state.settings,
        collection: {
          ...state.settings.collection,
          defaultView: 'query',
          autoExecuteDefaultQuery: true,
        },
      },
    }));
    await useSettingsStore.getState().setCollectionDefaults({
      defaultView: 'documents',
      autoExecuteDefaultQuery: true,
    });

    expect(useSettingsStore.getState().settings.collection).toEqual({
      defaultView: 'documents',
      autoExecuteDefaultQuery: false,
      explorerOpenBehavior: 'reuse-existing',
      criteriaOpenByDefault: true,
    });
    expect(save).toHaveBeenCalledOnce();
  });

  it('persists the Explorer collection behavior without replacing other collection defaults', async () => {
    save.mockResolvedValue(undefined);

    await useSettingsStore.getState().setExplorerCollectionOpenBehavior('new-tab');

    expect(useSettingsStore.getState().settings.collection).toEqual({
      defaultView: 'documents',
      autoExecuteDefaultQuery: false,
      explorerOpenBehavior: 'new-tab',
      criteriaOpenByDefault: true,
    });
    expect(save).toHaveBeenCalledOnce();
    expect(save.mock.calls[0]?.[0].collection).toEqual({
      defaultView: 'documents',
      autoExecuteDefaultQuery: false,
      explorerOpenBehavior: 'new-tab',
      criteriaOpenByDefault: true,
    });
  });

  it('rolls back an optimistic Explorer collection behavior when persistence fails', async () => {
    save.mockRejectedValue(new Error('settings unavailable'));

    await useSettingsStore.getState().setExplorerCollectionOpenBehavior('new-tab');

    expect(useSettingsStore.getState().settings.collection.explorerOpenBehavior).toBe('reuse-existing');
    expect(useSettingsStore.getState().saving).toBe(false);
    expect(useSettingsStore.getState().error).toBe('settings unavailable');
  });

  it('rolls back an optimistic page-size change when persistence fails', async () => {
    save.mockRejectedValue(new Error('disk full'));
    await useSettingsStore.getState().setPageSize(100);

    expect(useSettingsStore.getState().settings.execution.pageSize).toBe(50);
    expect(useSettingsStore.getState().saving).toBe(false);
    expect(useSettingsStore.getState().error).toBe('disk full');
  });

  it('persists the global idle timeout, including Never', async () => {
    save.mockResolvedValue(undefined);

    await useSettingsStore.getState().setConnectionIdleTimeout(0);

    expect(useSettingsStore.getState().settings.connection.idleTimeoutMS).toBe(0);
    expect(save).toHaveBeenCalledOnce();
    expect(save.mock.calls[0]?.[0].connection).toEqual({ idleTimeoutMS: 0 });
  });

  it('rolls back an optimistic idle-timeout change when persistence fails', async () => {
    save.mockRejectedValue(new Error('settings unavailable'));

    await useSettingsStore.getState().setConnectionIdleTimeout(2 * 60 * 60 * 1000);

    expect(useSettingsStore.getState().settings.connection.idleTimeoutMS).toBe(60 * 60 * 1000);
    expect(useSettingsStore.getState().saving).toBe(false);
    expect(useSettingsStore.getState().error).toBe('settings unavailable');
  });
});

function deferredSave() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
