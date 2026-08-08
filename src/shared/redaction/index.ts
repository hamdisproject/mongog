/**
 * Credential redaction (plan §13/§15/§22).
 * No log line, error, history entry, profile row or IPC payload may ever
 * contain an unredacted URI or known secret material.
 */

const URI_SCHEME = /^(mongodb(?:\+srv)?):\/\//i;

/** Replace userinfo in a MongoDB URI with a fixed mask. */
export function redactUri(uri: string): string {
  if (!URI_SCHEME.test(uri)) return redactSecretPatterns(uri);
  // Greedy match up to the LAST '@' before the host/path, so passwords
  // containing raw '@' characters are also fully masked.
  const replaced = uri.replace(/^(mongodb(?:\+srv)?:\/\/)[^/@]*@/i, '$1<redacted>@');
  return redactSecretPatterns(replaced);
}

/** Known secret-looking patterns outside URI userinfo (query params, key=value). */
function redactSecretPatterns(input: string): string {
  return input
    .replace(/(password|passwd|pwd|secret|token|aws_session_token)=([^\s&;]+)/gi, '$1=<redacted>')
    .replace(/\/\/[^/\s:]+:[^@\s]+@/g, '//<redacted>:<redacted>@');
}

/**
 * Assert that a URI contains no credentials. Used before persisting a profile
 * or query-history entry; throws instead of silently storing secrets.
 */
export function assertUriHasNoCredentials(uri: string): void {
  const m = uri.match(URI_SCHEME);
  if (!m) {
    throw new Error(`Invalid MongoDB URI scheme: ${redactUri(uri)}`);
  }
  try {
    const u = new URL(uri.replace(URI_SCHEME, 'http://'));
    if (u.username || u.password) {
      throw new Error('URI contains credentials; store secrets via the secret vault instead.');
    }
  } catch (e) {
    if (e instanceof TypeError) throw new Error(`Invalid MongoDB URI: ${redactUri(uri)}`);
    throw e;
  }
}

/** True when the URI embeds userinfo credentials. */
export function uriContainsCredentials(uri: string): boolean {
  if (!URI_SCHEME.test(uri)) return false;
  try {
    const u = new URL(uri.replace(URI_SCHEME, 'http://'));
    return Boolean(u.username || u.password);
  } catch {
    return false;
  }
}

/**
 * Detect material that must never be written to local persistence. This is
 * deliberately narrower than log redaction so ordinary document fields such
 * as `{ token: "hashed-value" }` remain valid query data.
 */
export function containsKnownSecretMaterial(value: unknown): boolean {
  if (typeof value === 'string') {
    const uris = value.match(/mongodb(?:\+srv)?:\/\/[^\s"'`]+/gi) ?? [];
    if (uris.some(uriContainsCredentials)) return true;
    return /\b(password|passwd|pwd|secret|token|aws_session_token)\s*=\s*(?!<redacted>)[^\s,;]+/i.test(value);
  }
  if (Array.isArray(value)) return value.some(containsKnownSecretMaterial);
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).some(containsKnownSecretMaterial);
  }
  return false;
}

/** Generic deep redactor for log payloads. */
export function redactForLog(value: unknown): unknown {
  if (typeof value === 'string') return redactSecretPatterns(redactUri(value));
  if (Array.isArray(value)) return value.map(redactForLog);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = /password|secret|token|credential|passphrase/i.test(k) ? '<redacted>' : redactForLog(v);
    }
    return out;
  }
  return value;
}
