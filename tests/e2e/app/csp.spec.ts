import { expect, test } from '../fixtures/mongog-test.js';
import { createE2EHarness } from '../helpers/harness.js';
import { setQueryEditorValue } from '../helpers/ui.js';

test('packaged renderer enforces the strict CSP without breaking Monaco or its workers', async ({ mongog }) => {
  test.setTimeout(120_000);
  const { launch, closeApplication, mongoUri, databaseName } = createE2EHarness(mongog);
  try {
    const page = await launch();
    const violations: string[] = [];
    page.on('console', (message) => {
      if (/Content Security Policy|Refused to/u.test(message.text())) violations.push(message.text());
    });

    const policy = await page.evaluate(async () => (await fetch(location.href)).headers.get('content-security-policy'));
    expect(policy).toContain("script-src 'self';");
    expect(policy).not.toContain('localhost');

    await page.getByRole('button', { name: 'New Connection', exact: true }).click();
    await page.getByLabel('Connection name').fill('CSP E2E');
    await page.getByLabel('Connection URI').fill(mongoUri);
    await page.getByLabel('Default database').fill(databaseName);
    await page.getByRole('button', { name: 'Test, Save & Connect' }).click();
    await expect(page.getByText('Connection tested, saved, and connected.')).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Open global search' }).click();
    await page.getByLabel('Search databases and collections').fill('inventory');
    await page.getByRole('option', { name: /inventory CSP E2E/ }).click();
    await expect(page.getByTestId('collection-documents-table').locator('tbody tr').first()).toBeVisible({ timeout: 15_000 });

    await page.getByRole('button', { name: 'Query', exact: true }).click();
    await setQueryEditorValue(page, 'db.coll');
    await page.keyboard.press('Control+Space');
    await expect(page.locator('.suggest-widget.visible')).toContainText('collection', { timeout: 15_000 });
    expect(violations).toEqual([]);
  } finally {
    await closeApplication();
  }
});
