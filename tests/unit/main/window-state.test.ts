import { EventEmitter } from 'node:events';
import type { BrowserWindow } from 'electron';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Database } from '../../../src/main/storage/database.js';
import {
  loadWindowState,
  saveWindowState,
  startWindowStateSaver,
  type WindowBounds,
  type WindowState,
} from '../../../src/main/window-state.js';
import { useTempDatabase } from './helpers/temp-database.js';

const context = useTempDatabase('mongog-window-state-test-');

const STATE: WindowState = {
  bounds: { x: 10, y: 20, width: 1280, height: 800 },
  maximized: false,
};

class FakeWindow extends EventEmitter {
  bounds: WindowBounds = { x: 0, y: 0, width: 1000, height: 700 };
  maximized = false;

  getBounds(): WindowBounds {
    return { ...this.bounds };
  }

  isMaximized(): boolean {
    return this.maximized;
  }
}

function asBrowserWindow(win: FakeWindow): BrowserWindow {
  return win as unknown as BrowserWindow;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('window state persistence', () => {
  it('loads null when nothing is stored', () => {
    const db = Database.openOrCreate(context.path);
    try {
      expect(loadWindowState(db.settings)).toBeNull();
    } finally {
      db.close();
    }
  });

  it('loads null on corrupt JSON instead of throwing', () => {
    const db = Database.openOrCreate(context.path);
    try {
      db.settings.setRaw('window:state', '{not-json');
      expect(loadWindowState(db.settings)).toBeNull();
    } finally {
      db.close();
    }
  });

  it('round-trips bounds and maximized flag', () => {
    const db = Database.openOrCreate(context.path);
    try {
      saveWindowState(db.settings, STATE);
      expect(loadWindowState(db.settings)).toEqual(STATE);

      saveWindowState(db.settings, { bounds: STATE.bounds, maximized: true });
      expect(loadWindowState(db.settings)).toEqual({ bounds: STATE.bounds, maximized: true });
    } finally {
      db.close();
    }
  });
});

describe('window state saver', () => {
  it('debounces rapid resize/move events into a single save', () => {
    vi.useFakeTimers();
    const db = Database.openOrCreate(context.path);
    try {
      const win = new FakeWindow();
      const stop = startWindowStateSaver(asBrowserWindow(win), db.settings);

      win.bounds = { x: 1, y: 1, width: 800, height: 600 };
      win.emit('resize');
      win.bounds = { x: 2, y: 2, width: 900, height: 650 };
      win.emit('move');
      win.bounds = { x: 3, y: 3, width: 1000, height: 700 };
      win.emit('resize');

      expect(loadWindowState(db.settings)).toBeNull();
      vi.advanceTimersByTime(500);

      expect(loadWindowState(db.settings)).toEqual({
        bounds: { x: 3, y: 3, width: 1000, height: 700 },
        maximized: false,
      });
      stop();
    } finally {
      db.close();
    }
  });

  it('cleanup removes listeners and cancels a pending save', () => {
    vi.useFakeTimers();
    const db = Database.openOrCreate(context.path);
    try {
      const win = new FakeWindow();
      const stop = startWindowStateSaver(asBrowserWindow(win), db.settings);

      win.emit('maximize');
      stop();
      vi.advanceTimersByTime(10_000);

      expect(loadWindowState(db.settings)).toBeNull();
      for (const event of ['resize', 'move', 'maximize', 'unmaximize']) {
        expect(win.listenerCount(event)).toBe(0);
      }
    } finally {
      db.close();
    }
  });
});
