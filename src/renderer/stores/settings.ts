import { create } from 'zustand';
import type { ApplicationSettings, ToolbarAction } from '../../shared/domain/index.js';
import type { BsonDisplayMode } from '../../shared/ejson/index.js';
import { DEFAULT_SETTINGS, normalizeApplicationSettings } from '../../shared/domain/workspace.js';
import { applyThemePreference, type ThemePreference } from '../theme.js';

interface SettingsState {
  settings: ApplicationSettings;
  loaded: boolean;
  saving: boolean;
  error: string | null;
  load: () => Promise<void>;
  setTheme: (theme: ThemePreference) => Promise<void>;
  setEditorFontSize: (fontSize: number) => Promise<void>;
  setEditorMouseWheelZoom: (enabled: boolean) => Promise<void>;
  setCriteriaOpenByDefault: (open: boolean) => Promise<void>;
  setBsonDisplayMode: (mode: BsonDisplayMode) => Promise<void>;
  setCollectionDefaults: (collection: Pick<ApplicationSettings['collection'], 'defaultView' | 'autoExecuteDefaultQuery'>) => Promise<void>;
  setExplorerCollectionOpenBehavior: (
    behavior: ApplicationSettings['collection']['explorerOpenBehavior'],
  ) => Promise<void>;
  setTableColumnOrder: (columnOrder: ApplicationSettings['table']['columnOrder']) => Promise<void>;
  setDatabaseOrder: (databaseOrder: ApplicationSettings['catalog']['databaseOrder']) => Promise<void>;
  setCollectionOrder: (collectionOrder: ApplicationSettings['catalog']['collectionOrder']) => Promise<void>;
  setToolbarActionVisible: (action: ToolbarAction, visible: boolean) => Promise<void>;
  setConnectionIdleTimeout: (idleTimeoutMS: number) => Promise<void>;
  setPageSize: (pageSize: number) => Promise<void>;
  setAuditSettings: (audit: ApplicationSettings['audit']) => Promise<void>;
}

const initialSettings: ApplicationSettings = structuredClone(DEFAULT_SETTINGS);
applyThemePreference(initialSettings.theme);

