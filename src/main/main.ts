import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { app, BrowserWindow, nativeImage, type IpcMainInvokeEvent } from 'electron';
import { createMainWindow, allowedRendererOrigins, applicationIconPath, installRendererProtocol } from './window.js';
import { registerIpcHandlers } from './ipc/handlers.js';
import { RuntimeSupervisor } from './runtime/supervisor.js';
import { Database } from './storage/database.js';
import { secretVault } from './security/secret-vault.js';
import { loadWindowState, startWindowStateSaver } from './window-state.js';
import { IpcEvents } from '../shared/ipc/index.js';
import { serializeError } from '../shared/errors/index.js';
import { AuditService } from './services/audit-service.js';
import { DataTransferCoordinator } from './data-transfer/coordinator.js';
import { normalizeApplicationSettings } from '../shared/domain/workspace.js';
import squirrelStartup from 'electron-squirrel-startup';

const supervisor = new RuntimeSupervisor({ maxRuntimes: 10 });
const dataTransfer = new DataTransferCoordinator(supervisor);
app.setName('MongoG');
if (process.platform === 'win32') app.setAppUserModelId('com.squirrel.MongoG.MongoG');
const isSquirrelStartup = process.platform === 'win32' && squirrelStartup;
if (isSquirrelStartup) app.quit();
const smokeUserDataPath = process.env.MONGOG_SMOKE === '1'
  ? join(app.getPath('temp'), `mongog-smoke-${process.pid}`)
  : null;
const e2eUserDataPath = process.env.MONGOG_E2E_USER_DATA?.trim() || null;

if (smokeUserDataPath || e2eUserDataPath) {
  app.setPath('userData', smokeUserDataPath ?? e2eUserDataPath!);
}

let spikeMongoUri: string | null = null;
let db: Database | null = null;
let audit: AuditService | null = null;

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

if (!isSquirrelStartup) void app.whenReady().then(async () => {
  // Packaged macOS builds resolve the standard compact ICNS from the bundle.
  // Development uses the matching padded master so both modes have equal sizing.
  if (process.platform === 'darwin' && app.dock && !app.isPackaged) {
    const icon = nativeImage.createFromPath(applicationIconPath());
    if (!icon.isEmpty()) app.dock.setIcon(icon);
  }
  db = Database.openOrCreate(join(app.getPath('userData'), 'mongog.db'));
  const startupSettings = normalizeApplicationSettings(db.settings.get());
  supervisor.setIdleTimeoutMS(startupSettings.connection.idleTimeoutMS, false);
  secretVault.bind(db.secrets);
  audit = new AuditService(db);
  audit.setChangeEmitter((event) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(IpcEvents.auditChanged, event);
    }
  });
  audit.initialize();

  if (process.env.MONGOG_SMOKE === '1') {
    const { runSmokeChecks } = await import('./smoke.js');
    await runSmokeChecks(supervisor, await getSpikeMongoUri(), getDb);
    return;
  }

  installRendererProtocol();
  supervisor.startSweeper();

  registerIpcHandlers(
    {
      supervisor,
      getWindow: () => BrowserWindow.getAllWindows()[0] ?? null,
      getSpikeMongoUri,
      getDb,
      secretStore: secretVault,
      audit,
      dataTransfer,
    },
    validateSender,
  );

  supervisor.on('engine-event', (connectionId, executionId, event, tabId, runId) => {
    audit?.handleEngineEvent(runId, event);
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
  supervisor.on('export-progress', (_connectionId, event) => {
    audit?.handleExportEvent(event);
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(IpcEvents.exportProgress, event);
    }
  });
  dataTransfer.on('progress', (event) => {
    supervisor.trackDataJobProgress(event);
    audit?.handleDataTransferEvent(event);
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(IpcEvents.dataJobProgress, event);
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
    audit?.failQueriesForConnection(connectionId, 'Query runtime exited before execution completed.');
    audit?.failExportsForConnection(connectionId, 'Query runtime exited before export completed.');
    audit?.failDataTransfersForConnection(connectionId, 'Query runtime exited before data transfer completed.');
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(IpcEvents.connectionState, {
        connectionId,
        status: 'runtime-crashed',
        since: Date.now(),
      });
    }
  });
  supervisor.on('runtime-idle-evicted', (connectionId, idleTimeoutMS: number) => {
    const startedAt = Date.now();
    const auditId = audit?.begin({
      connectionId,
      category: 'connection',
      action: 'connection.idle-disconnect',
      origin: 'system',
      operationClass: 'connection',
      summary: 'Disconnect idle MongoDB connection',
      detail: { idleTimeoutMS },
    }) ?? null;
    audit?.finish(auditId, startedAt, { status: 'success' });
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(IpcEvents.connectionState, {
        connectionId,
        status: 'disconnected',
        reason: 'idle',
        since: Date.now(),
        idleTimeoutMS,
      });
    }
  });
  supervisor.on('runtime-force-killed', (connectionId) => {
    audit?.failQueriesForConnection(connectionId, 'Query runtime was force-killed before execution completed.');
    audit?.failExportsForConnection(connectionId, 'Query runtime was force-killed before export completed.');
    audit?.failDataTransfersForConnection(connectionId, 'Query runtime was force-killed before data transfer completed.');
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
  dataTransfer.dispose();
  audit?.dispose();
  db?.close();
  if (smokeUserDataPath) {
    rmSync(smokeUserDataPath, { recursive: true, force: true });
  }
});
