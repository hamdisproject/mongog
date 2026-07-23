import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { app, BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { createMainWindow, allowedRendererOrigins } from './window.js';
import { registerIpcHandlers } from './ipc/handlers.js';
import { RuntimeSupervisor } from './runtime/supervisor.js';
import { Database } from './storage/database.js';
import { secretVault } from './security/secret-vault.js';
import { loadWindowState, startWindowStateSaver } from './window-state.js';
import { IpcEvents } from '../shared/ipc/index.js';
import { serializeError } from '../shared/errors/index.js';

const supervisor = new RuntimeSupervisor({ maxRuntimes: 10, idleTimeoutMS: 15 * 60 * 1000 });
const smokeUserDataPath = process.env.MONGOG_SMOKE === '1'
  ? join(app.getPath('temp'), `mongog-smoke-${process.pid}`)
  : null;

if (smokeUserDataPath) {
  app.setPath('userData', smokeUserDataPath);
}

let spikeMongoUri: string | null = null;
let db: Database | null = null;

function getDb(): Database {
  if (!db) throw new Error('Database not initialized');
  return db;
}

function validateSender(event: IpcMainInvokeEvent): boolean {
  const url = event.senderFrame?.url ?? '';
  if (!url) return false;
  return allowedRendererOrigins().some((origin) => url.startsWith(origin));
}

async function getSpikeMongoUri(): Promise<string | null> {
  if (spikeMongoUri) return spikeMongoUri;
  const externalSmokeUri = process.env.MONGOG_SMOKE_MONGO_URI?.trim();
  if (externalSmokeUri) {
    spikeMongoUri = externalSmokeUri;
    return spikeMongoUri;
  }
  if (process.env.MONGOG_SPIKE_MONGO !== '1') return null;
  if (app.isPackaged) {
    throw new Error(
      'Packaged smoke cannot start mongodb-memory-server. Start mongod externally and set MONGOG_SMOKE_MONGO_URI.',
    );
  }
  const { startSpikeMongo } = await import('./spike-mongo.js');
  spikeMongoUri = await startSpikeMongo(
    process.env.MONGOG_SPIKE_REPLSET === '1' ? 'replset' : 'standalone',
  );
  return spikeMongoUri;
}

void app.whenReady().then(async () => {
  db = Database.openOrCreate(join(app.getPath('userData'), 'mongog.db'));
  secretVault.bind(db.secrets);

  if (process.env.MONGOG_SMOKE === '1') {
    const { runSmokeChecks } = await import('./smoke.js');
    await runSmokeChecks(supervisor, await getSpikeMongoUri(), getDb);
    return;
  }

  supervisor.startSweeper();

  registerIpcHandlers(
    {
      supervisor,
      getWindow: () => BrowserWindow.getAllWindows()[0] ?? null,
      getSpikeMongoUri,
      getDb,
      secretStore: secretVault,
    },
    validateSender,
  );

  supervisor.on('engine-event', (connectionId, executionId, event, tabId, runId) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(IpcEvents.engine, {
        connectionId,
        executionId,
        ...(tabId ? { tabId } : {}),
        ...(runId ? { runId } : {}),
        event,
      });
    }
  });
  supervisor.on('runtime-connecting', (connectionId) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(IpcEvents.connectionState, {
        connectionId,
        status: 'connecting',
      });
    }
  });
  supervisor.on('runtime-ready', (connectionId, info) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(IpcEvents.connectionState, {
        connectionId,
        status: 'connected',
        runtimePid: info.pid,
        serverVersion: info.serverVersion,
        connectedAt: info.connectedAt,
      });
    }
  });
  supervisor.on('runtime-connect-error', (connectionId, error) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(IpcEvents.connectionState, {
        connectionId,
        status: 'error',
        error,
      });
    }
  });
  supervisor.on('runtime-exit', (connectionId) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(IpcEvents.connectionState, {
        connectionId,
        status: 'runtime-crashed',
        since: Date.now(),
      });
    }
  });
  supervisor.on('runtime-idle-evicted', (connectionId) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(IpcEvents.connectionState, {
        connectionId,
        status: 'disconnected',
      });
    }
  });
  supervisor.on('runtime-force-killed', (connectionId) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(IpcEvents.connectionState, {
        connectionId,
        status: 'runtime-crashed',
        since: Date.now(),
      });
    }
  });

  const savedState = loadWindowState(db.settings);
  const win = createMainWindow({ windowState: savedState });

  const stopSaver = startWindowStateSaver(win, db.settings);
  win.on('closed', stopSaver);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const s = loadWindowState(db!.settings);
      const w = createMainWindow({ windowState: s });
      const stop = startWindowStateSaver(w, db!.settings);
      w.on('closed', stop);
    }
  });
}).catch((err: unknown) => {
  // Startup failures otherwise surface as Electron's opaque "#<Object>"
  // unhandled rejection and leave a headless smoke process hanging.
  console.error('[MongoG main] startup failed', JSON.stringify(serializeError(err)));
  app.exit(1);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (spikeMongoUri) {
    void import('./spike-mongo.js').then((m) => m.stopSpikeMongo());
  }
  void supervisor.disposeAll();
  db?.close();
  if (smokeUserDataPath) {
    rmSync(smokeUserDataPath, { recursive: true, force: true });
  }
});
