import { Decimal128, Int32, ObjectId } from 'bson';
import { MongoClient } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  countCollectionDocuments,
  deleteCollectionDocument,
  dropCollection,
  dropDatabase,
  findCollectionDocuments,
  insertCollectionDocument,
  renameCollection,
  replaceCollectionDocument,
} from '../../../src/query-runtime/collection/operations.js';
import { CursorRegistry } from '../../../src/query-runtime/registry/cursors.js';
import { buildColumnFilterExpression } from '../../../src/renderer/collection-column-filter.js';
import { cycleColumnSort } from '../../../src/renderer/collection-column-sort.js';
import { parseEjson } from '../../../src/shared/ejson/index.js';
import { isAppError } from '../../../src/shared/errors/index.js';
import { useMongoIntegrationSuite } from '../fixtures/mongo.js';

const suite = useMongoIntegrationSuite('collection column filters');
const DATABASE = suite.databaseName;

describe('collection browser operations', () => {
  let client: MongoClient;
  let registry: CursorRegistry;

  beforeAll(async () => {
    client = await suite.newClient(suite.standaloneUri);
    registry = new CursorRegistry();
  }, 120_000);

  afterAll(async () => {
    await registry.dispose();
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
});
