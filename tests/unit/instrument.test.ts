import { describe, expect, it } from 'vitest';
import vm from 'node:vm';
import { createAutoAwaitRuntime } from '../../src/query-runtime/engine/auto-await.js';
import {
  buildInstrumentedSource,
  parseScript,
} from '../../src/features/script-analysis/index.js';

describe('buildInstrumentedSource', () => {
  it('wraps top-level expressions in capture thunks and marks the rest', () => {
    const src = 'const a = 1;\ndb.x.find();\nif (a) { print(1); }\nawait db.x.countDocuments({});';
    const p = parseScript(src);
    const { code, capturedStatementIndexes } = buildInstrumentedSource(src, p);
    expect(capturedStatementIndexes).toEqual([1, 3]);
    expect(code).toContain('__mongogCapture(1, async () => (');
    expect(code).toContain('__mongogCapture(3, async () => (');
    expect(code).toContain('__mongogMark(0);');
    expect(code).toContain('__mongogMark(2);');
  });

  it('preserves execution semantics: order, variables, side effects', async () => {
    const src = `const xs = [];
1 + 2;
for (let i = 0; i < 3; i++) { xs.push(i); }
xs.length;
"semi;colon";
`;
    const p = parseScript(src);
    const { code, runtimeIdentifier } = buildInstrumentedSource(src, p);

    const captured: Array<{ index: number; value: unknown }> = [];
    const marks: number[] = [];
    const sandbox = {
      __mongogCapture: async (index: number, thunk: () => Promise<unknown>) => {
        captured.push({ index, value: await thunk() });
      },
      __mongogMark: (index: number) => marks.push(index),
    };
    Object.assign(sandbox, { [runtimeIdentifier]: createAutoAwaitRuntime({ checkpoint: () => {}, track: () => {}, checkCatch: () => {} }) });
    vm.createContext(sandbox);
    await vm.runInContext(code, sandbox);

    expect(captured).toEqual([
      { index: 1, value: 3 },
      { index: 3, value: 3 },
      { index: 4, value: 'semi;colon' },
    ]);
    expect(marks).toEqual([0, 2]);
  });

  it('keeps shared variable scope across statements', async () => {
    const src = 'const x = 21;\nx * 2;';
    const p = parseScript(src);
    const { code, runtimeIdentifier } = buildInstrumentedSource(src, p);
    const captured: unknown[] = [];
    const sandbox = {
      __mongogCapture: async (_i: number, thunk: () => Promise<unknown>) => {
        captured.push(await thunk());
      },
      __mongogMark: () => undefined,
    };
    Object.assign(sandbox, { [runtimeIdentifier]: createAutoAwaitRuntime({ checkpoint: () => {}, track: () => {}, checkCatch: () => {} }) });
    vm.createContext(sandbox);
    await vm.runInContext(code, sandbox);
    expect(captured).toEqual([42]);
  });

  it('supports top-level await inside capture thunks', async () => {
    const src = 'const later = async () => 7;\nawait later();';
    const p = parseScript(src);
    const { code, runtimeIdentifier } = buildInstrumentedSource(src, p);
    const captured: unknown[] = [];
    const sandbox = {
      __mongogCapture: async (_i: number, thunk: () => Promise<unknown>) => {
        captured.push(await thunk());
      },
      __mongogMark: () => undefined,
    };
    Object.assign(sandbox, { [runtimeIdentifier]: createAutoAwaitRuntime({ checkpoint: () => {}, track: () => {}, checkCatch: () => {} }) });
    vm.createContext(sandbox);
    await vm.runInContext(code, sandbox);
    expect(captured).toEqual([7]);
  });
});
