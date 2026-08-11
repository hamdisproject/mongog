/** Connection domain model (plan §14/§F). */
import type { AppError } from '../errors/index.js';

export interface ConnectionGroup {
  id: string;
  name: string;
  collapsed: boolean;
  sortOrder: number;
  createdAt: number;
}

export type ReadPreferenceMode =
  | 'primary'
  | 'primaryPreferred'
  | 'secondary'
  | 'secondaryPreferred'
  | 'nearest';

export interface ConnectionOptions {
  connectTimeoutMS?: number;
  serverSelectionTimeoutMS?: number;
  socketTimeoutMS?: number;
  /** CSOT default applied at client level. */
  timeoutMS?: number;
  maxPoolSize?: number;
  minPoolSize?: number;
  readPreference?: ReadPreferenceMode;
  retryReads?: boolean;
  retryWrites?: boolean;
  directConnection?: boolean;
  appName?: string;
  authMechanism?: 'SCRAM' | 'MONGODB-X509' | 'MONGODB-AWS' | 'MONGODB-OIDC';
  authSource?: string;
  /** Non-secret credential part. Password/keys live in the secret vault only. */
  username?: string;
  tls?: { enabled: boolean; allowInvalidCertificates?: boolean };
}

export interface ConnectionProfile {
  id: string;
  groupId: string | null;
  name: string;
  color: string | null;
  /** Guaranteed to contain NO userinfo (enforced at save time). */
  uriRedacted: string;
  defaultDatabase: string | null;
  readOnly: boolean;
  options: ConnectionOptions;
  hasSecret: boolean;
  createdAt: number;
  updatedAt: number;
}

/** Secret material; only ever handled by the main-process vault. */
export interface SecretPayload {
  password?: string;
  /** Full URI including credentials (alternative to password injection). */
  uriOverride?: string;
  awsAccessKeyId?: string;
  awsSecretAccessKey?: string;
  awsSessionToken?: string;
  tlsCertificateKeyFilePassphrase?: string;
}

export type ConnectionRuntimeState =
  | { status: 'disconnected'; reason?: 'idle' | 'user'; since?: number; idleTimeoutMS?: number }
  | { status: 'connecting'; since: number }
  | {
      status: 'connected';
      runtimePid: number;
      serverVersion: string;
      connectedAt: number;
    }
  | { status: 'error'; error: AppError }
  | { status: 'runtime-crashed'; since: number };

export interface TestConnectionResult {
  ok: boolean;
  serverVersion?: string;
  topology?: string;
  roundTripMs?: number;
  error?: AppError;
}

export interface ConnectionDraft {
  name: string;
  groupId: string | null;
  uri: string;
  defaultDatabase: string | null;
  readOnly: boolean;
  color: string | null;
  options: ConnectionOptions;
}

export type ConnectionSecretAction =
  | { mode: 'preserve' }
  | { mode: 'clear' }
  | { mode: 'replace'; secret: SecretPayload };

export interface ConnectionDraftRequest {
  profileId?: string;
  draft: ConnectionDraft;
  secretAction: ConnectionSecretAction;
}

export interface SaveAndConnectResult {
  test: TestConnectionResult;
  saved: boolean;
  connected: boolean;
  profile?: ConnectionProfile;
  connectionError?: AppError;
}

export interface DbSummary {
  name: string;
}

export interface CollectionSummary {
  name: string;
  type: 'collection' | 'view' | 'timeseries';
}
