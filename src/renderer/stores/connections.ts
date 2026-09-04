import { create } from 'zustand';
import type {
  ConnectionGroup,
  ConnectionProfile,
  ConnectionDraftRequest,
  SaveAndConnectResult,
  TestConnectionResult,
} from '../../shared/domain/connections.js';
import type { ConnectionState as RuntimeConnectionState } from '../../shared/domain/index.js';
import { useSchemaCache } from './schema-cache.js';
import { useWorkspaceStore } from './workspace.js';
import { useSavedLibraryStore } from './saved.js';

interface ConnectedInfo {
  pid?: number;
  serverVersion?: string;
}

interface DbInfo {
  name: string;
}

interface CollectionInfo {
  name: string;
  type?: string;
}

interface IdleDisconnectInfo {
  since: number;
  idleTimeoutMS: number;
}

interface ConnectionState {
  groups: ConnectionGroup[];
  profiles: ConnectionProfile[];
  connected: Record<string, ConnectedInfo>;
  runtimeEpochs: Record<string, number>;
  errors: Record<string, string>;
  idleDisconnects: Record<string, IdleDisconnectInfo>;
  selectedGroupId: string | null;
  selectedProfileId: string | null;
  expandedGroupIds: Set<string>;
  expandedProfileIds: Set<string>;
  expandedDatabaseIds: Set<string>;
  databases: Record<string, DbInfo[]>;
  collections: Record<string, CollectionInfo[]>;
  collectionsLoading: Record<string, boolean>;
  loading: boolean;

  load: () => Promise<void>;
  selectGroup: (id: string | null) => void;
  selectProfile: (id: string | null) => void;
  toggleGroup: (id: string) => void;
  toggleProfile: (id: string) => void;
  toggleDatabase: (connId: string, dbName: string) => void;
  loadDatabases: (connId: string) => Promise<void>;
  loadCollections: (connId: string, dbName: string) => Promise<void>;
  refreshDatabases: (connId: string) => Promise<void>;
  refreshCollections: (connId: string, dbName: string) => Promise<void>;
  renameCollection: (connId: string, dbName: string, oldName: string, newName: string) => Promise<void>;
  dropCollection: (connId: string, dbName: string, collection: string) => Promise<void>;
  dropDatabase: (connId: string, dbName: string) => Promise<void>;
  createGroup: (name: string) => Promise<ConnectionGroup>;
  updateGroup: (g: ConnectionGroup) => Promise<void>;
  deleteGroup: (id: string) => Promise<void>;
  createProfile: (input: {
    name: string; uri: string; groupId?: string | null;
    defaultDatabase?: string; readOnly?: boolean; color?: string;
    options?: { username?: string };
    secret?: { password?: string; uriOverride?: string };
  }) => Promise<ConnectionProfile>;
  updateProfile: (id: string, input: Partial<ConnectionProfile & { uri?: string }>) => Promise<ConnectionProfile>;
  moveProfileToGroup: (profileId: string, groupId: string | null) => Promise<void>;
  deleteProfile: (id: string) => Promise<void>;
  testDraft: (input: ConnectionDraftRequest) => Promise<TestConnectionResult>;
  saveAndConnect: (input: ConnectionDraftRequest) => Promise<SaveAndConnectResult>;
  connect: (profileId: string) => Promise<void>;
  disconnect: (profileId: string) => Promise<void>;
  refreshConnected: () => Promise<void>;
  applyRuntimeState: (state: RuntimeConnectionState & { connectionId: string }) => void;
}

