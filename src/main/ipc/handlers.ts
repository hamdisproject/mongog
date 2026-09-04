import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { app, dialog, type BrowserWindow } from 'electron';
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
  connFetchCancelSchema,
  connOwnerCloseSchema,
  connExecutionCancelSchema,
  connListDatabasesSchema,
  connListCollectionsSchema,
  connCollectionFindSchema,
  connCollectionCountSchema,
  connCollectionInsertSchema,
  connCollectionReplaceSchema,
  connCollectionBulkUpdateSchema,
  connCollectionBulkDeleteSchema,
  connCollectionDeleteSchema,
  connCollectionRenameSchema,
  connCollectionDropSchema,
  connDatabaseDropSchema,
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
  settingsSaveSchema,
  savedCreateFolderSchema,
  savedUpdateFolderSchema,
  savedDeleteFolderSchema,
  savedCreateItemSchema,
  savedUpdateItemSchema,
  savedDeleteItemSchema,
  auditListSchema,
  auditSummarySchema,
  auditDeleteSchema,
  auditClearSchema,
  exportCollectionSchema,
  exportQueryResultSchema,
  exportCancelSchema,
  dataTransferSelectFilesSchema,
  dataTransferPreviewFileSchema,
  dataTransferPreviewCollectionSchema,
  dataTransferCountCollectionSchema,
  dataTransferStartFileImportSchema,
  dataTransferStartConnectionCopySchema,
  dataTransferCancelSchema,
  dataTransferSaveErrorReportSchema,
  updatesCheckSchema,
  updatesInstallSchema,
  updatesDismissSchema,
  type ExecuteResponse,
  type PingRuntimeResponse,
  type QueryCancelResult,
  type SystemInfoResponse,
  type UpdateCheckResult,
} from '../../shared/ipc/index.js';
import {
  DEFAULT_SETTINGS,
  normalizeApplicationSettings,
  normalizeSidebarWidth,
} from '../../shared/domain/workspace.js';
import type {
  CollectionBulkDeleteResult,
  CollectionBulkUpdateResult,
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
  SavedFolder,
  SavedItem,
  SavedLibrarySnapshot,
  DeleteSavedFolderResult,
  ExportStartResult,
  DataFileDescriptor,
  DataFilePreview,
  CollectionTransferPreview,
  DataJobStartResult,
} from '../../shared/domain/index.js';
import type { EjsonEnvelope } from '../../shared/ejson/index.js';
import { appError } from '../../shared/errors/index.js';
import { containsKnownSecretMaterial } from '../../shared/redaction/index.js';
import { RuntimeSupervisor } from '../runtime/supervisor.js';
import { RuntimeClient } from '../runtime/runtime-client.js';
import { resolveRuntimeEntry } from '../runtime/paths.js';
import { ConnectionManager, type ConnectionSecretStore } from '../services/connection-manager.js';
import { AuditService, type AuditContext } from '../services/audit-service.js';
import type { Database } from '../storage/database.js';
import { buildExportFilename, exportDialogFilters } from '../export/filename.js';
import type { DataTransferCoordinator } from '../data-transfer/coordinator.js';
import type { UpdateService } from '../services/update-service.js';

export interface HandlerContext {
  supervisor: RuntimeSupervisor;
  getWindow: () => BrowserWindow | null;
  getSpikeMongoUri: () => Promise<string | null>;
  getDb: () => Database;
  secretStore: ConnectionSecretStore;
  audit: AuditService;
  dataTransfer: DataTransferCoordinator;
  updates: UpdateService;
}

const emptySchema = z.object({}).strict();
const SPIKE_CONNECTION_ID = 'spike';

