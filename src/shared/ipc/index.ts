import { z } from 'zod';
import type { AppError } from '../errors/index.js';
import type { EjsonEnvelope } from '../ejson/index.js';
import type {
  ConnectionState,
  CollectionDocumentsPage,
  CollectionMutationResult,
  DocumentsPage,
  EngineEvent,
  ExecuteRequest,
  ConnectionProfile,
  ConnectionGroup,
  ConnectionOptions,
  TestConnectionResult,
  SecretPayload,
  SchemaSnapshot,
  WorkspaceTab,
  ExplainVerbosity,
  IndexDescription,
  GlobalSearchResult,
  ChangeStreamStartResult,
  ChangeStreamPollResult,
  GridFsFileInfo,
  GridFsUploadResult,
  GridFsDialogResult,
  ConnectionDraftRequest,
  SaveAndConnectResult,
  ApplicationSettings,
  SavedFolder,
  SavedItem,
  SavedLibrarySnapshot,
  CreateSavedFolderInput,
  UpdateSavedFolderInput,
  CreateSavedItemInput,
  UpdateSavedItemInput,
  DeleteSavedFolderResult,
} from '../domain/index.js';

export const IpcChannels = {
  spikePingRuntime: 'mongog:spike:ping-runtime',
  spikeMongoUri: 'mongog:spike:mongo-uri',
  spikeExecute: 'mongog:spike:execute',
  cursorFetchNext: 'mongog:cursor:fetch-next',
  cursorClose: 'mongog:cursor:close',
  executionCancel: 'mongog:execution:cancel',
  systemInfo: 'mongog:system:info',
  // ── Phase 1: Connection Management ──
  connListGroups: 'mongog:conn:list-groups',
  connCreateGroup: 'mongog:conn:create-group',
  connUpdateGroup: 'mongog:conn:update-group',
  connDeleteGroup: 'mongog:conn:delete-group',
  connListProfiles: 'mongog:conn:list-profiles',
  connGetProfile: 'mongog:conn:get-profile',
  connCreateProfile: 'mongog:conn:create-profile',
  connUpdateProfile: 'mongog:conn:update-profile',
  connDeleteProfile: 'mongog:conn:delete-profile',
  connConnect: 'mongog:conn:connect',
  connDisconnect: 'mongog:conn:disconnect',
  connGetState: 'mongog:conn:get-state',
  connListConnected: 'mongog:conn:list-connected',
  connTest: 'mongog:conn:test',
  connTestDraft: 'mongog:conn:test-draft',
  connSaveAndConnect: 'mongog:conn:save-and-connect',
  // ── Phase 2: Query execution ──
  connExecute: 'mongog:conn:execute',
  connCursorFetchNext: 'mongog:conn:cursor:fetch-next',
  connCursorFetchPrev: 'mongog:conn:cursor:fetch-prev',
  connCursorFetchFull: 'mongog:conn:cursor:fetch-full',
  connCursorClose: 'mongog:conn:cursor:close',
  connOwnerClose: 'mongog:conn:owner:close',
  connExecutionCancel: 'mongog:conn:execution:cancel',
  connListDatabases: 'mongog:conn:list-databases',
  connListCollections: 'mongog:conn:list-collections',
  // ── Phase 3: Collection browser / document editor ──
  connCollectionFind: 'mongog:conn:collection:find',
  connCollectionCount: 'mongog:conn:collection:count',
  connCollectionInsert: 'mongog:conn:collection:insert',
  connCollectionReplace: 'mongog:conn:collection:replace',
  connCollectionDelete: 'mongog:conn:collection:delete',
  connCollectionRename: 'mongog:conn:collection:rename',
  connCollectionDrop: 'mongog:conn:collection:drop',
  connDatabaseDrop: 'mongog:conn:database:drop',
  // ── Phase 4: Schema / completions ──
  connSampleSchema: 'mongog:conn:sample-schema',
  // ── Phase 5: Administration ──
  connIndexList: 'mongog:conn:index:list',
  connIndexCreate: 'mongog:conn:index:create',
  connIndexDrop: 'mongog:conn:index:drop',
  connExplain: 'mongog:conn:explain',
  connGlobalSearch: 'mongog:conn:global-search',
  connChangeStart: 'mongog:conn:change:start',
  connChangePoll: 'mongog:conn:change:poll',
  connChangeClose: 'mongog:conn:change:close',
  connGridFsList: 'mongog:conn:gridfs:list',
  connGridFsUpload: 'mongog:conn:gridfs:upload',
  connGridFsDownload: 'mongog:conn:gridfs:download',
  connGridFsDelete: 'mongog:conn:gridfs:delete',
  // ── Workspace persistence ──
  workspaceSave: 'mongog:workspace:save',
  workspaceLoad: 'mongog:workspace:load',
  settingsSave: 'mongog:settings:save',
  settingsLoad: 'mongog:settings:load',
  // ── Hierarchical saved library ──
  savedList: 'mongog:saved:list',
  savedCreateFolder: 'mongog:saved:folder:create',
  savedUpdateFolder: 'mongog:saved:folder:update',
  savedDeleteFolder: 'mongog:saved:folder:delete',
  savedCreateItem: 'mongog:saved:item:create',
  savedUpdateItem: 'mongog:saved:item:update',
  savedDeleteItem: 'mongog:saved:item:delete',
} as const;

