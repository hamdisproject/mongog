import { describe, expect, it } from 'vitest';
import { SqlTranslateError, translateSql } from '../../../src/features/sql-translator/index.js';

describe('sql-translator SELECT -> find', () => {
  it('translates SELECT * without WHERE to an empty find', () => {
    const result = translateSql('SELECT * FROM people');
    expect(result.kind).toBe('select');
    expect(result.execution).toBe('find');
    expect(result.collection).toBe('people');
    expect(result.isWrite).toBe(false);
    expect(result.filter).toEqual({});
    expect(result.projection).toBeUndefined();
    expect(result.fullCollectionTarget).toBe(true);
    expect(result.jsSource).toContain('db.collection("people").find({})');
  });

  it('materialises missing projected fields as SQL NULL', () => {
    const result = translateSql('SELECT user_id, status FROM people');
    expect(result.execution).toBe('aggregate');
    expect(result.pipeline).toContainEqual({
      $project: {
        _id: 0,
        user_id: { $ifNull: ['$user_id', null] },
        status: { $ifNull: ['$status', null] },
      },
    });
  });

  it('keeps _id when explicitly selected', () => {
    const result = translateSql('SELECT _id, user_id FROM people');
    expect(result.pipeline).toContainEqual({
      $project: {
        _id: { $ifNull: ['$_id', null] },
        user_id: { $ifNull: ['$user_id', null] },
      },
    });
  });

  it('translates WHERE/ORDER BY/LIMIT/OFFSET', () => {
    const result = translateSql(
      `SELECT * FROM people WHERE status = 'A' AND age > 25 ORDER BY user_id DESC LIMIT 5 OFFSET 10`,
    );
    expect(result.filter).toEqual({ status: 'A', age: { $exists: true, $ne: null, $gt: 25 } });
    expect(result.sort).toEqual({ user_id: -1 });
    expect(result.limit).toBe(5);
    expect(result.skip).toBe(10);
    expect(result.jsSource).toContain('.sort(');
    expect(result.jsSource).toContain('.skip(10)');
    expect(result.jsSource).toContain('.limit(5)');
  });

  it('merges range predicates on the same field', () => {
    const result = translateSql('SELECT * FROM people WHERE age > 25 AND age <= 50');
    expect(result.filter).toEqual({ age: { $exists: true, $ne: null, $gt: 25, $lte: 50 } });
  });

  it('translates OR, IN, LIKE, BETWEEN and IS NULL', () => {
    const orResult = translateSql(`SELECT * FROM people WHERE status = 'A' OR age = 50`);
    expect(orResult.filter).toEqual({ $or: [{ status: 'A' }, { age: 50 }] });

    const inResult = translateSql(`SELECT * FROM t WHERE status IN ('A', 'B')`);
    expect(inResult.filter).toEqual({ status: { $in: ['A', 'B'] } });

    const likeResult = translateSql(`SELECT * FROM t WHERE user_id LIKE '%bc%'`);
    expect(likeResult.filter).toEqual({ user_id: { $regex: '^.*bc.*$' } });

    const betweenResult = translateSql('SELECT * FROM t WHERE age BETWEEN 20 AND 50');
    expect(betweenResult.filter).toEqual({ age: { $exists: true, $ne: null, $gte: 20, $lte: 50 } });

    const nullResult = translateSql('SELECT * FROM t WHERE deletedAt IS NULL');
    expect(nullResult.filter).toEqual({ deletedAt: null });

    const notNullResult = translateSql('SELECT * FROM t WHERE deletedAt IS NOT NULL');
    expect(notNullResult.filter).toEqual({ deletedAt: { $exists: true, $ne: null } });
  });

  it('translates <> and NOT', () => {
    const result = translateSql(`SELECT * FROM t WHERE status <> 'A'`);
    expect(result.filter).toEqual({
      $and: [
        { status: { $exists: true, $ne: null } },
        { status: { $ne: 'A' } },
      ],
    });
    const notResult = translateSql(`SELECT * FROM t WHERE NOT (status = 'A')`);
    expect(notResult.filter).toEqual(result.filter);
  });
});

