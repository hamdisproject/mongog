import { BSONRegExp, Decimal128, EJSON, Int32, Long, ObjectId, Timestamp } from 'bson';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MongoClient } from 'mongodb';
import {
  countCollectionDocuments,
  deleteCollectionDocument,
  dropCollection,
  dropDatabase,
  findCollectionDocuments,
  insertCollectionDocument,
  renameCollection,
  replaceCollectionDocument,
} from '../../src/query-runtime/collection/operations.js';
import { CursorRegistry } from '../../src/query-runtime/registry/cursors.js';
import { buildColumnFilterExpression } from '../../src/renderer/collection-column-filter.js';
import { cycleColumnSort } from '../../src/renderer/collection-column-sort.js';
import { parseEjson, serializeToEjson } from '../../src/shared/ejson/index.js';
import { getStandaloneUri, newClient, stopAll } from './helpers/mongo.js';

const DATABASE = 'mongog_phase3';

describe('collection browser operations', () => {
  let client: MongoClient | undefined;
  let registry: CursorRegistry | undefined;

  beforeAll(async () => {
    client = await newClient(await getStandaloneUri());
    registry = new CursorRegistry();
  }, 120_000);

  afterAll(async () => {
    await registry?.dispose();
    await client?.close();
    await stopAll();
  });

  it('pages the complete collection without imposing a one-page limit', async () => {
    const collection = client!.db(DATABASE).collection('paging');
    await collection.insertMany(Array.from({ length: 125 }, (_, n) => ({ n })));

    const first = await findCollectionDocuments(client!, registry!, {
      database: DATABASE,
      collection: 'paging',
      owner: { connectionId: 'phase3', tabId: 'paging-tab' },
      filterEjson: '{}',
      sortEjson: '{"n": 1}',
      pageSize: 25,
    });
    expect(first.documents).toHaveLength(25);
    expect(first.hasMore).toBe(true);
    expect(parseEjson<{ n: Int32 }>(first.documents[0]!).n.valueOf()).toBe(0);

    let count = first.documents.length;
    let page = await registry!.fetchNext(first.cursorId, 25);
    count += page.documents.length;
    while (page.hasMore) {
      page = await registry!.fetchNext(first.cursorId, 25);
      count += page.documents.length;
    }
    expect(count).toBe(125);
    expect(page.pageIndex).toBe(4);
  });

  it('applies safe object-literal filter, sort, and projection in the runtime', async () => {
    const collection = client!.db(DATABASE).collection('criteria');
    await collection.insertMany([
      { bikeid: 17827, rank: 1, active: true, hidden: 'a' },
      { bikeid: 17827, rank: 3, active: true, hidden: 'b' },
      { bikeid: 99, rank: 2, active: false, hidden: 'c' },
    ]);

    const page = await findCollectionDocuments(client!, registry!, {
      database: DATABASE,
      collection: 'criteria',
      owner: { connectionId: 'phase3', tabId: 'criteria-tab' },
      filterEjson: "{ /* sampled id */ bikeid: 17827, active: true, }",
      sortEjson: '{ rank: -1, }',
      projectionEjson: "{ rank: 1, 'active': 1 }",
      pageSize: 10,
    });
    const documents = page.documents.map((envelope) => parseEjson<Record<string, unknown>>(envelope));
    expect(documents.map((document) => (document.rank as Int32).valueOf())).toEqual([3, 1]);
    expect(documents.every((document) => !Object.hasOwn(document, 'hidden'))).toBe(true);
  });

  it('applies table-column ranges and array membership filters', async () => {
    const collection = client!.db(DATABASE).collection('column_quick_filters');
    await collection.insertMany([
      { name: 'lower', price: 100, amenities: ['wifi'], products: ['Computer'] },
      { name: 'middle', price: 150, amenities: ['pool'], products: ['Camera'] },
      { name: 'upper', price: 200, amenities: ['wifi', 'pool'], products: ['Compressor'] },
      { name: 'outside', price: 250 },
    ]);

    const inRangeWithWifi = await findCollectionDocuments(client!, registry!, {
      database: DATABASE,
      collection: 'column_quick_filters',
      owner: { connectionId: 'phase3', tabId: 'column-range-membership-tab' },
      filterEjson: buildColumnFilterExpression({ price: '100..200', amenities: 'has "wifi"' }),
      sortEjson: '{ price: 1 }',
      pageSize: 10,
    });
    expect(inRangeWithWifi.documents.map((item) => (
      parseEjson<{ name: string }>(item).name
    ))).toEqual(['lower', 'upper']);

    const withoutWifi = await findCollectionDocuments(client!, registry!, {
      database: DATABASE,
      collection: 'column_quick_filters',
      owner: { connectionId: 'phase3', tabId: 'column-not-membership-tab' },
      filterEjson: buildColumnFilterExpression({ amenities: '!has "wifi"' }),
      sortEjson: '{ price: 1 }',
      pageSize: 10,
    });
    expect(withoutWifi.documents.map((item) => (
      parseEjson<{ name: string }>(item).name
    ))).toEqual(['middle', 'outside']);

    const notEqual = await findCollectionDocuments(client!, registry!, {
      database: DATABASE,
      collection: 'column_quick_filters',
      owner: { connectionId: 'phase3', tabId: 'column-not-equal-tab' },
      filterEjson: buildColumnFilterExpression({ price: '<> 150' }),
      sortEjson: '{ price: 1 }',
      pageSize: 10,
    });
    expect(notEqual.documents.map((item) => (
      parseEjson<{ name: string }>(item).name
    ))).toEqual(['lower', 'upper', 'outside']);

    const productWildcard = await findCollectionDocuments(client!, registry!, {
      database: DATABASE,
      collection: 'column_quick_filters',
      owner: { connectionId: 'phase3', tabId: 'column-membership-regex-tab' },
      filterEjson: buildColumnFilterExpression({ products: 'has "*com*"' }),
      sortEjson: '{ price: 1 }',
      pageSize: 10,
    });
    expect(productWildcard.documents.map((item) => (
      parseEjson<{ name: string }>(item).name
    ))).toEqual(['lower', 'upper']);

    const withoutProductWildcard = await findCollectionDocuments(client!, registry!, {
      database: DATABASE,
      collection: 'column_quick_filters',
      owner: { connectionId: 'phase3', tabId: 'column-not-membership-regex-tab' },
      filterEjson: buildColumnFilterExpression({ products: '!has *com*' }),
      sortEjson: '{ price: 1 }',
      pageSize: 10,
    });
    expect(withoutProductWildcard.documents.map((item) => (
      parseEjson<{ name: string }>(item).name
    ))).toEqual(['middle', 'outside']);

    const productOr = await findCollectionDocuments(client!, registry!, {
      database: DATABASE,
      collection: 'column_quick_filters',
      owner: { connectionId: 'phase3', tabId: 'column-membership-or-tab' },
      filterEjson: buildColumnFilterExpression({
        products: 'has *computer* OR has *camera*',
      }),
      sortEjson: '{ price: 1 }',
      pageSize: 10,
    });
    expect(productOr.documents.map((item) => (
      parseEjson<{ name: string }>(item).name
    ))).toEqual(['lower', 'middle']);

    const productAnd = await findCollectionDocuments(client!, registry!, {
      database: DATABASE,
      collection: 'column_quick_filters',
      owner: { connectionId: 'phase3', tabId: 'column-membership-and-tab' },
      filterEjson: buildColumnFilterExpression({
        products: 'has *com* AND !has *press*',
      }),
      sortEjson: '{ price: 1 }',
      pageSize: 10,
    });
    expect(productAnd.documents.map((item) => (
      parseEjson<{ name: string }>(item).name
    ))).toEqual(['lower']);
  });

  it('applies guarded array-length column filters without failing on non-arrays', async () => {
    const collection = client!.db(DATABASE).collection('column_array_lengths');
    await collection.insertMany([
      { name: 'empty', products: [] },
      { name: 'one', products: ['Computer'] },
      { name: 'three', products: ['Computer', 'Phone', 'Used'] },
      { name: 'missing' },
      { name: 'null', products: null },
      { name: 'string', products: 'Computer' },
      { name: 'object', products: { name: 'Computer' } },
    ]);

    const exactEmpty = await findCollectionDocuments(client!, registry!, {
      database: DATABASE,
      collection: 'column_array_lengths',
      owner: { connectionId: 'phase3', tabId: 'column-length-exact-tab' },
      filterEjson: buildColumnFilterExpression({ products: 'len = 0' }),
      pageSize: 20,
    });
    expect(exactEmpty.documents.map((item) => parseEjson<{ name: string }>(item).name))
      .toEqual(['empty']);

    const inclusiveRange = await findCollectionDocuments(client!, registry!, {
      database: DATABASE,
      collection: 'column_array_lengths',
      owner: { connectionId: 'phase3', tabId: 'column-length-range-tab' },
      filterEjson: buildColumnFilterExpression({ products: 'len 1..3' }),
      sortEjson: '{ name: 1 }',
      pageSize: 20,
    });
    expect(inclusiveRange.documents.map((item) => parseEjson<{ name: string }>(item).name))
      .toEqual(['one', 'three']);

    const notOne = await findCollectionDocuments(client!, registry!, {
      database: DATABASE,
      collection: 'column_array_lengths',
      owner: { connectionId: 'phase3', tabId: 'column-length-not-equal-tab' },
      filterEjson: buildColumnFilterExpression({ products: 'len <> 1' }),
      sortEjson: '{ name: 1 }',
      pageSize: 20,
    });
    expect(notOne.documents.map((item) => parseEjson<{ name: string }>(item).name))
      .toEqual(['empty', 'three']);

    const combined = await findCollectionDocuments(client!, registry!, {
      database: DATABASE,
      collection: 'column_array_lengths',
      owner: { connectionId: 'phase3', tabId: 'column-length-combined-tab' },
      filterEjson: buildColumnFilterExpression({ products: 'len >= 2 AND has *Com*' }),
      pageSize: 20,
    });
    expect(combined.documents.map((item) => parseEjson<{ name: string }>(item).name))
      .toEqual(['three']);

    const either = await findCollectionDocuments(client!, registry!, {
      database: DATABASE,
      collection: 'column_array_lengths',
      owner: { connectionId: 'phase3', tabId: 'column-length-or-tab' },
      filterEjson: buildColumnFilterExpression({ products: 'len = 0 OR has *Phone*' }),
      sortEjson: '{ name: 1 }',
      pageSize: 20,
    });
    expect(either.documents.map((item) => parseEjson<{ name: string }>(item).name))
      .toEqual(['empty', 'three']);
  });

  it('matches quoted empty strings without including null, missing, or whitespace values', async () => {
    const collection = client!.db(DATABASE).collection('column_empty_strings');
    await collection.insertMany([
      {
        name: 'empty',
        label: '',
        profile: { nickname: '' },
        aliases: [{ value: '' }],
        tags: [''],
      },
      {
        name: 'null',
        label: null,
        profile: { nickname: null },
        aliases: [{ value: null }],
        tags: [null],
      },
      { name: 'missing', profile: {}, aliases: [{}], tags: [] },
      {
        name: 'whitespace',
        label: '   ',
        profile: { nickname: '   ' },
        aliases: [{ value: '   ' }],
        tags: ['   '],
      },
    ]);

    const findNames = async (tabId: string, filterEjson: string): Promise<string[]> => {
      const page = await findCollectionDocuments(client!, registry!, {
        database: DATABASE,
        collection: 'column_empty_strings',
        owner: { connectionId: 'phase3', tabId },
        filterEjson,
        sortEjson: '{ name: 1 }',
        pageSize: 20,
      });
      return page.documents.map((item) => parseEjson<{ name: string }>(item).name);
    };

    expect(await findNames('empty-string-top-level-tab', buildColumnFilterExpression({
      label: '""',
    }))).toEqual(['empty']);
    expect(await findNames('empty-string-nested-tab', buildColumnFilterExpression({
      profile: '{nickname}: ""',
    }))).toEqual(['empty']);
    expect(await findNames('empty-string-array-object-tab', buildColumnFilterExpression({
      aliases: '[{value}]: ""',
    }))).toEqual(['empty']);
    expect(await findNames('empty-string-membership-tab', buildColumnFilterExpression({
      tags: 'has ""',
    }))).toEqual(['empty']);
  });

  it('applies nested object and same-element array selectors across mixed schemas', async () => {
    const collection = client!.db(DATABASE).collection('column_nested_filters');
    await collection.insertMany([
      {
        name: 'same-element',
        profile: { city: 'Istanbul' },
        products: [
          { name: 'Computer Pro', price: 150, tags: ['wifi', 'office'] },
          { name: 'Phone', price: 500 },
        ],
        orders: [
          { status: 'open', items: [{ sku: 'A-42', tags: ['wifi'] }, { sku: 'B-1' }] },
        ],
      },
      {
        name: 'split-elements',
        profile: { city: 'Ankara' },
        products: [
          { name: 'Computer Basic', price: 300 },
          { name: 'Accessory', price: 120 },
        ],
        orders: [
          { status: 'open', items: [{ sku: 'short' }] },
          { status: 'closed', items: [{ sku: 'A-42' }, { sku: 'B-2' }, { sku: 'C-3' }] },
        ],
      },
      {
        name: 'missing-leaf',
        profile: { city: 'Istanbul' },
        products: [{ name: 'Other', price: 50 }],
        orders: [{ status: 'open', items: [] }],
      },
      { name: 'null-shapes', profile: null, products: null, orders: null },
      { name: 'scalar-shapes', profile: 'Istanbul', products: 'Computer', orders: 2 },
      { name: 'missing-shapes' },
    ]);

    const findNames = async (tabId: string, filterEjson: string): Promise<string[]> => {
      const page = await findCollectionDocuments(client!, registry!, {
        database: DATABASE,
        collection: 'column_nested_filters',
        owner: { connectionId: 'phase3', tabId },
        filterEjson,
        sortEjson: '{ name: 1 }',
        pageSize: 20,
      });
      return page.documents.map((item) => parseEjson<{ name: string }>(item).name);
    };

    expect(await findNames('nested-object-tab', buildColumnFilterExpression({
      profile: '{city}: Istanbul',
    }))).toEqual(['missing-leaf', 'same-element']);

    expect(await findNames('nested-same-element-tab', buildColumnFilterExpression({
      products: '[{name}]: *Computer* AND [{price}]: < 200',
    }))).toEqual(['same-element']);

    expect(await findNames('nested-array-array-tab', buildColumnFilterExpression({
      orders: '[{items}][{sku}]: A-42',
    }))).toEqual(['same-element', 'split-elements']);

    expect(await findNames('nested-membership-tab', buildColumnFilterExpression({
      orders: '[{items}][{tags}]: has *wifi*',
    }))).toEqual(['same-element']);

    expect(await findNames('nested-not-membership-tab', buildColumnFilterExpression({
      products: '[{tags}]: !has *wifi*',
    }))).toEqual(['missing-leaf', 'same-element', 'split-elements']);

    expect(await findNames('nested-length-tab', buildColumnFilterExpression({
      orders: '[{items}]: len >= 2 AND [{status}]: open',
    }))).toEqual(['same-element']);

    expect(await findNames('nested-length-membership-tab', buildColumnFilterExpression({
      products: '[{tags}]: len >= 1 AND has *wifi*',
    }))).toEqual(['same-element']);
  });

  it('applies header-managed multi-column sort with a fresh first-page cursor', async () => {
    const collection = client!.db(DATABASE).collection('column_header_sort');
    await collection.insertMany([
      { label: 'b2', group: 'b', score: 2, hidden: true },
      { label: 'a2', group: 'a', score: 2, hidden: true },
      { label: 'b1', group: 'b', score: 1, hidden: true },
      { label: 'a1', group: 'a', score: 1, hidden: true },
    ]);

    const groupAscending = cycleColumnSort('', 'group');
    const scoreAscending = cycleColumnSort(groupAscending.source, 'score');
    const first = await findCollectionDocuments(client!, registry!, {
      database: DATABASE,
      collection: 'column_header_sort',
      owner: { connectionId: 'phase3', tabId: 'column-header-sort-tab' },
      filterEjson: '{ score: { $gte: 1 } }',
      sortEjson: scoreAscending.source,
      projectionEjson: '{ label: 1, group: 1, score: 1 }',
      pageSize: 10,
    });
    expect(first.pageIndex).toBe(0);
    expect(first.documents.map((item) => parseEjson<{ label: string }>(item).label))
      .toEqual(['a1', 'a2', 'b1', 'b2']);
    expect(first.documents.every((item) => !Object.hasOwn(
      parseEjson<Record<string, unknown>>(item),
      'hidden',
    ))).toBe(true);

    const groupDescending = cycleColumnSort(scoreAscending.source, 'group');
    const second = await findCollectionDocuments(client!, registry!, {
      database: DATABASE,
      collection: 'column_header_sort',
      owner: { connectionId: 'phase3', tabId: 'column-header-sort-tab' },
      filterEjson: '{ score: { $gte: 1 } }',
      sortEjson: groupDescending.source,
      projectionEjson: '{ label: 1, group: 1, score: 1 }',
      pageSize: 10,
    });
    expect(second.cursorId).not.toBe(first.cursorId);
    expect(second.pageIndex).toBe(0);
    expect(second.documents.map((item) => parseEjson<{ label: string }>(item).label))
      .toEqual(['b1', 'b2', 'a1', 'a2']);
  });

  it('applies Compass-style BSON filters and document mutations with type preservation', async () => {
    const id = '507f1f77bcf86cd799439011';
    await insertCollectionDocument(client!, {
      database: DATABASE,
      collection: 'compass_literals',
      documentEjson: `{
        _id: ObjectId("${id}"),
        createdAt: ISODate("2026-01-02T03:04:05.006Z"),
        sequence: Long("9223372036854775807"),
        amount: Decimal128("125.50"),
        name: "bike-alpha",
        matcher: BSONRegExp("^bike", "i"),
        clock: Timestamp({ t: 1700000000, i: 1 }),
      }`,
    });

    const stored = await client!.db(DATABASE).collection('compass_literals').findOne({
      _id: new ObjectId(id),
    });
    expect(stored?.createdAt).toBeInstanceOf(Date);
    expect((stored?.sequence as { _bsontype?: string })._bsontype).toBe('Long');
    expect((stored?.amount as { _bsontype?: string })._bsontype).toBe('Decimal128');
    expect(EJSON.stringify(stored?.matcher, undefined, 0, { relaxed: false })).toContain('$regularExpression');
    expect((stored?.clock as { _bsontype?: string })._bsontype).toBe('Timestamp');

    const page = await findCollectionDocuments(client!, registry!, {
      database: DATABASE,
      collection: 'compass_literals',
      owner: { connectionId: 'phase3', tabId: 'compass-literals-tab' },
      filterEjson: `{
        _id: ObjectId("${id}"),
        createdAt: { $gte: ISODate("2026-01-01T00:00:00.000Z") },
        sequence: Long("9223372036854775807"),
        amount: Decimal128("125.50"),
        name: /^bike/i,
        clock: Timestamp({ t: 1700000000, i: 1 }),
      }`,
      pageSize: 10,
    });
    expect(page.documents).toHaveLength(1);

    await replaceCollectionDocument(client!, {
      database: DATABASE,
      collection: 'compass_literals',
      originalDocumentEjson: serializeToEjson(stored).ejson,
      documentEjson: `{
        _id: ObjectId("${id}"),
        createdAt: ISODate("2026-01-03T00:00:00.000Z"),
        sequence: Long("42"),
        amount: Decimal128("250.75"),
        name: "bike-updated",
      }`,
    });
    const replaced = await client!.db(DATABASE).collection('compass_literals').findOne({
      _id: new ObjectId(id),
    });
    expect((replaced?.sequence as Long).toString()).toBe('42');
    expect((replaced?.amount as Decimal128).toString()).toBe('250.75');
  });

  it('counts the applied safe filter without consuming the browser cursor', async () => {
    const result = await countCollectionDocuments(client!, {
      database: DATABASE,
      collection: 'criteria',
      filterEjson: '{ bikeid: 17827, rank: { $gte: 2 } }',
    });
    expect(result).toEqual({ count: 1 });
  });

  it('renames and drops collections and drops a database through driver operations', async () => {
    const database = 'mongog_namespace_mutations';
    await client!.db(database).collection('before').insertOne({ value: 1 });
    await expect(renameCollection(client!, {
      database,
      collection: 'before',
      newName: 'after',
    })).resolves.toEqual({ oldName: 'before', newName: 'after' });
    await expect(client!.db(database).collection('after').countDocuments({})).resolves.toBe(1);
    await expect(dropCollection(client!, { database, collection: 'after' }))
      .resolves.toEqual({ dropped: true });
    await client!.db(database).collection('remaining').insertOne({ value: 2 });
    await expect(dropDatabase(client!, database)).resolves.toEqual({ dropped: true });
    const names = (await client!.db('admin').admin().listDatabases()).databases.map((item) => item.name);
    expect(names).not.toContain(database);
  });

  it('rejects executable criteria before they reach MongoDB', async () => {
    await expect(findCollectionDocuments(client!, registry!, {
      database: DATABASE,
      collection: 'criteria',
      owner: { connectionId: 'phase3', tabId: 'unsafe-criteria-tab' },
      filterEjson: '{ bikeid: getBikeId() }',
      pageSize: 10,
    })).rejects.toMatchObject({ category: 'Validation' });
  });

  it('replaces a BSON-rich document while preserving its immutable _id', async () => {
    const id = new ObjectId();
    const inserted = await insertCollectionDocument(client!, {
      database: DATABASE,
      collection: 'mutations',
      documentEjson: EJSON.stringify({ _id: id, value: 1 }, undefined, 0, { relaxed: false }),
    });
    expect(parseEjson<ObjectId>(inserted.insertedId!).equals(id)).toBe(true);

    const original = await client!.db(DATABASE).collection('mutations').findOne({ _id: id });
    const replacement = { ...original, value: 2, nested: { enabled: true } };
    const result = await replaceCollectionDocument(client!, {
      database: DATABASE,
      collection: 'mutations',
      originalDocumentEjson: serializeToEjson(original).ejson,
      documentEjson: serializeToEjson(replacement).ejson,
    });
    expect(result).toMatchObject({ acknowledged: true, matchedCount: 1, modifiedCount: 1 });
    await expect(client!.db(DATABASE).collection('mutations').findOne({ _id: id }))
      .resolves.toMatchObject({ value: 2, nested: { enabled: true } });
  });

  it('rejects stale replacements instead of overwriting a concurrent change', async () => {
    const collection = client!.db(DATABASE).collection('stale');
    const { insertedId } = await collection.insertOne({ value: 'original' });
    const original = await collection.findOne({ _id: insertedId });
    await collection.updateOne({ _id: insertedId }, { $set: { value: 'concurrent' } });

    await expect(replaceCollectionDocument(client!, {
      database: DATABASE,
      collection: 'stale',
      originalDocumentEjson: serializeToEjson(original).ejson,
      documentEjson: serializeToEjson({ ...original, value: 'mine' }).ejson,
    })).rejects.toMatchObject({ category: 'StaleDocument' });
    await expect(collection.findOne({ _id: insertedId })).resolves.toMatchObject({ value: 'concurrent' });
  });

  it('deletes the exact loaded version and reports a missing document', async () => {
    const collection = client!.db(DATABASE).collection('deletes');
    const { insertedId } = await collection.insertOne({ value: 'delete-me' });
    const original = await collection.findOne({ _id: insertedId });
    const originalEjson = serializeToEjson(original).ejson;

    await expect(deleteCollectionDocument(client!, {
      database: DATABASE,
      collection: 'deletes',
      originalDocumentEjson: originalEjson,
    })).resolves.toMatchObject({ acknowledged: true, deletedCount: 1 });

    await expect(deleteCollectionDocument(client!, {
      database: DATABASE,
      collection: 'deletes',
      originalDocumentEjson: originalEjson,
    })).rejects.toMatchObject({ category: 'NotFound' });
  });

  it('closes the previous cursor when the same tab refreshes', async () => {
    const collection = client!.db(DATABASE).collection('owner_cleanup');
    await collection.insertMany(Array.from({ length: 5 }, (_, value) => ({ value })));
    const owner = { connectionId: 'phase3', tabId: 'same-tab' };
    const first = await findCollectionDocuments(client!, registry!, {
      database: DATABASE,
      collection: 'owner_cleanup',
      owner,
      filterEjson: '{}',
      pageSize: 2,
    });
    await findCollectionDocuments(client!, registry!, {
      database: DATABASE,
      collection: 'owner_cleanup',
      owner,
      filterEjson: '{}',
      pageSize: 2,
    });
    await expect(registry!.fetchNext(first.cursorId, 2)).rejects.toMatchObject({
      category: 'CursorNotFound',
    });
  });
});
