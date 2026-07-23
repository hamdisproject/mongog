import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app } from 'electron';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * The query runtime is built to `runtime-dist/query-runtime.cjs` (outside
 * .vite, which plugin-vite wipes). In packaged apps it is excluded from asar
 * (forge.config asar.unpack) because utilityProcess.fork() needs a real file.
 */
export function resolveRuntimeEntry(): string {
  const p = path.join(app.getAppPath(), 'runtime-dist', 'query-runtime.cjs');
  if (app.isPackaged) {
    return p.replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`);
  }
  return p;
}
