import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

import {
  _electron as electron,
  expect,
  test as base,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

import { redactForLog } from '../../../src/shared/redaction/index.js';
import { closeElectron, removeElectronUserData } from '../helpers/electron-lifecycle.js';
import { createTestDatabaseUri, e2eDatabaseName } from './identity.js';

export interface MongoGSession {
  application: ElectronApplication;
  page: Page;
}

export interface MongoGTestContext {
  readonly mongoUri: string;
  readonly databaseName: string;
  readonly userDataPath: string;
  readonly application: ElectronApplication | null;
  readonly page: Page | null;
  launch(extraEnv?: Record<string, string>): Promise<MongoGSession>;
  relaunch(extraEnv?: Record<string, string>): Promise<MongoGSession>;
  close(): Promise<void>;
}

interface WorkerMongo {
  rootUri: string;
  server: MongoMemoryReplSet;
}

interface TestFixtures {
  mongog: MongoGTestContext;
}

interface WorkerFixtures {
  workerMongo: WorkerMongo;
}

function packagedExecutable(): string {
  const configured = process.env.MONGOG_E2E_EXECUTABLE?.trim();
  if (configured) {
    if (!existsSync(configured)) throw new Error(`MONGOG_E2E_EXECUTABLE does not exist: ${configured}`);
    return configured;
  }
  const macArchitectures = process.arch === 'x64' ? ['x64', 'arm64'] : ['arm64', 'x64'];
  const candidates = process.platform === 'darwin'
    ? macArchitectures.flatMap((arch) => [
        join(process.cwd(), `out/MongoG-darwin-${arch}/MongoG.app/Contents/MacOS/MongoG`),
        join(process.cwd(), `out/MongoG-darwin-${arch}/MongoG.app/Contents/MacOS/mongog`),
      ])
    : process.platform === 'win32'
      ? [join(process.cwd(), 'out/MongoG-win32-x64/MongoG.exe'), join(process.cwd(), 'out/MongoG-win32-x64/mongog.exe')]
      : [join(process.cwd(), 'out/MongoG-linux-x64/mongog'), join(process.cwd(), 'out/MongoG-linux-x64/MongoG')];
  const executable = candidates.find(existsSync);
  if (!executable) throw new Error('Packaged MongoG executable not found. Run npm run package first.');
  return executable;
}

async function seedDatabase(mongoUri: string, databaseName: string): Promise<void> {
  const client = new MongoClient(mongoUri);
  await client.connect();
  try {
    await client.db(databaseName).collection('inventory').insertMany([
      {
        sku: 'alpha', quantity: 3, amenities: ['wifi', 'balcony'],
        catalog: {
          city: 'Istanbul',
          products: [{ name: 'Computer Pro', price: 150, tags: ['wifi'] }, { name: 'Accessory', price: 300 }],
        },
      },
      {
        sku: 'beta', quantity: 7, amenities: ['pool'],
        catalog: {
          city: '',
          products: [{ name: 'Computer Basic', price: 300 }, { name: 'Accessory', price: 150 }],
        },
      },
    ]);
  } finally {
    await client.close(true);
  }
}

export const test = base.extend<TestFixtures, WorkerFixtures>({
  workerMongo: [async ({}, use) => {
    const server = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: 'wiredTiger' },
      instanceOpts: [{ args: ['--setParameter', 'enableTestCommands=1'] }],
    });
    try {
      await use({ rootUri: server.getUri(), server });
    } finally {
      await server.stop();
    }
  }, { scope: 'worker' }],

  mongog: async ({ workerMongo }, use, testInfo) => {
    const databaseName = e2eDatabaseName(
      testInfo.testId,
      testInfo.workerIndex,
      testInfo.repeatEachIndex,
      testInfo.retry,
    );
    const mongoUri = createTestDatabaseUri(workerMongo.rootUri, databaseName);
    const userDataPath = await mkdtemp(join(tmpdir(), `mongog-e2e-w${testInfo.workerIndex}-`));
    let currentApplication: ElectronApplication | null = null;
    let currentPage: Page | null = null;
    let launchNumber = 0;

    await seedDatabase(mongoUri, databaseName);

    const close = async (): Promise<void> => {
      if (!currentApplication) return;
      const closing = currentApplication;
      currentApplication = null;
      currentPage = null;
      await test.step('Quit Electron and wait for its process to exit', () => closeElectron(closing));
    };

    const launch = async (extraEnv: Record<string, string> = {}): Promise<MongoGSession> => {
      if (currentApplication) throw new Error('Close the previous Electron application before relaunching.');
      const application = await electron.launch({
        executablePath: packagedExecutable(),
        env: {
          ...process.env,
          MONGOG_E2E_USER_DATA: userDataPath,
          MONGOG_UPDATE_FEED_URL: 'http://127.0.0.1:1/update',
          ...extraEnv,
        },
      });
      currentApplication = application;
      mkdirSync(testInfo.outputDir, { recursive: true });
      const logPath = testInfo.outputPath(`electron-${++launchNumber}.log`);
      const log = (message: string) => appendFileSync(logPath, `${redactForLog(message)}\n`);
      const child = application.process();
      log(`Electron launched: platform=${process.platform} arch=${process.arch} pid=${child.pid}`);
      for (const stream of [child.stdout, child.stderr]) {
        if (stream) createInterface({ input: stream }).on('line', log);
      }
      child.once('close', (code, signal) => log(`Electron closed: code=${code} signal=${signal}`));
      await application.evaluate(({ app }) => {
        process.on('uncaughtExceptionMonitor', (error) => console.error('[E2E main uncaught exception]', error));
        app.on('before-quit', () => console.log('[E2E lifecycle] before-quit'));
        app.on('will-quit', () => console.log('[E2E lifecycle] will-quit'));
        app.on('quit', () => console.log('[E2E lifecycle] quit'));
      });
      const page = await application.firstWindow();
      currentPage = page;
      await application.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows()[0];
        if (!window) throw new Error('MongoG test window was not created');
        window.setSize(1000, 700);
      });
      await expect.poll(() => page.evaluate(() => ({ width: window.outerWidth, height: window.outerHeight })))
        .toEqual({ width: 1000, height: 700 });
      return { application, page };
    };

    const context: MongoGTestContext = {
      mongoUri,
      databaseName,
      userDataPath,
      get application() { return currentApplication; },
      get page() { return currentPage; },
      launch,
      async relaunch(extraEnv = {}) {
        await close();
        return launch(extraEnv);
      },
      close,
    };

    let failure: unknown;
    try {
      await use(context);
    } catch (error) {
      failure = error;
    } finally {
      try {
        await close();
      } catch (error) {
        failure ??= error;
      }
      const cleanup = new MongoClient(workerMongo.rootUri);
      try {
        await cleanup.connect();
        await cleanup.db(databaseName).dropDatabase();
      } catch (error) {
        failure ??= error;
      } finally {
        await cleanup.close(true).catch(() => undefined);
        await removeElectronUserData(userDataPath).catch((error: unknown) => { failure ??= error; });
      }
    }
    if (failure) throw failure;
  },
});

export { expect } from '@playwright/test';
