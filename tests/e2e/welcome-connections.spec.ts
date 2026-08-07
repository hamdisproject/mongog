import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { MongoMemoryServer } from 'mongodb-memory-server';

let mongo: MongoMemoryServer;
let mongoUri: string;
let userDataPath: string;
let application: ElectronApplication | null = null;

test.beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  mongoUri = mongo.getUri('mongog_e2e');
  userDataPath = await mkdtemp(join(tmpdir(), 'mongog-e2e-'));
});

test.afterEach(async () => {
  await application?.close().catch(() => undefined);
  application = null;
});

test.afterAll(async () => {
  await mongo?.stop();
  if (userDataPath) await rm(userDataPath, { recursive: true, force: true });
});

test('Welcome and Connections provide the complete profile lifecycle', async () => {
  let page = await launch();
  await expect(page.getByText('Welcome back')).toBeVisible();
  await expect(page.locator('[title^="welcome: Welcome"]')).toHaveCount(1);

  await page.getByRole('button', { name: 'New Connection' }).click();
  await expect(page.getByRole('heading', { name: 'New connection' })).toBeVisible();
  await page.getByLabel('Connection name').fill('E2E Local');
  await page.getByLabel('Connection URI').fill(mongoUri);
  await page.getByLabel('Default database').fill('mongog_e2e');
  await page.getByRole('button', { name: 'advanced' }).click();
  await expect(page.getByText('Authentication & topology')).toBeVisible();
  await page.getByRole('button', { name: 'basic' }).click();
  await page.getByRole('button', { name: 'Test, Save & Connect' }).click();
  await expect(page.getByText('Connection tested, saved, and connected.')).toBeVisible({ timeout: 30_000 });

  await page.getByTitle('Welcome').click();
  await page.getByRole('button', { name: /E2E Local/ }).click();
  await expect(page.locator('[title^="query: E2E Local · mongog_e2e"]')).toBeVisible();

  await application!.close();
  application = null;
  page = await launch();
  await expect(page.getByText('Welcome back')).toBeVisible();
  await expect(page.locator('[title^="welcome: Welcome"]')).toHaveCount(1);

  await page.getByRole('button', { name: 'Open Connections' }).click();
  await page.getByText('E2E Local', { exact: true }).first().click();
  await page.getByLabel('Connection name').fill('E2E Renamed');
  await page.getByRole('button', { name: 'Test, Save & Connect' }).click();
  await expect(page.getByText('Connection tested, saved, and connected.')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('E2E Renamed', { exact: true }).first()).toBeVisible();

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText('No matching connections.')).toBeVisible();
});

async function launch(): Promise<Page> {
  const executablePath = packagedExecutable();
  application = await electron.launch({
    executablePath,
    env: { ...process.env, MONGOG_E2E_USER_DATA: userDataPath },
  });
  return application.firstWindow();
}

function packagedExecutable(): string {
  const candidates = process.platform === 'darwin'
    ? [
        join(process.cwd(), 'out/MongoG-darwin-arm64/MongoG.app/Contents/MacOS/MongoG'),
        join(process.cwd(), 'out/MongoG-darwin-arm64/MongoG.app/Contents/MacOS/mongog'),
      ]
    : process.platform === 'win32'
      ? [join(process.cwd(), 'out/MongoG-win32-x64/mongog.exe')]
      : [join(process.cwd(), 'out/MongoG-linux-x64/mongog')];
  const executable = candidates.find(existsSync);
  if (!executable) throw new Error('Packaged MongoG executable not found. Run npm run package first.');
  return executable;
}
