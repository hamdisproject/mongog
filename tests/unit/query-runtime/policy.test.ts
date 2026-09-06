import { describe, expect, it } from 'vitest';
import { parseScript } from '../../../src/features/script-analysis/index.js';
import {
  scanQueryModeViolations,
  scanWriteOperations,
} from '../../../src/query-runtime/engine/policy.js';

const qm = (src: string) => scanQueryModeViolations(parseScript(src).sourceFile);
const ro = (src: string) => scanWriteOperations(parseScript(src).sourceFile);

describe('Query Mode policy', () => {
  it('allows normal driver usage', () => {
    expect(qm('const c = db.collection("x"); await c.find({}).toArray();')).toHaveLength(0);
  });

  it('blocks import declarations', () => {
    expect(qm('import { x } from "fs";').length).toBeGreaterThan(0);
  });

  it('blocks require()', () => {
    expect(qm('const fs = require("fs");').length).toBeGreaterThan(0);
  });

  it('blocks process access', () => {
    expect(qm('print(process.env.HOME);').length).toBeGreaterThan(0);
  });

  it('blocks dynamic import()', () => {
    expect(qm('const m = await import("fs");').length).toBeGreaterThan(0);
  });

  it('reports ranges for violations', () => {
    const v = qm('const a = 1;\nprint(process.pid);')[0]!;
    expect(v.range.startLine).toBe(2);
  });
});

describe('read-only write detection (best-effort)', () => {
  it('allows reads', () => {
    expect(ro('db.collection("x").find({}); db.collection("x").countDocuments({});')).toHaveLength(0);
  });

  it('flags insert/update/delete methods', () => {
    expect(ro('db.collection("x").insertOne({});')).toHaveLength(1);
    expect(ro('db.collection("x").updateMany({}, {});')).toHaveLength(1);
    expect(ro('db.collection("x").deleteOne({});')).toHaveLength(1);
    expect(ro('db.collection("x").findOneAndUpdate({}, {});')).toHaveLength(1);
  });

  it('flags bulk writes and index operations', () => {
    expect(ro('db.collection("x").bulkWrite([]);')).toHaveLength(1);
    expect(ro('db.collection("x").createIndex({ a: 1 });')).toHaveLength(1);
    expect(ro('db.collection("x").dropIndex("a_1");')).toHaveLength(1);
  });

  it('flags $out and $merge aggregation stages', () => {
    expect(ro('db.collection("x").aggregate([{ $match: {} }, { $out: "y" }]);')).toHaveLength(1);
    expect(ro('db.collection("x").aggregate([{ $merge: { into: "y" } }]);')).toHaveLength(1);
  });

  it('flags write commands via db.command', () => {
    expect(ro('db.command({ insert: "x", documents: [] });')).toHaveLength(1);
    expect(ro('db.command({ dropIndexes: "x", index: "*" });')).toHaveLength(1);
  });

  it('allows read commands via db.command', () => {
    expect(ro('db.command({ ping: 1 });')).toHaveLength(0);
    expect(ro('db.command({ collStats: "x" });')).toHaveLength(0);
  });
});