export const IpcEvents = {
  engine: 'mongog:event:engine',
  connectionState: 'mongog:event:connection-state',
} as const;

// ── Existing schemas ──

export const executeRequestSchema = z.object({
  connectionId: z.string().min(1),
  tabId: z.string().min(1).optional(),
  runId: z.string().min(1).optional(),
  database: z.string().min(1),
  mode: z.enum(['query', 'trusted']),
  source: z.string().max(2 * 1024 * 1024),
  sourceOffset: z.object({ line: z.number().int().min(0), column: z.number().int().min(0) }),
  readOnly: z.boolean().optional(),
  pageSize: z.number().int().min(1).max(500).optional(),
  timeoutMS: z.number().int().min(0).max(600_000).optional(),
}) satisfies z.ZodType<ExecuteRequest>;

export const cursorFetchNextSchema = z.object({
  cursorId: z.string().min(1),
  pageSize: z.number().int().min(1).max(500).optional(),
});

export const cursorCloseSchema = z.object({ cursorId: z.string().min(1) });
export const executionCancelSchema = z.object({ executionId: z.string().min(1) });

// ── Phase 1: Connection schemas ──

export const connectionOptionsSchema: z.ZodType<ConnectionOptions> = z.object({
  connectTimeoutMS: z.number().int().min(0).optional(),
  serverSelectionTimeoutMS: z.number().int().min(0).optional(),
  socketTimeoutMS: z.number().int().min(0).optional(),
  timeoutMS: z.number().int().min(0).optional(),
  maxPoolSize: z.number().int().min(1).optional(),
  minPoolSize: z.number().int().min(0).optional(),
  readPreference: z.enum(['primary', 'primaryPreferred', 'secondary', 'secondaryPreferred', 'nearest']).optional(),
  retryReads: z.boolean().optional(),
  retryWrites: z.boolean().optional(),
  directConnection: z.boolean().optional(),
  appName: z.string().optional(),
  authMechanism: z.enum(['SCRAM', 'MONGODB-X509', 'MONGODB-AWS', 'MONGODB-OIDC']).optional(),
  authSource: z.string().optional(),
  username: z.string().optional(),
  tls: z.object({ enabled: z.boolean(), allowInvalidCertificates: z.boolean().optional() }).optional(),
});

