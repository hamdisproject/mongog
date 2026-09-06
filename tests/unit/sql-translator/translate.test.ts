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

  it('translates an explicit column list to a projection without _id', () => {
    const result = translateSql('SELECT user_id, status FROM people');
    expect(result.execution).toBe('find');
    expect(result.projection).toEqual({ user_id: 1, status: 1, _id: 0 });
  });

  it('keeps _id when explicitly selected', () => {
    const result = translateSql('SELECT _id, user_id FROM people');
    expect(result.projection).toEqual({ _id: 1, user_id: 1 });
  });

  it('translates WHERE/ORDER BY/LIMIT/OFFSET', () => {
    const result = translateSql(
      `SELECT * FROM people WHERE status = 'A' AND age > 25 ORDER BY user_id DESC LIMIT 5 OFFSET 10`,
    );
    expect(result.filter).toEqual({ status: 'A', age: { $gt: 25 } });
    expect(result.sort).toEqual({ user_id: -1 });
    expect(result.limit).toBe(5);
    expect(result.skip).toBe(10);
    expect(result.jsSource).toContain('.sort(');
    expect(result.jsSource).toContain('.skip(10)');
    expect(result.jsSource).toContain('.limit(5)');
  });

  it('merges range predicates on the same field', () => {
    const result = translateSql('SELECT * FROM people WHERE age > 25 AND age <= 50');
    expect(result.filter).toEqual({ age: { $gt: 25, $lte: 50 } });
  });

  it('translates OR, IN, LIKE, BETWEEN and IS NULL', () => {
    const orResult = translateSql(`SELECT * FROM people WHERE status = 'A' OR age = 50`);
    expect(orResult.filter).toEqual({ $or: [{ status: 'A' }, { age: 50 }] });

    const inResult = translateSql(`SELECT * FROM t WHERE status IN ('A', 'B')`);
    expect(inResult.filter).toEqual({ status: { $in: ['A', 'B'] } });

    const likeResult = translateSql(`SELECT * FROM t WHERE user_id LIKE '%bc%'`);
    expect(likeResult.filter).toEqual({ user_id: { $regex: '^.*bc.*$' } });

    const betweenResult = translateSql('SELECT * FROM t WHERE age BETWEEN 20 AND 50');
    expect(betweenResult.filter).toEqual({ age: { $gte: 20, $lte: 50 } });

    const nullResult = translateSql('SELECT * FROM t WHERE deletedAt IS NULL');
    expect(nullResult.filter).toEqual({ deletedAt: null });

    const notNullResult = translateSql('SELECT * FROM t WHERE deletedAt IS NOT NULL');
    expect(notNullResult.filter).toEqual({ deletedAt: { $exists: true, $ne: null } });
  });

  it('translates <> and NOT', () => {
    const result = translateSql(`SELECT * FROM t WHERE status <> 'A'`);
    expect(result.filter).toEqual({ status: { $ne: 'A' } });
    const notResult = translateSql(`SELECT * FROM t WHERE NOT (status = 'A')`);
    expect(notResult.filter).toEqual({ $nor: [{ status: 'A' }] });
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
    expect(stages).toEqual(['$group', '$match', '$project', '$sort']);
    const group = result.pipeline![0]!.$group as Record<string, unknown>;
    expect(group._id).toBe('$status');
    expect(group.cnt).toEqual({ $sum: 1 });
    expect(group.avgTotal).toEqual({ $avg: '$total' });
    expect(result.pipeline![1]).toEqual({ $match: { cnt: { $gt: 2 } } });
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
    expect(result.pipeline).toContainEqual({ $match: { total: { $gt: 100 } } });
    expect(result.jsSource).toContain('.aggregate(');
  });

  it('translates LEFT JOIN with preserveNullAndEmptyArrays', () => {
    const result = translateSql('SELECT * FROM orders o LEFT JOIN users u ON o.userId = u._id');
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
    expect(result.pipeline).toContainEqual({ $project: { id: '$user_id' } });
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
});
