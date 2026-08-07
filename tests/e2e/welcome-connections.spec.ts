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
  await expectViewportLocked(page);
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
  let explorer = page.getByRole('navigation', { name: 'Connection explorer' });
  await expect(explorer.getByRole('button', { name: 'Disconnect', exact: true })).toBeVisible();
  await expect(explorer.getByRole('button', { name: 'Connection settings for E2E Local' })).toBeVisible();

  await page.locator('[title^="welcome: Welcome"]').click();
  await page.getByRole('button', { name: /E2E Local CONNECTED/ }).click();
  await expect(page.locator('[title^="query: E2E Local · mongog_e2e"]')).toBeVisible();
  await expect(page.getByTestId('query-results-region')).toHaveCount(0);
  await expectWorkspaceSurfaceFullWidth(page, 'query-editor');
  await expectQueryEditorFullHeight(page);

  await application!.close();
  application = null;
  page = await launch();
  await expect(page.getByText('Welcome back')).toBeVisible();
  await expect(page.locator('[title^="welcome: Welcome"]')).toHaveCount(1);
  explorer = page.getByRole('navigation', { name: 'Connection explorer' });
  await expect(explorer.getByRole('button', { name: 'Connect', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Open Connections' }).click();
  await page.getByRole('complementary').getByText('E2E Local', { exact: true }).click();
  await page.getByLabel('Connection name').fill('E2E Renamed');
  await page.getByRole('button', { name: 'Test, Save & Connect' }).click();
  await expect(page.getByText('Connection tested, saved, and connected.')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('E2E Renamed', { exact: true }).first()).toBeVisible();
  await expect(explorer.getByRole('button', { name: 'Connection settings for E2E Renamed' })).toBeVisible();
  await explorer.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(explorer.getByRole('button', { name: 'Connect', exact: true })).toBeVisible();
  await explorer.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(explorer.getByRole('button', { name: 'Disconnect', exact: true })).toBeVisible();

  await page.getByTitle('Expand databases').click();
  await page.getByTitle('Expand database mongog_e2e').click();
  await page.getByTitle('Open mongog_e2e.inventory').click();
  await expect(page.getByRole('button', { name: 'Documents', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('alpha', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Collection filter')).toBeVisible();
  await expect(page.getByLabel('Collection sort')).toBeVisible();
  await expect(page.getByLabel('Collection projection')).toBeVisible();
  await expectViewportLocked(page);
  const initialFilterHeight = await page.getByTestId('criteria-editor-filter').evaluate(
    (element) => element.getBoundingClientRect().height,
  );
  await setMonacoValue(page, 'Collection filter', '{ ');
  await page.keyboard.press('Control+Space');
  await expect(page.locator('.suggest-widget.visible')).toContainText('sku', { timeout: 15_000 });
  await page.keyboard.press('Escape');
  await setMonacoValue(page, 'Collection filter', "{\n  sku: 'alpha',\n");
  await expect.poll(() => page.getByTestId('criteria-editor-filter').evaluate(
    (element) => element.getBoundingClientRect().height,
  )).toBeGreaterThan(initialFilterHeight);
  await expectViewportLocked(page);
  await setMonacoValue(page, 'Collection sort', '{ createdAt: -1 }');
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
  await expect(page.getByTestId('query-results-region')).toHaveCount(0);
  await expectWorkspaceSurfaceFullWidth(page, 'query-editor');
  await expectQueryEditorFullHeight(page);
  await expect(page.getByLabel('Connection', { exact: true })).toBeDisabled();
  await expect(page.getByLabel('Database')).toBeDisabled();
  await page.getByRole('button', { name: /^Run/ }).click();
  await expect(page.getByTestId('query-results-region')).toBeVisible();
  await expect(page.getByText('Statement 1', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('documents', { exact: true })).toBeVisible();
  await expectQueryColumnsFillWidth(page);

  await page.getByRole('button', { name: 'Documents', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Criteria · 3/ })).toBeVisible();
  await expect(page.getByText('beta', { exact: true })).toHaveCount(0);

  await page.locator('[title^="connection-settings: Connections"]').click();

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText('No matching connections.')).toBeVisible();
});

async function setMonacoValue(page: Page, label: string, value: string): Promise<void> {
  const kind = label.replace('Collection ', '');
  await page.getByTestId(`criteria-editor-${kind}`).evaluate((element) => {
    (element as HTMLElement).click();
  });
  await expect(page.getByLabel(label)).toBeFocused();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.keyboard.press('Backspace');
  await page.keyboard.insertText(value);
}

async function expectViewportLocked(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => ({
    horizontalOverflow: Math.max(
      document.documentElement.scrollWidth,
      document.body.scrollWidth,
    ) - window.innerWidth,
    verticalOverflow: Math.max(
      document.documentElement.scrollHeight,
      document.body.scrollHeight,
    ) - window.innerHeight,
    scrollX: window.scrollX,
    scrollY: window.scrollY,
  }))).toEqual({
    horizontalOverflow: 0,
    verticalOverflow: 0,
    scrollX: 0,
    scrollY: 0,
  });
}

async function expectWorkspaceSurfaceFullWidth(page: Page, testId: string): Promise<void> {
  await expect.poll(() => page.getByTestId(testId).evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const navigation = document.querySelector('nav[aria-label="Connection explorer"]');
    const surface = element.querySelector('[data-testid="query-editor-surface"]');
    const monaco = surface?.querySelector('.monaco-editor');
    if (!navigation || !surface || !monaco) return Number.POSITIVE_INFINITY;

    const navigationRect = navigation.getBoundingClientRect();
    const surfaceRect = surface.getBoundingClientRect();
    const monacoRect = monaco.getBoundingClientRect();
    return Math.round(Math.max(
      Math.abs(rect.left - navigationRect.right),
      Math.abs(window.innerWidth - rect.right),
      Math.abs(surfaceRect.left - monacoRect.left),
      Math.abs(surfaceRect.right - monacoRect.right),
    ));
  })).toBeLessThanOrEqual(1);
}

async function expectQueryEditorFullHeight(page: Page): Promise<void> {
  await expect.poll(() => page.getByTestId('query-editor').evaluate((element) => (
    Math.round(Math.abs(window.innerHeight - element.getBoundingClientRect().bottom))
  ))).toBeLessThanOrEqual(1);
}

async function expectQueryColumnsFillWidth(page: Page): Promise<void> {
  await expect.poll(() => page.getByTestId('query-documents-table-wrap').evaluate((wrapper) => {
    const lastHeader = wrapper.querySelector('th:last-child');
    if (!lastHeader) return Number.POSITIVE_INFINITY;
    return Math.round(Math.abs(
      wrapper.getBoundingClientRect().right - lastHeader.getBoundingClientRect().right,
    ));
  })).toBeLessThanOrEqual(2);
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
