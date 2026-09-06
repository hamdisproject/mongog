import { execFileSync, spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import packageMetadata from '../../../package.json';
import { script } from './helpers/release.js';

describe('release tooling', () => {
  it('requires the release tag to match package.json', () => {
    execFileSync(process.execPath, [script('validate-release-environment.mjs'), '--platform', 'linux', '--tag', `v${packageMetadata.version}`], {
      env: { ...process.env, MONGOG_RELEASE: '1' },
    });

    const mismatch = spawnSync(
      process.execPath,
      [script('validate-release-environment.mjs'), '--platform', 'linux', '--tag', 'v99.0.0'],
      { env: { ...process.env, MONGOG_RELEASE: '1' }, encoding: 'utf8' },
    );
    expect(mismatch.status).not.toBe(0);
    expect(mismatch.stderr).toContain('does not match package.json');
  });

  it('accepts the positional target form produced by npm on Windows', () => {
    execFileSync(
      process.execPath,
      [script('validate-release-environment.mjs'), 'linux', 'x64'],
      {
        env: {
          ...process.env,
          MONGOG_RELEASE: '1',
          RELEASE_TAG: `v${packageMetadata.version}`,
        },
      },
    );

    const invalid = spawnSync(
      process.execPath,
      [script('validate-release-environment.mjs'), 'linux', 'x64', 'extra'],
      {
        env: {
          ...process.env,
          MONGOG_RELEASE: '1',
          RELEASE_TAG: `v${packageMetadata.version}`,
        },
        encoding: 'utf8',
      },
    );
    expect(invalid.status).not.toBe(0);
    expect(invalid.stderr).toContain('Unexpected positional arguments');
  });

  it('accepts the GitHub Actions tag fallback', () => {
    execFileSync(
      process.execPath,
      [script('validate-release-environment.mjs'), '--platform', 'linux'],
      {
        env: {
          ...process.env,
          MONGOG_RELEASE: '1',
          RELEASE_TAG: '',
          GITHUB_REF_NAME: `v${packageMetadata.version}`,
        },
      },
    );
  });

  it('accepts unsigned production Windows releases without certificate material', () => {
    const result = spawnSync(
      process.execPath,
      [script('validate-release-environment.mjs'), '--platform', 'win32', '--tag', `v${packageMetadata.version}`],
      { env: { ...process.env, MONGOG_RELEASE: '1', MONGOG_SIGN_RELEASE: '' }, encoding: 'utf8' },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Unsigned release environment validated');
  });

  it('fails closed when signed production material is requested but missing', () => {
    const result = spawnSync(
      process.execPath,
      [script('validate-release-environment.mjs'), '--platform', 'darwin', '--tag', `v${packageMetadata.version}`],
      {
        env: {
          ...process.env,
          MONGOG_RELEASE: '1',
          MONGOG_SIGN_RELEASE: '1',
          MACOS_CERTIFICATE_P12_BASE64: '',
        },
        encoding: 'utf8',
      },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('MACOS_CERTIFICATE_P12_BASE64 is required');
  });
});