export const secretPayloadSchema: z.ZodType<SecretPayload> = z.object({
  password: z.string().optional(),
  uriOverride: z.string().optional(),
  awsAccessKeyId: z.string().optional(),
  awsSecretAccessKey: z.string().optional(),
  awsSessionToken: z.string().optional(),
  tlsCertificateKeyFilePassphrase: z.string().optional(),
});

export const createGroupSchema = z.object({ name: z.string().min(1).max(200) });

export const updateGroupSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(200),
  collapsed: z.boolean(),
  sortOrder: z.number().int().min(0),
});

export const deleteGroupSchema = z.object({ id: z.string().min(1) });

export const createProfileSchema = z.object({
  name: z.string().min(1).max(200),
  groupId: z.string().nullable().optional(),
  uri: z.string().min(1),
  defaultDatabase: z.string().optional(),
  readOnly: z.boolean().optional(),
  options: connectionOptionsSchema.optional(),
  color: z.string().optional(),
  secret: secretPayloadSchema.optional(),
});

export const updateProfileSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(200).optional(),
  groupId: z.string().nullable().optional(),
  uri: z.string().optional(),
  defaultDatabase: z.string().nullable().optional(),
  readOnly: z.boolean().optional(),
  options: connectionOptionsSchema.optional(),
  color: z.string().nullable().optional(),
  secret: secretPayloadSchema.nullable().optional(),
});

export const deleteProfileSchema = z.object({ id: z.string().min(1) });
export const connectSchema = z.object({ profileId: z.string().min(1) });
export const disconnectSchema = z.object({ profileId: z.string().min(1) });
export const getStateSchema = z.object({ profileId: z.string().min(1) });
export const testConnectionSchema = z.object({
  uri: z.string().min(1),
  options: connectionOptionsSchema.optional(),
});

const connectionDraftSchema = z.object({
  name: z.string().trim().min(1).max(200),
  groupId: z.string().min(1).nullable(),
  uri: z.string().trim().min(1).max(8_192),
  defaultDatabase: z.string().trim().min(1).max(255).nullable(),
  readOnly: z.boolean(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable(),
  options: connectionOptionsSchema,
});

const connectionSecretActionSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('preserve') }),
  z.object({ mode: z.literal('clear') }),
  z.object({ mode: z.literal('replace'), secret: secretPayloadSchema }),
]);

export const connectionDraftRequestSchema = z.object({
  profileId: z.string().min(1).optional(),
  draft: connectionDraftSchema,
  secretAction: connectionSecretActionSchema,
}) satisfies z.ZodType<ConnectionDraftRequest>;

export const sampleSchemaSchema = z.object({
  connectionId: z.string().min(1),
  database: z.string().min(1),
  collection: z.string().min(1),
  sampleSize: z.number().int().min(1).max(5000).optional(),
});

export const workspaceSaveSchema = z.object({
  state: z.object({
    tabs: z.array(z.object({
      id: z.string(),
      kind: z.enum(['welcome', 'query', 'collection', 'history', 'connection-settings', 'settings', 'admin', 'change-stream']),
      title: z.string(),
      connectionId: z.string().nullable(),
      database: z.string().optional(),
      collection: z.string().optional(),
      collectionViewMode: z.enum(['documents', 'query']).optional(),
      editorContent: z.string().optional(),
      mode: z.enum(['query', 'trusted']).optional(),
      savedItemId: z.string().min(1).optional(),
      documentsState: z.object({
        draft: z.object({ filter: z.string(), sort: z.string(), projection: z.string() }),
        applied: z.object({ filter: z.string(), sort: z.string(), projection: z.string() }),
      }).optional(),
      profileId: z.string().optional(),
      connectionMode: z.enum(['list', 'create', 'edit']).optional(),
      adminSection: z.enum(['indexes', 'explain', 'search', 'changes', 'gridfs']).optional(),
      pinned: z.boolean().optional(),
      customTitle: z.boolean().optional(),
      dirty: z.boolean().optional(),
    })),
    activeTabId: z.string().nullable(),
  }),
});

