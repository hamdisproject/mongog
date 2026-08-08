import { create } from 'zustand';
import type { ApplicationSettings } from '../../shared/domain/index.js';
import { DEFAULT_SETTINGS } from '../../shared/domain/workspace.js';
import { applyThemePreference, type ThemePreference } from '../theme.js';

interface SettingsState {
  settings: ApplicationSettings;
  loaded: boolean;
  saving: boolean;
  error: string | null;
  load: () => Promise<void>;
  setTheme: (theme: ThemePreference) => Promise<void>;
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
      const settings = await window.mongog.settings.load();
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
}));

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) return String(error.message);
  return String(error);
}
