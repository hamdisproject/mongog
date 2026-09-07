import type { Locator, Page } from '@playwright/test';

import type { E2EHarness } from '../../helpers/harness.js';

export interface LifecycleContext {
  harness: E2EHarness;
  launch: E2EHarness['launch'];
  closeApplication: E2EHarness['closeApplication'];
  mongoUri: string;
  databaseName: string;
  userDataPath: string;
  csvPattern: RegExp;
  textPattern: RegExp;
}

export interface LifecycleState {
  page: Page;
  explorer: Locator;
}

export interface LifecycleWorkspaceState extends LifecycleState {
  queryTabId: string;
  collectionTabId: string;
}

export interface LifecycleSettingsState extends LifecycleWorkspaceState {
  alphabeticalColumnOrder: Locator;
  documentColumnOrder: Locator;
  documentsTable: Locator;
  quantityHeader: Locator;
}
