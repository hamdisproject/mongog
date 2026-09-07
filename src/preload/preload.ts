import { contextBridge, ipcRenderer } from 'electron';
import {
  IpcChannels,
  IpcEvents,
  type MongoGDesktopApi,
} from '../shared/ipc/index.js';
import type { ExecuteRequest } from '../shared/domain/index.js';

const ALLOWED_EVENTS = new Set<string>(Object.values(IpcEvents));

function invoke<T>(channel: string, payload?: unknown): Promise<T> {
  return ipcRenderer.invoke(channel, payload ?? {}).then((res) => {
    const r = res as { ok: boolean; value?: T; error?: unknown };
    if (r && typeof r === 'object' && 'ok' in r) {
      if (r.ok) return r.value as T;
      throw r.error;
    }
    return res as T;
  });
}

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  if (!ALLOWED_EVENTS.has(channel)) {
    throw new Error(`Event channel not allowed: ${channel}`);
  }
  const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => cb(payload as T);
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}

const api: MongoGDesktopApi = {
  spike: {
    pingRuntime: () => invoke(IpcChannels.spikePingRuntime),
    mongoUri: () => invoke(IpcChannels.spikeMongoUri),
    execute: (req: ExecuteRequest) => invoke(IpcChannels.spikeExecute, req),
  },
  cursors: {
    fetchNext: (cursorId: string, pageSize?: number) =>
      invoke(IpcChannels.cursorFetchNext, { cursorId, pageSize }),
    close: (cursorId: string) => invoke(IpcChannels.cursorClose, { cursorId }),
  },
  executions: {
    cancel: (executionId: string) => invoke(IpcChannels.executionCancel, { executionId }),
  },
  system: {
    info: () => invoke(IpcChannels.systemInfo),
  },
  updates: {
    check: () => invoke(IpcChannels.updatesCheck),
    install: () => invoke(IpcChannels.updatesInstall),
    dismiss: () => invoke(IpcChannels.updatesDismiss),
  },
  events: {
    onEngineEvent: (cb) => subscribe(IpcEvents.engine, cb),
    onConnectionState: (cb) => subscribe(IpcEvents.connectionState, cb),
    onAuditChanged: (cb) => subscribe(IpcEvents.auditChanged, cb),
    onExportProgress: (cb) => subscribe(IpcEvents.exportProgress, cb),
    onDataJobProgress: (cb) => subscribe(IpcEvents.dataJobProgress, cb),
    onDatabaseRenameProgress: (cb) => subscribe(IpcEvents.databaseRenameProgress, cb),
    onUpdateStatus: (cb) => subscribe(IpcEvents.updateStatus, cb),
  },
  connections: {
    listGroups: () => invoke(IpcChannels.connListGroups),
    createGroup: (name) => invoke(IpcChannels.connCreateGroup, { name }),
    updateGroup: (group) => invoke(IpcChannels.connUpdateGroup, group),
    deleteGroup: (id) => invoke(IpcChannels.connDeleteGroup, { id }),
    listProfiles: () => invoke(IpcChannels.connListProfiles),
    getProfile: (id) => invoke(IpcChannels.connGetProfile, { profileId: id }),
    createProfile: (input) => invoke(IpcChannels.connCreateProfile, input),
    updateProfile: (id, input) => invoke(IpcChannels.connUpdateProfile, { id, ...input }),
    deleteProfile: (id) => invoke(IpcChannels.connDeleteProfile, { id }),
    connect: (profileId) => invoke(IpcChannels.connConnect, { profileId }),
    disconnect: (profileId) => invoke(IpcChannels.connDisconnect, { profileId }),
    getState: (profileId) => invoke(IpcChannels.connGetState, { profileId }),
    listConnected: () => invoke(IpcChannels.connListConnected),
    testConnection: (uri, options) => invoke(IpcChannels.connTest, { uri, options }),
    testDraft: (input) => invoke(IpcChannels.connTestDraft, input),
    saveAndConnect: (input) => invoke(IpcChannels.connSaveAndConnect, input),
  },
  query: {
    execute: (req) => invoke(IpcChannels.connExecute, req),
    executeSql: (req) => invoke(IpcChannels.connExecuteSql, req),
    cursorFetchNext: (connectionId, cursorId, pageSize, operationId) =>
      invoke(IpcChannels.connCursorFetchNext, { connectionId, cursorId, pageSize, operationId }),
    cursorFetchPrev: (connectionId, cursorId, operationId) =>
      invoke(IpcChannels.connCursorFetchPrev, { connectionId, cursorId, operationId }),
    cursorFetchFull: (connectionId, cursorId, fullValueId) =>
      invoke(IpcChannels.connCursorFetchFull, { connectionId, cursorId, fullValueId }),
    cursorClose: (connectionId, cursorId) =>
      invoke(IpcChannels.connCursorClose, { connectionId, cursorId }),
    cancelFetch: (connectionId, operationId) =>
      invoke(IpcChannels.connFetchCancel, { connectionId, operationId }),
    closeOwner: (connectionId, tabId) =>
      invoke(IpcChannels.connOwnerClose, { connectionId, tabId }),
    cancel: (connectionId, executionId) =>
      invoke(IpcChannels.connExecutionCancel, { connectionId, executionId }),
    listDatabases: (connectionId) =>
      invoke(IpcChannels.connListDatabases, { connectionId }),
    listCollections: (connectionId, database) =>
      invoke(IpcChannels.connListCollections, { connectionId, database }),
    collectionFind: (input) => invoke(IpcChannels.connCollectionFind, input),
    collectionCount: (input) => invoke(IpcChannels.connCollectionCount, input),
    collectionInsert: (input) => invoke(IpcChannels.connCollectionInsert, input),
    collectionReplace: (input) => invoke(IpcChannels.connCollectionReplace, input),
    collectionBulkUpdate: (input) => invoke(IpcChannels.connCollectionBulkUpdate, input),
    collectionBulkDelete: (input) => invoke(IpcChannels.connCollectionBulkDelete, input),
    collectionDelete: (input) => invoke(IpcChannels.connCollectionDelete, input),
    collectionRename: (input) => invoke(IpcChannels.connCollectionRename, input),
    collectionDrop: (connectionId, database, collection) =>
      invoke(IpcChannels.connCollectionDrop, { connectionId, database, collection }),
    createDatabase: (input) => invoke(IpcChannels.connDatabaseCreate, input),
    startDatabaseRename: (input) => invoke(IpcChannels.connDatabaseRenameStart, input),
    databaseDrop: (connectionId, database) =>
      invoke(IpcChannels.connDatabaseDrop, { connectionId, database }),
    sampleSchema: (connectionId, database, collection, sampleSize) =>
      invoke(IpcChannels.connSampleSchema, { connectionId, database, collection, sampleSize }),
  },
  admin: {
    listIndexes: (connectionId, database, collection) =>
      invoke(IpcChannels.connIndexList, { connectionId, database, collection }),
    createIndex: (input) => invoke(IpcChannels.connIndexCreate, input),
    dropIndex: (connectionId, database, collection, name) =>
      invoke(IpcChannels.connIndexDrop, { connectionId, database, collection, name }),
    explain: (input) => invoke(IpcChannels.connExplain, input),
    globalSearch: (input) => invoke(IpcChannels.connGlobalSearch, input),
    startChangeStream: (input) => invoke(IpcChannels.connChangeStart, input),
    pollChangeStream: (connectionId, streamId, maxEvents) =>
      invoke(IpcChannels.connChangePoll, { connectionId, streamId, maxEvents }),
    closeChangeStream: (connectionId, streamId) =>
      invoke(IpcChannels.connChangeClose, { connectionId, streamId }),
    listGridFsFiles: (connectionId, database, bucketName, limit) =>
      invoke(IpcChannels.connGridFsList, { connectionId, database, bucketName, limit }),
    uploadGridFsFile: (input) => invoke(IpcChannels.connGridFsUpload, input),
    downloadGridFsFile: (input) => invoke(IpcChannels.connGridFsDownload, input),
    deleteGridFsFile: (connectionId, database, bucketName, idEjson) =>
      invoke(IpcChannels.connGridFsDelete, { connectionId, database, bucketName, idEjson }),
  },
  workspace: {
    save: (state) => invoke(IpcChannels.workspaceSave, { state }),
    load: () => invoke(IpcChannels.workspaceLoad),
  },
  settings: {
    save: (settings) => invoke(IpcChannels.settingsSave, { settings }),
    load: () => invoke(IpcChannels.settingsLoad),
  },
  saved: {
    list: () => invoke(IpcChannels.savedList),
    createFolder: (input) => invoke(IpcChannels.savedCreateFolder, input),
    updateFolder: (input) => invoke(IpcChannels.savedUpdateFolder, input),
    deleteFolder: (id) => invoke(IpcChannels.savedDeleteFolder, { id }),
    createItem: (input) => invoke(IpcChannels.savedCreateItem, input),
    updateItem: (input) => invoke(IpcChannels.savedUpdateItem, input),
    deleteItem: (id) => invoke(IpcChannels.savedDeleteItem, { id }),
  },
  audit: {
    list: (filter = {}, page = {}) => invoke(IpcChannels.auditList, {
      filter,
      limit: page.limit ?? 100,
      offset: page.offset ?? 0,
    }),
    summary: (filter = {}, bucket = 'day') => invoke(IpcChannels.auditSummary, { filter, bucket }),
    deleteEntry: (id) => invoke(IpcChannels.auditDelete, { id }),
    clear: (input) => invoke(IpcChannels.auditClear, input),
  },
  exports: {
    startCollection: (input) => invoke(IpcChannels.exportCollection, input),
    startQueryResult: (input) => invoke(IpcChannels.exportQueryResult, input),
    cancel: (connectionId, jobId) => invoke(IpcChannels.exportCancel, { connectionId, jobId }),
  },
  dataTransfer: {
    selectFiles: (targetConnectionId) =>
      invoke(IpcChannels.dataTransferSelectFiles, { targetConnectionId }),
    previewFile: (input) => invoke(IpcChannels.dataTransferPreviewFile, input),
    previewCollection: (input) => invoke(IpcChannels.dataTransferPreviewCollection, input),
    countCollection: (input) => invoke(IpcChannels.dataTransferCountCollection, input),
    startFileImport: (input) => invoke(IpcChannels.dataTransferStartFileImport, input),
    startConnectionCopy: (input) => invoke(IpcChannels.dataTransferStartConnectionCopy, input),
    cancel: (jobId) => invoke(IpcChannels.dataTransferCancel, { jobId }),
    saveErrorReport: (jobId) => invoke(IpcChannels.dataTransferSaveErrorReport, { jobId }),
  },
};

contextBridge.exposeInMainWorld('mongog', api);
