import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const scratchDirectories: string[] = [];

export const { load: loadYaml } = createRequire(import.meta.url)('js-yaml') as {
  load: (source: string) => unknown;
};

export function scratch(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'mongog-release-test-'));
  scratchDirectories.push(directory);
  return directory;
}

export function cleanupReleaseScratch(): void {
  for (const directory of scratchDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
}

export function script(name: string): string {
  return path.resolve(process.cwd(), 'scripts', name);
}