export function registerIpcHandlers(ctx: HandlerContext, validateSender: SenderValidator): void {
  const { supervisor } = ctx;
  const conn = new ConnectionManager(ctx.getDb(), supervisor, ctx.secretStore);
  const auditContext = (
    connectionId: string | undefined,
    context: Omit<AuditContext, 'connectionId' | 'connectionName'>,
  ): AuditContext => ({
    ...context,
    ...(connectionId ? { connectionId } : {}),
    connectionName: connectionId
      ? conn.getProfile(connectionId)?.name ?? 'Deleted connection'
      : 'Temporary connection',
  });
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
      appVersion: app.getVersion(),
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
  registerChannel(IpcChannels.connDeleteProfile, deleteProfileSchema, async ({ id }) => ctx.audit.run(
    auditContext(id, {
      category: 'connection', action: 'connection.delete', origin: 'user', operationClass: 'connection',
      summary: 'Delete connection profile and close its runtime',
    }),
    () => conn.deleteProfile(id),
  ), validateSender);

  // ── Connectivity ──
  registerChannel(IpcChannels.connConnect, connectSchema, async ({ profileId }) => ctx.audit.run(
    auditContext(profileId, {
      category: 'connection', action: 'connection.connect', origin: 'user', operationClass: 'connection',
      summary: 'Connect to MongoDB',
    }),
    () => conn.connect(profileId),
  ), validateSender);
  registerChannel(IpcChannels.connDisconnect, disconnectSchema, async ({ profileId }) => ctx.audit.run(
    auditContext(profileId, {
      category: 'connection', action: 'connection.disconnect', origin: 'user', operationClass: 'connection',
      summary: 'Disconnect from MongoDB',
    }),
    () => conn.disconnect(profileId),
  ), validateSender);
  registerChannel(IpcChannels.connGetState, getStateSchema, async ({ profileId }) => conn.getConnectionState(profileId), validateSender);
  registerChannel(IpcChannels.connListConnected, emptySchema, async () => conn.listConnected(), validateSender);
  registerChannel(IpcChannels.connTest, testConnectionSchema, async ({ uri, options }) => ctx.audit.run(
    auditContext(undefined, {
      category: 'connection', action: 'connection.test', origin: 'user', operationClass: 'connection',
      summary: 'Test temporary MongoDB connection',
    }),
    () => conn.testConnection(uri, options),
    (result) => result.ok
      ? { resultCount: 1 }
      : { status: 'error', errorCategory: result.error?.category, errorMessage: result.error?.message },
  ), validateSender);
  registerChannel(
    IpcChannels.connTestDraft,
    connectionDraftRequestSchema,
    async (payload) => ctx.audit.run(
      auditContext(payload.profileId, {
        category: 'connection', action: 'connection.test-draft', origin: 'user', operationClass: 'connection',
        summary: `Test connection draft "${payload.draft.name}"`,
      }),
      () => conn.testDraft(payload),
      (result) => result.ok
        ? { resultCount: 1 }
        : { status: 'error', errorCategory: result.error?.category, errorMessage: result.error?.message },
    ),
    validateSender,
  );
  registerChannel(
    IpcChannels.connSaveAndConnect,
    connectionDraftRequestSchema,
    async (payload): Promise<SaveAndConnectResult> => ctx.audit.run(
      auditContext(payload.profileId, {
        category: 'connection', action: 'connection.save-connect', origin: 'user', operationClass: 'connection',
        summary: `Test, save and connect "${payload.draft.name}"`,
      }),
      () => conn.saveAndConnect(payload, {
        test: (operation) => ctx.audit.run(
          auditContext(payload.profileId, {
            category: 'connection', action: 'connection.save-connect.test', origin: 'user', operationClass: 'connection',
            summary: `Validate connection draft "${payload.draft.name}"`,
          }),
          operation,
          (result) => result.ok
            ? { resultCount: 1 }
            : { status: 'error', errorCategory: result.error?.category, errorMessage: result.error?.message },
        ),
        connect: (profile, operation) => ctx.audit.run(
          auditContext(profile.id, {
            category: 'connection', action: 'connection.save-connect.connect', origin: 'user', operationClass: 'connection',
            summary: `Connect saved profile "${profile.name}"`,
          }),
          operation,
        ),
      }),
      (result) => result.connected
        ? { resultCount: 1 }
        : {
            status: 'error',
            errorCategory: result.connectionError?.category ?? result.test.error?.category,
            errorMessage: result.connectionError?.message ?? result.test.error?.message,
          },
    ),
    validateSender,
  );

  // ── Phase 2: Connection-aware query execution ──
  registerChannel(IpcChannels.connExecute, connExecuteSchema, async (payload) => {
    const runId = payload.runId ?? randomUUID();
    ctx.audit.beginQuery(auditContext(payload.connectionId, {
      correlationId: runId,
      database: payload.database,
      category: 'query', action: 'query.execute', origin: 'user', operationClass: 'read',
      summary: `Execute ${payload.mode} query`,
      detail: { source: payload.source, mode: payload.mode },
    }) as AuditContext & { correlationId: string });
    try {
      const client = supervisor.get(payload.connectionId);
      if (!client) throw appError('UtilityProcessCrash', `Connection ${payload.connectionId} is not running.`);
      return await client.request<ExecuteResponse>('execute', { request: { ...payload, runId } });
    } catch (error) {
      ctx.audit.failQueryStart(runId, error);
      throw error;
    }
  }, validateSender);

  registerChannel(IpcChannels.connCursorFetchNext, connCursorFetchNextSchema, async ({ connectionId, cursorId, pageSize, operationId }) => {
    return ctx.audit.run(auditContext(connectionId, {
      category: 'cursor', action: 'cursor.next', origin: 'background', operationClass: 'background',
      summary: 'Fetch next cursor page',
    }), async () => {
      const client = supervisor.get(connectionId);
      if (!client) throw appError('UtilityProcessCrash', 'Query runtime is not running.');
      return client.request<DocumentsPage>('cursor-next', { cursorId, pageSize, operationId });
    }, (page) => ({ resultCount: page.documents.length }));
  }, validateSender);

  registerChannel(IpcChannels.connCursorFetchPrev, connCursorFetchPrevSchema, async ({ connectionId, cursorId, operationId }) => {
    return ctx.audit.run(auditContext(connectionId, {
      category: 'cursor', action: 'cursor.previous', origin: 'background', operationClass: 'background',
      summary: 'Fetch previous cursor page',
    }), async () => {
      const client = supervisor.get(connectionId);
      if (!client) throw appError('UtilityProcessCrash', 'Query runtime is not running.');
      return client.request<DocumentsPage>('cursor-prev', { cursorId, operationId });
    }, (page) => ({ resultCount: page.documents.length }));
  }, validateSender);

  registerChannel(
    IpcChannels.connCursorFetchFull,
    connCursorFetchFullSchema,
    async ({ connectionId, cursorId, fullValueId }): Promise<EjsonEnvelope> => {
      return ctx.audit.run(auditContext(connectionId, {
        category: 'cursor', action: 'cursor.full-value', origin: 'background', operationClass: 'background',
        summary: 'Fetch full cursor value',
      }), async () => {
        const client = supervisor.get(connectionId);
        if (!client) throw appError('UtilityProcessCrash', 'Query runtime is not running.');
        return client.request<EjsonEnvelope>('cursor-full', { cursorId, fullValueId });
      });
    },
    validateSender,
  );

  registerChannel(IpcChannels.connCursorClose, connCursorCloseSchema, async ({ connectionId, cursorId }) => {
    await ctx.audit.run(auditContext(connectionId, {
      category: 'cursor', action: 'cursor.close', origin: 'system', operationClass: 'background',
      summary: 'Close query cursor',
    }), async () => {
      const client = supervisor.get(connectionId);
      if (!client) return;
      await client.request('cursor-close', { cursorId });
    });
  }, validateSender);

  registerChannel(IpcChannels.connFetchCancel, connFetchCancelSchema, async ({ connectionId, operationId }) => {
    return ctx.audit.run(auditContext(connectionId, {
      category: 'cursor', action: 'cursor.fetch-cancel', origin: 'user', operationClass: 'background',
      summary: 'Cancel cursor fetch',
    }), async () => {
      const client = supervisor.get(connectionId);
      if (!client) return { cancelled: false };
      return client.request<{ cancelled: boolean }>('fetch-cancel', { operationId });
    });
  }, validateSender);

  registerChannel(IpcChannels.connOwnerClose, connOwnerCloseSchema, async ({ connectionId, tabId }) => {
    await ctx.audit.run(auditContext(connectionId, {
      category: 'cursor', action: 'cursor.close-owner', origin: 'system', operationClass: 'background',
      summary: 'Close tab-owned cursors',
    }), async () => {
      const client = supervisor.get(connectionId);
      if (!client) return;
      await client.request('owner-close', { connectionId, tabId });
    });
  }, validateSender);

  registerChannel(IpcChannels.connExecutionCancel, connExecutionCancelSchema, async ({ connectionId, executionId }) => {
    return ctx.audit.run(auditContext(connectionId, {
      correlationId: executionId,
      category: 'query', action: 'query.cancel', origin: 'user', operationClass: 'admin',
      summary: 'Cancel query execution',
    }), async (): Promise<QueryCancelResult> => {
      const client = supervisor.get(connectionId);
      if (!client) return { cancelled: false, outcome: 'not-found' };
      const executionContext = supervisor.getExecutionContext(connectionId, executionId);
      const cooperativeCancel = client.request('cancel', { executionId })
        .then((value) => ({ kind: 'response' as const, value: value as { cancelled: boolean } }))
        .catch(() => ({ kind: 'error' as const }));
      let timer: NodeJS.Timeout | undefined;
      const outcome = await Promise.race([
        cooperativeCancel,
        new Promise<{ kind: 'timeout' }>((resolve) => {
          timer = setTimeout(() => resolve({ kind: 'timeout' }), 750);
          timer.unref?.();
        }),
      ]);
      if (timer) clearTimeout(timer);

      if (outcome.kind === 'response') {
        return outcome.value.cancelled
          ? { cancelled: true, outcome: 'cooperative' }
          : { cancelled: false, outcome: 'not-found' };
      }

      // The runtime either stopped responding or could not prove that the
      // underlying script settled. Kill its sockets, then reconnect from the
      // supervisor's in-memory connection configuration.
      try {
        await supervisor.restart(connectionId, {
          executionId,
          ...(executionContext?.runId ? { runId: executionContext.runId } : {}),
          reason: outcome.kind === 'timeout'
            ? 'Execution remained active after cooperative cancellation.'
            : 'Execution cancellation request failed.',
        });
      } catch {
        // restart() already emitted the connection error state. Cancellation
        // itself succeeded through the hard process stop and must not become a
        // red query error if reconnecting fails.
      }
      return { cancelled: true, outcome: 'runtime-restarted' };
    });
  }, validateSender);

  registerChannel(IpcChannels.connListDatabases, connListDatabasesSchema, async ({ connectionId }) => {
    return ctx.audit.run(auditContext(connectionId, {
      category: 'administration', action: 'database.list', origin: 'background', operationClass: 'background',
      summary: 'List databases',
    }), async () => {
      const client = supervisor.get(connectionId);
      if (!client) throw appError('UtilityProcessCrash', `Connection ${connectionId} is not running.`);
      return client.request<Array<{ name: string }>>('list-databases');
    }, (items) => ({ resultCount: items.length }));
  }, validateSender);

  registerChannel(IpcChannels.connListCollections, connListCollectionsSchema, async ({ connectionId, database }) => {
    return ctx.audit.run(auditContext(connectionId, {
      database,
      category: 'administration', action: 'collection.list', origin: 'background', operationClass: 'background',
      summary: 'List collections',
    }), async () => {
      const client = supervisor.get(connectionId);
      if (!client) throw appError('UtilityProcessCrash', `Connection ${connectionId} is not running.`);
      return client.request<Array<{ name: string; type?: string }>>('list-collections', { database });
    }, (items) => ({ resultCount: items.length }));
  }, validateSender);

  // ── Phase 3: Collection browser / document editor ──
  registerChannel(IpcChannels.connCollectionFind, connCollectionFindSchema, async (payload) => {
    return ctx.audit.run(auditContext(payload.connectionId, {
      database: payload.database, collection: payload.collection,
      category: 'documents', action: 'documents.find', origin: 'user', operationClass: 'read',
      summary: 'Find collection documents',
      detail: {
        filter: payload.filterEjson,
        ...(payload.sortEjson ? { sort: payload.sortEjson } : {}),
        ...(payload.projectionEjson ? { projection: payload.projectionEjson } : {}),
      },
    }), async () => {
      const client = supervisor.get(payload.connectionId);
      if (!client) throw appError('UtilityProcessCrash', 'Query runtime is not running.');
      return client.request<CollectionDocumentsPage>('collection-find', payload);
    }, (page) => ({ resultCount: page.documents.length }));
  }, validateSender);

  registerChannel(IpcChannels.connCollectionCount, connCollectionCountSchema, async (payload) => {
    return ctx.audit.run(auditContext(payload.connectionId, {
      database: payload.database, collection: payload.collection,
      category: 'documents', action: 'documents.count', origin: 'user', operationClass: 'read',
      summary: 'Count matching documents', detail: { filter: payload.filterEjson },
    }), async () => {
      const client = supervisor.get(payload.connectionId);
      if (!client) throw appError('UtilityProcessCrash', 'Query runtime is not running.');
      return client.request<{ count: number }>('collection-count', payload);
    }, (result) => ({ resultCount: result.count }));
  }, validateSender);

  registerChannel(IpcChannels.connCollectionInsert, connCollectionInsertSchema, async (payload) => {
    return ctx.audit.run(auditContext(payload.connectionId, {
      database: payload.database, collection: payload.collection,
      category: 'documents', action: 'documents.insert', origin: 'user', operationClass: 'write',
      summary: 'Insert document',
    }), async () => {
      requireWritableConnection(payload.connectionId);
      const client = supervisor.get(payload.connectionId);
      if (!client) throw appError('UtilityProcessCrash', 'Query runtime is not running.');
      return client.request<CollectionMutationResult>('collection-insert', payload);
    }, (result) => ({ affectedCount: result.acknowledged ? 1 : 0 }));
  }, validateSender);

  registerChannel(IpcChannels.connCollectionReplace, connCollectionReplaceSchema, async (payload) => {
    return ctx.audit.run(auditContext(payload.connectionId, {
      database: payload.database, collection: payload.collection,
      category: 'documents', action: 'documents.replace', origin: 'user', operationClass: 'write',
      summary: 'Replace document',
    }), async () => {
      requireWritableConnection(payload.connectionId);
      const client = supervisor.get(payload.connectionId);
      if (!client) throw appError('UtilityProcessCrash', 'Query runtime is not running.');
      return client.request<CollectionMutationResult>('collection-replace', payload);
    }, (result) => ({ affectedCount: result.modifiedCount ?? result.matchedCount ?? 0 }));
  }, validateSender);

  registerChannel(IpcChannels.connCollectionBulkUpdate, connCollectionBulkUpdateSchema, async (payload) => {
    return ctx.audit.run(auditContext(payload.connectionId, {
      database: payload.database, collection: payload.collection,
      category: 'documents', action: 'documents.bulk-update', origin: 'user', operationClass: 'write',
      summary: 'Bulk update selected documents',
      detail: {
        mode: payload.change.kind,
        requestedCount: payload.originalDocumentsEjson.length,
        ...(payload.change.kind === 'field'
          ? { fieldPath: payload.change.path, fieldOperation: payload.change.operation }
          : {}),
      },
    }), async () => {
      requireWritableConnection(payload.connectionId);
      const client = supervisor.get(payload.connectionId);
      if (!client) throw appError('UtilityProcessCrash', 'Query runtime is not running.');
      return client.request<CollectionBulkUpdateResult>('collection-bulk-update', payload);
    }, (result) => ({
      affectedCount: result.modifiedCount,
      resultCount: result.matchedCount,
      ...(result.failedCount > 0
        ? {
          status: 'error' as const,
          errorCategory: 'BulkPartialFailure',
          errorMessage: `${result.failedCount} of ${result.requestedCount} bulk update items failed.`,
        }
        : {}),
    }));
  }, validateSender);

  registerChannel(IpcChannels.connCollectionBulkDelete, connCollectionBulkDeleteSchema, async (payload) => {
    return ctx.audit.run(auditContext(payload.connectionId, {
      database: payload.database, collection: payload.collection,
      category: 'documents', action: 'documents.bulk-delete', origin: 'user', operationClass: 'write',
      summary: 'Bulk delete selected documents',
      detail: { requestedCount: payload.originalDocumentsEjson.length },
    }), async () => {
      requireWritableConnection(payload.connectionId);
      const client = supervisor.get(payload.connectionId);
      if (!client) throw appError('UtilityProcessCrash', 'Query runtime is not running.');
      return client.request<CollectionBulkDeleteResult>('collection-bulk-delete', payload);
    }, (result) => ({
      affectedCount: result.deletedCount,
      resultCount: result.deletedCount,
      ...(result.failedCount > 0
        ? {
          status: 'error' as const,
          errorCategory: 'BulkPartialFailure',
          errorMessage: `${result.failedCount} of ${result.requestedCount} bulk delete items failed.`,
        }
        : {}),
    }));
  }, validateSender);

  registerChannel(IpcChannels.connCollectionDelete, connCollectionDeleteSchema, async (payload) => {
    return ctx.audit.run(auditContext(payload.connectionId, {
      database: payload.database, collection: payload.collection,
      category: 'documents', action: 'documents.delete', origin: 'user', operationClass: 'write',
      summary: 'Delete document',
    }), async () => {
      requireWritableConnection(payload.connectionId);
      const client = supervisor.get(payload.connectionId);
      if (!client) throw appError('UtilityProcessCrash', 'Query runtime is not running.');
      return client.request<CollectionMutationResult>('collection-delete', payload);
    }, (result) => ({ affectedCount: result.deletedCount ?? 0 }));
  }, validateSender);

  registerChannel(IpcChannels.connCollectionRename, connCollectionRenameSchema, async (payload) => {
    return ctx.audit.run(auditContext(payload.connectionId, {
      database: payload.database, collection: payload.collection,
      category: 'documents', action: 'collection.rename', origin: 'user', operationClass: 'write',
      summary: `Rename collection to "${payload.newName}"`,
    }), async () => {
      requireWritableConnection(payload.connectionId);
      const client = supervisor.get(payload.connectionId);
      if (!client) throw appError('UtilityProcessCrash', 'Query runtime is not running.');
      const renamed = await client.request<{ oldName: string; newName: string }>('collection-rename', payload);
      ctx.getDb().saved.renameCollectionContext(
        payload.connectionId,
        payload.database,
        payload.collection,
        payload.newName,
      );
      return renamed;
    }, () => ({ affectedCount: 1 }));
  }, validateSender);

  registerChannel(IpcChannels.connCollectionDrop, connCollectionDropSchema, async (payload) => {
    return ctx.audit.run(auditContext(payload.connectionId, {
      database: payload.database, collection: payload.collection,
      category: 'documents', action: 'collection.drop', origin: 'user', operationClass: 'write',
      summary: 'Drop collection',
    }), async () => {
      requireWritableConnection(payload.connectionId);
      const client = supervisor.get(payload.connectionId);
      if (!client) throw appError('UtilityProcessCrash', 'Query runtime is not running.');
      return client.request<{ dropped: boolean }>('collection-drop', payload);
    }, (result) => ({ affectedCount: result.dropped ? 1 : 0 }));
  }, validateSender);

  registerChannel(IpcChannels.connDatabaseDrop, connDatabaseDropSchema, async (payload) => {
    return ctx.audit.run(auditContext(payload.connectionId, {
      database: payload.database,
      category: 'documents', action: 'database.drop', origin: 'user', operationClass: 'write',
      summary: 'Drop database',
    }), async () => {
      requireWritableConnection(payload.connectionId);
      const client = supervisor.get(payload.connectionId);
      if (!client) throw appError('UtilityProcessCrash', 'Query runtime is not running.');
      return client.request<{ dropped: boolean }>('database-drop', payload);
    }, (result) => ({ affectedCount: result.dropped ? 1 : 0 }));
  }, validateSender);

  // ── Phase 4: Schema sampling ──
  registerChannel(IpcChannels.connSampleSchema, sampleSchemaSchema, async ({ connectionId, database, collection, sampleSize }) => {
    return ctx.audit.run(auditContext(connectionId, {
      database, collection,
      category: 'schema', action: 'schema.sample', origin: 'background', operationClass: 'background',
      summary: 'Sample collection schema',
    }), async () => {
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
    }, (result) => ({ resultCount: result.sampledCount }));
  }, validateSender);

  // ── Phase 5: Administration ──
  registerChannel(IpcChannels.connIndexList, connIndexListSchema, async ({ connectionId, database, collection }) => {
    return ctx.audit.run(auditContext(connectionId, {
      database, collection,
      category: 'administration', action: 'index.list', origin: 'user', operationClass: 'admin',
      summary: 'List collection indexes',
    }), async () => {
      const client = supervisor.get(connectionId);
      if (!client) throw appError('UtilityProcessCrash', 'Query runtime is not running.');
      return client.request<IndexDescription[]>('index-list', { database, collection });
    }, (items) => ({ resultCount: items.length }));
  }, validateSender);

  registerChannel(IpcChannels.connIndexCreate, connIndexCreateSchema, async (payload) => {
    return ctx.audit.run(auditContext(payload.connectionId, {
      database: payload.database, collection: payload.collection,
      category: 'administration', action: 'index.create', origin: 'user', operationClass: 'write',
      summary: `Create index${payload.name ? ` "${payload.name}"` : ''}`,
      detail: { keys: payload.keysEjson, ...(payload.partialFilterEjson ? { partialFilter: payload.partialFilterEjson } : {}) },
    }), async () => {
      requireWritableConnection(payload.connectionId);
      const client = supervisor.get(payload.connectionId);
      if (!client) throw appError('UtilityProcessCrash', 'Query runtime is not running.');
      return client.request<{ name: string }>('index-create', payload);
    }, () => ({ affectedCount: 1 }));
  }, validateSender);

  registerChannel(IpcChannels.connIndexDrop, connIndexDropSchema, async (payload) => {
    return ctx.audit.run(auditContext(payload.connectionId, {
      database: payload.database, collection: payload.collection,
      category: 'administration', action: 'index.drop', origin: 'user', operationClass: 'write',
      summary: `Drop index "${payload.name}"`,
    }), async () => {
      requireWritableConnection(payload.connectionId);
      const client = supervisor.get(payload.connectionId);
      if (!client) throw appError('UtilityProcessCrash', 'Query runtime is not running.');
      return client.request<{ dropped: string }>('index-drop', payload);
    }, () => ({ affectedCount: 1 }));
  }, validateSender);

  registerChannel(IpcChannels.connExplain, connExplainSchema, async (payload) => {
    return ctx.audit.run(auditContext(payload.connectionId, {
      database: payload.database, collection: payload.collection,
      category: 'administration', action: 'query.explain', origin: 'user', operationClass: 'admin',
      summary: `Explain query (${payload.verbosity})`,
      detail: {
        filter: payload.filterEjson,
        ...(payload.sortEjson ? { sort: payload.sortEjson } : {}),
        ...(payload.projectionEjson ? { projection: payload.projectionEjson } : {}),
      },
    }), async () => {
      const client = supervisor.get(payload.connectionId);
      if (!client) throw appError('UtilityProcessCrash', 'Query runtime is not running.');
      return client.request<EjsonEnvelope>('explain', payload);
    });
  }, validateSender);

  registerChannel(IpcChannels.connGlobalSearch, connGlobalSearchSchema, async (payload) => {
    return ctx.audit.run(auditContext(payload.connectionId, {
      database: payload.database,
      category: 'administration', action: 'global-search.execute', origin: 'user', operationClass: 'read',
      summary: 'Search database collections', detail: { search: payload.text },
    }), async () => {
      const client = supervisor.get(payload.connectionId);
      if (!client) throw appError('UtilityProcessCrash', 'Query runtime is not running.');
      return client.request<GlobalSearchResult>('global-search', {
        ...payload,
        maxCollections: payload.maxCollections ?? 50,
        maxDocumentsPerCollection: payload.maxDocumentsPerCollection ?? 500,
        maxResults: payload.maxResults ?? 100,
      });
    }, (result) => ({ resultCount: result.matches.length }));
  }, validateSender);

  registerChannel(IpcChannels.connChangeStart, connChangeStartSchema, async (payload) => {
    return ctx.audit.run(auditContext(payload.connectionId, {
      database: payload.database, ...(payload.collection ? { collection: payload.collection } : {}),
      category: 'change-stream', action: 'change-stream.start', origin: 'user', operationClass: 'admin',
      summary: 'Start change stream', detail: { pipeline: payload.pipelineEjson, fullDocument: payload.fullDocument },
    }), async () => {
      const client = supervisor.get(payload.connectionId);
      if (!client) throw appError('UtilityProcessCrash', 'Query runtime is not running.');
      const result = await client.request<ChangeStreamStartResult>('change-start', payload);
      supervisor.setChangeStreamActive(payload.connectionId, result.streamId, true);
      return result;
    });
  }, validateSender);

  registerChannel(IpcChannels.connChangePoll, connChangePollSchema, async ({ connectionId, streamId, maxEvents }) => {
    return ctx.audit.run(auditContext(connectionId, {
      category: 'change-stream', action: 'change-stream.poll', origin: 'background', operationClass: 'background',
      summary: 'Poll change stream',
    }), async () => {
      const client = supervisor.get(connectionId);
      if (!client) throw appError('UtilityProcessCrash', 'Query runtime is not running.');
      const result = await client.request<ChangeStreamPollResult>('change-poll', {
        streamId,
        maxEvents: maxEvents ?? 50,
      });
      if (result.closed) supervisor.setChangeStreamActive(connectionId, streamId, false);
      return result;
    }, (result) => ({ resultCount: result.events.length }));
  }, validateSender);

  registerChannel(IpcChannels.connChangeClose, connChangeCloseSchema, async ({ connectionId, streamId }) => {
    try {
      await ctx.audit.run(auditContext(connectionId, {
        category: 'change-stream', action: 'change-stream.close', origin: 'user', operationClass: 'admin',
        summary: 'Close change stream',
      }), async () => {
        const client = supervisor.get(connectionId);
        if (!client) return;
        await client.request('change-close', { streamId });
      });
    } finally {
      supervisor.setChangeStreamActive(connectionId, streamId, false);
    }
  }, validateSender);

  registerChannel(IpcChannels.connGridFsList, connGridFsListSchema, async ({ connectionId, database, bucketName, limit }) => {
    return ctx.audit.run(auditContext(connectionId, {
      database, collection: `${bucketName}.files`,
      category: 'gridfs', action: 'gridfs.list', origin: 'user', operationClass: 'read',
      summary: 'List GridFS files',
    }), async () => {
      const client = supervisor.get(connectionId);
      if (!client) throw appError('UtilityProcessCrash', 'Query runtime is not running.');
      return client.request<GridFsFileInfo[]>('gridfs-list', {
        database,
        bucketName,
        limit: limit ?? 200,
      });
    }, (items) => ({ resultCount: items.length }));
  }, validateSender);

  registerChannel(IpcChannels.connGridFsUpload, connGridFsUploadSchema, async (payload) => {
    requireWritableConnection(payload.connectionId);
    const window = ctx.getWindow();
    const selection = window
      ? await dialog.showOpenDialog(window, { properties: ['openFile'] })
      : await dialog.showOpenDialog({ properties: ['openFile'] });
    if (selection.canceled || !selection.filePaths[0]) return { cancelled: true };
    return ctx.audit.run(auditContext(payload.connectionId, {
      database: payload.database, collection: `${payload.bucketName}.files`,
      category: 'gridfs', action: 'gridfs.upload', origin: 'user', operationClass: 'write',
      summary: 'Upload GridFS file',
    }), async () => {
      const client = supervisor.get(payload.connectionId);
      if (!client) throw appError('UtilityProcessCrash', 'Query runtime is not running.');
      const value = await client.request<GridFsUploadResult>('gridfs-upload', {
        database: payload.database,
        bucketName: payload.bucketName,
        sourcePath: selection.filePaths[0],
        ...(payload.metadataEjson ? { metadataEjson: payload.metadataEjson } : {}),
      });
      return { cancelled: false as const, value };
    }, () => ({ affectedCount: 1 }));
  }, validateSender);

  registerChannel(IpcChannels.connGridFsDownload, connGridFsDownloadSchema, async (payload) => {
    const window = ctx.getWindow();
    const options = { defaultPath: basename(payload.filename) };
    const selection = window
      ? await dialog.showSaveDialog(window, options)
      : await dialog.showSaveDialog(options);
    if (selection.canceled || !selection.filePath) return { cancelled: true };
    return ctx.audit.run(auditContext(payload.connectionId, {
      database: payload.database, collection: `${payload.bucketName}.files`,
      category: 'gridfs', action: 'gridfs.download', origin: 'user', operationClass: 'read',
      summary: 'Download GridFS file',
    }), async () => {
      const client = supervisor.get(payload.connectionId);
      if (!client) throw appError('UtilityProcessCrash', 'Query runtime is not running.');
      const value = await client.request<{ downloaded: true }>('gridfs-download', {
        database: payload.database,
        bucketName: payload.bucketName,
        idEjson: payload.idEjson,
        destinationPath: selection.filePath,
      });
      return { cancelled: false as const, value };
    }, () => ({ resultCount: 1 }));
  }, validateSender);

  registerChannel(IpcChannels.connGridFsDelete, connGridFsDeleteSchema, async (payload) => {
    return ctx.audit.run(auditContext(payload.connectionId, {
      database: payload.database, collection: `${payload.bucketName}.files`,
      category: 'gridfs', action: 'gridfs.delete', origin: 'user', operationClass: 'write',
      summary: 'Delete GridFS file',
    }), async () => {
      requireWritableConnection(payload.connectionId);
      const client = supervisor.get(payload.connectionId);
      if (!client) throw appError('UtilityProcessCrash', 'Query runtime is not running.');
      return client.request<{ deleted: true }>('gridfs-delete', payload);
    }, () => ({ affectedCount: 1 }));
  }, validateSender);

  // ── Streaming result export ──
  registerChannel(IpcChannels.exportCollection, exportCollectionSchema, async (payload): Promise<ExportStartResult> => {
    const client = supervisor.get(payload.connectionId);
    if (!client) throw appError('UtilityProcessCrash', 'Query runtime is not running.');
    const filename = buildExportFilename(payload.database, payload.collection, payload.format);
    const destinationPath = await chooseExportDestination(ctx.getWindow(), filename, payload.format);
    if (!destinationPath) return { cancelled: true };
    const jobId = randomUUID();
    const finalFilename = basename(destinationPath);
    ctx.audit.beginExport(auditContext(payload.connectionId, {
      correlationId: jobId,
      database: payload.database,
      collection: payload.collection,
      category: 'export', action: 'export.documents', origin: 'user', operationClass: 'read',
      summary: `Export collection documents as ${payload.format.toUpperCase()}`,
      detail: { format: payload.format, scope: payload.scope },
    }) as AuditContext & { correlationId: string });
    try {
      await client.request('export-collection-start', {
        ...payload,
        jobId,
        filename: finalFilename,
        destinationPath,
      });
      return { cancelled: false, jobId, filename: finalFilename };
    } catch (error) {
      ctx.audit.failExportStart(jobId, error);
      throw error;
    }
  }, validateSender);

  registerChannel(IpcChannels.exportQueryResult, exportQueryResultSchema, async (payload): Promise<ExportStartResult> => {
    const client = supervisor.get(payload.connectionId);
    if (!client) throw appError('UtilityProcessCrash', 'Query runtime is not running.');
    let collection: string | undefined;
    if (payload.result.kind === 'documents') {
      const metadata = await client.request<{ namespace: string }>('cursor-metadata', {
        cursorId: payload.result.cursorId,
      });
      const prefix = `${payload.database}.`;
      collection = metadata.namespace.startsWith(prefix)
        ? metadata.namespace.slice(prefix.length)
        : undefined;
    }
    const fallback = `query_statement_${payload.statementIndex + 1}`;
    const filename = buildExportFilename(payload.database, collection, payload.format, new Date(), fallback);
    const destinationPath = await chooseExportDestination(ctx.getWindow(), filename, payload.format);
    if (!destinationPath) return { cancelled: true };
    const jobId = randomUUID();
    const finalFilename = basename(destinationPath);
    ctx.audit.beginExport(auditContext(payload.connectionId, {
      correlationId: jobId,
      database: payload.database,
      ...(collection ? { collection } : {}),
      category: 'export', action: 'export.query-result', origin: 'user', operationClass: 'read',
      summary: `Export visible query result as ${payload.format.toUpperCase()}`,
      detail: { format: payload.format, scope: 'current-page', statement: payload.statementIndex + 1 },
    }) as AuditContext & { correlationId: string });
    try {
      await client.request('export-query-start', {
        ...payload,
        jobId,
        filename: finalFilename,
        destinationPath,
      });
      return { cancelled: false, jobId, filename: finalFilename };
    } catch (error) {
      ctx.audit.failExportStart(jobId, error);
      throw error;
    }
  }, validateSender);

  registerChannel(IpcChannels.exportCancel, exportCancelSchema, async ({ connectionId, jobId }) => {
    const client = supervisor.get(connectionId);
    if (!client) return { cancelled: false };
    return client.request<{ cancelled: boolean }>('export-cancel', { jobId });
  }, validateSender);

  // ── Streaming data import / read-only source copy ──
  registerChannel(
    IpcChannels.dataTransferSelectFiles,
    dataTransferSelectFilesSchema,
    async ({ targetConnectionId }): Promise<DataFileDescriptor[]> => {
      requireWritableConnection(targetConnectionId);
      return ctx.dataTransfer.selectFiles(ctx.getWindow(), targetConnectionId);
    },
    validateSender,
  );

  registerChannel(
    IpcChannels.dataTransferPreviewFile,
    dataTransferPreviewFileSchema,
    async (payload): Promise<DataFilePreview> => ctx.dataTransfer.previewFile(payload),
    validateSender,
  );

  registerChannel(
    IpcChannels.dataTransferPreviewCollection,
    dataTransferPreviewCollectionSchema,
    async (payload): Promise<CollectionTransferPreview> => ctx.dataTransfer.previewCollection(payload),
    validateSender,
  );

  registerChannel(
    IpcChannels.dataTransferCountCollection,
    dataTransferCountCollectionSchema,
    async (payload): Promise<{ count: number }> => ctx.dataTransfer.countCollection(payload),
    validateSender,
  );

  registerChannel(
    IpcChannels.dataTransferStartFileImport,
    dataTransferStartFileImportSchema,
    async (payload): Promise<DataJobStartResult> => {
      requireWritableConnection(payload.targetConnectionId);
      const result = await ctx.dataTransfer.startFileImport(payload);
      ctx.audit.beginDataTransfer(auditContext(payload.targetConnectionId, {
        correlationId: result.jobId,
        category: 'data-transfer',
        action: 'data-transfer.file-import',
        origin: 'user',
        operationClass: 'write',
        summary: `Import ${payload.datasets.length} file dataset(s)`,
        detail: {
          kind: 'file-import',
          datasets: payload.datasets.map((dataset) => ({
            targetDatabase: dataset.targetDatabase,
            targetCollection: dataset.targetCollection,
            conflictMode: dataset.conflictMode,
          })),
        },
      }) as AuditContext & { correlationId: string });
      return result;
    },
    validateSender,
  );

  registerChannel(
    IpcChannels.dataTransferStartConnectionCopy,
    dataTransferStartConnectionCopySchema,
    async (payload): Promise<DataJobStartResult> => {
      requireWritableConnection(payload.targetConnectionId);
      if (!conn.getProfile(payload.sourceConnectionId)) {
        throw appError('NotFound', `Source connection profile not found: ${payload.sourceConnectionId}`);
      }
      const result = await ctx.dataTransfer.startConnectionCopy(payload);
      ctx.audit.beginDataTransfer(auditContext(payload.targetConnectionId, {
        correlationId: result.jobId,
        category: 'data-transfer',
        action: 'data-transfer.connection-copy',
        origin: 'user',
        operationClass: 'write',
        summary: `Copy ${payload.datasets.length} collection(s) without modifying the source`,
        detail: {
          kind: 'connection-copy',
          sourceConnectionId: payload.sourceConnectionId,
          datasets: payload.datasets.map((dataset) => ({
            sourceDatabase: dataset.sourceDatabase,
            sourceCollection: dataset.sourceCollection,
            targetDatabase: dataset.targetDatabase,
            targetCollection: dataset.targetCollection,
            filter: dataset.filterSource,
            conflictMode: dataset.conflictMode,
            metadata: dataset.metadata,
          })),
        },
      }) as AuditContext & { correlationId: string });
      return result;
    },
    validateSender,
  );

  registerChannel(IpcChannels.dataTransferCancel, dataTransferCancelSchema, async ({ jobId }) => ({
    cancelled: await ctx.dataTransfer.cancel(jobId),
  }), validateSender);

  registerChannel(IpcChannels.dataTransferSaveErrorReport, dataTransferSaveErrorReportSchema, async ({ jobId }) => (
    ctx.dataTransfer.saveErrorReport(ctx.getWindow(), jobId)
  ), validateSender);

  // ── Workspace persistence ──
  registerChannel(IpcChannels.workspaceSave, workspaceSaveSchema, async ({ state }) => {
    ctx.getDb().workspace.upsert({
      version: 1,
      sidebarWidth: state.sidebarWidth,
      expandedNodeKeys: [],
      tabs: state.tabs,
      activeTabId: state.activeTabId,
    });
  }, validateSender);

  registerChannel(IpcChannels.workspaceLoad, emptySchema, async () => {
    const ws = ctx.getDb().workspace.get();
    if (!ws) return null;
    return {
      tabs: ws.tabs,
      activeTabId: ws.activeTabId,
      sidebarWidth: normalizeSidebarWidth(ws.sidebarWidth),
    };
  }, validateSender);

  registerChannel(IpcChannels.settingsSave, settingsSaveSchema, async ({ settings }) => {
    ctx.getDb().settings.upsert(settings);
    ctx.supervisor.setIdleTimeoutMS(settings.connection.idleTimeoutMS);
    ctx.audit.pruneSafely();
  }, validateSender);

  registerChannel(IpcChannels.settingsLoad, emptySchema, async () => (
    normalizeApplicationSettings(ctx.getDb().settings.get() ?? structuredClone(DEFAULT_SETTINGS))
  ), validateSender);

  // ── Application updates ──
  registerChannel(IpcChannels.updatesCheck, updatesCheckSchema, async (): Promise<UpdateCheckResult> => (
    ctx.updates.check()
  ), validateSender);

  registerChannel(IpcChannels.updatesInstall, updatesInstallSchema, async () => {
    await ctx.updates.install();
  }, validateSender);

  registerChannel(IpcChannels.updatesDismiss, updatesDismissSchema, async () => {
    ctx.updates.dismiss();
  }, validateSender);

  // ── Hierarchical saved library ──
  registerChannel(IpcChannels.savedList, emptySchema, async (): Promise<SavedLibrarySnapshot> => (
    ctx.getDb().saved.list()
  ), validateSender);

  registerChannel(IpcChannels.savedCreateFolder, savedCreateFolderSchema, async (payload): Promise<SavedFolder> => (
    ctx.getDb().saved.createFolder(payload)
  ), validateSender);

  registerChannel(IpcChannels.savedUpdateFolder, savedUpdateFolderSchema, async (payload): Promise<SavedFolder> => (
    ctx.getDb().saved.updateFolder(payload)
  ), validateSender);

  registerChannel(
    IpcChannels.savedDeleteFolder,
    savedDeleteFolderSchema,
    async ({ id }): Promise<DeleteSavedFolderResult> => ctx.getDb().saved.deleteFolder(id),
    validateSender,
  );

  registerChannel(IpcChannels.savedCreateItem, savedCreateItemSchema, async (payload): Promise<SavedItem> => {
    await validateSavedPayload(payload.payload);
    return ctx.getDb().saved.createItem(payload);
  }, validateSender);

  registerChannel(IpcChannels.savedUpdateItem, savedUpdateItemSchema, async (payload): Promise<SavedItem> => {
    await validateSavedPayload(payload.payload);
    return ctx.getDb().saved.updateItem(payload);
  }, validateSender);

  registerChannel(IpcChannels.savedDeleteItem, savedDeleteItemSchema, async ({ id }) => {
    ctx.getDb().saved.deleteItem(id);
  }, validateSender);

  // ── Local MongoDB activity audit ──
  registerChannel(IpcChannels.auditList, auditListSchema, async ({ filter, limit, offset }) => (
    ctx.audit.list(filter, limit, offset)
  ), validateSender);

  registerChannel(IpcChannels.auditSummary, auditSummarySchema, async ({ filter, bucket }) => (
    ctx.audit.summary(filter, bucket)
  ), validateSender);

  registerChannel(IpcChannels.auditDelete, auditDeleteSchema, async ({ id }) => ({
    deleted: ctx.audit.deleteEntry(id),
  }), validateSender);

  registerChannel(IpcChannels.auditClear, auditClearSchema, async (payload) => ({
    deleted: ctx.audit.clear(payload.scope === 'all' ? undefined : payload.filter),
  }), validateSender);
}

