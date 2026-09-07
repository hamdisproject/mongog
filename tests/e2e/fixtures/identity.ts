import { createHash } from 'node:crypto';

export function e2eDatabaseName(
  testId: string,
  workerIndex: number,
  repeatEachIndex: number,
  retry: number,
): string {
  const slug = testId.toLowerCase().replace(/[^a-z0-9]+/gu, '_').replace(/^_+|_+$/gu, '').slice(-10);
  const digest = createHash('sha256').update(testId).digest('hex').slice(0, 8);
  return `mongog_e2e_w${workerIndex}_r${repeatEachIndex}_a${retry}_${slug}_${digest}`;
}

export function createTestDatabaseUri(rootUri: string, databaseName: string): string {
  const databaseUrl = new URL(rootUri);
  databaseUrl.pathname = `/${databaseName}`;
  return databaseUrl.toString();
}
