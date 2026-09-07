import { test, type MongoGTestContext } from '../fixtures/mongog-test.js';
import { createE2EHarness } from '../helpers/harness.js';
import type { LifecycleContext } from './lifecycle/context.js';
import { runDocumentsAndSavedLibrary } from './lifecycle/documents-library.js';
import { runExplorerAndAdministration } from './lifecycle/explorer-admin.js';
import { runQueryResultsAndCleanup } from './lifecycle/query-results.js';
import {
  runConnectionManagement,
  runDataTransfer,
  runGroupManagement,
  runWelcomeConnectionsAndGroups,
  runWelcomeReleaseAndSettings,
} from './lifecycle/welcome-connections.js';
import { runWorkspacePersistence } from './lifecycle/workspace-persistence.js';

function lifecycleContext(mongog: MongoGTestContext): LifecycleContext {
  const harness = createE2EHarness(mongog);
  const exportPrefix = harness.databaseName.replace(/[^a-z0-9_-]/giu, '_');
  return {
    harness,
    launch: harness.launch,
    closeApplication: harness.closeApplication,
    mongoUri: harness.mongoUri,
    databaseName: harness.databaseName,
    userDataPath: harness.userDataPath,
    csvPattern: new RegExp(`^${exportPrefix}_inventory_.*\\.csv$`, 'u'),
    textPattern: new RegExp(`^${exportPrefix}_inventory_.*\\.txt$`, 'u'),
  };
}

test('Welcome and release notes start from clean application state', async ({ mongog }) => {
  await runWelcomeReleaseAndSettings(lifecycleContext(mongog));
});

test('connection and group management are independent', async ({ mongog }) => {
  const context = lifecycleContext(mongog);
  const page = await runWelcomeReleaseAndSettings(context);
  const connected = await runConnectionManagement(context, page);
  await runGroupManagement(connected);
});

test('data transfer imports into the test-owned database', async ({ mongog }) => {
  const context = lifecycleContext(mongog);
  const page = await runWelcomeReleaseAndSettings(context);
  const connected = await runConnectionManagement(context, page);
  await runDataTransfer(context, connected);
});

test('workspace tabs, saved items, and relaunch persistence are independent', async ({ mongog }) => {
  const context = lifecycleContext(mongog);
  const connected = await runWelcomeConnectionsAndGroups(context);
  await runWorkspacePersistence(context, connected);
});

test('connection lifecycle, explorer, and administration are independent', async ({ mongog }) => {
  const context = lifecycleContext(mongog);
  const connected = await runWelcomeConnectionsAndGroups(context);
  const workspace = await runWorkspacePersistence(context, connected);
  await runExplorerAndAdministration(context, workspace);
});

test('documents, saved library, and export are independent', async ({ mongog }) => {
  const context = lifecycleContext(mongog);
  const connected = await runWelcomeConnectionsAndGroups(context);
  const workspace = await runWorkspacePersistence(context, connected);
  const settings = await runExplorerAndAdministration(context, workspace);
  await runDocumentsAndSavedLibrary(context, settings);
});

test('query results, clipboard, export, and cleanup are independent', async ({ mongog }) => {
  const context = lifecycleContext(mongog);
  const connected = await runWelcomeConnectionsAndGroups(context);
  const workspace = await runWorkspacePersistence(context, connected);
  const settings = await runExplorerAndAdministration(context, workspace);
  const documents = await runDocumentsAndSavedLibrary(context, settings);
  await runQueryResultsAndCleanup(context, documents);
});
