/**
 * Closes the canonical vm escape for scripts (ADR-05).
 *
 * Scripts receive REAL outer-realm objects, so `anyFunction.constructor`
 * reaches the outer `Function`, whose realm still allows code generation
 * from strings: `client.constructor.constructor("return process")()`.
 * Electron's utilityProcess ignores `--disallow-code-generation-from-strings`
 * (execArgv, js-flags and v8.setFlagsFromString all have no effect), so the
 * runtime swaps the inherited `constructor` of every function kind for a
 * proxy that refuses to compile. The global `Function` stays intact because
 * bundled dependencies (bluebird via exceljs) call `new Function` directly.
 *
 * This raises the bar; it is NOT a security boundary.
 */

let hardened = false;

export function hardenFunctionConstructors(): void {
  if (hardened) return;
  hardened = true;
  const prototypes: object[] = [
    Function.prototype,
    Object.getPrototypeOf(async function () {}) as object,
    Object.getPrototypeOf(function* () {}) as object,
    Object.getPrototypeOf(async function* () {}) as object,
  ];
  for (const prototype of prototypes) {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'constructor')!;
    Object.defineProperty(prototype, 'constructor', {
      ...descriptor,
      value: new Proxy(descriptor.value as (...args: unknown[]) => unknown, {
        apply: refuseCodeGeneration,
        construct: refuseCodeGeneration,
      }),
    });
  }
}

function refuseCodeGeneration(): never {
  throw new EvalError('Code generation from strings disallowed for this context');
}