export const useSettingsStore = create<SettingsState>()((set, get) => {
  let pending: ApplicationSettings | null = null;
  let savingPromise: Promise<void> | null = null;

  // Save full snapshots serially. Wheel input stays responsive while the next
  // snapshot coalesces all edits made during an in-flight IPC save.
  const persist = (settings: ApplicationSettings): Promise<void> => {
    const previous = get().settings;
    pending = settings;
    if (!savingPromise) {
      savingPromise = Promise.resolve().then(async () => {
        let confirmed = previous;
        while (pending) {
          const snapshot = pending;
          pending = null;
          try {
            await window.mongog.settings.save(snapshot);
            confirmed = snapshot;
          } catch (error) {
            // A newer snapshot includes the failed edit; let it retry without
            // replacing the user's more recent choices with an older state.
            if (!pending) {
              if (get().settings.theme !== confirmed.theme) applyThemePreference(confirmed.theme);
              set({ settings: confirmed, error: errorMessage(error) });
            }
          }
        }
        savingPromise = null;
        set({ saving: false });
      });
    }
    const completion = savingPromise;
    if (previous.theme !== settings.theme) applyThemePreference(settings.theme);
    set({ settings, saving: true, error: null });
    return completion;
  };

  return {
    settings: initialSettings,
    loaded: false,
    saving: false,
    error: null,

    load: async () => {
      try {
        const settings = normalizeApplicationSettings(await window.mongog.settings.load());
        applyThemePreference(settings.theme);
        set({ settings, loaded: true, error: null });
      } catch (error) {
        applyThemePreference(get().settings.theme);
        set({ loaded: true, error: errorMessage(error) });
      }
    },

    setTheme: async (theme) => {
      if (get().settings.theme === theme) return;
      const previous = get().settings;
      await persist({ ...previous, theme });
    },

    setEditorFontSize: async (fontSize) => {
      if (!Number.isInteger(fontSize) || fontSize < 8 || fontSize > 72) return;
      const previous = get().settings;
      if (previous.editor.fontSize === fontSize) return;
      await persist({ ...previous, editor: { ...previous.editor, fontSize } });
    },

    setEditorMouseWheelZoom: async (mouseWheelZoom) => {
      const previous = get().settings;
      if (previous.editor.mouseWheelZoom === mouseWheelZoom) return;
      await persist({ ...previous, editor: { ...previous.editor, mouseWheelZoom } });
    },

    setCriteriaOpenByDefault: async (criteriaOpenByDefault) => {
      const previous = get().settings;
      if (previous.collection.criteriaOpenByDefault === criteriaOpenByDefault) return;
      await persist({ ...previous, collection: { ...previous.collection, criteriaOpenByDefault } });
    },

    setBsonDisplayMode: async (mode) => {
      if (get().settings.ejson.defaultMode === mode) return;
      const previous = get().settings;
      const settings = { ...previous, ejson: { ...previous.ejson, defaultMode: mode } };
      await persist(settings);
    },

    setCollectionDefaults: async (collection) => {
      const previous = get().settings;
      const normalized: ApplicationSettings['collection'] = {
        ...previous.collection,
        defaultView: collection.defaultView,
        autoExecuteDefaultQuery: collection.defaultView === 'query'
          ? collection.autoExecuteDefaultQuery
          : false,
      };
      if (
        previous.collection.defaultView === normalized.defaultView &&
        previous.collection.autoExecuteDefaultQuery === normalized.autoExecuteDefaultQuery
      ) return;
      const settings = { ...previous, collection: normalized };
      await persist(settings);
    },

    setExplorerCollectionOpenBehavior: async (explorerOpenBehavior) => {
      if (
        get().settings.collection.explorerOpenBehavior === explorerOpenBehavior
      ) return;
      const previous = get().settings;
      const settings = {
        ...previous,
        collection: { ...previous.collection, explorerOpenBehavior },
      };
      await persist(settings);
    },

    setTableColumnOrder: async (columnOrder) => {
      if (get().settings.table.columnOrder === columnOrder) return;
      const previous = get().settings;
      const settings = { ...previous, table: { columnOrder } };
      await persist(settings);
    },

    setDatabaseOrder: async (databaseOrder) => {
      const previous = get().settings;
      if (previous.catalog.databaseOrder === databaseOrder) return;
      await persist({
        ...previous,
        catalog: { ...previous.catalog, databaseOrder },
      });
    },

    setCollectionOrder: async (collectionOrder) => {
      const previous = get().settings;
      if (previous.catalog.collectionOrder === collectionOrder) return;
      await persist({
        ...previous,
        catalog: { ...previous.catalog, collectionOrder },
      });
    },

    setToolbarActionVisible: async (action, visible) => {
      const previous = get().settings;
      if (previous.toolbar[action] === visible) return;
      await persist({
        ...previous,
        toolbar: { ...previous.toolbar, [action]: visible },
      });
    },

    setConnectionIdleTimeout: async (idleTimeoutMS) => {
      if (get().settings.connection.idleTimeoutMS === idleTimeoutMS) return;
      const previous = get().settings;
      const settings = {
        ...previous,
        connection: { idleTimeoutMS },
      };
      await persist(settings);
    },

    setPageSize: async (pageSize) => {
      if (
        !Number.isInteger(pageSize) ||
        pageSize < 1 ||
        pageSize > 500 ||
        get().settings.execution.pageSize === pageSize
      ) return;
      const previous = get().settings;
      const settings = {
        ...previous,
        execution: { ...previous.execution, pageSize },
      };
      await persist(settings);
    },

    setAuditSettings: async (audit) => {
      const previous = get().settings;
      const normalized = {
        retentionDays: Math.max(1, Math.min(36_500, Math.trunc(audit.retentionDays))),
        maxEntries: Math.max(100, Math.min(1_000_000, Math.trunc(audit.maxEntries))),
      };
      if (
        previous.audit.retentionDays === normalized.retentionDays &&
        previous.audit.maxEntries === normalized.maxEntries
      ) return;
      const settings = { ...previous, audit: normalized };
      await persist(settings);
    },
  };
});

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) return String(error.message);
  return String(error);
}
