import { describe, expect, it } from 'vitest';
import {
  connectionRequest,
  draftFromProfile,
  emptyConnectionDraft,
  splitCredentialsFromUri,
} from '../../src/renderer/components/Connections/connection-draft.js';

describe('connection form draft', () => {
  it('extracts encoded credentials and returns a credential-free URI', () => {
    expect(splitCredentialsFromUri('mongodb://user%40mail:p%40ss@localhost:27017/db')).toEqual({
      uri: 'mongodb://localhost:27017/db',
      username: 'user@mail',
      password: 'p@ss',
    });
  });

  it('builds a new typed request with Basic and Advanced options', () => {
    const form = {
      ...emptyConnectionDraft(),
      name: 'Local',
      username: 'alice',
      password: 'secret',
      defaultDatabase: 'shop',
      tlsEnabled: true,
      allowInvalidCertificates: true,
      maxPoolSize: '40',
    };
    const request = connectionRequest(form);
    expect(request.draft).toMatchObject({
      name: 'Local',
      defaultDatabase: 'shop',
      options: {
        username: 'alice',
        maxPoolSize: 40,
        tls: { enabled: true, allowInvalidCertificates: true },
      },
    });
    expect(request.secretAction).toEqual({ mode: 'replace', secret: { password: 'secret' } });
  });

  it('preserves credentials when editing without putting a password in form state', () => {
    const form = draftFromProfile({
      id: 'p1', groupId: null, name: 'Saved', color: null,
      uriRedacted: 'mongodb://localhost:27017', defaultDatabase: null,
      readOnly: false, options: { username: 'saved-user' }, hasSecret: true,
      createdAt: 1, updatedAt: 1,
    });
    expect(form.password).toBe('');
    expect(form.secretMode).toBe('preserve');
    expect(connectionRequest(form, 'p1').secretAction).toEqual({ mode: 'preserve' });
  });

  it('rejects credentialed URIs and invalid pool bounds', () => {
    expect(() => connectionRequest({ ...emptyConnectionDraft(), name: 'Bad', uri: 'mongodb://u:p@host' }))
      .toThrow(/Credentials/);
    expect(() => connectionRequest({ ...emptyConnectionDraft(), name: 'Bad pool', minPoolSize: '5', maxPoolSize: '2' }))
      .toThrow(/Min pool size/);
  });
});
