import { describe, expect, it } from 'vitest';
import {
  assertUriHasNoCredentials,
  redactForLog,
  redactUri,
  uriContainsCredentials,
} from '../../src/shared/redaction/index.js';

describe('redaction', () => {
  it('masks userinfo in mongodb:// URIs', () => {
    expect(redactUri('mongodb://alice:s3cret@db.example.com:27017/app')).toBe(
      'mongodb://<redacted>@db.example.com:27017/app',
    );
  });

  it('masks userinfo in mongodb+srv:// URIs', () => {
    const r = redactUri('mongodb+srv://bob:p%40ss@cluster0.example.net/prod?retryWrites=true');
    expect(r).toContain('<redacted>');
    expect(r).not.toContain('p%40ss');
    expect(r).toContain('cluster0.example.net');
  });

  it('masks passwords with special characters', () => {
    const r = redactUri('mongodb://u:p@ss:word@host:27017/');
    expect(r).not.toContain('p@ss');
    expect(r).toContain('host:27017');
  });

  it('leaves credential-free URIs untouched', () => {
    const uri = 'mongodb://localhost:27017/mydb?directConnection=true';
    expect(redactUri(uri)).toBe(uri);
  });

  it('redacts secret-looking key=value pairs in arbitrary text', () => {
    expect(redactUri('connect password=hunter2 now')).toBe('connect password=<redacted> now');
  });

  it('detects credentials', () => {
    expect(uriContainsCredentials('mongodb://u:p@h/')).toBe(true);
    expect(uriContainsCredentials('mongodb://h/')).toBe(false);
  });

  it('assertUriHasNoCredentials rejects secret URIs', () => {
    expect(() => assertUriHasNoCredentials('mongodb://u:p@h/db')).toThrow(/credentials/);
    expect(() => assertUriHasNoCredentials('mongodb://h/db')).not.toThrow();
  });

  it('redactForLog deep-redacts objects', () => {
    const out = redactForLog({
      uri: 'mongodb://u:p@h/db',
      nested: { password: 'x', list: ['token=abc', 'ok'] },
    }) as Record<string, unknown>;
    expect(JSON.stringify(out)).not.toContain('hunter');
    expect(JSON.stringify(out)).not.toContain('u:p@');
    expect((out.nested as Record<string, unknown>).password).toBe('<redacted>');
  });
});
