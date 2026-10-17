import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { hardenFunctionConstructors } from '../../../src/query-runtime/engine/realm-hardening.js';

const outer = {
  fn() {},
  async asyncFn() {},
  *generator() {},
  async *asyncGenerator() {},
  error: new Error('outer'),
};

function runInScriptRealm(source: string): unknown {
  const context = vm.createContext({ outer }, { codeGeneration: { strings: false, wasm: false } });
  return vm.runInContext(source, context);
}

describe('realm hardening', () => {
  it.each([
    'outer.constructor.constructor("return process")',
    'outer.fn.constructor("return process")',
    'outer.asyncFn.constructor("return process")',
    'outer.generator.constructor("yield process")',
    'outer.asyncGenerator.constructor("yield process")',
    'outer.error.constructor.constructor("return process")',
    'new outer.fn.constructor("return process")',
    'outer.fn.constructor.bind(null, "return process")()',
    'Reflect.construct(outer.fn.constructor, ["return process"])',
  ])('refuses outer-realm code generation: %s', (source) => {
    hardenFunctionConstructors();
    expect(() => runInScriptRealm(source)).toThrow(/Code generation from strings disallowed/);
  });

  it('keeps the global Function and constructor metadata usable', () => {
    hardenFunctionConstructors();
    // eslint-disable-next-line no-new-func -- bundled deps (bluebird) rely on it
    expect(new Function('return 1')()).toBe(1);
    expect(outer.asyncFn.constructor.name).toBe('AsyncFunction');
    expect(outer.fn instanceof outer.fn.constructor).toBe(true);
  });
});
