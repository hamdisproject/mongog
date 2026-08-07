import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';

let mongo: MongoMemoryServer;
let mongoUri: string;
let userDataPath: string;
let application: ElectronApplication | null = null;

test.beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  mongoUri = mongo.getUri('mongog_e2e');
  const client = new MongoClient(mongoUri);
  await client.connect();
  try {
    await client.db('mongog_e2e').collection('inventory').insertMany([
      { sku: 'alpha', quantity: 3 },
      { sku: 'beta', quantity: 7 },
    ]);
  } finally {
    await client.close();
  }
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

test('Welcome, Connections, and Collection Query provide the complete lifecycle', async () => {
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

  await page.locator('[title^="welcome: Welcome"]').click();
  await page.getByRole('button', { name: /E2E Local/ }).click();
  await expect(page.locator('[title^="query: E2E Local · mongog_e2e"]')).toBeVisible();

  await application!.close();
  application = null;
  page = await launch();
  await expect(page.getByText('Welcome back')).toBeVisible();
  await expect(page.locator('[title^="welcome: Welcome"]')).toHaveCount(1);

  await page.getByRole('button', { name: 'Open Connections' }).click();
  await page.getByRole('complementary').getByText('E2E Local', { exact: true }).click();
  await page.getByLabel('Connection name').fill('E2E Renamed');
  await page.getByRole('button', { name: 'Test, Save & Connect' }).click();
  await expect(page.getByText('Connection tested, saved, and connected.')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('E2E Renamed', { exact: true }).first()).toBeVisible();

  await page.getByTitle('Expand databases').click();
  await page.getByTitle('Expand database mongog_e2e').click();
  await page.getByTitle('Open mongog_e2e.inventory').click();
  await expect(page.getByRole('button', { name: 'Documents', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('alpha', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Collection filter')).toBeVisible();
  await expect(page.getByLabel('Collection sort')).toBeVisible();
  await expect(page.getByLabel('Collection projection')).toBeVisible();
  const initialFilterHeight = await page.getByTestId('criteria-editor-filter').evaluate(
    (element) => element.getBoundingClientRect().height,
  );
  await setMonacoValue(page, 'Collection filter', '{ ');
  await page.keyboard.press('Control+Space');
  await expect(page.locator('.suggest-widget.visible')).toContainText('sku', { timeout: 15_000 });
  await page.keyboard.press('Escape');
  await setMonacoValue(page, 'Collection filter', "{\n  sku: 'alpha',\n}");
  await expect.poll(() => page.getByTestId('criteria-editor-filter').evaluate(
    (element) => element.getBoundingClientRect().height,
  )).toBeGreaterThan(initialFilterHeight);
  await setMonacoValue(page, 'Collection sort', '{ quantity: -1 }');
  await setMonacoValue(page, 'Collection projection', '{ sku: 1, quantity: 1 }');
  await expect(page.getByRole('button', { name: 'Apply', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.getByText('alpha', { exact: true })).toBeVisible();
  await expect(page.getByText('beta', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: /^Criteria/ }).click();
  await expect(page.getByLabel('Collection filter')).toHaveCount(0);
  await page.getByRole('button', { name: /^Criteria/ }).click();
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.getByText('beta', { exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: 'Query', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Query', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Connection')).toBeDisabled();
  await expect(page.getByLabel('Database')).toBeDisabled();
  await page.getByRole('button', { name: /^Run/ }).click();
  await expect(page.getByText('Statement 1', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('documents', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Documents', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Criteria · 3/ })).toBeVisible();
  await expect(page.getByText('beta', { exact: true })).toHaveCount(0);

  await page.locator('[title^="connection-settings: Connections"]').click();

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText('No matching connections.')).toBeVisible();
});

async function setMonacoValue(page: Page, label: string, value: string): Promise<void> {
  const editor = page.getByLabel(label);
  await editor.focus();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.keyboard.press('Backspace');
  await page.keyboard.insertText(value);
}

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
