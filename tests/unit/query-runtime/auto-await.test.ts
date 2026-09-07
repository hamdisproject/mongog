import { describe, expect, it } from 'vitest';
import vm from 'node:vm';
import { buildInstrumentedSource, parseScript } from '../../../src/features/script-analysis/index.js';
import { createAutoAwaitRuntime } from '../../../src/query-runtime/engine/auto-await.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function execute(source: string, globals: Record<string, unknown> = {}) {
  const program = buildInstrumentedSource(source, parseScript(source));
  const values: unknown[] = [];
  const pending: Promise<unknown>[] = [];
  const runtime = createAutoAwaitRuntime({ checkpoint() {}, track(p) { pending.push(p.catch(() => undefined)); }, checkCatch() {} });
  const context = vm.createContext({ ...globals, [program.runtimeIdentifier]: runtime,
    __mongogCapture: async (_i: number, thunk: () => unknown) => { values.push(await thunk()); }, __mongogMark() {},
  });
  runtime.install(vm.runInContext('Array', context), vm.runInContext('Promise', context));
  const completion = Promise.resolve(vm.runInContext(program.code, context));
  return { completion, values, pending, code: program.code };
}
async function result(source: string, globals: Record<string, unknown> = {}) {
  const run = execute(source, { later: (value: unknown) => Promise.resolve(value), ...globals });
  await run.completion;
  return run.values.at(-1);
}

