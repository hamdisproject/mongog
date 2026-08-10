import { app } from 'electron';
import { RuntimeClient } from './runtime/runtime-client.js';
import { resolveRuntimeEntry } from './runtime/paths.js';
import type { RuntimeSupervisor } from './runtime/supervisor.js';
import type { EngineEvent } from '../shared/domain/index.js';
import type { Database } from './storage/database.js';
import { ConnectionManager } from './services/connection-manager.js';
import { secretVault } from './security/secret-vault.js';
import { loadWindowState, saveWindowState } from './window-state.js';
import { serializeError } from '../shared/errors/index.js';

export async function runSmokeChecks(supervisor: RuntimeSupervisor, spikeMongoUri: string | null, getDb?: () => Database): Promise<void> {
  const log = (msg: string) => console.log(`[SMOKE] ${msg}`);
  let failures = 0;
  const expect = (cond: boolean, msg: string) => {
    log(`  ${cond ? 'PASS' : 'FAIL'}: ${msg}`);
    if (!cond) failures += 1;
  };

  log(`entry: ${resolveRuntimeEntry()}`);
  log(`versions: electron=${process.versions.electron} node=${process.versions.node}`);

  // ── 1) Runtime ping ──
  {
    const client = new RuntimeClient({ entryPath: resolveRuntimeEntry(), connectionId: 'smoke-ping' });
    client.on('log', (stream, data) => log(`[rt:${stream}] ${String(data).trim().slice(0, 2000)}`));
    try {
      await client.start();
      const res = await client.request<{ pong: boolean; pid: number }>('ping');
      expect(res.pong === true && res.pid > 0, `runtime ping (pid=${res.pid})`);
    } catch (err) {
      expect(false, `runtime ping failed: ${(err as Error).message}`);
    } finally {
      await client.kill();
    }
  }

  // ── 2) Storage layer ──
  if (getDb) {
    const db = getDb();

    expect(db.checkIntegrity() === null, 'DB integrity check');

    // Repos exist and are functional.
    const g = db.groups.list();
    expect(Array.isArray(g), 'connection_groups repo works');

    const p = db.profiles.list();
    expect(Array.isArray(p), 'connection_profiles repo works');

    const h = db.history.count();
    expect(typeof h === 'number', `history repo works (count=${h})`);

    const ws = db.workspace.get();
    expect(ws === null || typeof ws === 'object', 'workspace repo works');

    const s = db.settings.get();
    expect(s === null || typeof s === 'object', 'settings repo works');

    // ── 3) Connection Manager CRUD ──
    const cm = new ConnectionManager(db, supervisor, secretVault);

    const group = cm.createGroup('Smoke Test Group');
    expect(group.id.length > 0, `created group "${group.name}" (id=${group.id.slice(0, 8)}…)`);

    const groups = cm.listGroups();
    expect(groups.some((x) => x.id === group.id), 'group appears in list');

    cm.updateGroup({ ...group, name: 'Smoke Group Updated' });
    const updatedGroup = cm.listGroups().find((x) => x.id === group.id);
    expect(updatedGroup?.name === 'Smoke Group Updated', 'group name updated');

    const profile = await cm.createProfile({
      name: 'Smoke Profile',
      uri: 'mongodb://localhost:27017/test',
      groupId: group.id,
    });
    expect(profile.id.length > 0, `created profile "${profile.name}"`);
    expect(profile.uriRedacted === 'mongodb://localhost:27017/test', 'URI redacted correctly');
    expect(profile.groupId === group.id, 'profile assigned to group');

    const loaded = cm.getProfile(profile.id);
    expect(loaded !== null && loaded.name === 'Smoke Profile', 'profile retrievable by id');

    await cm.updateProfile(profile.id, { name: 'Smoke Profile Updated' });
    expect(cm.getProfile(profile.id)?.name === 'Smoke Profile Updated', 'profile name updated');

    // ── 4) URI resolution ──
    const noSecretUri = await cm.resolveUri(profile.id);
    expect(noSecretUri === 'mongodb://localhost:27017/test', 'URI resolves without secret');

    try {
      const secretProfile = await cm.createProfile({
        name: 'Secret Profile',
        uri: 'mongodb://secret-host:27017',
        secret: { password: 'hunter2' },
      });
      const resolvedSecret = await cm.resolveUri(secretProfile.id);
      expect(
        resolvedSecret.includes('hunter2@secret-host'),
        `URI injected password (${resolvedSecret.replace(/hunter2/, '<redacted>')})`,
      );

      await cm.deleteProfile(secretProfile.id);
      expect(cm.getProfile(secretProfile.id) === null, 'secret profile deleted');
    } catch (err) {
      const secureStorageError = serializeError(err);
      if (process.platform === 'darwin') throw err;
      // Linux CI environments may not provide an OS keyring. The security
      // invariant remains that persistence fails closed with no plaintext.
      expect(
        secureStorageError.category === 'SecureStorageFailure' &&
          cm.listProfiles().every((candidate) => candidate.name !== 'Secret Profile'),
        'secure storage unavailable: secret profile rejected without plaintext fallback',
      );
    }

    await cm.deleteProfile(profile.id);
    expect(cm.getProfile(profile.id) === null, 'profile deleted');

    cm.deleteGroup(group.id);
    expect(cm.listGroups().some((x) => x.id === group.id) === false, 'group deleted');

    // ── 5) Window state persistence ──
    saveWindowState(db.settings, { bounds: { x: 100, y: 100, width: 1280, height: 800 }, maximized: false });
    const loadedState = loadWindowState(db.settings);
    expect(loadedState !== null, 'window state saved and loaded');
    expect(loadedState!.bounds.width === 1280, 'window state bounds correct');

    // Clean up window state.
    db.settings.remove('window:state');
    expect(loadWindowState(db.settings) === null, 'window state cleaned up');

    log('  Phase 1 storage/connection smoke: PASS');
  } else {
    log('  (no getDb; storage/connection smoke skipped — only available in app context)');
  }

  // ── 6) Full DB path through the supervised runtime ──
  if (spikeMongoUri) {
    try {
      const client = await supervisor.ensure('smoke', spikeMongoUri);
      expect(true, 'runtime init + MongoClient.connect');

      client.on('log', (stream, data) => log(`[runtime:${stream}] ${String(data).trim()}`));
      client.on('runtime-error', (err) => log(`runtime-error: ${JSON.stringify(err)}`));
      const events: EngineEvent[] = [];
      client.onEngineEvent((_id, e) => {
        log(`event: ${e.type}`);
        events.push(e);
      });
      await client.request('execute', {
        request: {
          connectionId: 'smoke',
          database: 'smoke',
          mode: 'query',
          source: `
const coll = db.collection("smoke");
await coll.insertMany([{ a: 1 }, { a: 2 }, { a: 3 }]);
coll.find({ a: { $gte: 2 } });
await coll.countDocuments({});
`,
          sourceOffset: { line: 0, column: 0 },
        },
      });
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('execution timed out')), 15_000);
        const check = () => {
          const fin = events.find((e) => e.type === 'execution-finished');
          if (fin) {
            clearTimeout(timer);
            resolve();
          } else setTimeout(check, 20);
        };
        check();
      });
      const results = events.filter((e) => e.type === 'result');
      const finished = events.find((e) => e.type === 'execution-finished');
      expect(results.length === 3, `3 statement results (got ${results.length})`);
      expect(results[1]?.type === 'result' && results[1].result.kind === 'documents', 'cursor result');
      expect(finished?.type === 'execution-finished' && finished.status === 'completed', 'execution completed');

      const docs = results[1]?.type === 'result' && results[1].result.kind === 'documents' ? results[1].result : null;
      if (docs) {
        const page = await client.request<{ documents: unknown[] }>('cursor-next', {
          cursorId: docs.cursorId,
          pageSize: 10,
        });
        expect(page.documents.length + docs.documents.length === 2, 'cursor paging consistent');
      }
      await supervisor.dispose('smoke');
      expect(true, 'runtime disposed');
    } catch (err) {
      expect(false, `full path failed: ${(err as Error).message}`);
    }
  } else {
    log('  (no spike mongo; DB path skipped — set MONGOG_SPIKE_MONGO=1)');
  }

  log(failures === 0 ? 'SMOKE: PASS' : `SMOKE: ${failures} FAILURES`);
  app.exit(failures === 0 ? 0 : 1);
}
