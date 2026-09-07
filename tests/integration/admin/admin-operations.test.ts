import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MongoClient } from 'mongodb';
import {
  createCollectionIndex,
  deleteGridFsFile,
  downloadGridFsFile,
  dropCollectionIndex,
  explainCollectionFind,
  globalSearch,
  listGridFsFiles,
  listIndexes,
  pollChangeStream,
  startChangeStream,
  uploadGridFsFile,
} from '../../../src/query-runtime/admin/operations.js';
import { CursorRegistry } from '../../../src/query-runtime/registry/cursors.js';
import { parseEjson } from '../../../src/shared/ejson/index.js';
import { useMongoIntegrationSuite } from '../fixtures/mongo.js';

const suite = useMongoIntegrationSuite('admin operations');

const DATABASE = suite.databaseName;

describe('Phase 5 administration operations', () => {
  let standalone: MongoClient;
  let replicaSet: MongoClient;
  let registry: CursorRegistry;
  let tempDirectory: string;

  beforeAll(async () => {
    [standalone, replicaSet] = await Promise.all([
      suite.newClient(await suite.standaloneUri),
      suite.newClient(await suite.replicaSetUri),
    ]);
    registry = new CursorRegistry();
    tempDirectory = await mkdtemp(join(tmpdir(), 'mongog-phase5-'));
  }, 180_000);

  afterAll(async () => {
    await registry?.dispose();
    if (tempDirectory) await rm(tempDirectory, { recursive: true, force: true });
  });

  it('creates, lists, explains, and drops collection indexes', async () => {
    const collection = standalone.db(DATABASE).collection('indexes');
    await collection.insertMany([{ email: 'a@example.test', score: 1 }, { email: 'b@example.test', score: 2 }]);

    const created = await createCollectionIndex(standalone, {
      database: DATABASE,
      collection: 'indexes',
      keysEjson: '{"email": 1}',
      name: 'email_unique',
      unique: true,
    });
    expect(created.name).toBe('email_unique');
    const indexes = await listIndexes(standalone, { database: DATABASE, collection: 'indexes' });
    expect(indexes.find((index) => index.name === 'email_unique')).toMatchObject({ unique: true });

    const explanation = await explainCollectionFind(standalone, {
      database: DATABASE,
      collection: 'indexes',
      filterEjson: '{"email": "a@example.test"}',
      verbosity: 'executionStats',
    });
    const explainDocument = parseEjson<Record<string, unknown>>(explanation);
    expect(explainDocument).toHaveProperty('queryPlanner');
    expect(explainDocument).toHaveProperty('executionStats');

    await expect(dropCollectionIndex(standalone, { database: DATABASE, collection: 'indexes', name: '_id_' }))
      .rejects.toMatchObject({ category: 'Validation' });
    await expect(dropCollectionIndex(standalone, { database: DATABASE, collection: 'indexes', name: 'email_unique' }))
      .resolves.toEqual({ dropped: 'email_unique' });
  });

  it('performs a bounded sampled search across collections', async () => {
    await standalone.db(DATABASE).collection('search_a').insertMany([{ value: 'needle-one' }, { value: 'other' }]);
    await standalone.db(DATABASE).collection('search_b').insertOne({ nested: { value: 'NEEDLE-two' } });
    const result = await globalSearch(standalone, {
      database: DATABASE,
      text: 'needle',
      maxCollections: 100,
      maxDocumentsPerCollection: 100,
      maxResults: 10,
    });
    expect(result.sampled).toBe(true);
    expect(result.matches.map((match) => match.collection)).toEqual(expect.arrayContaining(['search_a', 'search_b']));
    expect(result.scannedDocuments).toBeGreaterThanOrEqual(3);
  });

  it('streams GridFS uploads and downloads without moving file bytes through renderer IPC', async () => {
    const sourcePath = join(tempDirectory, 'source.bin');
    const destinationPath = join(tempDirectory, 'downloaded.bin');
    const bytes = Buffer.concat([
      Buffer.from('MongoG GridFS integration payload', 'utf8'),
      Buffer.from([0, 1]),
    ]);
    await writeFile(sourcePath, bytes);

    const uploaded = await uploadGridFsFile(standalone, {
      database: DATABASE,
      bucketName: 'assets',
      sourcePath,
      metadataEjson: '{"purpose": "integration"}',
    });
    expect(uploaded.filename).toBe('source.bin');
    expect(uploaded.length).toBe(bytes.length);

    const files = await listGridFsFiles(standalone, { database: DATABASE, bucketName: 'assets', limit: 10 });
    expect(files).toHaveLength(1);
    expect(parseEjson<Record<string, unknown>>(files[0]!.metadata!)).toMatchObject({ purpose: 'integration' });

    await downloadGridFsFile(standalone, {
      database: DATABASE,
      bucketName: 'assets',
      idEjson: uploaded.id.ejson,
      destinationPath,
    });
    expect(await readFile(destinationPath)).toEqual(bytes);
    await deleteGridFsFile(standalone, { database: DATABASE, bucketName: 'assets', idEjson: uploaded.id.ejson });
    await expect(listGridFsFiles(standalone, { database: DATABASE, bucketName: 'assets', limit: 10 })).resolves.toEqual([]);
  });

  it('starts, polls, and closes a real replica-set change stream', async () => {
    const collection = replicaSet.db(DATABASE).collection('changes');
    const started = startChangeStream(replicaSet, registry, {
      database: DATABASE,
      collection: 'changes',
      pipelineEjson: '[]',
      fullDocument: 'updateLookup',
      owner: { connectionId: 'phase5', tabId: 'changes' },
    });

    // First poll opens the lazy driver stream before the write happens.
    await pollChangeStream(registry, started.streamId, 10);
    await collection.insertOne({ marker: 'phase5-change' });
    const result = await pollChangeStream(registry, started.streamId, 10);
    expect(result.events).toHaveLength(1);
    expect(parseEjson<Record<string, unknown>>(result.events[0]!)).toMatchObject({ operationType: 'insert' });
    expect(await registry.closeAllForOwner({ connectionId: 'phase5', tabId: 'changes' })).toBe(1);
  }, 30_000);
});
