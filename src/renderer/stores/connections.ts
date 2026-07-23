import { create } from 'zustand';
import type {
  ConnectionGroup,
  ConnectionProfile,
} from '../../shared/domain/connections.js';
import type { ConnectionState as RuntimeConnectionState } from '../../shared/domain/index.js';

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

interface ConnectionState {
  groups: ConnectionGroup[];
  profiles: ConnectionProfile[];
  connected: Record<string, ConnectedInfo>;
  selectedGroupId: string | null;
  selectedProfileId: string | null;
  expandedGroupIds: Set<string>;
  expandedProfileIds: Set<string>;
  expandedDatabaseIds: Set<string>;
  databases: Record<string, DbInfo[]>;
  collections: Record<string, CollectionInfo[]>;
  loading: boolean;

  load: () => Promise<void>;
  selectGroup: (id: string | null) => void;
  selectProfile: (id: string | null) => void;
  toggleGroup: (id: string) => void;
  toggleProfile: (id: string) => void;
  toggleDatabase: (connId: string, dbName: string) => void;
  loadDatabases: (connId: string) => Promise<void>;
  loadCollections: (connId: string, dbName: string) => Promise<void>;
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
  deleteProfile: (id: string) => Promise<void>;
  connect: (profileId: string) => Promise<void>;
  disconnect: (profileId: string) => Promise<void>;
  refreshConnected: () => Promise<void>;
  applyRuntimeState: (state: RuntimeConnectionState & { connectionId: string }) => void;
}

export const useConnectionStore = create<ConnectionState>()((set, get) => ({
  groups: [],
  profiles: [],
  connected: {},
  selectedGroupId: null,
  selectedProfileId: null,
  expandedGroupIds: new Set(),
  expandedProfileIds: new Set(),
  expandedDatabaseIds: new Set(),
  databases: {},
  collections: {},
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
    if (get().collections[key]) return;
    try {
      const cols = await window.mongog.query.listCollections(connId, dbName);
      set((s) => ({ collections: { ...s.collections, [key]: cols } }));
    } catch {
      // Connection may have been disconnected.
    }
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

  deleteProfile: async (id) => {
    await window.mongog.connections.deleteProfile(id);
    const connected = { ...get().connected };
    delete connected[id];
    const databases = { ...get().databases };
    delete databases[id];
    const collections = Object.fromEntries(
      Object.entries(get().collections).filter(([key]) => !key.startsWith(`${id}:`)),
    );
    const expandedProfileIds = new Set(get().expandedProfileIds);
    expandedProfileIds.delete(id);
    const expandedDatabaseIds = new Set(
      [...get().expandedDatabaseIds].filter((key) => !key.startsWith(`${id}:`)),
    );
    set({
      profiles: get().profiles.filter((x) => x.id !== id),
      connected,
      databases,
      collections,
      expandedProfileIds,
      expandedDatabaseIds,
      selectedProfileId: get().selectedProfileId === id ? null : get().selectedProfileId,
    });
  },

  connect: async (profileId) => {
    await window.mongog.connections.connect(profileId);
    const state = await window.mongog.connections.getState(profileId);
    const connected = { ...get().connected };
    if (state.status === 'connected') {
      connected[profileId] = { pid: state.pid, serverVersion: state.serverVersion };
      set({ connected });
      void get().loadDatabases(profileId);
    } else {
      delete connected[profileId];
      set({ connected });
    }
  },

  disconnect: async (profileId) => {
    await window.mongog.connections.disconnect(profileId);
    const next = { ...get().connected };
    delete next[profileId];
    const databases = { ...get().databases };
    delete databases[profileId];
    const collections = Object.fromEntries(
      Object.entries(get().collections).filter(([key]) => !key.startsWith(`${profileId}:`)),
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
      expandedProfileIds,
      expandedDatabaseIds,
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
    if (state.status === 'connected') {
      connected[connectionId] = {
        pid: state.runtimePid,
        serverVersion: state.serverVersion,
      };
      set({ connected });
      return;
    }
    if (state.status === 'connecting') return;

    delete connected[connectionId];
    const databases = { ...get().databases };
    delete databases[connectionId];
    const collections = Object.fromEntries(
      Object.entries(get().collections).filter(([key]) => !key.startsWith(`${connectionId}:`)),
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
      expandedProfileIds,
      expandedDatabaseIds,
    });
  },
}));