describe('sql-translator SELECT -> aggregate', () => {
  it('translates GROUP BY with aggregates and HAVING', () => {
    const result = translateSql(
      'SELECT status, COUNT(*) AS cnt, AVG(total) AS avgTotal FROM orders GROUP BY status HAVING COUNT(*) > 2 ORDER BY cnt DESC',
    );
    expect(result.execution).toBe('aggregate');
    expect(result.pipeline).toBeDefined();
    const stages = result.pipeline!.map((stage) => Object.keys(stage)[0]);
    expect(stages).toEqual(['$group', '$project', '$match', '$sort']);
    const group = result.pipeline![0]!.$group as Record<string, unknown>;
    expect(group._id).toBe('$status');
    expect(group.cnt).toEqual({ $sum: 1 });
    expect(group.avgTotal).toEqual({ $avg: '$total' });
    expect(result.pipeline![2]).toEqual({ $match: { cnt: { $exists: true, $ne: null, $gt: 2 } } });
  });

  it('translates DISTINCT to a $group pipeline', () => {
    const result = translateSql('SELECT DISTINCT status FROM people');
    expect(result.execution).toBe('aggregate');
    expect(result.pipeline![0]).toEqual({ $group: { _id: { status: '$status' } } });
  });

  it('translates INNER JOIN to $lookup + $unwind', () => {
    const result = translateSql(
      'SELECT o.total, u.name FROM orders o INNER JOIN users u ON o.userId = u._id WHERE o.total > 100',
    );
    expect(result.execution).toBe('aggregate');
    expect(result.pipeline![0]).toEqual({
      $lookup: { from: 'users', localField: 'userId', foreignField: '_id', as: 'u' },
    });
    expect(result.pipeline![1]).toEqual({ $unwind: '$u' });
    expect(result.pipeline).toContainEqual({ $match: { total: { $exists: true, $ne: null, $gt: 100 } } });
    expect(result.jsSource).toContain('.aggregate(');
  });

  it('translates LEFT JOIN with preserveNullAndEmptyArrays', () => {
    const result = translateSql('SELECT o.userId, u.name FROM orders o LEFT JOIN users u ON o.userId = u._id');
    expect(result.pipeline![1]).toEqual({
      $unwind: { path: '$u', preserveNullAndEmptyArrays: true },
    });
  });

  it('translates COUNT(*) without GROUP BY to a $group pipeline', () => {
    const result = translateSql(`SELECT COUNT(*) AS n FROM people WHERE status = 'A'`);
    expect(result.execution).toBe('aggregate');
    expect(result.pipeline).toContainEqual({ $match: { status: 'A' } });
    expect(result.pipeline).toContainEqual({ $group: { _id: null, n: { $sum: 1 } } });
  });

  it('honours column aliases via $project', () => {
    const result = translateSql('SELECT user_id AS id FROM people');
    expect(result.execution).toBe('aggregate');
    expect(result.pipeline).toContainEqual({
      $project: { _id: 0, id: { $ifNull: ['$user_id', null] } },
    });
  });

  it('maps db-qualified tables to a database override', () => {
    const result = translateSql('SELECT * FROM shop.orders');
    expect(result.collection).toBe('orders');
    expect(result.database).toBe('shop');
    expect(result.jsSource).toContain('getSiblingDB("shop")');
  });
});