async function chooseExportDestination(
  window: BrowserWindow | null,
  filename: string,
  format: 'xlsx' | 'csv' | 'txt',
): Promise<string | null> {
  const options = {
    title: 'Export results',
    defaultPath: filename,
    filters: exportDialogFilters(format),
    properties: ['createDirectory', 'showOverwriteConfirmation'] as Array<'createDirectory' | 'showOverwriteConfirmation'>,
  };
  const selection = window
    ? await dialog.showSaveDialog(window, options)
    : await dialog.showSaveDialog(options);
  if (selection.canceled || !selection.filePath) return null;
  const extension = `.${format}`;
  return selection.filePath.toLocaleLowerCase().endsWith(extension)
    ? selection.filePath
    : `${selection.filePath}${extension}`;
}

async function validateSavedPayload(payload: SavedItem['payload']): Promise<void> {
  if (containsKnownSecretMaterial(payload)) {
    throw appError('Validation', 'Saved content contains credential material. Remove credentials before saving.');
  }
  if (payload.type === 'documents') {
    await validateSavedCriteria(payload.criteria);
  } else if (payload.type === 'tab' && payload.template.documentsState) {
    await validateSavedCriteria(payload.template.documentsState.applied);
  }
}

async function validateSavedCriteria(
  criteria: { filter: string; sort: string; projection: string },
): Promise<void> {
  try {
    // Keep the TypeScript AST implementation out of the Electron startup
    // chunk. It is only needed when a Documents payload is persisted.
    const { parseDocumentExpression } = await import('../../features/script-analysis/index.js');
    parseDocumentExpression(criteria.filter, 'Filter');
    if (criteria.sort.trim()) parseDocumentExpression(criteria.sort, 'Sort');
    if (criteria.projection.trim()) parseDocumentExpression(criteria.projection, 'Projection');
  } catch {
    throw appError('Validation', 'Saved document criteria must contain valid data-only object expressions.');
  }
}
