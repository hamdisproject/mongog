import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseUpdateConfig, UPDATE_CONFIG } from '../../../src/shared/update-config.mjs';

describe('packaged updater configuration', () => {
  const bundled = readFileSync('build/app-update.yml', 'utf8');

  it('ships the generic feed and a stable cache directory', () => {
    expect(parseUpdateConfig(bundled)).toEqual({
      provider: 'generic', url: 'https://mongog.com/update', updaterCacheDirName: 'mongog-updater',
    });
    expect(parseUpdateConfig(JSON.stringify(UPDATE_CONFIG))).toEqual(UPDATE_CONFIG);
  });

  it.each([
    '', 'null', '[]', 'plain string', 'provider: [',
    `${bundled}provider: generic\n`,
    bundled.replace('provider: generic', 'provider: github'),
    bundled.replace('https://mongog.com/update', 'http://mongog.com/update'),
    bundled.replace('updaterCacheDirName: mongog-updater', 'updaterCacheDirName: ../outside'),
    bundled.replace('updaterCacheDirName: mongog-updater', 'updaterCacheDirName: 123'),
    bundled.replace('updaterCacheDirName: mongog-updater', ''),
  ])('rejects invalid, ambiguous or incomplete YAML: %s', (source) => {
    expect(() => parseUpdateConfig(source)).toThrow('Invalid packaged update configuration.');
  });

  it('does not include malformed configuration contents in errors', () => {
    expect(() => parseUpdateConfig('url: [https://alice:private@host/update?token=private'))
      .toThrow(/^Invalid packaged update configuration\.$/);
  });
});