describe('automatic await', () => {
  it('resolves assignments, destructuring, arguments, operators and conditions', async () => {
    expect(await result(`
      let { name, missing = later(3) } = later({name:'Ada'});
      let value; value = later(2);
      const output = [];
      if (later(1) > 0 && later(true)) output.push(name, missing, value + later(4));
      output;
    `)).toEqual(['Ada', 3, 6]);
  });

  it('keeps synchronous functions synchronous and only suspends the required path', async () => {
    const observed: unknown[] = [];
    expect(await result(`
      function choose(asyncPath) { return asyncPath ? later(3) : 2; }
      inspect(choose);
      [choose(false), choose(true)];
    `, { inspect: (fn: (arg: boolean) => unknown) => { observed.push(fn(false), fn(true)); return Promise.all(observed); } })).toEqual([2, 3]);
    expect(observed[0]).toBe(2);
    expect(typeof (observed[1] as Promise<unknown>).then).toBe('function');
    await observed[1];
  });

  it('preserves strict directives and synchronous throws', async () => {
    expect(await result(`function strict() { "use strict"; return this === undefined; } strict();`)).toBe(true);
    await expect(result('"use strict"; missingGlobal=1;')).rejects.toThrow(/missingGlobal/);
  });

  it('preserves this, arguments, closure scope, default arguments and super', async () => {
    expect(await result(`
      const offset = 4;
      class Base { value(n) { return n + 1; } }
      class Child extends Base { value(n = Math.max(1, 2)) { return super.value(later(n)) + offset; } }
      const object = { value: 3, get() { return later(this.value + arguments[0]); } };
      [object.get(2), new Child().value(), (() => later(offset))()];
    `)).toEqual([5, 7, 4]);
  });

  it('preserves short circuiting, optional chains, method receiver and evaluation order', async () => {
    expect(await result(`
      const log = [];
      const object = { value: 4, get method() { log.push('get'); return function(n) { return later(this.value + n); }; } };
      function argument() { log.push('arg'); return later(2); }
      const absent = null;
      const a = absent?.method(argument());
      const b = false && argument();
      const c = true || argument();
      const d = 0 ?? argument();
      const e = object?.method?.(argument());
      [a, b, c, d, e, log];
    `)).toEqual([undefined, false, true, 0, 6, ['get', 'arg']]);
  });

  it('awaits finally before returning and supports catches and overriding returns', async () => {
    expect(await result(`
      const log = [];
      function work() { try { return later(1); } finally { log.push(later('finally')); } }
      function override() { try { return 1; } finally { return later(2); } }
      function recover() { try { laterFail(); } catch (error) { return error.message; } finally { log.push(later('caught')); } }
      [work(), override(), recover(), log];
    `, { laterFail: () => Promise.reject(new Error('failed')) })).toEqual([1, 2, 'failed', ['finally', 'caught']]);
  });

  it('adapts all supported array callbacks in order, preserving holes and short circuits', async () => {
    expect(await result(`
      const a = [1,2,3]; const log = [];
      const mapped = a.map(x => { log.push(x); return later(x * 2); });
      a.forEach(x => { log.push(later(x + 3)); });
      [mapped, a.filter(x => later(x > 1)), a.reduce((n,x) => later(n+x), 0),
       a.find(x => later(x > 1)), a.some(x => later(x > 2)), a.every(x => later(x > 0)),
       a.flatMap(x => later([x,x])), log, [,,3].map(x => later(x)).length];
    `)).toEqual([[2,4,6], [2,3], 6, 2, true, true, [1,1,2,2,3,3], [1,2,3,4,5,6], 3]);
    expect([1,2].map(async n => n)[0]).toBeInstanceOf(Promise); // host prototypes untouched
  });

  it('does not start the next array callback before the previous one settles', async () => {
    const first=deferred<number>(); const started:number[]=[];
    const run=execute('[1,2].map(n=>job(n));',{job:(n:number)=> {started.push(n); return n===1?first.promise:2;}});
    expect(started).toEqual([1]); first.resolve(1); await run.completion;
    expect(started).toEqual([1,2]); expect(run.values.at(-1)).toEqual([1,2]);
  });

  it('resolves nested binding defaults and computed method names', async () => {
    expect(await result(`const {value:{n=later(3)}}={value:{}}; const object={ [later('read')]() {return later(n);} }; object.read();`)).toBe(3);
  });

  it('awaits async iterators, closes on break and preserves labelled continue', async () => {
    const log: string[] = [];
    const iterable = { async *[Symbol.asyncIterator]() { try { yield 1; yield 2; yield 3; } finally { log.push('closed'); } } };
    expect(await result(`const output=[]; outer: for(const n of stream) { if(n===1) continue outer; output.push(later(n)); break; } output;`, { stream: iterable })).toEqual([2]);
    expect(log).toEqual(['closed']);
  });

  it('ordinary assignments start sequentially', async () => {
    const first = deferred<number>(); const started: number[] = [];
    const run = execute('const a=job(1); const b=job(2); [a,b];', { job: (n: number) => { started.push(n); return n === 1 ? first.promise : Promise.resolve(2); } });
    expect(started).toEqual([1]);
    first.resolve(1); await run.completion;
    expect(started).toEqual([1,2]); expect(run.values.at(-1)).toEqual([1,2]);
  });

  it.each(['all', 'allSettled', 'race', 'any'])('Promise.%s starts independent inputs in parallel', async method => {
    const first = deferred<number>(); const second = deferred<number>(); const started: number[] = [];
    const run = execute(`Promise.${method}([job(1), job(2)]);`, { job: (n: number) => { started.push(n); return n===1 ? first.promise : second.promise; } });
    expect(started).toEqual([1,2]);
    first.resolve(1); second.resolve(2); await run.completion;
    expect(run.values[0]).toEqual(method==='all' ? [1,2] : method==='allSettled' ? [{status:'fulfilled',value:1},{status:'fulfilled',value:2}] : 1);
  });

  it('Promise.all preserves parallel array map inputs', async () => {
    const first = deferred<number>(); const started: number[] = [];
    const run = execute('Promise.all([1,2].map(n => job(n)));', { job: (n: number) => { started.push(n); return n===1 ? first.promise : Promise.resolve(2); } });
    expect(started).toEqual([1,2]); first.resolve(1); await run.completion;
    expect(run.values[0]).toEqual([1,2]);
  });

  it('supports explicit async, await, then, catch and finally', async () => {
    expect(await result(`async function work() { return await later(3); } const log=[];
      const a = work().then(x => later(x+1)).finally(() => { log.push(later('done')); });
      const b = Promise.reject(new Error('x')).catch(error => error.message);
      [a,b,log];
    `)).toEqual([4,'x',['done']]);
  });

  it.each([
    'class C { constructor() { later(1); } } new C();',
    'function C() { this.value=later(1); } new C();',
    'const o = { set x(v) { later(v); } }; o.x=1;',
    'function* g() { yield later(1); } g().next();',
    'new Promise(resolve => { resolve(later(1)); });',
    '[2,1].sort((a,b) => later(a-b));',
  ])('rejects waiting inside synchronous contexts: %s', async source => {
    await expect(result(source)).rejects.toThrow(/synchronous context/);
  });

  it('allows synchronous sort callbacks and constructors', async () => {
    expect(await result('class C { constructor(v) { this.v=v; } } [new C(2).v, [3,1,2].sort((a,b)=>a-b)];')).toEqual([2,[1,2,3]]);
  });

  it('rejects native callbacks whose promises are ignored and permits consumed callbacks', async () => {
    await expect(result('api(x=>later(x));', { api: (callback: (n:number)=>unknown) => { callback(2); } })).rejects.toThrow(/for\.\.\.of/);
    expect(await result('api(x=>later(x));', { api: async (callback: (n:number)=>unknown) => await callback(2) })).toBe(2);
  });

  it('preserves grouped/optional promise continuations and async generators', async () => {
    expect(await result(`
      async function* values() { yield later(1); yield 2; }
      const all=[]; for (const n of values()) all.push(n);
      [(later(3)).then(n=>n+1), later(5)?.then(n=>n+1), all, Promise.reject('x')?.then(n=>n).catch(e=>e)];
    `)).toEqual([4,6,[1,2],'x']);
  });

  it('keeps destructuring assignment defaults, computed keys and array result realms', async () => {
    expect(await result(`
      let a,b; ({[later('a')]:a, b=later(2)} = later({a:1}));
      [a,b,[1,2].map(x=>later(x)) instanceof Array];
    `)).toEqual([1,2,true]);
  });

  it('does not treat a shadowed Promise.all as a parallel combinator', async () => {
    const pending=deferred<number>(); const started:number[]=[];
    const run=execute(`const Promise={all:values=>values}; Promise.all([job(1),job(2)]);`, {job:(n:number)=>{started.push(n);return n===1?pending.promise:2;}});
    expect(started).toEqual([1]); pending.resolve(1); await run.completion;
    expect(run.values.at(-1)).toEqual([1,2]);
  });

  it('stops on an uncaught rejection without starting the following statement', async () => {
    const log: unknown[] = [];
    await expect(result('const x=fail(); record(2);', { fail: ()=>Promise.reject(new Error('boom')), record: (v: unknown)=>log.push(v) })).rejects.toThrow('boom');
    expect(log).toEqual([]);
  });
});
