import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach } from 'vitest';

export interface TempDatabaseContext {
  readonly directory: string;
  readonly path: string;
}

export function useTempDatabase(prefix: string): TempDatabaseContext {
  let directory = '';
  let databasePath = '';
  let sequence = 0;

  beforeAll(() => {
    directory = mkdtempSync(join(tmpdir(), prefix));
  });

  afterAll(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  beforeEach(() => {
    databasePath = join(directory, `case-${++sequence}.db`);
  });

  return {
    get directory() {
      return directory;
    },
    get path() {
      return databasePath;
    },
  };
}
