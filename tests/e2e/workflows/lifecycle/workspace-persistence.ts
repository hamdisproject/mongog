import { expect } from '../../fixtures/mongog-test.js';
import {
  collectionColumnNames,
  dragHorizontalSeparator,
  dragVerticalSeparator,
  dragWorkspaceTabBefore,
  expectQueryColumnsFillWidth,
  expectQueryEditorFullHeight,
  expectViewportLocked,
  expectWorkspaceSurfaceFullWidth,
  queryColumnNames,
  setMonacoValue,
  setQueryEditorValue,
} from '../../helpers/ui.js';
import type {
  LifecycleContext,
  LifecycleSettingsState,
  LifecycleState,
  LifecycleWorkspaceState,
} from './context.js';

export async function runWorkspacePersistence(
  context: LifecycleContext,
  state: LifecycleState,
): Promise<LifecycleWorkspaceState> {
  const { launch, closeApplication, databaseName } = context;
  let { page, explorer } = state;
  await page.locator('[title^="welcome: Welcome"]').click();
  await page.getByRole('button', { name: /E2E Local CONNECTED/ }).click();
  await expect(page.locator(`[title^="query: E2E Local · ${databaseName}"]`)).toBeVisible();
  await expect(page.getByTestId('query-results-region')).toHaveCount(0);
  await expectWorkspaceSurfaceFullWidth(page, 'query-editor');
  await expectQueryEditorFullHeight(page);

  await page.getByRole('button', { name: 'Open global search' }).click();
  const preRestartSearch = page.getByLabel('Search databases and collections');
  await preRestartSearch.fill('inventory');
  await expect(page.getByRole('option', { name: /inventory/ })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('option', { name: /inventory/ }).click();
  const queryTab = page.locator('[data-tab-kind="query"]').first();
  const collectionTab = page.locator('[data-tab-kind="collection"]').first();
  const queryTabId = await queryTab.getAttribute('data-tab-id');
  let collectionTabId = await collectionTab.getAttribute('data-tab-id');
  if (!queryTabId || !collectionTabId) throw new Error('Expected query and collection tab ids');

  await expect(queryTab).not.toHaveAttribute('draggable', 'true');
  await expect(queryTab.locator('[data-tab-drag-handle]')).toHaveAttribute('draggable', 'true');
  const queryCloseButton = queryTab.locator('[data-tab-close]');
  await expect(queryCloseButton).toBeVisible();
  const queryCloseBox = await queryCloseButton.boundingBox();
  expect(queryCloseBox?.width).toBeGreaterThanOrEqual(24);
  expect(queryCloseBox?.height).toBeGreaterThanOrEqual(24);

  await queryTab.locator('[data-tab-select]').click();
  await expect(queryTab).toHaveAttribute('data-tab-active', 'true');
  await collectionTab.locator('[data-tab-select]').focus();
  await page.keyboard.press('Space');
  await expect(collectionTab).toHaveAttribute('data-tab-active', 'true');
  await queryTab.locator('[data-tab-select]').focus();
  await page.keyboard.press('Enter');
  await expect(queryTab).toHaveAttribute('data-tab-active', 'true');
  await collectionTab.locator('[data-tab-select]').click();
  await expect(collectionTab).toHaveAttribute('data-tab-active', 'true');

  const preRestartQuantitySort = page.locator('[data-sort-column="quantity"]');
  await expect(preRestartQuantitySort).toBeVisible();
  await preRestartQuantitySort.click();
  await expect(preRestartQuantitySort).toHaveAttribute('aria-label', /sorted ascending, priority 1/);

  await dragWorkspaceTabBefore(page, collectionTabId, queryTabId);
  await expect.poll(async () => {
    const ids = await page.locator('[data-tab-id]').evaluateAll((elements) => (
      elements.map((element) => element.getAttribute('data-tab-id'))
    ));
    return ids.indexOf(collectionTabId) < ids.indexOf(queryTabId);
  }).toBe(true);

  await collectionTab.dblclick();
  await page.getByLabel('Tab name').fill('Inventory work');
  await page.getByLabel('Tab name').press('Enter');
  await expect(collectionTab).toHaveAttribute('title', /^collection: Inventory work/);

  await queryTab.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Rename Tab…' }).click();
  await page.getByLabel('Tab name').fill('Pinned query');
  await page.getByLabel('Tab name').press('Enter');
  await expect(queryTab).toHaveAttribute('title', /^query: Pinned query/);

  await page.locator('[data-tab-kind="settings"]').click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Rename Tab…' })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'Pin Tab' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu', { name: 'Context menu' })).toHaveCount(0);

  await queryTab.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Pin Tab' }).click();
  await expect(queryTab).toHaveAttribute('data-tab-pinned', 'true');
  const pinIcon = queryTab.getByRole('img', { name: 'Pinned tab', exact: true });
  await expect(pinIcon).toBeVisible();
  await expect(pinIcon).toHaveAttribute('data-testid', 'tab-pin-icon');
  await expect(pinIcon).not.toContainText('📍');
  await expect(page.getByTestId('pinned-tab-divider')).toBeVisible();
  await expect(page.locator('[data-tab-id]').first()).toHaveAttribute('data-tab-id', queryTabId);

  await queryTab.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Unpin Tab' }).click();
  await expect(queryTab).toHaveAttribute('data-tab-pinned', 'false');
  await expect(queryTab.getByTestId('tab-pin-icon')).toHaveCount(0);
  await queryTab.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Pin Tab' }).click();
  await expect(queryTab.getByRole('img', { name: 'Pinned tab', exact: true })).toBeVisible();
  await queryTab.click();
  await expectWorkspaceSurfaceFullWidth(page, 'query-editor');

  await page.getByTestId('save-query').click();
  let saveDialog = page.getByRole('dialog', { name: 'Save item' });
  await saveDialog.getByLabel('Saved item name').fill('E2E Saved Query');
  for (const folderName of ['Level 1', 'Level 2', 'Level 3']) {
    await saveDialog.getByRole('button', { name: '+ Folder' }).click();
    await saveDialog.getByLabel('New saved folder name').fill(folderName);
    await saveDialog.getByRole('button', { name: 'Create', exact: true }).click();
  }
  await saveDialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved · E2E Saved Query')).toBeVisible();

  await page.getByRole('button', { name: 'More save options' }).click();
  await page.getByRole('menuitem', { name: 'Save Tab…' }).click();
  saveDialog = page.getByRole('dialog', { name: 'Save item' });
  await saveDialog.getByLabel('Saved item name').fill('E2E Saved Tab');
  await saveDialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved · E2E Saved Tab')).toBeVisible();

  const profileBeforeRestart = explorer.getByRole('treeitem', { name: 'Connection E2E Local' });
  await profileBeforeRestart.focus();
  await page.keyboard.press('ArrowRight');
  const savedRootBeforeRestart = explorer.getByRole('treeitem', { name: 'Saved for E2E Local' });
  await expect(savedRootBeforeRestart).toBeVisible();
  await expect(savedRootBeforeRestart).toHaveAttribute('aria-expanded', 'true');
  await expect(explorer.getByRole('treeitem', { name: 'Saved folder Level 1' })).toBeVisible();
  await expect(explorer.locator('[data-saved-item-type="query"]')).toHaveCount(1);
  await expect(explorer.locator('[data-saved-item-type="tab"]')).toHaveCount(1);

  await dragHorizontalSeparator(page, page.getByTestId('sidebar-resizer'), 80);
  await expect(page.getByTestId('connection-explorer')).toHaveJSProperty('clientWidth', 340);
  await expectViewportLocked(page);

  await closeApplication();
  page = await launch();
  await expect(page.getByText('Welcome back')).toBeVisible();
  await expect(page.getByTestId('connection-explorer')).toHaveJSProperty('clientWidth', 340);
  await expect(page.locator('[title^="welcome: Welcome"]')).toHaveCount(1);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.locator('[data-tab-kind="settings"]').click();
  await expect(page.getByRole('radio', { name: 'MongoDB Shell data display' }))
    .toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('[data-tab-id]').first()).toHaveAttribute('data-tab-id', queryTabId);
  await expect(page.locator(`[data-tab-id="${queryTabId}"]`)).toHaveAttribute('data-tab-pinned', 'true');
  await expect(page.locator(`[data-tab-id="${queryTabId}"]`)).toHaveAttribute('title', /^query: Pinned query/);
  await expect(page.locator(`[data-tab-id="${collectionTabId}"]`)).toHaveAttribute('title', /^collection: Inventory work/);
  await expect(page.locator(`[data-collection-surface="${collectionTabId}"]`)).toHaveCount(0);
  explorer = page.getByRole('navigation', { name: 'Connection explorer' });
  return { page, explorer, queryTabId, collectionTabId };
}