export const applicationSettingsSchema = z.object({
  schemaVersion: z.number().int().min(1),
  theme: z.enum(['dark', 'light', 'system']),
  editor: z.object({
    fontSize: z.number().int().min(8).max(72),
    tabSize: z.number().int().min(1).max(16),
    wordWrap: z.boolean(),
    minimap: z.boolean(),
  }),
  execution: z.object({
    defaultTimeoutMS: z.number().int().min(0).max(600_000),
    pageSize: z.number().int().min(1).max(500),
    maxRetainedPages: z.number().int().min(1).max(1_000),
    maxPreviewBytes: z.number().int().min(1),
    cursorIdleTimeoutMS: z.number().int().min(1_000),
    maxRuntimes: z.number().int().min(1).max(100),
    confirmDestructive: z.boolean(),
  }),
  history: z.object({
    retentionDays: z.number().int().min(1).max(36_500),
    maxEntries: z.number().int().min(1),
  }),
  ejson: z.object({ defaultMode: z.enum(['mongosh', 'relaxed', 'canonical']) }),
  window: z.object({
    bounds: z.object({
      x: z.number(),
      y: z.number(),
      width: z.number().positive(),
      height: z.number().positive(),
    }).optional(),
  }).optional(),
}) satisfies z.ZodType<ApplicationSettings>;

export const settingsSaveSchema = z.object({ settings: applicationSettingsSchema });

// ── Hierarchical saved library ──

const savedNameSchema = z.string().trim().min(1).max(120);
const savedNullableIdSchema = z.string().min(1).nullable();
const savedCriteriaTextSchema = z.object({
  filter: z.string().min(1).max(2 * 1024 * 1024),
  sort: z.string().max(2 * 1024 * 1024),
  projection: z.string().max(2 * 1024 * 1024),
});
const savedDocumentsStateSchema = z.object({
  draft: savedCriteriaTextSchema,
  applied: savedCriteriaTextSchema,
});
const savedQueryPayloadSchema = z.object({
  type: z.literal('query'),
  source: z.string().max(2 * 1024 * 1024),
  language: z.enum(['javascript', 'typescript']),
  mode: z.enum(['query', 'trusted']),
});
const savedDocumentsPayloadSchema = z.object({
  type: z.literal('documents'),
  criteria: savedCriteriaTextSchema,
});
const savedTabPayloadSchema = z.object({
  type: z.literal('tab'),
  template: z.object({
    kind: z.enum(['query', 'collection']),
    title: z.string().max(120),
    pinned: z.boolean(),
    customTitle: z.boolean(),
    collectionViewMode: z.enum(['documents', 'query']).optional(),
    editorContent: z.string().max(2 * 1024 * 1024).optional(),
    mode: z.enum(['query', 'trusted']).optional(),
    documentsState: savedDocumentsStateSchema.optional(),
  }),
});
export const savedItemPayloadSchema = z.discriminatedUnion('type', [
  savedQueryPayloadSchema,
  savedDocumentsPayloadSchema,
  savedTabPayloadSchema,
]);

export const savedCreateFolderSchema = z.object({
  name: savedNameSchema,
  connectionId: savedNullableIdSchema,
  parentId: savedNullableIdSchema,
}) satisfies z.ZodType<CreateSavedFolderInput>;

export const savedUpdateFolderSchema = savedCreateFolderSchema.extend({
  id: z.string().min(1),
}) satisfies z.ZodType<UpdateSavedFolderInput>;

export const savedDeleteFolderSchema = z.object({ id: z.string().min(1) });

const savedItemBaseSchema = {
  name: savedNameSchema,
  folderId: savedNullableIdSchema,
  connectionId: savedNullableIdSchema,
  database: z.string().max(255).nullable(),
  collection: z.string().max(255).nullable(),
  tags: z.array(z.string().trim().min(1).max(64)).max(50),
};

