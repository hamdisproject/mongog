import { create } from 'zustand';
import type { ApplicationSettings } from '../../shared/domain/index.js';
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
  setBsonDisplayMode: (mode: BsonDisplayMode) => Promise<void>;
  setCollectionDefaults: (collection: ApplicationSettings['collection']) => Promise<void>;
  setTableColumnOrder: (columnOrder: ApplicationSettings['table']['columnOrder']) => Promise<void>;
  setConnectionIdleTimeout: (idleTimeoutMS: number) => Promise<void>;
  setPageSize: (pageSize: number) => Promise<void>;
  setAuditSettings: (audit: ApplicationSettings['audit']) => Promise<void>;
}

const initialSettings: ApplicationSettings = structuredClone(DEFAULT_SETTINGS);
applyThemePreference(initialSettings.theme);

export const useSettingsStore = create<SettingsState>()((set, get) => ({
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
    if (get().saving || get().settings.theme === theme) return;
    const previous = get().settings;
    const settings = { ...previous, theme };
    applyThemePreference(theme);
    set({ settings, saving: true, error: null });
    try {
      await window.mongog.settings.save(settings);
      set({ saving: false });
    } catch (error) {
      applyThemePreference(previous.theme);
      set({ settings: previous, saving: false, error: errorMessage(error) });
    }
  },

  setBsonDisplayMode: async (mode) => {
    if (get().saving || get().settings.ejson.defaultMode === mode) return;
    const previous = get().settings;
    const settings = { ...previous, ejson: { ...previous.ejson, defaultMode: mode } };
    set({ settings, saving: true, error: null });
    try {
      await window.mongog.settings.save(settings);
      set({ saving: false });
    } catch (error) {
      set({ settings: previous, saving: false, error: errorMessage(error) });
    }
  },

  setCollectionDefaults: async (collection) => {
    if (get().saving) return;
    const previous = get().settings;
    const normalized: ApplicationSettings['collection'] = {
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
    set({ settings, saving: true, error: null });
    try {
      await window.mongog.settings.save(settings);
      set({ saving: false });
    } catch (error) {
      set({ settings: previous, saving: false, error: errorMessage(error) });
    }
  },

  setTableColumnOrder: async (columnOrder) => {
    if (get().saving || get().settings.table.columnOrder === columnOrder) return;
    const previous = get().settings;
    const settings = { ...previous, table: { columnOrder } };
    set({ settings, saving: true, error: null });
    try {
      await window.mongog.settings.save(settings);
      set({ saving: false });
    } catch (error) {
      set({ settings: previous, saving: false, error: errorMessage(error) });
    }
  },

  setConnectionIdleTimeout: async (idleTimeoutMS) => {
    if (get().saving || get().settings.connection.idleTimeoutMS === idleTimeoutMS) return;
    const previous = get().settings;
    const settings = {
      ...previous,
      connection: { idleTimeoutMS },
    };
    set({ settings, saving: true, error: null });
    try {
      await window.mongog.settings.save(settings);
      set({ saving: false });
    } catch (error) {
      set({ settings: previous, saving: false, error: errorMessage(error) });
    }
  },

  setPageSize: async (pageSize) => {
    if (
      get().saving ||
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
    set({ settings, saving: true, error: null });
    try {
      await window.mongog.settings.save(settings);
      set({ saving: false });
    } catch (error) {
      set({ settings: previous, saving: false, error: errorMessage(error) });
    }
  },

  setAuditSettings: async (audit) => {
    if (get().saving) return;
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
    set({ settings, saving: true, error: null });
    try {
      await window.mongog.settings.save(settings);
      set({ saving: false });
    } catch (error) {
      set({ settings: previous, saving: false, error: errorMessage(error) });
    }
  },
}));

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) return String(error.message);
  return String(error);
}
