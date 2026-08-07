import { z } from 'zod';
import { basename } from 'node:path';
import { dialog, type BrowserWindow } from 'electron';
import { registerChannel, type SenderValidator } from './registry.js';
import {
  cursorCloseSchema,
  cursorFetchNextSchema,
  executeRequestSchema,
  executionCancelSchema,
  IpcChannels,
  createGroupSchema,
  updateGroupSchema,
  deleteGroupSchema,
  createProfileSchema,
  updateProfileSchema,
  deleteProfileSchema,
  connectSchema,
  disconnectSchema,
  getStateSchema,
  testConnectionSchema,
  connectionDraftRequestSchema,
  connExecuteSchema,
  connCursorFetchNextSchema,
  connCursorFetchPrevSchema,
  connCursorFetchFullSchema,
  connCursorCloseSchema,
  connOwnerCloseSchema,
  connExecutionCancelSchema,
  connListDatabasesSchema,
  connListCollectionsSchema,
  connCollectionFindSchema,
  connCollectionInsertSchema,
  connCollectionReplaceSchema,
  connCollectionDeleteSchema,
  sampleSchemaSchema,
  connIndexListSchema,
  connIndexCreateSchema,
  connIndexDropSchema,
  connExplainSchema,
  connGlobalSearchSchema,
  connChangeStartSchema,
  connChangePollSchema,
  connChangeCloseSchema,
  connGridFsListSchema,
  connGridFsUploadSchema,
  connGridFsDownloadSchema,
  connGridFsDeleteSchema,
  workspaceSaveSchema,
  type ExecuteResponse,
  type PingRuntimeResponse,
  type SystemInfoResponse,
} from '../../shared/ipc/index.js';
import type {
  CollectionDocumentsPage,
  CollectionMutationResult,
  DocumentsPage,
  SchemaSnapshot,
  ChangeStreamPollResult,
  ChangeStreamStartResult,
  GlobalSearchResult,
  GridFsFileInfo,
  GridFsUploadResult,
  IndexDescription,
  SaveAndConnectResult,
} from '../../shared/domain/index.js';
import type { EjsonEnvelope } from '../../shared/ejson/index.js';
import { appError } from '../../shared/errors/index.js';
import { RuntimeSupervisor } from '../runtime/supervisor.js';
import { RuntimeClient } from '../runtime/runtime-client.js';
import { resolveRuntimeEntry } from '../runtime/paths.js';
import { ConnectionManager, type ConnectionSecretStore } from '../services/connection-manager.js';
import type { Database } from '../storage/database.js';

export interface HandlerContext {
  supervisor: RuntimeSupervisor;
  getWindow: () => BrowserWindow | null;
  getSpikeMongoUri: () => Promise<string | null>;
  getDb: () => Database;
  secretStore: ConnectionSecretStore;
}

const emptySchema = z.object({}).strict();
const SPIKE_CONNECTION_ID = 'spike';