export const savedCreateItemSchema = z.discriminatedUnion('type', [
  z.object({ ...savedItemBaseSchema, type: z.literal('query'), payload: savedQueryPayloadSchema }),
  z.object({ ...savedItemBaseSchema, type: z.literal('documents'), payload: savedDocumentsPayloadSchema }),
  z.object({ ...savedItemBaseSchema, type: z.literal('tab'), payload: savedTabPayloadSchema }),
]) satisfies z.ZodType<CreateSavedItemInput>;

export const savedUpdateItemSchema = z.discriminatedUnion('type', [
  z.object({ id: z.string().min(1), ...savedItemBaseSchema, type: z.literal('query'), payload: savedQueryPayloadSchema }),
  z.object({ id: z.string().min(1), ...savedItemBaseSchema, type: z.literal('documents'), payload: savedDocumentsPayloadSchema }),
  z.object({ id: z.string().min(1), ...savedItemBaseSchema, type: z.literal('tab'), payload: savedTabPayloadSchema }),
]) satisfies z.ZodType<UpdateSavedItemInput>;

export const savedDeleteItemSchema = z.object({ id: z.string().min(1) });

// ── Phase 2: Query schemas ──

export const connExecuteSchema = z.object({
  connectionId: z.string().min(1),
  tabId: z.string().min(1).optional(),
  runId: z.string().min(1).optional(),
  database: z.string().min(1),
  mode: z.enum(['query', 'trusted']),
  source: z.string().max(2 * 1024 * 1024),
  sourceOffset: z.object({ line: z.number().int().min(0), column: z.number().int().min(0) }),
  readOnly: z.boolean().optional(),
  pageSize: z.number().int().min(1).max(500).optional(),
  timeoutMS: z.number().int().min(0).max(600_000).optional(),
});

export const connCursorFetchNextSchema = z.object({
  connectionId: z.string().min(1),
  cursorId: z.string().min(1),
  pageSize: z.number().int().min(1).max(500).optional(),
});

export const connCursorFetchPrevSchema = z.object({
  connectionId: z.string().min(1),
  cursorId: z.string().min(1),
});

export const connCursorFetchFullSchema = z.object({
  connectionId: z.string().min(1),
  cursorId: z.string().min(1),
  fullValueId: z.string().min(1),
});

export const connCursorCloseSchema = z.object({
  connectionId: z.string().min(1),
  cursorId: z.string().min(1),
});

export const connOwnerCloseSchema = z.object({
  connectionId: z.string().min(1),
  tabId: z.string().min(1),
});

export const connExecutionCancelSchema = z.object({
  connectionId: z.string().min(1),
  executionId: z.string().min(1),
});

export const connListDatabasesSchema = z.object({
  connectionId: z.string().min(1),
});

export const connListCollectionsSchema = z.object({
  connectionId: z.string().min(1),
  database: z.string().min(1),
});

// ── Phase 3: Collection browser / document editor schemas ──

const namespaceSchema = {
  connectionId: z.string().min(1),
  database: z.string().min(1).max(255),
  collection: z.string().min(1).max(255),
};
const ejsonSchema = z.string().min(1).max(17 * 1024 * 1024);

export const connCollectionFindSchema = z.object({
  ...namespaceSchema,
  tabId: z.string().min(1),
  filterEjson: ejsonSchema,
  sortEjson: ejsonSchema.optional(),
  projectionEjson: ejsonSchema.optional(),
  pageSize: z.number().int().min(1).max(500),
});

export const connCollectionCountSchema = z.object({
  ...namespaceSchema,
  filterEjson: ejsonSchema,
});

export const connCollectionInsertSchema = z.object({
  ...namespaceSchema,
  documentEjson: ejsonSchema,
});

export const connCollectionReplaceSchema = z.object({
  ...namespaceSchema,
  originalDocumentEjson: ejsonSchema,
  documentEjson: ejsonSchema,
});