export const useConnectionStore = create<ConnectionState>()((set, get) => ({
  groups: [],
  profiles: [],
  connected: {},
  runtimeEpochs: {},
  errors: {},
  idleDisconnects: {},
  selectedGroupId: null,
  selectedProfileId: null,
  expandedGroupIds: new Set(),
  expandedProfileIds: new Set(),
  expandedDatabaseIds: new Set(),
  databases: {},
  collections: {},
  collectionsLoading: {},
  loading: false,

  load: async () => {
    set({ loading: true });
    try {
      const [groups, profiles, connectedIds] = await Promise.all([
        window.mongog.connections.listGroups(),
        window.mongog.connections.listProfiles(),
        window.mongog.connections.listConnected(),
      ]);
      const connected: Record<string, ConnectedInfo> = {};
      for (const id of connectedIds) {
        const state = await window.mongog.connections.getState(id);
        if (state.status === 'connected') {
          connected[id] = { pid: state.pid, serverVersion: state.serverVersion };
        }
      }
      set({
        groups,
        profiles,
        connected,
        expandedGroupIds: new Set(groups.filter((group) => !group.collapsed).map((group) => group.id)),
      });
    } finally {
      set({ loading: false });
    }
  },

  selectGroup: (id) => set({ selectedGroupId: id, selectedProfileId: null }),
  selectProfile: (id) => set({ selectedProfileId: id, selectedGroupId: null }),

  toggleGroup: (id) => {
    const next = new Set(get().expandedGroupIds);
    const isExpanded = next.has(id);
    if (isExpanded) next.delete(id); else next.add(id);

    const group = get().groups.find((candidate) => candidate.id === id);
    if (!group) {
      set({ expandedGroupIds: next });
      return;
    }

    const updated = { ...group, collapsed: isExpanded };
    set({
      expandedGroupIds: next,
      groups: get().groups.map((candidate) => (candidate.id === id ? updated : candidate)),
    });
    void window.mongog.connections.updateGroup(updated).catch(() => {
      const restoredExpanded = new Set(get().expandedGroupIds);
      if (isExpanded) restoredExpanded.add(id); else restoredExpanded.delete(id);
      set({
        expandedGroupIds: restoredExpanded,
        groups: get().groups.map((candidate) => (candidate.id === id ? group : candidate)),
      });
    });
  },

  toggleProfile: (id) => {
    const next = new Set(get().expandedProfileIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
      void get().loadDatabases(id);
    }
    set({ expandedProfileIds: next });
  },

  toggleDatabase: (connId, dbName) => {
    const key = `${connId}:${dbName}`;
    const next = new Set(get().expandedDatabaseIds);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
      void get().loadCollections(connId, dbName);
    }
    set({ expandedDatabaseIds: next });
  },

  loadDatabases: async (connId) => {
    if (get().databases[connId]) return;
    try {
      const dbs = await window.mongog.query.listDatabases(connId);
      set((s) => ({ databases: { ...s.databases, [connId]: dbs } }));
    } catch {
      // Connection may have been disconnected.
    }
  },

  loadCollections: async (connId, dbName) => {
    const key = `${connId}:${dbName}`;
    if (Object.hasOwn(get().collections, key) || get().collectionsLoading[key]) return;
    set((state) => ({
      collectionsLoading: { ...state.collectionsLoading, [key]: true },
    }));
    try {
      const cols = await window.mongog.query.listCollections(connId, dbName);
      set((s) => ({ collections: { ...s.collections, [key]: cols } }));
    } catch {
      // Connection may have been disconnected.
    } finally {
      set((state) => {
        const collectionsLoading = { ...state.collectionsLoading };
        delete collectionsLoading[key];
        return { collectionsLoading };
      });
    }
  },

  refreshDatabases: async (connId) => {
    const dbs = await window.mongog.query.listDatabases(connId);
    set((state) => ({ databases: { ...state.databases, [connId]: dbs } }));
  },

  refreshCollections: async (connId, dbName) => {
    const key = `${connId}:${dbName}`;
    set((state) => ({
      collectionsLoading: { ...state.collectionsLoading, [key]: true },
    }));
    try {
      const values = await window.mongog.query.listCollections(connId, dbName);
      set((state) => ({ collections: { ...state.collections, [key]: values } }));
    } finally {
      set((state) => {
        const collectionsLoading = { ...state.collectionsLoading };
        delete collectionsLoading[key];
        return { collectionsLoading };
      });
    }
  },

  renameCollection: async (connId, dbName, oldName, newName) => {
    await window.mongog.query.collectionRename({
      connectionId: connId,
      database: dbName,
      collection: oldName,
      newName,
    });
    const key = `${connId}:${dbName}`;
    set((state) => ({
      collections: {
        ...state.collections,
        [key]: (state.collections[key] ?? []).map((item) => (
          item.name === oldName ? { ...item, name: newName } : item
        )).sort((left, right) => left.name.localeCompare(right.name)),
      },
    }));
    useSchemaCache.getState().invalidate(connId, dbName, oldName);
    useSchemaCache.getState().invalidate(connId, dbName, newName);
    useWorkspaceStore.getState().renameCollectionContext(connId, dbName, oldName, newName);
    await useSavedLibraryStore.getState().load();
  },

  dropCollection: async (connId, dbName, collection) => {
    await window.mongog.query.collectionDrop(connId, dbName, collection);
    const key = `${connId}:${dbName}`;
    set((state) => ({
      collections: {
        ...state.collections,
        [key]: (state.collections[key] ?? []).filter((item) => item.name !== collection),
      },
    }));
    useSchemaCache.getState().invalidate(connId, dbName, collection);
    useWorkspaceStore.getState().closeNamespaceTabs(connId, dbName, collection);
  },

  dropDatabase: async (connId, dbName) => {
    await window.mongog.query.databaseDrop(connId, dbName);
    const key = `${connId}:${dbName}`;
    set((state) => {
      const collections = { ...state.collections };
      delete collections[key];
      const collectionsLoading = { ...state.collectionsLoading };
      delete collectionsLoading[key];
      const expandedDatabaseIds = new Set(state.expandedDatabaseIds);
      expandedDatabaseIds.delete(key);
      return {
        databases: {
          ...state.databases,
          [connId]: (state.databases[connId] ?? []).filter((item) => item.name !== dbName),
        },
        collections,
        collectionsLoading,
        expandedDatabaseIds,
      };
    });
    useSchemaCache.getState().invalidateConnection(connId);
    useWorkspaceStore.getState().closeNamespaceTabs(connId, dbName);
  },

  createGroup: async (name) => {
    const g = await window.mongog.connections.createGroup(name);
    const expandedGroupIds = new Set(get().expandedGroupIds);
    expandedGroupIds.add(g.id);
    set({ groups: [...get().groups, g], expandedGroupIds });
    return g;
  },

  updateGroup: async (g) => {
    await window.mongog.connections.updateGroup(g);
    set({ groups: get().groups.map((x) => (x.id === g.id ? g : x)) });
  },

  deleteGroup: async (id) => {
    await window.mongog.connections.deleteGroup(id);
    const expandedGroupIds = new Set(get().expandedGroupIds);
    expandedGroupIds.delete(id);
    set({
      groups: get().groups.filter((x) => x.id !== id),
      profiles: get().profiles.map((profile) => (
        profile.groupId === id ? { ...profile, groupId: null } : profile
      )),
      expandedGroupIds,
      selectedGroupId: get().selectedGroupId === id ? null : get().selectedGroupId,
    });
  },

  createProfile: async (input) => {
    const p = await window.mongog.connections.createProfile(input);
    set({ profiles: [...get().profiles, p] });
    return p;
  },

  updateProfile: async (id, input) => {
    const p = await window.mongog.connections.updateProfile(id, input);
    set({ profiles: get().profiles.map((x) => (x.id === id ? p : x)) });
    return p;
  },

  moveProfileToGroup: async (profileId, groupId) => {
    await get().updateProfile(profileId, { groupId });
  },

  deleteProfile: async (id) => {
    await window.mongog.connections.deleteProfile(id);
    const connected = { ...get().connected };
    delete connected[id];
    const databases = { ...get().databases };
    delete databases[id];
    const collections = Object.fromEntries(
      Object.entries(get().collections).filter(([key]) => !key.startsWith(`${id}:`)),
    );
    const collectionsLoading = Object.fromEntries(
      Object.entries(get().collectionsLoading).filter(([key]) => !key.startsWith(`${id}:`)),
    );
    const expandedProfileIds = new Set(get().expandedProfileIds);
    expandedProfileIds.delete(id);
    const expandedDatabaseIds = new Set(
      [...get().expandedDatabaseIds].filter((key) => !key.startsWith(`${id}:`)),
    );
    const errors = { ...get().errors };
    delete errors[id];
    const idleDisconnects = { ...get().idleDisconnects };
    delete idleDisconnects[id];
    useSchemaCache.getState().invalidateConnection(id);
    useWorkspaceStore.getState().detachConnection(id);
    set({
      profiles: get().profiles.filter((x) => x.id !== id),
      connected,
      databases,
      collections,
      collectionsLoading,
      expandedProfileIds,
      expandedDatabaseIds,
      selectedProfileId: get().selectedProfileId === id ? null : get().selectedProfileId,
      errors,
      idleDisconnects,
    });
    await useSavedLibraryStore.getState().load();
  },

  testDraft: (input) => window.mongog.connections.testDraft(input),

  saveAndConnect: async (input) => {
    const result = await window.mongog.connections.saveAndConnect(input);
    if (!result.profile) return result;
    const profile = result.profile;
    const exists = get().profiles.some((candidate) => candidate.id === profile.id);
    const profiles = exists
      ? get().profiles.map((candidate) => (candidate.id === profile.id ? profile : candidate))
      : [...get().profiles, profile];
    const connected = { ...get().connected };
    const errors = { ...get().errors };
    const idleDisconnects = { ...get().idleDisconnects };
    const databases = { ...get().databases };
    delete databases[profile.id];
    const collections = Object.fromEntries(
      Object.entries(get().collections).filter(([key]) => !key.startsWith(`${profile.id}:`)),
    );
    const collectionsLoading = Object.fromEntries(
      Object.entries(get().collectionsLoading).filter(([key]) => !key.startsWith(`${profile.id}:`)),
    );
    const expandedProfileIds = new Set(get().expandedProfileIds);
    useSchemaCache.getState().invalidateConnection(profile.id);
    if (result.connected) {
      const state = await window.mongog.connections.getState(profile.id);
      if (state.status === 'connected') {
        connected[profile.id] = { pid: state.pid, serverVersion: state.serverVersion };
      }
      delete errors[profile.id];
      delete idleDisconnects[profile.id];
      expandedProfileIds.add(profile.id);
    } else {
      delete connected[profile.id];
      if (result.connectionError) errors[profile.id] = result.connectionError.message;
    }
    set({
      profiles,
      connected,
      errors,
      idleDisconnects,
      databases,
      collections,
      collectionsLoading,
      expandedProfileIds,
      selectedProfileId: profile.id,
    });
    if (result.connected) void get().loadDatabases(profile.id);
    return result;
  },

  connect: async (profileId) => {
    await window.mongog.connections.connect(profileId);
    const state = await window.mongog.connections.getState(profileId);
    const connected = { ...get().connected };
    const idleDisconnects = { ...get().idleDisconnects };
    delete idleDisconnects[profileId];
    if (state.status === 'connected') {
      connected[profileId] = { pid: state.pid, serverVersion: state.serverVersion };
      const errors = { ...get().errors };
      const expandedProfileIds = new Set(get().expandedProfileIds);
      expandedProfileIds.add(profileId);
      delete errors[profileId];
      set({ connected, errors, idleDisconnects, expandedProfileIds });
      void get().loadDatabases(profileId);
    } else {
      delete connected[profileId];
      set({ connected, idleDisconnects });
    }
  },

  disconnect: async (profileId) => {
    await window.mongog.connections.disconnect(profileId);
    const next = { ...get().connected };
    delete next[profileId];
    const errors = { ...get().errors };
    delete errors[profileId];
    const idleDisconnects = { ...get().idleDisconnects };
    delete idleDisconnects[profileId];
    const databases = { ...get().databases };
    delete databases[profileId];
    const collections = Object.fromEntries(
      Object.entries(get().collections).filter(([key]) => !key.startsWith(`${profileId}:`)),
    );
    const collectionsLoading = Object.fromEntries(
      Object.entries(get().collectionsLoading).filter(([key]) => !key.startsWith(`${profileId}:`)),
    );
    const expandedProfileIds = new Set(get().expandedProfileIds);
    expandedProfileIds.delete(profileId);
    const expandedDatabaseIds = new Set(
      [...get().expandedDatabaseIds].filter((key) => !key.startsWith(`${profileId}:`)),
    );
    set({
      connected: next,
      databases,
      collections,
      collectionsLoading,
      expandedProfileIds,
      expandedDatabaseIds,
      errors,
      idleDisconnects,
    });
  },

  refreshConnected: async () => {
    const connectedIds = await window.mongog.connections.listConnected();
    const connected: Record<string, ConnectedInfo> = {};
    for (const id of connectedIds) {
      const state = await window.mongog.connections.getState(id);
      if (state.status === 'connected') {
        connected[id] = { pid: state.pid, serverVersion: state.serverVersion };
      }
    }
    set({ connected });
  },

  applyRuntimeState: (state) => {
    const { connectionId } = state;
    const connected = { ...get().connected };
    const idleDisconnects = { ...get().idleDisconnects };
    const runtimeEpochs = { ...get().runtimeEpochs };
    if (state.status === 'connected') {
      connected[connectionId] = {
        pid: state.runtimePid,
        serverVersion: state.serverVersion,
      };
      const errors = { ...get().errors };
      const expandedProfileIds = new Set(get().expandedProfileIds);
      expandedProfileIds.add(connectionId);
      delete errors[connectionId];
      delete idleDisconnects[connectionId];
      set({ connected, errors, idleDisconnects, expandedProfileIds });
      void get().loadDatabases(connectionId);
      return;
    }
    if (state.status === 'connecting') {
      delete idleDisconnects[connectionId];
      set({ idleDisconnects });
      return;
    }

    if (state.status === 'restarting') {
      runtimeEpochs[connectionId] = (runtimeEpochs[connectionId] ?? 0) + 1;
    }

    delete connected[connectionId];
    const errors = { ...get().errors };
    if (state.status === 'error') errors[connectionId] = state.error.message;
    if (state.status === 'restarting') delete errors[connectionId];
    if (state.status === 'disconnected' && state.reason === 'idle' && state.idleTimeoutMS !== undefined) {
      idleDisconnects[connectionId] = {
        since: state.since ?? Date.now(),
        idleTimeoutMS: state.idleTimeoutMS,
      };
    } else {
      delete idleDisconnects[connectionId];
    }
    const databases = { ...get().databases };
    delete databases[connectionId];
    const collections = Object.fromEntries(
      Object.entries(get().collections).filter(([key]) => !key.startsWith(`${connectionId}:`)),
    );
    const collectionsLoading = Object.fromEntries(
      Object.entries(get().collectionsLoading).filter(([key]) => !key.startsWith(`${connectionId}:`)),
    );
    const expandedProfileIds = new Set(get().expandedProfileIds);
    expandedProfileIds.delete(connectionId);
    const expandedDatabaseIds = new Set(
      [...get().expandedDatabaseIds].filter((key) => !key.startsWith(`${connectionId}:`)),
    );
    set({
      connected,
      databases,
      collections,
      collectionsLoading,
      expandedProfileIds,
      expandedDatabaseIds,
      errors,
      idleDisconnects,
      runtimeEpochs,
    });
  },
}));
