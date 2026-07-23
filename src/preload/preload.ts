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
  events: {
    onEngineEvent: (cb) => subscribe(IpcEvents.engine, cb),
    onConnectionState: (cb) => subscribe(IpcEvents.connectionState, cb),
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
  },
  query: {
    execute: (req) => invoke(IpcChannels.connExecute, req),
    cursorFetchNext: (connectionId, cursorId, pageSize) =>
      invoke(IpcChannels.connCursorFetchNext, { connectionId, cursorId, pageSize }),
    cursorFetchPrev: (connectionId, cursorId) =>
      invoke(IpcChannels.connCursorFetchPrev, { connectionId, cursorId }),
    cursorFetchFull: (connectionId, cursorId, fullValueId) =>
      invoke(IpcChannels.connCursorFetchFull, { connectionId, cursorId, fullValueId }),
    cursorClose: (connectionId, cursorId) =>
      invoke(IpcChannels.connCursorClose, { connectionId, cursorId }),
    closeOwner: (connectionId, tabId) =>
      invoke(IpcChannels.connOwnerClose, { connectionId, tabId }),
    cancel: (connectionId, executionId) =>
      invoke(IpcChannels.connExecutionCancel, { connectionId, executionId }),
    listDatabases: (connectionId) =>
      invoke(IpcChannels.connListDatabases, { connectionId }),
    listCollections: (connectionId, database) =>
      invoke(IpcChannels.connListCollections, { connectionId, database }),
    sampleSchema: (connectionId, database, collection, sampleSize) =>
      invoke(IpcChannels.connSampleSchema, { connectionId, database, collection, sampleSize }),
  },
  workspace: {
    save: (state) => invoke(IpcChannels.workspaceSave, { state }),
    load: () => invoke(IpcChannels.workspaceLoad),
  },
};

contextBridge.exposeInMainWorld('mongog', api);