describe('sql-translator writes', () => {
  it('translates single-row INSERT to insertOne', () => {
    const result = translateSql(`INSERT INTO people (user_id, age) VALUES ('abc', 55)`);
    expect(result.execution).toBe('insertOne');
    expect(result.isWrite).toBe(true);
    expect(result.documents).toEqual([{ user_id: 'abc', age: 55 }]);
    expect(result.jsSource).toContain('.insertOne(');
  });

  it('translates multi-row INSERT to insertMany', () => {
    const result = translateSql(`INSERT INTO people (user_id) VALUES ('a'), ('b')`);
    expect(result.execution).toBe('insertMany');
    expect(result.documents).toEqual([{ user_id: 'a' }, { user_id: 'b' }]);
  });

  it('translates UPDATE to updateMany with $set', () => {
    const result = translateSql(`UPDATE people SET age = 56 WHERE user_id = 'abc'`);
    expect(result.execution).toBe('updateMany');
    expect(result.filter).toEqual({ user_id: 'abc' });
    expect(result.update).toEqual({ age: 56 });
    expect(result.jsSource).toContain('.updateMany(');
    expect(result.jsSource).toContain('$set');
  });

  it('translates DELETE to deleteMany and warns without WHERE', () => {
    const result = translateSql('DELETE FROM people');
    expect(result.execution).toBe('deleteMany');
    expect(result.fullCollectionTarget).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
    const scoped = translateSql(`DELETE FROM people WHERE status = 'A'`);
    expect(scoped.filter).toEqual({ status: 'A' });
    expect(scoped.fullCollectionTarget).toBe(false);
  });
});

