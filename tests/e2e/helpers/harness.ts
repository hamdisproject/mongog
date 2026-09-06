import type { ElectronApplication, Page } from '@playwright/test';

import type { MongoGTestContext } from '../fixtures/mongog-test.js';

export interface E2EHarness {
  readonly application: ElectronApplication | null;
  readonly mongoUri: string;
  readonly databaseName: string;
  readonly userDataPath: string;
  launch(extraEnv?: Record<string, string>): Promise<Page>;
  closeApplication(): Promise<void>;
}

export function createE2EHarness(context: MongoGTestContext): E2EHarness {
  return {
    get application() { return context.application; },
    mongoUri: context.mongoUri,
    databaseName: context.databaseName,
    userDataPath: context.userDataPath,
    async launch(extraEnv = {}) {
      return (await context.launch(extraEnv)).page;
    },
    closeApplication: () => context.close(),
  };
}
