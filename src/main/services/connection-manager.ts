import { randomUUID } from 'node:crypto';
import { RuntimeSupervisor } from '../runtime/supervisor.js';
import { RuntimeClient } from '../runtime/runtime-client.js';
import { resolveRuntimeEntry } from '../runtime/paths.js';
import { appError, serializeError } from '../../shared/errors/index.js';
import { assertUriHasNoCredentials, redactUri } from '../../shared/redaction/index.js';
import type { Database } from '../storage/database.js';
import type {
  ConnectionProfile,
  ConnectionGroup,
  ConnectionOptions,
  SecretPayload,
  TestConnectionResult,
  ConnectionDraftRequest,
  SaveAndConnectResult,
} from '../../shared/domain/connections.js';

export type ConnectionTester = (
  uri: string,
  options: Record<string, unknown>,
) => Promise<TestConnectionResult>;

export interface ConnectionSecretStore {
  set(key: string, plaintext: string): Promise<void>;
  get(key: string): Promise<string | null>;
  clear(key: string): Promise<void>;
  has(key: string): Promise<boolean>;
}

export class ConnectionManager {
  private db: Database;
  private supervisor: RuntimeSupervisor;
  private secrets: ConnectionSecretStore;
  private tester: ConnectionTester | null;

  constructor(
    db: Database,
    supervisor: RuntimeSupervisor,
    secrets: ConnectionSecretStore,
    tester: ConnectionTester | null = null,
  ) {
    this.db = db;
    this.supervisor = supervisor;
    this.secrets = secrets;
    this.tester = tester;
  }

  // ── Groups ──

  listGroups(): ConnectionGroup[] {
    return this.db.groups.list();
  }

  createGroup(name: string): ConnectionGroup {
    const group: ConnectionGroup = {
      id: randomUUID(),
      name,
      collapsed: false,
      sortOrder: this.db.groups.count(),
      createdAt: Date.now(),
    };
    this.db.groups.insert(group);
    return group;
  }

  updateGroup(group: ConnectionGroup): void {
    this.db.groups.update(group);
  }

  deleteGroup(id: string): void {
    // The schema deliberately uses ON DELETE SET NULL: deleting a folder must
    // never delete its connection profiles or their encrypted credentials.
    this.db.groups.remove(id);
  }

  // ── Profiles ──

  listProfiles(): ConnectionProfile[] {
    return this.db.profiles.list();
  }

  getProfile(id: string): ConnectionProfile | null {
    return this.db.profiles.byId(id);
  }