export function registerIpcHandlers(ctx: HandlerContext, validateSender: SenderValidator): void {
  const { supervisor } = ctx;
  const conn = new ConnectionManager(ctx.getDb(), supervisor, ctx.secretStore);
  const requireWritableConnection = (connectionId: string): void => {
    const profile = conn.getProfile(connectionId);
    if (!profile) throw appError('NotFound', `Connection profile not found: ${connectionId}`);
    if (profile.readOnly) {
      throw appError('ReadOnlyProtection', 'This connection is read-only; document changes are disabled.');
    }
  };

  // ── S1: Spike ping runtime ──
  registerChannel(
    IpcChannels.spikePingRuntime,
    emptySchema,
    async (): Promise<PingRuntimeResponse> => {
      const started = Date.now();
      const client = new RuntimeClient({
        entryPath: resolveRuntimeEntry(),
        connectionId: 'spike-ping',
      });
      try {
        await client.start();
        const res = await client.request<{ pong: boolean; pid: number }>('ping');
        return { pong: true, runtimePid: res.pid, roundTripMs: Date.now() - started };
      } finally {
        await client.kill();
      }
    },
    validateSender,
  );

  registerChannel(IpcChannels.spikeMongoUri, emptySchema, async () => ctx.getSpikeMongoUri(), validateSender);

  // ── S2/S3: Execute ──
  registerChannel(
    IpcChannels.spikeExecute,
    executeRequestSchema,
    async (payload): Promise<ExecuteResponse> => {
      const uri = await ctx.getSpikeMongoUri();
      if (!uri) {
        throw appError('InvalidConnectionString', 'No spike MongoDB available. Start with MONGOG_SPIKE_MONGO=1.');
      }
      const client = await supervisor.ensure(SPIKE_CONNECTION_ID, uri);
      return client.request<ExecuteResponse>('execute', { request: payload });
    },
    validateSender,
  );

  registerChannel(
    IpcChannels.cursorFetchNext,
    cursorFetchNextSchema,
    async ({ cursorId, pageSize }): Promise<DocumentsPage> => {
      const client = supervisor.get(SPIKE_CONNECTION_ID);
      if (!client) throw appError('UtilityProcessCrash', 'Query runtime is not running.');
      return client.request<DocumentsPage>('cursor-next', { cursorId, pageSize });
    },
    validateSender,
  );

  registerChannel(
    IpcChannels.cursorClose,
    cursorCloseSchema,
    async ({ cursorId }): Promise<void> => {
      const client = supervisor.get(SPIKE_CONNECTION_ID);
      if (!client) return;
      await client.request('cursor-close', { cursorId });
    },
    validateSender,
  );

  registerChannel(
    IpcChannels.executionCancel,
    executionCancelSchema,
    async ({ executionId }): Promise<void> => {
      const client = supervisor.get(SPIKE_CONNECTION_ID);
      if (!client) return;
      await client.request('cancel', { executionId });
    },
    validateSender,
  );

  registerChannel(
    IpcChannels.systemInfo,
    emptySchema,
    async (): Promise<SystemInfoResponse> => ({
      appVersion: process.env.npm_package_version ?? '0.0.1',
      electron: process.versions.electron ?? 'unknown',
      chrome: process.versions.chrome ?? 'unknown',
      node: process.versions.node ?? 'unknown',
      platform: process.platform,
    }),
    validateSender,
  );

  // ── Connection Groups ──
  registerChannel(IpcChannels.connListGroups, emptySchema, async () => conn.listGroups(), validateSender);
  registerChannel(IpcChannels.connCreateGroup, createGroupSchema, async ({ name }) => conn.createGroup(name), validateSender);
  registerChannel(IpcChannels.connUpdateGroup, updateGroupSchema, async (g) => {
    const existing = conn.listGroups().find((x) => x.id === g.id);
    if (!existing) throw appError('NotFound', `Group not found: ${g.id}`);
    conn.updateGroup({ ...existing, name: g.name, collapsed: g.collapsed, sortOrder: g.sortOrder });
  }, validateSender);
  registerChannel(IpcChannels.connDeleteGroup, deleteGroupSchema, async ({ id }) => conn.deleteGroup(id), validateSender);

  // ── Connection Profiles ──
  registerChannel(IpcChannels.connListProfiles, emptySchema, async () => conn.listProfiles(), validateSender);
  registerChannel(IpcChannels.connGetProfile, getStateSchema, async ({ profileId }) => conn.getProfile(profileId), validateSender);
  registerChannel(IpcChannels.connCreateProfile, createProfileSchema, async (input) => {
    return conn.createProfile({ ...input, groupId: input.groupId ?? null });
  }, validateSender);
  registerChannel(IpcChannels.connUpdateProfile, updateProfileSchema, async ({ id, ...input }) => {
    return conn.updateProfile(id, input);
  }, validateSender);
  registerChannel(IpcChannels.connDeleteProfile, deleteProfileSchema, async ({ id }) => conn.deleteProfile(id), validateSender);

  // ── Connectivity ──
  registerChannel(IpcChannels.connConnect, connectSchema, async ({ profileId }) => conn.connect(profileId), validateSender);
  registerChannel(IpcChannels.connDisconnect, disconnectSchema, async ({ profileId }) => conn.disconnect(profileId), validateSender);
  registerChannel(IpcChannels.connGetState, getStateSchema, async ({ profileId }) => conn.getConnectionState(profileId), validateSender);
  registerChannel(IpcChannels.connListConnected, emptySchema, async () => conn.listConnected(), validateSender);
  registerChannel(IpcChannels.connTest, testConnectionSchema, async ({ uri, options }) => conn.testConnection(uri, options), validateSender);
  registerChannel(
    IpcChannels.connTestDraft,
    connectionDraftRequestSchema,
    async (payload) => conn.testDraft(payload),
    validateSender,
  );
  registerChannel(
    IpcChannels.connSaveAndConnect,
    connectionDraftRequestSchema,
    async (payload): Promise<SaveAndConnectResult> => conn.saveAndConnect(payload),
    validateSender,
  );

  // ── Phase 2: Connection-aware query execution ──
  registerChannel(IpcChannels.connExecute, connExecuteSchema, async (payload) => {
    const client = supervisor.get(payload.connectionId);
    if (!client) throw appError('UtilityProcessCrash', `Connection ${payload.connectionId} is not running.`);
    return client.request<ExecuteResponse>('execute', { request: payload });
  }, validateSender);

  registerChannel(IpcChannels.connCursorFetchNext, connCursorFetchNextSchema, async ({ connectionId, cursorId, pageSize }) => {
    const client = supervisor.get(connectionId);
    if (!client) throw appError('UtilityProcessCrash', 'Query runtime is not running.');
    return client.request<DocumentsPage>('cursor-next', { cursorId, pageSize });
  }, validateSender);

  registerChannel(IpcChannels.connCursorFetchPrev, connCursorFetchPrevSchema, async ({ connectionId, cursorId }) => {
    const client = supervisor.get(connectionId);
    if (!client) throw appError('UtilityProcessCrash', 'Query runtime is not running.');
    return client.request<DocumentsPage>('cursor-prev', { cursorId });
  }, validateSender);

  registerChannel(
    IpcChannels.connCursorFetchFull,
    connCursorFetchFullSchema,
    async ({ connectionId, cursorId, fullValueId }): Promise<EjsonEnvelope> => {
      const client = supervisor.get(connectionId);
      if (!client) throw appError('UtilityProcessCrash', 'Query runtime is not running.');
      return client.request<EjsonEnvelope>('cursor-full', { cursorId, fullValueId });
    },
    validateSender,
  );

  registerChannel(IpcChannels.connCursorClose, connCursorCloseSchema, async ({ connectionId, cursorId }) => {
    const client = supervisor.get(connectionId);
    if (!client) return;
    await client.request('cursor-close', { cursorId });
  }, validateSender);

  registerChannel(IpcChannels.connOwnerClose, connOwnerCloseSchema, async ({ connectionId, tabId }) => {
    const client = supervisor.get(connectionId);
    if (!client) return;
    await client.request('owner-close', { connectionId, tabId });
  }, validateSender);

  registerChannel(IpcChannels.connExecutionCancel, connExecutionCancelSchema, async ({ connectionId, executionId }) => {
    const client = supervisor.get(connectionId);
    if (!client) return;
    const cooperativeCancel = client.request('cancel', { executionId })
      .then(() => true)
      .catch(() => false);
    const acknowledged = await Promise.race([
      cooperativeCancel,
      new Promise<false>((resolve) => {
        const timer = setTimeout(() => resolve(false), 750);
        timer.unref?.();
      }),
    ]);
    if (!acknowledged) {
      await supervisor.terminate(connectionId, 'Execution did not respond to cooperative cancellation.');
    }
  }, validateSender);

  registerChannel(IpcChannels.connListDatabases, connListDatabasesSchema, async ({ connectionId }) => {
    const client = supervisor.get(connectionId);
    if (!client) throw appError('UtilityProcessCrash', `Connection ${connectionId} is not running.`);
    return client.request<Array<{ name: string }>>('list-databases');
  }, validateSender);

  registerChannel(IpcChannels.connListCollections, connListCollectionsSchema, async ({ connectionId, database }) => {
    const client = supervisor.get(connectionId);
    if (!client) throw appError('UtilityProcessCrash', `Connection ${connectionId} is not running.`);
    return client.request<Array<{ name: string; type?: string }>>('list-collections', { database });
  }, validateSender);

  // ── Phase 3: Collection browser / document editor ──
  registerChannel(IpcChannels.connCollectionFind, connCollectionFindSchema, async (payload) => {
    const client = supervisor.get(payload.connectionId);
    if (!client) throw appError('UtilityProcessCrash', 'Query runtime is not running.');
    return client.request<CollectionDocumentsPage>('collection-find', payload);
  }, validateSender);

  registerChannel(IpcChannels.connCollectionInsert, connCollectionInsertSchema, async (payload) => {
    requireWritableConnection(payload.connectionId);
    const client = supervisor.get(payload.connectionId);
    if (!client) throw appError('UtilityProcessCrash', 'Query runtime is not running.');
    return client.request<CollectionMutationResult>('collection-insert', payload);
  }, validateSender);

  registerChannel(IpcChannels.connCollectionReplace, connCollectionReplaceSchema, async (payload) => {
    requireWritableConnection(payload.connectionId);
    const client = supervisor.get(payload.connectionId);
    if (!client) throw appError('UtilityProcessCrash', 'Query runtime is not running.');
    return client.request<CollectionMutationResult>('collection-replace', payload);
  }, validateSender);

  registerChannel(IpcChannels.connCollectionDelete, connCollectionDeleteSchema, async (payload) => {
    requireWritableConnection(payload.connectionId);
    const client = supervisor.get(payload.connectionId);
    if (!client) throw appError('UtilityProcessCrash', 'Query runtime is not running.');
    return client.request<CollectionMutationResult>('collection-delete', payload);
  }, validateSender);

  // ── Phase 4: Schema sampling ──
  registerChannel(IpcChannels.connSampleSchema, sampleSchemaSchema, async ({ connectionId, database, collection, sampleSize }) => {
    const client = supervisor.get(connectionId);
    if (!client) throw appError('UtilityProcessCrash', `Connection ${connectionId} is not running.`);
    const result = await client.request<Pick<SchemaSnapshot, 'fields' | 'sampledCount' | 'sampleSize'>>(
      'sample-schema',
      { database, collection, ...(sampleSize !== undefined ? { sampleSize } : {}) },
    );
    return {
      ...result,
      connectionId,
      database,
      collection,
      takenAt: Date.now(),
      ttlMs: 5 * 60 * 1000,
      inferred: true,
    } satisfies SchemaSnapshot;
  }, validateSender);

  // ── Phase 5: Administration ──
  registerChannel(IpcChannels.connIndexList, connIndexListSchema, async ({ connectionId, database, collection }) => {
    const client = supervisor.get(connectionId);
    if (!client) throw appError('UtilityProcessCrash', 'Query runtime is not running.');
    return client.request<IndexDescription[]>('index-list', { database, collection });
  }, validateSender);

  registerChannel(IpcChannels.connIndexCreate, connIndexCreateSchema, async (payload) => {
    requireWritableConnection(payload.connectionId);
    const client = supervisor.get(payload.connectionId);
    if (!client) throw appError('UtilityProcessCrash', 'Query runtime is not running.');
    return client.request<{ name: string }>('index-create', payload);
  }, validateSender);

  registerChannel(IpcChannels.connIndexDrop, connIndexDropSchema, async (payload) => {
    requireWritableConnection(payload.connectionId);
    const client = supervisor.get(payload.connectionId);
    if (!client) throw appError('UtilityProcessCrash', 'Query runtime is not running.');
    return client.request<{ dropped: string }>('index-drop', payload);
  }, validateSender);

  registerChannel(IpcChannels.connExplain, connExplainSchema, async (payload) => {
    const client = supervisor.get(payload.connectionId);
    if (!client) throw appError('UtilityProcessCrash', 'Query runtime is not running.');
    return client.request<EjsonEnvelope>('explain', payload);
  }, validateSender);

  registerChannel(IpcChannels.connGlobalSearch, connGlobalSearchSchema, async (payload) => {
    const client = supervisor.get(payload.connectionId);
    if (!client) throw appError('UtilityProcessCrash', 'Query runtime is not running.');
    return client.request<GlobalSearchResult>('global-search', {
      ...payload,
      maxCollections: payload.maxCollections ?? 50,
      maxDocumentsPerCollection: payload.maxDocumentsPerCollection ?? 500,
      maxResults: payload.maxResults ?? 100,
    });
  }, validateSender);

  registerChannel(IpcChannels.connChangeStart, connChangeStartSchema, async (payload) => {
    const client = supervisor.get(payload.connectionId);
    if (!client) throw appError('UtilityProcessCrash', 'Query runtime is not running.');
    return client.request<ChangeStreamStartResult>('change-start', payload);
  }, validateSender);

  registerChannel(IpcChannels.connChangePoll, connChangePollSchema, async ({ connectionId, streamId, maxEvents }) => {
    const client = supervisor.get(connectionId);
    if (!client) throw appError('UtilityProcessCrash', 'Query runtime is not running.');
    return client.request<ChangeStreamPollResult>('change-poll', {
      streamId,
      maxEvents: maxEvents ?? 50,
    });
  }, validateSender);

  registerChannel(IpcChannels.connChangeClose, connChangeCloseSchema, async ({ connectionId, streamId }) => {
    const client = supervisor.get(connectionId);
    if (!client) return;
    await client.request('change-close', { streamId });
  }, validateSender);

  registerChannel(IpcChannels.connGridFsList, connGridFsListSchema, async ({ connectionId, database, bucketName, limit }) => {
    const client = supervisor.get(connectionId);
    if (!client) throw appError('UtilityProcessCrash', 'Query runtime is not running.');
    return client.request<GridFsFileInfo[]>('gridfs-list', {
      database,
      bucketName,
      limit: limit ?? 200,
    });
  }, validateSender);

  registerChannel(IpcChannels.connGridFsUpload, connGridFsUploadSchema, async (payload) => {
    requireWritableConnection(payload.connectionId);
    const window = ctx.getWindow();
    const selection = window
      ? await dialog.showOpenDialog(window, { properties: ['openFile'] })
      : await dialog.showOpenDialog({ properties: ['openFile'] });
    if (selection.canceled || !selection.filePaths[0]) return { cancelled: true };
    const client = supervisor.get(payload.connectionId);
    if (!client) throw appError('UtilityProcessCrash', 'Query runtime is not running.');
    const value = await client.request<GridFsUploadResult>('gridfs-upload', {
      database: payload.database,
      bucketName: payload.bucketName,
      sourcePath: selection.filePaths[0],
      ...(payload.metadataEjson ? { metadataEjson: payload.metadataEjson } : {}),
    });
    return { cancelled: false, value };
  }, validateSender);

  registerChannel(IpcChannels.connGridFsDownload, connGridFsDownloadSchema, async (payload) => {
    const window = ctx.getWindow();
    const options = { defaultPath: basename(payload.filename) };
    const selection = window
      ? await dialog.showSaveDialog(window, options)
      : await dialog.showSaveDialog(options);
    if (selection.canceled || !selection.filePath) return { cancelled: true };
    const client = supervisor.get(payload.connectionId);
    if (!client) throw appError('UtilityProcessCrash', 'Query runtime is not running.');
    const value = await client.request<{ downloaded: true }>('gridfs-download', {
      database: payload.database,
      bucketName: payload.bucketName,
      idEjson: payload.idEjson,
      destinationPath: selection.filePath,
    });
    return { cancelled: false, value };
  }, validateSender);

  registerChannel(IpcChannels.connGridFsDelete, connGridFsDeleteSchema, async (payload) => {
    requireWritableConnection(payload.connectionId);
    const client = supervisor.get(payload.connectionId);
    if (!client) throw appError('UtilityProcessCrash', 'Query runtime is not running.');
    return client.request<{ deleted: true }>('gridfs-delete', payload);
  }, validateSender);

  // ── Workspace persistence ──
  registerChannel(IpcChannels.workspaceSave, workspaceSaveSchema, async ({ state }) => {
    ctx.getDb().workspace.upsert({
      version: 1,
      sidebarWidth: 260,
      expandedNodeKeys: [],
      tabs: state.tabs,
      activeTabId: state.activeTabId,
    });
  }, validateSender);

  registerChannel(IpcChannels.workspaceLoad, emptySchema, async () => {
    const ws = ctx.getDb().workspace.get();
    if (!ws) return null;
    return { tabs: ws.tabs, activeTabId: ws.activeTabId };
  }, validateSender);
}
