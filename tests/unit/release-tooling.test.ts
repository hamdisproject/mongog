import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';
import packageMetadata from '../../package.json';
import { generateUpdateManifests } from '../../scripts/generate-update-manifests.mjs';
import { isRecoverableDmgDetachFailure } from '../../scripts/release-utils.mjs';

const scratchDirectories: string[] = [];
const { load: loadYaml } = createRequire(import.meta.url)('js-yaml') as {
  load: (source: string) => unknown;
};

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
  it('keeps the complete GitHub Actions platform, release, and hardening contract', () => {
    const workflow = readFileSync(path.resolve(process.cwd(), '.github', 'workflows', 'release.yml'), 'utf8');
    const parsed = loadYaml(workflow) as { jobs: Record<string, unknown> };

    expect(Object.keys(parsed.jobs)).toEqual(['checks', 'macos', 'windows', 'linux', 'draft-release']);
    expect(workflow).toContain("NODE_VERSION: '22.13.0'");
    expect(workflow).toContain('runs-on: ubuntu-24.04');
    expect(workflow).toContain('runner: macos-15');
    expect(workflow).toContain('runner: macos-15-intel');
    expect(workflow).toContain('runs-on: windows-2022');
    expect(workflow).toContain("python-version: '3.12.10'");
    expect(workflow).toContain('architecture: x64');
    expect(workflow).toContain('cache: npm');
    expect(workflow).toContain('Cache Electron downloads');
    expect(workflow).not.toContain('node_modules\n');
    expect(workflow).toContain('npm run typecheck');
    expect(workflow).toContain('npm run lint');
    expect(workflow).toContain('npm test');
    expect(workflow).not.toContain('test:e2e');
    expect(workflow).not.toContain('test:integ');
    expect(workflow).not.toContain('smoke:packaged');
    expect(workflow).not.toContain('playwright install-deps');
    expect(workflow).not.toContain('xvfb');
    expect(workflow.match(/npm run package --/gu)).toHaveLength(3);
    expect(workflow).toContain('--skip-package --platform=darwin');
    expect(workflow).toContain('--skip-package --platform=linux');
    expect(workflow).toContain('[[ "$SIGNING_IDENTITIES" == *"$MACOS_SIGN_IDENTITY"* ]]');
    expect(workflow).toContain('node scripts/make-macos-dmg.mjs --arch ${{ matrix.arch }}');
    expect(workflow).toContain('--targets=@electron-forge/maker-zip');
    expect(workflow).toContain('hdiutil verify "$DMG_PATH"');
    expect(workflow).toContain("$signature.Status -ne 'NotSigned'");
    expect(workflow).not.toContain('--no-sandbox');

    const forgeConfig = readFileSync(path.resolve(process.cwd(), 'forge.config.mts'), 'utf8');
    expect(forgeConfig).toContain('continueOnError: false');
    expect(forgeConfig).toContain('resetAdHocDarwinSignature: true');
    expect(forgeConfig).toContain('rebuildConfig: { force: true }');
    expect(forgeConfig).toContain("['darwin', 'win32', 'linux'].includes(process.platform)");
    expect(forgeConfig).toContain("'assets/windows/mongog-icon'");
    expect(forgeConfig).toContain("'assets/windows/mongog-icon.png'");
    expect(forgeConfig).toContain("icon: path.resolve('assets/legacy/mongog-icon.icns')");

    const windowsMaker = readFileSync(script('make-windows-nsis.mjs'), 'utf8');
    expect(windowsMaker).toContain("CSC_IDENTITY_AUTO_DISCOVERY: 'false'");
    expect(windowsMaker).not.toContain("app-update.yml");
    expect(windowsMaker).not.toContain('rmSync');
    expect(windowsMaker).toContain("'electron-builder', 'cli.js'");
    expect(windowsMaker).toContain('spawnSync(process.execPath, builderArguments');
    expect(windowsMaker).not.toContain("'node_modules', '.bin', 'electron-builder.cmd'");
    expect(windowsMaker).not.toContain("process.env.ComSpec || 'cmd.exe'");
    expect(windowsMaker).not.toContain('prepareWindowsUpdateRuntime');

    const builderConfig = readFileSync(path.resolve(process.cwd(), 'electron-builder.yml'), 'utf8');
    expect(builderConfig).not.toContain('publish:');
    expect(builderConfig).toContain('verifyUpdateCodeSignature: false');
    expect(builderConfig).toContain('packElevateHelper: true');
    expect(builderConfig).toContain('icon: assets/windows/mongog-icon.ico');
    expect(builderConfig).toContain('installerIcon: assets/windows/mongog-icon.ico');
    expect(builderConfig).toContain('uninstallerIcon: assets/windows/mongog-icon.ico');
    expect(builderConfig).toContain('installerHeaderIcon: assets/windows/mongog-icon.ico');

    expect(packageMetadata.scripts['build:icons']).toContain('build-windows-ico.mjs');
    expect(packageMetadata.scripts['verify:icons']).toContain('verify-windows-icons.mjs');

    const packageVerifier = readFileSync(script('verify-packaged-app.mjs'), 'utf8');
    expect(packageVerifier).toContain("platform === 'win32'");
    expect(packageVerifier).toContain("requiredFile(updateConfig, 'Packaged updater configuration')");
    expect(packageVerifier).toContain("requiredFile(packagedIcon, 'Packaged Windows runtime icon')");
    expect(packageVerifier).toContain("path.resolve('assets', 'windows', 'mongog-icon.png')");
    expect(packageVerifier).toContain("requiredFile(packagedIcon, 'Packaged macOS application icon')");
    expect(packageVerifier).toContain("path.resolve('assets', 'legacy', 'mongog-icon.icns')");
    expect(packageVerifier).not.toContain('must not contain app-update.yml');
  });

  it('creates tag-only GitHub Actions artifacts and a protected draft release', () => {
    const workflow = readFileSync(path.resolve(process.cwd(), '.github', 'workflows', 'release.yml'), 'utf8');

    expect(existsSync(path.resolve(process.cwd(), '.circleci', 'config.yml'))).toBe(false);
    expect(workflow).toContain("- 'v*.*.*'");
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain('release_tag:');
    expect(workflow.match(/git show-ref --verify --quiet/g)).toHaveLength(5);
    expect(workflow).toContain('git rev-parse "${RELEASE_TAG}^{commit}"');
    expect(workflow).not.toContain('pull_request:');
    expect(workflow).not.toContain('branches:');
    expect(workflow).toContain('group: release-${{ inputs.release_tag || github.ref_name }}');
    expect(workflow).toContain('cancel-in-progress: false');
    expect(workflow).toContain('environment: release');
    expect(workflow).toContain('permissions:\n  contents: read');
    expect(workflow).toContain('permissions:\n      contents: write');
    expect(workflow).toContain('actions/upload-artifact@v4');
    expect(workflow).toContain('actions/download-artifact@v5');
    expect(workflow).toContain('merge-multiple: true');
    expect(workflow).toContain('compression-level: 0');
    expect(workflow).toContain('--unsigned-windows');
    expect(workflow).toContain('node scripts/generate-update-manifests.mjs');
    expect(workflow).toContain('gh release create "$RELEASE_TAG"');
    expect(workflow).toContain('--verify-tag --draft --generate-notes');
    expect(workflow).toContain('gh release upload "$RELEASE_TAG" release-artifacts/* --clobber');
    expect(workflow).toContain('Refusing to replace assets on published release');
    expect(workflow).not.toContain('WINDOWS_CERTIFICATE_PFX_BASE64');
    expect(workflow).not.toContain('WINDOWS_CERTIFICATE_PASSWORD');
  });

  it('retries only the known idempotent macOS DMG detach failure', () => {
    expect(isRecoverableDmgDetachFailure(
      'Command failed: hdiutil detach /Volumes/MongoG\nhdiutil: detach failed - No such file or directory',
    )).toBe(true);
    expect(isRecoverableDmgDetachFailure('hdiutil: detach failed - Resource busy')).toBe(false);
    expect(isRecoverableDmgDetachFailure('codesign failed')).toBe(false);

    const forgeConfig = readFileSync(path.resolve(process.cwd(), 'forge.config.mts'), 'utf8');
    expect(forgeConfig).toContain("additionalDMGOptions: { filesystem: 'APFS' }");
  });

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