export const connCollectionDeleteSchema = z.object({
  ...namespaceSchema,
  originalDocumentEjson: ejsonSchema,
});

export const connCollectionRenameSchema = z.object({
  ...namespaceSchema,
  newName: z.string().trim().min(1).max(255),
});

export const connCollectionDropSchema = z.object(namespaceSchema);

export const connDatabaseDropSchema = z.object({
  connectionId: z.string().min(1),
  database: z.string().min(1).max(255),
});

// ── Phase 5: Administration schemas ──

export const connIndexListSchema = z.object(namespaceSchema);

export const connIndexCreateSchema = z.object({
  ...namespaceSchema,
  keysEjson: ejsonSchema,
  name: z.string().min(1).max(127).optional(),
  unique: z.boolean().optional(),
  sparse: z.boolean().optional(),
  hidden: z.boolean().optional(),
  expireAfterSeconds: z.number().int().min(0).max(2_147_483_647).optional(),
  partialFilterEjson: ejsonSchema.optional(),
});

export const connIndexDropSchema = z.object({
  ...namespaceSchema,
  name: z.string().min(1).max(127),
});

export const connExplainSchema = z.object({
  ...namespaceSchema,
  filterEjson: ejsonSchema,
  sortEjson: ejsonSchema.optional(),
  projectionEjson: ejsonSchema.optional(),
  verbosity: z.enum(['queryPlanner', 'executionStats', 'allPlansExecution']),
});

export const connGlobalSearchSchema = z.object({
  connectionId: z.string().min(1),
  database: z.string().min(1).max(255),
  text: z.string().trim().min(1).max(1_000),
  maxCollections: z.number().int().min(1).max(200).optional(),
  maxDocumentsPerCollection: z.number().int().min(1).max(10_000).optional(),
  maxResults: z.number().int().min(1).max(1_000).optional(),
});

export const connChangeStartSchema = z.object({
  connectionId: z.string().min(1),
  database: z.string().min(1).max(255),
  collection: z.string().min(1).max(255).optional(),
  tabId: z.string().min(1),
  pipelineEjson: ejsonSchema,
  fullDocument: z.enum(['default', 'updateLookup', 'whenAvailable', 'required']),
});

export const connChangePollSchema = z.object({
  connectionId: z.string().min(1),
  streamId: z.string().min(1),
  maxEvents: z.number().int().min(1).max(100).optional(),
});

export const connChangeCloseSchema = z.object({
  connectionId: z.string().min(1),
  streamId: z.string().min(1),
});

const gridFsNamespaceSchema = {
  connectionId: z.string().min(1),
  database: z.string().min(1).max(255),
  bucketName: z.string().min(1).max(128),
};

export const connGridFsListSchema = z.object({
  ...gridFsNamespaceSchema,
  limit: z.number().int().min(1).max(1_000).optional(),
});

export const connGridFsUploadSchema = z.object({
  ...gridFsNamespaceSchema,
  metadataEjson: ejsonSchema.optional(),
});

export const connGridFsDownloadSchema = z.object({
  ...gridFsNamespaceSchema,
  idEjson: ejsonSchema,
  filename: z.string().min(1).max(255),
});

export const connGridFsDeleteSchema = z.object({
  ...gridFsNamespaceSchema,
  idEjson: ejsonSchema,
});

// ── Response types ──

export interface PingRuntimeResponse {
  pong: true;
  runtimePid: number;
  roundTripMs: number;
}

export interface ExecuteResponse {
  executionId: string;
}

export interface SystemInfoResponse {
  appVersion: string;
  electron: string;
  chrome: string;
  node: string;
  platform: string;
}

// ── Renderer API ──

