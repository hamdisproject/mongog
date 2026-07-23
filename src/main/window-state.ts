import type { BrowserWindow } from 'electron';
import type { SettingsRepo } from './storage/repositories/settings.js';

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowState {
  bounds: WindowBounds;
  maximized: boolean;
}

const STORAGE_KEY = 'window:state';

const DEBOUNCE_MS = 500;

export function loadWindowState(repo: SettingsRepo): WindowState | null {
  const raw = repo.getRaw(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as WindowState;
  } catch {
    return null;
  }
}

export function saveWindowState(repo: SettingsRepo, state: WindowState): void {
  repo.setRaw(STORAGE_KEY, JSON.stringify(state));
}

export function startWindowStateSaver(win: BrowserWindow, repo: SettingsRepo): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const save = () => {
    const bounds = win.getBounds();
    const maximized = win.isMaximized();
    saveWindowState(repo, { bounds, maximized });
  };

  const debouncedSave = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(save, DEBOUNCE_MS);
  };

  win.on('resize', debouncedSave);
  win.on('move', debouncedSave);
  win.on('maximize', debouncedSave);
  win.on('unmaximize', debouncedSave);

  return () => {
    if (timer) clearTimeout(timer);
    win.removeListener('resize', debouncedSave);
    win.removeListener('move', debouncedSave);
    win.removeListener('maximize', debouncedSave);
    win.removeListener('unmaximize', debouncedSave);
  };
}