describe('sql-translator errors', () => {
  it('rejects multiple statements', () => {
    expect(() => translateSql('SELECT * FROM a; SELECT * FROM b')).toThrow(SqlTranslateError);
  });

  it('rejects empty input', () => {
    expect(() => translateSql('  ')).toThrow(SqlTranslateError);
  });

  it('rejects unsupported statements with a hint', () => {
    try {
      translateSql('DROP TABLE people');
      expect.unreachable();
    } catch (caught) {
      expect(caught).toBeInstanceOf(SqlTranslateError);
      expect((caught as SqlTranslateError).hint.length).toBeGreaterThan(0);
    }
  });

  it('rejects subqueries with a JOIN hint', () => {
    try {
      translateSql('SELECT * FROM t WHERE x IN (SELECT y FROM u)');
      expect.unreachable();
    } catch (caught) {
      expect(caught).toBeInstanceOf(SqlTranslateError);
      expect((caught as SqlTranslateError).hint).toMatch(/JOIN/);
    }
  });

  it('rejects mixing plain columns with aggregates without GROUP BY', () => {
    expect(() => translateSql('SELECT status, COUNT(*) FROM orders')).toThrow(/GROUP BY/);
  });

  it('rejects JOIN without ON', () => {
    expect(() => translateSql('SELECT * FROM a INNER JOIN b')).toThrow(SqlTranslateError);
  });

  it.each([
    'UPDATE t SET x = 1 LIMIT 1',
    'DELETE FROM t LIMIT 1',
    'DELETE FROM t ORDER BY x',
    'INSERT IGNORE INTO t (x) VALUES (1)',
    'INSERT INTO t (x) VALUES (1) ON DUPLICATE KEY UPDATE x = 2',
    'INSERT INTO t (x) SELECT x FROM u',
    'WITH rows AS (SELECT * FROM t) SELECT * FROM rows',
    'SELECT x FROM t UNION SELECT x FROM u',
    'SELECT x INTO backup FROM t',
    'SELECT * FROM t RIGHT JOIN u ON t.id = u.id',
    'SELECT t.* FROM t',
    'SELECT CASE WHEN x = 1 THEN 2 ELSE 3 END AS y FROM t',
    'SELECT COUNT(DISTINCT x) FROM t',
  ])('rejects unsupported SQL without approximating it: %s', (sql) => {
    expect(() => translateSql(sql)).toThrow(SqlTranslateError);
  });

  it('rejects LIMIT 0 instead of creating an unlimited MongoDB cursor', () => {
    expect(() => translateSql('SELECT * FROM t LIMIT 0')).toThrow(/LIMIT 0/);
  });

  it('rejects unsafe or over-precise numeric literals before parser rounding', () => {
    expect(() => translateSql('INSERT INTO t (x) VALUES (-9007199254740993)')).toThrow(/safe integer/);
    expect(() => translateSql('INSERT INTO t (x) VALUES (1000000000000000)')).toThrow(/15 significant/);
    expect(() => translateSql('INSERT INTO t (x) VALUES (0.1234567890123456)')).toThrow(/15 significant/);
    expect(translateSql('INSERT INTO t (x) VALUES (999999999999999)').documents?.[0]?.x).toBe(999999999999999);
    expect(translateSql('INSERT INTO t (x) VALUES (0.123456789012345)').documents?.[0]?.x).toBe(0.123456789012345);
  });

  it('rejects comparisons and lists that use NULL ambiguously', () => {
    expect(() => translateSql('DELETE FROM t WHERE x = NULL')).toThrow(/IS NULL/);
    expect(() => translateSql('UPDATE t SET y = 1 WHERE x <> NULL')).toThrow(/IS NULL/);
    expect(() => translateSql('DELETE FROM t WHERE x NOT IN (1, NULL)')).toThrow(/NULL inside/);
  });

  it('does not overwrite repeated operators in AND filters', () => {
    const result = translateSql('DELETE FROM t WHERE age > 50 AND age > 25');
    expect(result.filter).toHaveProperty('$and');
    expect(JSON.stringify(result.filter)).toContain('50');
    expect(JSON.stringify(result.filter)).toContain('25');
  });

  it('preserves prototype-named INSERT and UPDATE fields as own properties', () => {
    const inserted = translateSql('INSERT INTO t (`__proto__`) VALUES (1)');
    expect(Object.hasOwn(inserted.documents![0]!, '__proto__')).toBe(true);
    expect(inserted.documents![0]!.__proto__).toBe(1);
    expect(inserted.jsSource).toContain('JSON.parse');
    const updated = translateSql('UPDATE t SET `__proto__` = 2 WHERE x = 1');
    expect(Object.hasOwn(updated.update!, '__proto__')).toBe(true);
    expect(updated.update!.__proto__).toBe(2);
    expect(updated.jsSource).toContain('JSON.parse');
  });

  it('rejects duplicate INSERT/UPDATE fields', () => {
    expect(() => translateSql('INSERT INTO t (x, x) VALUES (1, 2)')).toThrow(/Duplicate INSERT/);
    expect(() => translateSql('UPDATE t SET x = 1, x = 2 WHERE y = 3')).toThrow(/Duplicate UPDATE/);
  });

  it('qualifies joined aggregate/scalar paths and supports expression helpers', () => {
    const joined = translateSql(
      'SELECT o.status, SUM(s.amount) AS total FROM orders o INNER JOIN shipments s ON o.id = s.orderId GROUP BY o.status',
    );
    expect(joined.pipeline?.find((stage) => '$group' in stage)?.$group).toMatchObject({ total: { $sum: '$s.amount' } });
    expect(translateSql("SELECT CONCAT(first, ' ', last) AS fullName FROM people").pipeline)
      .toContainEqual({
        $project: { _id: 0, fullName: { $concat: ['$first', { $literal: ' ' }, '$last'] } },
      });
    expect(() => translateSql('SELECT IFNULL(first, last, name) AS value FROM people'))
      .toThrow(/exactly two/);
  });

  it('projects group keys before applying HAVING', () => {
    const result = translateSql("SELECT status, COUNT(*) AS count FROM t GROUP BY status HAVING status = 'A'");
    expect(result.pipeline?.map((stage) => Object.keys(stage)[0])).toEqual(['$group', '$project', '$match']);
    expect(result.pipeline?.[2]).toEqual({ $match: { status: 'A' } });
  });

  it('rejects cross-database JOINs and computed grouped projections', () => {
    expect(() => translateSql('SELECT o.x, u.y FROM orders o JOIN shop.users u ON o.id = u.id')).toThrow(/different databases/);
    expect(() => translateSql('SELECT status, UPPER(status) AS upperStatus, COUNT(*) FROM t GROUP BY status'))
      .toThrow(/Computed\/scalar/);
  });
});
