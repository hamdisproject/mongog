import type {
  ConnectionDraftRequest,
  ConnectionOptions,
  ConnectionProfile,
} from '../../../shared/domain/index.js';

export type SecretMode = 'preserve' | 'replace' | 'clear';

export interface ConnectionFormDraft {
  name: string;
  uri: string;
  username: string;
  password: string;
  defaultDatabase: string;
  groupId: string;
  color: string;
  readOnly: boolean;
  secretMode: SecretMode;
  connectTimeoutMS: string;
  serverSelectionTimeoutMS: string;
  socketTimeoutMS: string;
  timeoutMS: string;
  maxPoolSize: string;
  minPoolSize: string;
  readPreference: ConnectionOptions['readPreference'] | '';
  retryReads: boolean;
  retryWrites: boolean;
  directConnection: boolean;
  appName: string;
  authMechanism: ConnectionOptions['authMechanism'] | '';
  authSource: string;
  tlsEnabled: boolean;
  allowInvalidCertificates: boolean;
}

export function emptyConnectionDraft(): ConnectionFormDraft {
  return {
    name: '',
    uri: 'mongodb://localhost:27017',
    username: '',
    password: '',
    defaultDatabase: '',
    groupId: '',
    color: '#4ec9b0',
    readOnly: false,
    secretMode: 'replace',
    connectTimeoutMS: '10000',
    serverSelectionTimeoutMS: '10000',
    socketTimeoutMS: '0',
    timeoutMS: '30000',
    maxPoolSize: '20',
    minPoolSize: '0',
    readPreference: 'primary',
    retryReads: true,
    retryWrites: true,
    directConnection: false,
    appName: 'MongoG',
    authMechanism: '',
    authSource: '',
    tlsEnabled: false,
    allowInvalidCertificates: false,
  };
}

export function draftFromProfile(profile: ConnectionProfile): ConnectionFormDraft {
  const options = profile.options ?? {};
  return {
    ...emptyConnectionDraft(),
    name: profile.name,
    uri: profile.uriRedacted,
    username: options.username ?? '',
    defaultDatabase: profile.defaultDatabase ?? '',
    groupId: profile.groupId ?? '',
    color: profile.color ?? '#4ec9b0',
    readOnly: profile.readOnly,
    secretMode: 'preserve',
    connectTimeoutMS: numberText(options.connectTimeoutMS, '10000'),
    serverSelectionTimeoutMS: numberText(options.serverSelectionTimeoutMS, '10000'),
    socketTimeoutMS: numberText(options.socketTimeoutMS, '0'),
    timeoutMS: numberText(options.timeoutMS, '30000'),
    maxPoolSize: numberText(options.maxPoolSize, '20'),
    minPoolSize: numberText(options.minPoolSize, '0'),
    readPreference: options.readPreference ?? 'primary',
    retryReads: options.retryReads ?? true,
    retryWrites: options.retryWrites ?? true,
    directConnection: options.directConnection ?? false,
    appName: options.appName ?? 'MongoG',
    authMechanism: options.authMechanism ?? 'SCRAM',
    authSource: options.authSource ?? '',
    tlsEnabled: options.tls?.enabled ?? false,
    allowInvalidCertificates: options.tls?.allowInvalidCertificates ?? false,
  };
}

export function splitCredentialsFromUri(uri: string): {
  uri: string;
  username?: string;
  password?: string;
} {
  const match = uri.trim().match(/^(mongodb(?:\+srv)?):\/\/([^/@]+)@(.*)$/i);
  if (!match) return { uri: uri.trim() };
  const [, scheme, userInfo, rest] = match;
  if (!scheme || !userInfo || !rest) return { uri: uri.trim() };
  const separator = userInfo.indexOf(':');
  const rawUsername = separator === -1 ? userInfo : userInfo.slice(0, separator);
  const rawPassword = separator === -1 ? undefined : userInfo.slice(separator + 1);
  return {
    uri: `${scheme}://${rest}`,
    username: safeDecode(rawUsername),
    ...(rawPassword !== undefined ? { password: safeDecode(rawPassword) } : {}),
  };
}

export function connectionRequest(
  form: ConnectionFormDraft,
  profileId?: string,
): ConnectionDraftRequest {
  const name = form.name.trim();
  const uri = form.uri.trim();
  if (!name) throw new Error('Connection name is required.');
  if (!/^mongodb(?:\+srv)?:\/\//i.test(uri)) {
    throw new Error('Connection URI must start with mongodb:// or mongodb+srv://.');
  }
  if (/^mongodb(?:\+srv)?:\/\/[^/@]+@/i.test(uri)) {
    throw new Error('Credentials must use the username and password fields, not the URI.');
  }

  const maxPoolSize = integer(form.maxPoolSize, 'Max pool size', 1, 10_000);
  const minPoolSize = integer(form.minPoolSize, 'Min pool size', 0, 10_000);
  if (minPoolSize > maxPoolSize) throw new Error('Min pool size cannot exceed max pool size.');

  const options: ConnectionOptions = {
    connectTimeoutMS: integer(form.connectTimeoutMS, 'Connect timeout', 0, 3_600_000),
    serverSelectionTimeoutMS: integer(form.serverSelectionTimeoutMS, 'Server selection timeout', 0, 3_600_000),
    socketTimeoutMS: integer(form.socketTimeoutMS, 'Socket timeout', 0, 3_600_000),
    timeoutMS: integer(form.timeoutMS, 'Operation timeout', 0, 600_000),
    maxPoolSize,
    minPoolSize,
    retryReads: form.retryReads,
    retryWrites: form.retryWrites,
    directConnection: form.directConnection,
    ...(form.readPreference ? { readPreference: form.readPreference } : {}),
    ...(form.appName.trim() ? { appName: form.appName.trim().slice(0, 128) } : {}),
    ...(form.authMechanism ? { authMechanism: form.authMechanism } : {}),
    ...(form.authSource.trim() ? { authSource: form.authSource.trim() } : {}),
    ...(form.username.trim() ? { username: form.username.trim() } : {}),
    ...(form.tlsEnabled
      ? { tls: { enabled: true, allowInvalidCertificates: form.allowInvalidCertificates } }
      : {}),
  };

  const mode = profileId ? form.secretMode : 'replace';
  const secretAction = mode === 'replace'
    ? {
        mode: 'replace' as const,
        secret: form.password ? { password: form.password } : {},
      }
    : mode === 'clear'
      ? { mode: 'clear' as const }
      : { mode: 'preserve' as const };

  return {
    ...(profileId ? { profileId } : {}),
    draft: {
      name,
      groupId: form.groupId || null,
      uri,
      defaultDatabase: form.defaultDatabase.trim() || null,
      readOnly: form.readOnly,
      color: form.color || null,
      options,
    },
    secretAction,
  };
}

function integer(value: string, label: string, min: number, max: number): number {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new Error(`${label} must be an integer between ${min} and ${max}.`);
  }
  return number;
}

function numberText(value: number | undefined, fallback: string): string {
  return value === undefined ? fallback : String(value);
}

function safeDecode(value: string): string {
  try { return decodeURIComponent(value); }
  catch { return value; }
}
