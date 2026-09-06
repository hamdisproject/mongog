import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import packageMetadata from '../../../package.json';
import { generateUpdateManifests } from '../../../scripts/generate-update-manifests.mjs';
import { cleanupReleaseScratch, scratch, script } from './helpers/release.js';

afterEach(cleanupReleaseScratch);

describe('release tooling', () => {
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

  it('accepts the complete release set and generates updater manifests from the exact artifacts', async () => {
    const directory = scratch();
    const names = [
      `MongoG-${packageMetadata.version}-macOS-arm64.dmg`,
      `MongoG-${packageMetadata.version}-macOS-arm64.zip`,
      `MongoG-${packageMetadata.version}-macOS-x64.dmg`,
      `MongoG-${packageMetadata.version}-macOS-x64.zip`,
      `MongoG-Setup-${packageMetadata.version}-UNSIGNED-win-x64.exe`,
      `mongog-${packageMetadata.version}-1.x86_64.rpm`,
    ];
    for (const name of names) writeFileSync(path.join(directory, name), name);

    execFileSync(process.execPath, [
      script('verify-release-assets.mjs'),
      '--directory', directory,
      '--tag', `v${packageMetadata.version}`,
      '--unsigned-windows',
    ]);

    const checksums = readFileSync(path.join(directory, 'SHA256SUMS.txt'), 'utf8');
    expect(checksums.trim().split('\n')).toHaveLength(6);
    expect(checksums).toContain(`MongoG-${packageMetadata.version}-macOS-arm64.dmg`);

    await expect(generateUpdateManifests(directory)).resolves.toEqual([
      'latest-mac.yml',
      'latest.yml',
      'latest-linux.yml',
    ]);
    const macManifest = readFileSync(path.join(directory, 'latest-mac.yml'), 'utf8');
    const windowsManifest = readFileSync(path.join(directory, 'latest.yml'), 'utf8');
    const linuxManifest = readFileSync(path.join(directory, 'latest-linux.yml'), 'utf8');
    expect(macManifest).toContain(`version: "${packageMetadata.version}"`);
    expect(macManifest).toContain(`MongoG-${packageMetadata.version}-macOS-arm64.zip`);
    expect(macManifest).toContain(`MongoG-${packageMetadata.version}-macOS-x64.zip`);
    expect(macManifest).not.toContain('.dmg');
    expect(windowsManifest).toContain(`MongoG-Setup-${packageMetadata.version}-UNSIGNED-win-x64.exe`);
    expect(windowsManifest).toContain(
      createHash('sha512')
        .update(`MongoG-Setup-${packageMetadata.version}-UNSIGNED-win-x64.exe`)
        .digest('base64'),
    );
    expect(windowsManifest).toContain(
      `size: ${Buffer.byteLength(`MongoG-Setup-${packageMetadata.version}-UNSIGNED-win-x64.exe`)}`,
    );
    expect(linuxManifest).toContain(`mongog-${packageMetadata.version}-1.x86_64.rpm`);
    expect(readdirSync(directory)).toContain('latest.yml');
    const expectedHash = createHash('sha512')
      .update(`mongog-${packageMetadata.version}-1.x86_64.rpm`)
      .digest('base64');
    expect(linuxManifest).toContain(expectedHash);

    execFileSync(process.execPath, [
      script('verify-release-assets.mjs'),
      '--directory', directory,
      '--tag', `v${packageMetadata.version}`,
      '--unsigned-windows',
    ]);
  });

  it('rejects obsolete portable and DEB files in the official release set', () => {
    const directory = scratch();
    const names = [
      `MongoG-${packageMetadata.version}-macOS-arm64.dmg`,
      `MongoG-${packageMetadata.version}-macOS-arm64.zip`,
      `MongoG-${packageMetadata.version}-macOS-x64.dmg`,
      `MongoG-${packageMetadata.version}-macOS-x64.zip`,
      `MongoG-Setup-${packageMetadata.version}-UNSIGNED-win-x64.exe`,
      `mongog-${packageMetadata.version}-1.x86_64.rpm`,
      `mongog_${packageMetadata.version}_amd64.deb`,
    ];
    for (const name of names) writeFileSync(path.join(directory, name), name);

    const result = spawnSync(process.execPath, [
      script('verify-release-assets.mjs'), '--directory', directory, '--tag', `v${packageMetadata.version}`, '--unsigned-windows',
    ], { encoding: 'utf8' });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Release artifact set is incomplete');
  });

  it('normalizes the Windows NSIS artifact with an explicit unsigned marker', () => {
    const directory = scratch();
    const source = path.join(directory, 'make');
    const output = path.join(directory, 'release');
    mkdirSync(source, { recursive: true });
    writeFileSync(path.join(source, `MongoG-Setup-${packageMetadata.version}-win-x64.exe`), 'exe');

    execFileSync(process.execPath, [
      script('collect-release-artifacts.mjs'),
      '--platform', 'win32',
      '--arch', 'x64',
      '--source', source,
      '--output', output,
      '--clean',
      '--unsigned',
    ]);

    expect(readdirSync(output)).toEqual([
      `MongoG-Setup-${packageMetadata.version}-UNSIGNED-win-x64.exe`,
    ]);
  });
});
