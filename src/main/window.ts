import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, protocol, screen, shell } from 'electron';
import type { WindowState } from './window-state.js';

const here = path.dirname(fileURLToPath(import.meta.url));

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

const rendererScheme = 'mongog';
const rendererHost = 'bundle';
const rendererOrigin = `${rendererScheme}://${rendererHost}`;

// Keep the production renderer off file://. Besides matching Electron's
// security guidance, this is required when GrantFileProtocolExtraPrivileges
// is fused off in release builds.
protocol.registerSchemesAsPrivileged([{
  scheme: rendererScheme,
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    codeCache: true,
  },
}]);

export function allowedRendererOrigins(): string[] {
  const origins: string[] = [];
  if (typeof MAIN_WINDOW_VITE_DEV_SERVER_URL !== 'undefined' && MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    origins.push(new URL(MAIN_WINDOW_VITE_DEV_SERVER_URL).origin);
  }
  origins.push(rendererOrigin);
  return origins;
}

export function installRendererProtocol(): void {
  if (typeof MAIN_WINDOW_VITE_DEV_SERVER_URL !== 'undefined' && MAIN_WINDOW_VITE_DEV_SERVER_URL) return;

  const root = path.join(app.getAppPath(), '.vite', 'renderer', MAIN_WINDOW_VITE_NAME);
  protocol.handle(rendererScheme, async (request) => {
    const url = new URL(request.url);
    if (url.host !== rendererHost) return new Response('Not found', { status: 404 });

    let requestedPath: string;
    try {
      requestedPath = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    } catch {
      return new Response('Bad request', { status: 400 });
    }

    const target = path.resolve(root, requestedPath);
    const relative = path.relative(root, target);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      return new Response('Forbidden', { status: 403 });
    }

    try {
      const body = await readFile(target);
      return new Response(new Uint8Array(body), {
        headers: { 'content-type': contentType(target) },
      });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
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
    // Packaged macOS builds resolve the compact ICNS directly from the bundle.
    // Development uses the matching PNG through applicationIconPath().
    ...(process.platform === 'darwin' && app.isPackaged
      ? {}
      : { icon: applicationIconPath() }),
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
    void win.loadURL(`${rendererOrigin}/index.html`);
  }

  return win;
}

export function applicationIconPath(): string {
  const iconFilename = process.platform === 'darwin'
    ? 'mongog-icon-macos.png'
    : 'mongog-icon.png';
  return app.isPackaged
    ? path.join(process.resourcesPath, iconFilename)
    : path.join(app.getAppPath(), 'assets', iconFilename);
}

function contentType(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case '.html': return 'text/html; charset=utf-8';
    case '.js': return 'text/javascript; charset=utf-8';
    case '.css': return 'text/css; charset=utf-8';
    case '.json':
    case '.map': return 'application/json; charset=utf-8';
    case '.svg': return 'image/svg+xml';
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.woff': return 'font/woff';
    case '.woff2': return 'font/woff2';
    case '.ttf': return 'font/ttf';
    case '.wasm': return 'application/wasm';
    default: return 'application/octet-stream';
  }
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
