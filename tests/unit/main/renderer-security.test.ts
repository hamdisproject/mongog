import { describe, expect, it } from 'vitest';
import { isAllowedRendererUrl, PRODUCTION_CSP } from '../../../src/main/renderer-security.js';

const PRODUCTION = ['mongog://bundle'];
const DEVELOPMENT = ['http://localhost:5173', 'mongog://bundle'];

describe('renderer origin checks', () => {
  it.each([
    ['mongog://bundle/index.html', PRODUCTION],
    ['mongog://bundle/assets/editor.worker.js', PRODUCTION],
    ['http://localhost:5173/', DEVELOPMENT],
    ['http://localhost:5173/src/renderer/main.tsx', DEVELOPMENT],
  ])('allows %s', (url, allowed) => {
    expect(isAllowedRendererUrl(url, allowed)).toBe(true);
  });

  it.each([
    ['http://localhost:5173.evil.com/', DEVELOPMENT],
    ['http://localhost:51730/', DEVELOPMENT],
    ['mongog://bundle.evil/index.html', PRODUCTION],
    ['mongog://bundlex/index.html', PRODUCTION],
    ['https://example.com/mongog://bundle', PRODUCTION],
    ['not a url', PRODUCTION],
    ['', PRODUCTION],
  ])('rejects %s', (url, allowed) => {
    expect(isAllowedRendererUrl(url, allowed)).toBe(false);
  });
});

describe('production content security policy', () => {
  const directives = new Map(PRODUCTION_CSP.split(';').map((directive) => {
    const [name, ...values] = directive.trim().split(/\s+/u);
    return [name!, values] as const;
  }));

  it('allows only bundled scripts and no network beyond the bundle', () => {
    expect(directives.get('script-src')).toEqual(["'self'"]);
    expect(directives.get('connect-src')).toEqual(["'self'"]);
    expect(PRODUCTION_CSP).not.toContain('localhost');
    expect(PRODUCTION_CSP).not.toContain('unsafe-eval');
  });

  it('blocks plugins, base rewriting and framing', () => {
    expect(directives.get('object-src')).toEqual(["'none'"]);
    expect(directives.get('base-uri')).toEqual(["'none'"]);
    expect(directives.get('frame-ancestors')).toEqual(["'none'"]);
  });
});