  async createProfile(input: {
    name: string;
    groupId?: string | null;
    uri: string;
    defaultDatabase?: string;
    readOnly?: boolean;
    options?: ConnectionOptions;
    color?: string;
    secret?: SecretPayload;
  }): Promise<ConnectionProfile> {
    assertUriHasNoCredentials(input.uri);

    const profile: ConnectionProfile = {
      id: randomUUID(),
      groupId: input.groupId ?? null,
      name: input.name,
      color: input.color ?? null,
      uriRedacted: redactUri(input.uri),
      defaultDatabase: input.defaultDatabase ?? null,
      readOnly: input.readOnly ?? false,
      options: input.options ?? {},
      hasSecret: input.secret !== undefined && Object.keys(input.secret).length > 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    if (profile.hasSecret && input.secret) {
      await this.secrets.set(secretKey(profile.id), JSON.stringify(input.secret));
    }

    try {
      this.db.profiles.insert(profile);
      return profile;
    } catch (err) {
      if (profile.hasSecret) {
        await this.secrets.clear(secretKey(profile.id)).catch(() => undefined);
      }
      throw err;
    }
  }

  async updateProfile(
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
  ): Promise<ConnectionProfile> {
    const existing = this.db.profiles.byId(id);
    if (!existing) throw appError('NotFound', `Connection profile not found: ${id}`);

    if (input.uri !== undefined) {
      assertUriHasNoCredentials(input.uri);
    }

    const updated: ConnectionProfile = {
      ...existing,
      name: input.name ?? existing.name,
      groupId: input.groupId !== undefined ? input.groupId : existing.groupId,
      color: input.color !== undefined ? input.color : existing.color,
      uriRedacted: input.uri !== undefined ? redactUri(input.uri) : existing.uriRedacted,
      defaultDatabase: input.defaultDatabase !== undefined ? input.defaultDatabase : existing.defaultDatabase,
      readOnly: input.readOnly ?? existing.readOnly,
      options: input.options ?? existing.options,
      updatedAt: Date.now(),
    };

    let previousSecret: string | null | undefined;
    if (input.secret !== undefined) {
      previousSecret = await this.secrets.get(secretKey(id));
      const hasSecret = input.secret !== null && Object.keys(input.secret).length > 0;
      updated.hasSecret = hasSecret;
      if (hasSecret && input.secret) {
        await this.secrets.set(secretKey(id), JSON.stringify(input.secret));
      } else {
        await this.secrets.clear(secretKey(id));
      }
    }

    try {
      this.db.profiles.update(updated);
      return updated;
    } catch (err) {
      if (previousSecret !== undefined) {
        if (previousSecret === null) {
          await this.secrets.clear(secretKey(id)).catch(() => undefined);
        } else {
          await this.secrets.set(secretKey(id), previousSecret).catch(() => undefined);
        }
      }
      throw err;
    }
  }

  async deleteProfile(id: string): Promise<void> {
    await this.supervisor.dispose(id).catch(() => undefined);
    await this.secrets.clear(secretKey(id));
    this.db.profiles.remove(id);
  }

  // ── Connectivity ──

  async resolveUri(profileId: string): Promise<string> {
    const profile = this.db.profiles.byId(profileId);
    if (!profile) throw appError('NotFound', `Connection profile not found: ${profileId}`);

    let secret: SecretPayload | undefined;
    if (profile.hasSecret) {
      const secretJson = await this.secrets.get(secretKey(profileId));
      if (secretJson) {
        try {
          secret = JSON.parse(secretJson) as SecretPayload;
        } catch {
          throw appError('SecureStorageFailure', 'Stored connection secret is invalid and must be entered again.');
        }
      }
    }
    if (secret?.uriOverride) return secret.uriOverride;

    const username = profile.options.username;
    if (username) {
      const creds = `${encodeURIComponent(username)}:${encodeURIComponent(secret?.password ?? '')}`;
      return profile.uriRedacted.replace('//', `//${creds}@`);
    }
    if (secret?.password) {
      return profile.uriRedacted.replace('//', `//${encodeURIComponent(secret.password)}@`);
    }
    return profile.uriRedacted;
  }

  async connect(profileId: string): Promise<void> {
    const profile = this.db.profiles.byId(profileId);
    if (!profile) throw appError('NotFound', `Connection profile not found: ${profileId}`);
    const uri = await this.resolveUri(profileId);
    // Strip non-driver options (username is already embedded in the resolved URI).
    await this.supervisor.ensure(profileId, uri, toDriverOptions(profile.options ?? {}));
  }

  async disconnect(profileId: string): Promise<void> {
    await this.supervisor.dispose(profileId);
  }

  getConnectionState(profileId: string): {
    status: string;
    pid?: number;
    serverVersion?: string;
    connectedAt?: number;
  } {
    const info = this.supervisor.getInfo(profileId);
    if (!info) return { status: 'disconnected' };
    return {
      status: 'connected',
      pid: info.pid,
      serverVersion: info.serverVersion,
      connectedAt: info.connectedAt,
    };
  }

  listConnected(): string[] {
    return this.db.profiles.list()
      .filter((p) => this.supervisor.getInfo(p.id) !== null)
      .map((p) => p.id);
  }

  async testConnection(uri: string, options?: ConnectionOptions): Promise<TestConnectionResult> {
    const runtimeOptions = toDriverOptions(options ?? {});
    if (this.tester) return this.tester(uri, runtimeOptions);
    const client = new RuntimeClient({
      entryPath: resolveRuntimeEntry(),
      connectionId: `test-${randomUUID()}`,
      requestTimeoutMS: 15_000,
    });

    try {
      await client.start();
      const started = Date.now();
      const init = await client.request<{ serverVersion: string; topology: string }>('init', {
        uri,
        options: runtimeOptions,
      });
      const roundTripMs = Date.now() - started;
      await client.request('ping');
      return {
        ok: true,
        serverVersion: init.serverVersion,
        topology: init.topology,
        roundTripMs,
      };
    } catch (err) {
      return { ok: false, error: serializeError(err) };
    } finally {
      await client.kill();
    }
  }

  async testDraft(input: ConnectionDraftRequest): Promise<TestConnectionResult> {
    try {
      const { uri, options } = await this.resolveDraftConnection(input);
      return this.testConnection(uri, options);
    } catch (error) {
      return { ok: false, error: serializeError(error) };
    }
  }

  async saveAndConnect(input: ConnectionDraftRequest): Promise<SaveAndConnectResult> {
    const test = await this.testDraft(input);
    if (!test.ok) return { test, saved: false, connected: false };

    const { draft, secretAction } = input;
    let profile: ConnectionProfile;
    if (input.profileId) {
      profile = await this.updateProfile(input.profileId, {
        name: draft.name,
        groupId: draft.groupId,
        uri: draft.uri,
        defaultDatabase: draft.defaultDatabase,
        readOnly: draft.readOnly,
        color: draft.color,
        options: draft.options,
        ...(secretAction.mode === 'replace' ? { secret: secretAction.secret } : {}),
        ...(secretAction.mode === 'clear' ? { secret: null } : {}),
      });
    } else {
      if (secretAction.mode !== 'replace') {
        return {
          test: {
            ok: false,
            error: appError('Validation', 'A new connection must provide an explicit credential state.'),
          },
          saved: false,
          connected: false,
        };
      }
      profile = await this.createProfile({
        name: draft.name,
        groupId: draft.groupId,
        uri: draft.uri,
        ...(draft.defaultDatabase ? { defaultDatabase: draft.defaultDatabase } : {}),
        readOnly: draft.readOnly,
        ...(draft.color ? { color: draft.color } : {}),
        options: draft.options,
        ...(Object.keys(secretAction.secret).length > 0 ? { secret: secretAction.secret } : {}),
      });
    }

    // Do not disturb an active runtime until the draft has passed its isolated
    // test and its profile/vault update has succeeded.
    await this.supervisor.dispose(profile.id).catch(() => undefined);
    try {
      await this.connect(profile.id);
      return { test, saved: true, connected: true, profile };
    } catch (error) {
      return {
        test,
        saved: true,
        connected: false,
        profile,
        connectionError: serializeError(error),
      };
    }
  }

  private async resolveDraftConnection(
    input: ConnectionDraftRequest,
  ): Promise<{ uri: string; options: ConnectionOptions }> {
    const { draft, secretAction } = input;
    assertUriHasNoCredentials(draft.uri);
    if (input.profileId && !this.db.profiles.byId(input.profileId)) {
      throw appError('NotFound', `Connection profile not found: ${input.profileId}`);
    }
    if (!input.profileId && secretAction.mode !== 'replace') {
      throw appError('Validation', 'A new connection must provide an explicit credential state.');
    }

    let secret: SecretPayload | undefined;
    if (secretAction.mode === 'replace') {
      secret = secretAction.secret;
    } else if (secretAction.mode === 'preserve' && input.profileId) {
      const stored = await this.secrets.get(secretKey(input.profileId));
      if (stored) {
        try {
          secret = JSON.parse(stored) as SecretPayload;
        } catch {
          throw appError('SecureStorageFailure', 'Stored connection secret is invalid and must be entered again.');
        }
      }
    }

    const username = draft.options.username?.trim();
    const uri = secret?.uriOverride
      ? secret.uriOverride
      : username
        ? draft.uri.replace(
            '//',
            `//${encodeURIComponent(username)}:${encodeURIComponent(secret?.password ?? '')}@`,
          )
        : secret?.password
          ? draft.uri.replace('//', `//${encodeURIComponent(secret.password)}@`)
          : draft.uri;
    const { username: _username, ...driverOptions } = draft.options;
    return { uri, options: driverOptions };
  }

}

function secretKey(profileId: string): string {
  return `conn:${profileId}`;
}

function toDriverOptions(options: ConnectionOptions): Record<string, unknown> {
  const { username: _username, tls, authMechanism, ...rest } = options;
  return {
    ...rest,
    ...(authMechanism && authMechanism !== 'SCRAM' ? { authMechanism } : {}),
    ...(tls
      ? {
          tls: tls.enabled,
          ...(tls.allowInvalidCertificates !== undefined
            ? { tlsAllowInvalidCertificates: tls.allowInvalidCertificates }
            : {}),
        }
      : {}),
  };
}
