import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BrowserWindow, screen, shell } from 'electron';
import type { WindowState } from './window-state.js';

const here = path.dirname(fileURLToPath(import.meta.url));

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

export function allowedRendererOrigins(): string[] {
  const origins: string[] = [];
  if (typeof MAIN_WINDOW_VITE_DEV_SERVER_URL !== 'undefined' && MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    origins.push(new URL(MAIN_WINDOW_VITE_DEV_SERVER_URL).origin);
  }
  origins.push('file://');
  return origins;
}

export interface CreateWindowOptions {
  windowState?: WindowState | null;
}

export function createMainWindow(options?: CreateWindowOptions): BrowserWindow {
  const defaultWidth = 1440;
  const defaultHeight = 900;

  const savedBounds = options?.windowState?.bounds;
  const bounds = savedBounds && isVisibleOnAnyDisplay(savedBounds)
    ? savedBounds
    : { width: defaultWidth, height: defaultHeight };

  const win = new BrowserWindow({
    ...bounds,
    minWidth: 900,
    minHeight: 600,
    title: 'MongoG',
    backgroundColor: '#1e1e1e',
    show: false,
    webPreferences: {
      preload: path.join(here, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
    },
  });

  if (options?.windowState?.maximized) {
    win.maximize();
  }

  win.once('ready-to-show', () => win.show());

  win.webContents.on('will-navigate', (event, url) => {
    if (!allowedRendererOrigins().some((o) => url.startsWith(o))) {
      event.preventDefault();
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });

  if (typeof MAIN_WINDOW_VITE_DEV_SERVER_URL !== 'undefined' && MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    void win.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    void win.loadFile(path.join(here, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }

  return win;
}

function isVisibleOnAnyDisplay(bounds: { x: number; y: number; width: number; height: number }): boolean {
  return screen.getAllDisplays().some((d) => {
    const { x, y, width, height } = d.workArea;
    return (
      bounds.x >= x &&
      bounds.y >= y &&
      bounds.x + bounds.width <= x + width &&
      bounds.y + bounds.height <= y + height
    );
  });
}
