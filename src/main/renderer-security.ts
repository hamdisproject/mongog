/**
 * Renderer trust checks and the production renderer policy. No Electron
 * imports, so the rules are unit-tested directly.
 */

/**
 * Exact `scheme://host[:port]` match. WHATWG `URL.origin` is "null" for custom
 * schemes such as mongog://, and prefix matching would accept look-alike hosts
 * (http://localhost:5173.evil.com).
 */
export function isAllowedRendererUrl(url: string, allowedOrigins: readonly string[]): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return allowedOrigins.includes(`${parsed.protocol}//${parsed.host}`);
}

/**
 * Sent by the mongog://bundle handler with every HTML response; the browser
 * enforces it together with index.html's development meta policy. Monaco needs
 * inline styles and blob workers; nothing needs inline scripts, eval or network.
 */
export const PRODUCTION_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');
