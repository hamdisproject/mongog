/** Runtime helpers for the AST lowering. Driver instances are never wrapped or patched. */
export interface AutoAwaitHooks {
  checkpoint: () => void;
  track: (promise: Promise<unknown>) => void;
  checkCatch: (error: unknown) => void;
}

type Callable = (...args: unknown[]) => unknown;
type ArrayOperation = 'map' | 'forEach' | 'filter' | 'reduce' | 'find' | 'some' | 'every' | 'flatMap';
const arrayOperations: ArrayOperation[] = ['map', 'forEach', 'filter', 'reduce', 'find', 'some', 'every', 'flatMap'];
export const isPromise = (value: unknown): value is PromiseLike<unknown> =>
  value !== null && (typeof value === 'object' || typeof value === 'function') && typeof (value as { then?: unknown }).then === 'function';

export function createAutoAwaitRuntime(hooks: AutoAwaitHooks) {
  const arrayMethods = new Map<unknown, ArrayOperation>();
  const sorts = new Set<unknown>();
  const combinators = new Map<unknown, Set<unknown>>();
  const registerPromise = (constructor: PromiseConstructor) => combinators.set(constructor,
    new Set([constructor.all, constructor.allSettled, constructor.race, constructor.any]));
  registerPromise(Promise);
  const registerArray = (prototype: typeof Array.prototype) => {
    for (const operation of arrayOperations) arrayMethods.set(prototype[operation], operation);
    sorts.add(prototype.sort);
  };
  registerArray(Array.prototype);
  const track = <T>(value: T): T => {
    if (isPromise(value)) hooks.track(Promise.resolve(value));
    return value;
  };
  const wait = async (value: unknown) => {
    hooks.checkpoint();
    const result = await track(value);
    hooks.checkpoint();
    return result;
  };
  const sync = (value: unknown): unknown => {
    if (isPromise(value)) {
      track(value);
      throw new Error('This synchronous context cannot wait for a database result. Move the operation to a normal function or a for...of loop.');
    }
    return value;
  };
  // A sync fast path is important: native callbacks such as Array.sort must
  // continue receiving ordinary values when no asynchronous work is performed.
  const run = (iterator: Generator<unknown, unknown, unknown>): unknown => {
    const advance = (value?: unknown): unknown => {
      let step = iterator.next(value);
      while (!step.done) {
        hooks.checkpoint();
        if (isPromise(step.value)) return track(wait(step.value).then(advance, (error) => {
          iterator.return(undefined);
          throw error;
        }));
        step = iterator.next(step.value);
      }
      return step.value;
    };
    return advance();
  };
  const array = (operation: ArrayOperation, receiver: unknown, args: unknown[]): unknown => {
    if (receiver === null || receiver === undefined) throw new TypeError('Array method called on null or undefined');
    const object = Object(receiver) as Record<number, unknown> & { length: number };
    const length = Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.trunc(Number(object.length)) || 0));
    const callback = args[0];
    if (typeof callback !== 'function') throw new TypeError('Array callback must be a function');
    return run((function* () {
      const size = operation === 'map' ? length : 0;
      const constructor = Array.isArray(receiver) ? receiver.constructor as ArrayConstructor : Array;
      const species = constructor?.[Symbol.species] ?? Array;
      const output = Reflect.construct(species, [size]) as unknown[];
      let accumulator = args[1];
      let initialized = args.length > 1;
      for (let index = 0; index < length; index++) {
        hooks.checkpoint();
        if (!(index in object) && operation !== 'find') continue;
        const value = object[index];
        if (operation === 'reduce' && !initialized) { accumulator = value; initialized = true; continue; }
        const result = yield Reflect.apply(callback, operation === 'reduce' ? undefined : args[1],
          operation === 'reduce' ? [accumulator, value, index, object] : [value, index, object]);
        switch (operation) {
          case 'map': output[index] = result; break;
          case 'filter': if (result) output.push(value); break;
          case 'flatMap': if (Array.isArray(result)) { for (let i = 0; i < result.length; i++) if (i in result) output.push(result[i]); } else output.push(result); break;
          case 'reduce': accumulator = result; break;
          case 'find': if (result) return value; break;
          case 'some': if (result) return true; break;
          case 'every': if (!result) return false; break;
        }
      }
      if (operation === 'reduce') {
        if (!initialized) throw new TypeError('Reduce of empty array with no initial value');
        return accumulator;
      }
      if (operation === 'forEach' || operation === 'find') return undefined;
      if (operation === 'some') return false;
      if (operation === 'every') return true;
      return output;
    })());
  };
  const invoke = (receiver: unknown, fn: unknown, args: unknown[], parallelArray = false): unknown => {
    hooks.checkpoint();
    if (typeof fn !== 'function') throw new TypeError('The called value is not a function');
    const operation = arrayMethods.get(fn);
    if (operation && !parallelArray) return array(operation, receiver, args);
    if (operation && parallelArray) return track(Reflect.apply(parallelMethods.get(fn as Callable) ?? fn, receiver, args));
    if (sorts.has(fn) && typeof args[0] === 'function') {
      const comparator = args[0];
      return Reflect.apply(fn, receiver, [(...values: unknown[]) => sync(Reflect.apply(comparator, undefined, values))]);
    }
    const callbacks: Array<{ consumed: boolean }> = [];
    const guardedArgs = args.map((argument) => {
      if (typeof argument !== 'function') return argument;
      return function (this: unknown, ...values: unknown[]) {
        hooks.checkpoint();
        if (callbacks.some(callback => !callback.consumed)) {
          throw new Error('This API does not await its callback. Use a for...of loop for database operations (including cursor.forEach).');
        }
        const result = Reflect.apply(argument, this, values);
        if (!isPromise(result)) return result;
        track(result);
        const callback = { consumed: false };
        callbacks.push(callback);
        // A native API which awaits/assimilates its callback will consume this
        // thenable. APIs such as the driver's cursor.forEach do not do so.
        return { then(resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) {
          callback.consumed = true;
          return Promise.resolve(result).then(resolve, reject);
        } };
      };
    });
    const verify = (value: unknown) => {
      if (callbacks.some((callback) => !callback.consumed)) {
        throw new Error('This API does not await its callback. Use a for...of loop for database operations (including cursor.forEach).');
      }
      return value;
    };
    const result = Reflect.apply(fn, receiver, guardedArgs);
    return isPromise(result) ? track(Promise.resolve(result).then(verify)) : verify(result);
  };
  return {
    isPromise,
    isCombinator: (receiver: unknown, fn: unknown) => combinators.get(receiver)?.has(fn) === true,
    wait,
    sync,
    track,
    invoke,
    construct: (constructor: unknown, args: unknown[]) => {
      hooks.checkpoint();
      let constructing = true;
      const guarded = args.map(argument => typeof argument !== 'function' ? argument : function (this: unknown, ...values: unknown[]) {
        const result = Reflect.apply(argument, this, values);
        return constructing ? sync(result) : result;
      });
      try { return track(Reflect.construct(constructor as new (...values: unknown[]) => unknown, guarded)); }
      finally { constructing = false; }
    },
    checkpoint: hooks.checkpoint,
    checkCatch: hooks.checkCatch,
    iterator: (value: unknown) => {
      if (value === null || value === undefined) throw new TypeError('Value is not iterable');
      const iterable = value as Iterable<unknown> & AsyncIterable<unknown>;
      const factory = iterable[Symbol.asyncIterator] ?? iterable[Symbol.iterator];
      if (typeof factory !== 'function') throw new TypeError('Value is not iterable');
      const iterator = Reflect.apply(factory, value, []) as Iterator<unknown> | AsyncIterator<unknown>;
      let done = false;
      const remember = (result: IteratorResult<unknown>) => { done = !!result.done; return result; };
      return {
        next: () => {
          hooks.checkpoint();
          const result = iterator.next();
          return isPromise(result) ? track(Promise.resolve(result).then(remember)) : remember(result);
        },
        close: () => {
          if (!done && iterator.return) { done = true; return track(iterator.return()); }
          return undefined;
        },
      };
    },
    install: (realmArray: ArrayConstructor, realmPromise: PromiseConstructor = Promise) => {
      registerPromise(realmPromise);
      const prototype = realmArray.prototype;
      registerArray(prototype);
      for (const operation of arrayOperations) {
        const original = prototype[operation];
        const replacement = function (this: unknown, ...args: unknown[]) { return array(operation, this, args); };
        // Keep the original method for explicit parallel array inputs.
        Object.defineProperty(prototype, operation, { configurable: true, writable: true, value: replacement });
        arrayMethods.set(replacement, operation);
        parallelMethods.set(replacement, original as Callable);
      }
    },
  };
}

// Populated only with VM-local replacements; weak keys avoid retaining closed contexts.
const parallelMethods = new WeakMap<Callable, Callable>();