export interface MongoGDesktopApi {
  spike: {
    pingRuntime(): Promise<PingRuntimeResponse>;
    mongoUri(): Promise<string | null>;
    execute(req: ExecuteRequest): Promise<ExecuteResponse>;
  };
  cursors: {
    fetchNext(cursorId: string, pageSize?: number): Promise<DocumentsPage>;
    close(cursorId: string): Promise<void>;
  };
  executions: {
    cancel(executionId: string): Promise<void>;
  };
  system: {
    info(): Promise<SystemInfoResponse>;
  };
  events: {
    onEngineEvent(cb: (e: {
      connectionId: string;
      executionId: string;
      tabId?: string;
      runId?: string;
      event: EngineEvent;
    }) => void): () => void;
    onConnectionState(cb: (s: ConnectionState & { connectionId: string }) => void): () => void;
  };
  connections: {
    listGroups(): Promise<ConnectionGroup[]>;
    createGroup(name: string): Promise<ConnectionGroup>;
    updateGroup(group: ConnectionGroup): Promise<void>;
    deleteGroup(id: string): Promise<void>;
    listProfiles(): Promise<ConnectionProfile[]>;
    getProfile(id: string): Promise<ConnectionProfile | null>;
    createProfile(input: {
      name: string;
      groupId?: string | null;
      uri: string;
      defaultDatabase?: string;
      readOnly?: boolean;
      options?: ConnectionOptions;
      color?: string;
      secret?: SecretPayload;
    }): Promise<ConnectionProfile>;
    updateProfile(
      id: string,
      input: {
        name?: string;
        groupId?: string | null;
        uri?: string;
        defaultDatabase?: string | null;
        readOnly?: boolean;
        options?: ConnectionOptions;
        color?: string | null;
        secret?: SecretPayload | null;
      },
    ): Promise<ConnectionProfile>;
    deleteProfile(id: string): Promise<void>;
    connect(profileId: string): Promise<void>;
    disconnect(profileId: string): Promise<void>;
    getState(profileId: string): Promise<{
      status: string;
      pid?: number;
      serverVersion?: string;
      connectedAt?: number;
    }>;
    listConnected(): Promise<string[]>;
    testConnection(uri: string, options?: ConnectionOptions): Promise<TestConnectionResult>;
    testDraft(input: ConnectionDraftRequest): Promise<TestConnectionResult>;
    saveAndConnect(input: ConnectionDraftRequest): Promise<SaveAndConnectResult>;
  };
  query: {
    execute(req: ExecuteRequest): Promise<ExecuteResponse>;
    cursorFetchNext(connectionId: string, cursorId: string, pageSize?: number): Promise<DocumentsPage>;
    cursorFetchPrev(connectionId: string, cursorId: string): Promise<DocumentsPage>;
    cursorFetchFull(
      connectionId: string,
      cursorId: string,
      fullValueId: string,
    ): Promise<EjsonEnvelope>;
    cursorClose(connectionId: string, cursorId: string): Promise<void>;
    closeOwner(connectionId: string, tabId: string): Promise<void>;
    cancel(connectionId: string, executionId: string): Promise<void>;
    listDatabases(connectionId: string): Promise<Array<{ name: string }>>;
    listCollections(connectionId: string, database: string): Promise<Array<{ name: string; type?: string }>>;
    collectionFind(input: {
      connectionId: string;
      database: string;
      collection: string;
      tabId: string;
      filterEjson: string;
      sortEjson?: string;
      projectionEjson?: string;
      pageSize: number;
    }): Promise<CollectionDocumentsPage>;
    collectionCount(input: {
      connectionId: string;
      database: string;
      collection: string;
      filterEjson: string;
    }): Promise<{ count: number }>;
    collectionInsert(input: {
      connectionId: string;
      database: string;
      collection: string;
      documentEjson: string;
    }): Promise<CollectionMutationResult>;
    collectionReplace(input: {
      connectionId: string;
      database: string;
      collection: string;
      originalDocumentEjson: string;
      documentEjson: string;
    }): Promise<CollectionMutationResult>;
    collectionDelete(input: {
      connectionId: string;
      database: string;
      collection: string;
      originalDocumentEjson: string;
    }): Promise<CollectionMutationResult>;
    collectionRename(input: {
      connectionId: string;
      database: string;
      collection: string;
      newName: string;
    }): Promise<{ oldName: string; newName: string }>;
    collectionDrop(connectionId: string, database: string, collection: string): Promise<{ dropped: boolean }>;
    databaseDrop(connectionId: string, database: string): Promise<{ dropped: boolean }>;
    sampleSchema(
      connectionId: string,
      database: string,
      collection: string,
      sampleSize?: number,
    ): Promise<SchemaSnapshot>;
  };
  admin: {
    listIndexes(connectionId: string, database: string, collection: string): Promise<IndexDescription[]>;
    createIndex(input: {
      connectionId: string;
      database: string;
      collection: string;
      keysEjson: string;
      name?: string;
      unique?: boolean;
      sparse?: boolean;
      hidden?: boolean;
      expireAfterSeconds?: number;
      partialFilterEjson?: string;
    }): Promise<{ name: string }>;
    dropIndex(connectionId: string, database: string, collection: string, name: string): Promise<{ dropped: string }>;
    explain(input: {
      connectionId: string;
      database: string;
      collection: string;
      filterEjson: string;
      sortEjson?: string;
      projectionEjson?: string;
      verbosity: ExplainVerbosity;
    }): Promise<EjsonEnvelope>;
    globalSearch(input: {
      connectionId: string;
      database: string;
      text: string;
      maxCollections?: number;
      maxDocumentsPerCollection?: number;
      maxResults?: number;
    }): Promise<GlobalSearchResult>;
    startChangeStream(input: {
      connectionId: string;
      database: string;
      collection?: string;
      tabId: string;
      pipelineEjson: string;
      fullDocument: 'default' | 'updateLookup' | 'whenAvailable' | 'required';
    }): Promise<ChangeStreamStartResult>;
    pollChangeStream(connectionId: string, streamId: string, maxEvents?: number): Promise<ChangeStreamPollResult>;
    closeChangeStream(connectionId: string, streamId: string): Promise<void>;
    listGridFsFiles(connectionId: string, database: string, bucketName: string, limit?: number): Promise<GridFsFileInfo[]>;
    uploadGridFsFile(input: {
      connectionId: string;
      database: string;
      bucketName: string;
      metadataEjson?: string;
    }): Promise<GridFsDialogResult<GridFsUploadResult>>;
    downloadGridFsFile(input: {
      connectionId: string;
      database: string;
      bucketName: string;
      idEjson: string;
      filename: string;
    }): Promise<GridFsDialogResult<{ downloaded: true }>>;
    deleteGridFsFile(connectionId: string, database: string, bucketName: string, idEjson: string): Promise<{ deleted: true }>;
  };
  workspace: {
    save(state: { tabs: WorkspaceTab[]; activeTabId: string | null }): Promise<void>;
    load(): Promise<{ tabs: WorkspaceTab[]; activeTabId: string | null } | null>;
  };
  settings: {
    save(settings: ApplicationSettings): Promise<void>;
    load(): Promise<ApplicationSettings>;
  };
  saved: {
    list(): Promise<SavedLibrarySnapshot>;
    createFolder(input: CreateSavedFolderInput): Promise<SavedFolder>;
    updateFolder(input: UpdateSavedFolderInput): Promise<SavedFolder>;
    deleteFolder(id: string): Promise<DeleteSavedFolderResult>;
    createItem(input: CreateSavedItemInput): Promise<SavedItem>;
    updateItem(input: UpdateSavedItemInput): Promise<SavedItem>;
    deleteItem(id: string): Promise<void>;
  };
}

export type IpcResult<T> = { ok: true; value: T } | { ok: false; error: AppError };
