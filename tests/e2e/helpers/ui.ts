import { expect, type ElectronApplication, type Locator, type Page } from '@playwright/test';

export async function expectQueryErrorOnLine(page: Page, text: string): Promise<void> {
  await expect.poll(() => page.getByTestId('query-editor-surface').evaluate((surface, text) => {
    const line = [...surface.querySelectorAll('.view-line')].find(line=>line.textContent?.includes(text));
    if (!line) return false;
    const bounds=line.getBoundingClientRect();
    return [...surface.querySelectorAll('.squiggly-error')].some(marker=> {
      const rect=marker.getBoundingClientRect();
      return rect.top >= bounds.top && rect.top < bounds.bottom;
    });
  }, text), {timeout:15000}).toBe(true);
}

export async function setMonacoValue(page: Page, label: string, value: string): Promise<void> {
  const kind = label.replace('Collection ', '');
  await page.getByTestId(`criteria-editor-${kind}`).evaluate((element) => {
    (element as HTMLElement).click();
  });
  await expect(page.getByLabel(label)).toBeFocused();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.keyboard.press('Backspace');
  await page.keyboard.insertText(value);
}

export async function setQueryEditorValue(page: Page, value: string): Promise<void> {
  await page.getByTestId('query-editor-surface').click();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.keyboard.press('Backspace');
  await page.keyboard.insertText(value);
}

export async function setEditorValueByLabel(
  page: Page,
  application: ElectronApplication,
  label: string,
  value: string,
): Promise<void> {
  await page.getByLabel(label).focus();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.keyboard.press('Backspace');
  await application.evaluate(({ clipboard }, text) => clipboard.writeText(text), value);
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+V' : 'Control+V');
}

export async function expectCancelBelowSpinner(overlay: Locator): Promise<void> {
  const spinner = await overlay.locator('.loading-overlay-spinner').boundingBox();
  const cancel = await overlay.getByRole('button', { name: 'Cancel' }).boundingBox();
  if (!spinner || !cancel) throw new Error('Expected loading spinner and Cancel button bounds');
  expect(cancel.y).toBeGreaterThan(spinner.y + spinner.height);
}

export async function collectionColumnNames(page: Page): Promise<string[]> {
  return page.getByTestId('collection-documents-table').locator('[data-sort-column]')
    .evaluateAll((elements) => elements.map((element) => element.getAttribute('data-sort-column') ?? ''));
}

export async function queryColumnNames(page: Page): Promise<string[]> {
  return page.getByTestId('query-documents-table').locator('thead th')
    .evaluateAll((elements) => elements.map((element) => element.textContent?.trim() ?? ''));
}

export async function dragVerticalSeparator(page: Page, separator: ReturnType<Page['locator']>, deltaY: number): Promise<void> {
  const box = await separator.boundingBox();
  if (!box) throw new Error('Vertical resize handle is missing');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  const pointerId = 1;
  await separator.dispatchEvent('pointerdown', {
    clientX: x,
    clientY: y,
    pointerId,
    pointerType: 'mouse',
    isPrimary: true,
    button: 0,
    buttons: 1,
    bubbles: true,
  });
  await page.evaluate(({ clientX, clientY, movement, id }) => {
    const steps = 6;
    for (let step = 1; step <= steps; step += 1) {
      window.dispatchEvent(new PointerEvent('pointermove', {
        clientX,
        clientY: clientY + (movement * step) / steps,
        pointerId: id,
        pointerType: 'mouse',
        isPrimary: true,
        button: -1,
        buttons: 1,
        bubbles: true,
      }));
    }
    window.dispatchEvent(new PointerEvent('pointerup', {
      clientX,
      clientY: clientY + movement,
      pointerId: id,
      pointerType: 'mouse',
      isPrimary: true,
      button: 0,
      buttons: 0,
      bubbles: true,
    }));
  }, { clientX: x, clientY: y, movement: deltaY, id: pointerId });
}

