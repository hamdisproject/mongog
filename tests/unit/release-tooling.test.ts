import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import packageMetadata from '../../package.json';

const scratchDirectories: string[] = [];

function scratch(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'mongog-release-test-'));
  scratchDirectories.push(directory);
  return directory;
}

function script(name: string): string {
  return path.resolve(process.cwd(), 'scripts', name);
}

afterEach(() => {
  for (const directory of scratchDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

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

  it('accepts an unsigned production release without signing material', () => {
    for (const platform of ['darwin', 'win32']) {
      execFileSync(
        process.execPath,
        [script('validate-release-environment.mjs'), '--platform', platform, '--tag', `v${packageMetadata.version}`],
        { env: { ...process.env, MONGOG_RELEASE: '1' } },
      );
    }
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

  it('normalizes Forge maker outputs for one platform', () => {
    const directory = scratch();
    const source = path.join(directory, 'make');
    const output = path.join(directory, 'release');
    mkdirSync(path.join(source, 'nested'), { recursive: true });
    writeFileSync(path.join(source, 'MongoG-source.dmg'), 'dmg');
    writeFileSync(path.join(source, 'nested', 'MongoG-source.zip'), 'zip');

    execFileSync(process.execPath, [
      script('collect-release-artifacts.mjs'),
      '--platform', 'darwin',
      '--arch', 'arm64',
      '--source', source,
      '--output', output,
      '--clean',
      '--unsigned',
    ]);

    expect(readdirSync(output).sort()).toEqual([
      `MongoG-${packageMetadata.version}-UNSIGNED-macOS-arm64.dmg`,
      `MongoG-${packageMetadata.version}-UNSIGNED-macOS-arm64.zip`,
    ]);
  });

  it('accepts only the complete nine-file release set and writes checksums', () => {
    const directory = scratch();
    const names = [
      `MongoG-${packageMetadata.version}-UNSIGNED-macOS-arm64.dmg`,
      `MongoG-${packageMetadata.version}-UNSIGNED-macOS-arm64.zip`,
      `MongoG-${packageMetadata.version}-UNSIGNED-macOS-x64.dmg`,
      `MongoG-${packageMetadata.version}-UNSIGNED-macOS-x64.zip`,
      `MongoG-${packageMetadata.version}-UNSIGNED-win-x64.zip`,
      `MongoG-${packageMetadata.version}-UNSIGNED-linux-x64.zip`,
      `MongoG-Setup-${packageMetadata.version}-UNSIGNED-win-x64.exe`,
      `mongog-${packageMetadata.version}-UNSIGNED-1.x86_64.rpm`,
      `mongog_${packageMetadata.version}-UNSIGNED_amd64.deb`,
    ];
    for (const name of names) writeFileSync(path.join(directory, name), name);

    execFileSync(process.execPath, [
      script('verify-release-assets.mjs'),
      '--directory', directory,
      '--tag', `v${packageMetadata.version}`,
      '--unsigned',
    ]);

    const checksums = readFileSync(path.join(directory, 'SHA256SUMS.txt'), 'utf8');
    expect(checksums.trim().split('\n')).toHaveLength(9);
    expect(checksums).toContain(`MongoG-${packageMetadata.version}-UNSIGNED-macOS-arm64.dmg`);
  });
});