export async function dragHorizontalSeparator(page: Page, separator: ReturnType<Page['locator']>, deltaX: number): Promise<void> {
  const box = await separator.boundingBox();
  if (!box) throw new Error('Horizontal resize handle is missing');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  const pointerId = 2;
  await separator.dispatchEvent('pointerdown', {
    clientX: x,
    clientY: y,
    pointerId,
    pointerType: 'mouse',
    isPrimary: true,
    button: 0,
    buttons: 1,
    bubbles: true,
  });
  await page.evaluate(({ clientX, clientY, movement, id }) => {
    const steps = 6;
    for (let step = 1; step <= steps; step += 1) {
      window.dispatchEvent(new PointerEvent('pointermove', {
        clientX: clientX + (movement * step) / steps,
        clientY,
        pointerId: id,
        pointerType: 'mouse',
        isPrimary: true,
        button: -1,
        buttons: 1,
        bubbles: true,
      }));
    }
    window.dispatchEvent(new PointerEvent('pointerup', {
      clientX: clientX + movement,
      clientY,
      pointerId: id,
      pointerType: 'mouse',
      isPrimary: true,
      button: 0,
      buttons: 0,
      bubbles: true,
    }));
  }, { clientX: x, clientY: y, movement: deltaX, id: pointerId });
}

export async function dragWorkspaceTabBefore(page: Page, sourceId: string, targetId: string): Promise<void> {
  await page.evaluate(({ sourceId: source, targetId: target }) => {
    const sourceElement = document.querySelector<HTMLElement>(
      `[data-tab-id="${CSS.escape(source)}"] [data-tab-drag-handle]`,
    );
    const targetElement = document.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(target)}"]`);
    if (!sourceElement || !targetElement) throw new Error('Workspace tab drag target is missing');
    const dataTransfer = new DataTransfer();
    const targetRect = targetElement.getBoundingClientRect();
    sourceElement.dispatchEvent(new DragEvent('dragstart', {
      bubbles: true,
      cancelable: true,
      dataTransfer,
    }));
    targetElement.dispatchEvent(new DragEvent('dragover', {
      bubbles: true,
      cancelable: true,
      clientX: targetRect.left + 2,
      clientY: targetRect.top + targetRect.height / 2,
      dataTransfer,
    }));
    targetElement.dispatchEvent(new DragEvent('drop', {
      bubbles: true,
      cancelable: true,
      clientX: targetRect.left + 2,
      clientY: targetRect.top + targetRect.height / 2,
      dataTransfer,
    }));
    sourceElement.dispatchEvent(new DragEvent('dragend', {
      bubbles: true,
      cancelable: true,
      dataTransfer,
    }));
  }, { sourceId, targetId });
}

export async function expectViewportLocked(page: Page): Promise<void> {
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

export async function expectWorkspaceSurfaceFullWidth(page: Page, testId: string): Promise<void> {
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

export async function expectQueryEditorFullHeight(page: Page): Promise<void> {
  await expect.poll(() => page.getByTestId('query-editor').evaluate((element) => (
    Math.round(Math.abs(window.innerHeight - element.getBoundingClientRect().bottom))
  ))).toBeLessThanOrEqual(1);
}

export async function expectQueryColumnsFillWidth(page: Page): Promise<void> {
  await expect.poll(() => page.getByTestId('query-documents-table-wrap').evaluate((wrapper) => {
    const table = wrapper.querySelector('table');
    const headerRow = wrapper.querySelector('thead tr');
    const lastHeader = wrapper.querySelector('th:last-child');
    if (!table || !headerRow || !lastHeader) return Number.POSITIVE_INFINITY;
    const tableRect = table.getBoundingClientRect();
    const headerRowRect = headerRow.getBoundingClientRect();
    const lastHeaderRect = lastHeader.getBoundingClientRect();
    return Math.round(Math.max(
      // A table must fill the visible viewport, but it may legitimately be
      // wider when its minimum column widths require horizontal scrolling.
      Math.max(0, wrapper.clientWidth - tableRect.width),
      Math.abs(tableRect.width - headerRowRect.width),
      Math.abs(tableRect.right - lastHeaderRect.right),
    ));
  })).toBeLessThanOrEqual(2);
}
