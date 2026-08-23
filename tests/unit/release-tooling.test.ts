import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import packageMetadata from '../../package.json';
import { isRecoverableDmgDetachFailure } from '../../scripts/release-utils.mjs';

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
  it('keeps the complete CircleCI platform, release, and hardening contract', () => {
    const workflow = readFileSync(path.resolve(process.cwd(), '.circleci', 'config.yml'), 'utf8');

    expect(workflow).toContain('image: cimg/node:22.12.0');
    expect(workflow).toContain("image: ubuntu-2404:current");
    expect(workflow).toContain('resource_class: medium');
    expect(workflow).not.toContain('resource_class: xlarge');
    expect(workflow).toContain('executor: win/server-2022');
    expect(workflow).toContain("$nodeRoot = 'C:\\tools\\node-v22.12.0'");
    expect(workflow).toContain('test "$(node --version)" = "v22.12.0"');
    expect(workflow).toContain('choco install python312 -y');
    expect(workflow).toContain("npm_config_msvs_version='2022'");
    expect(workflow).toContain('resource_class: m4pro.medium');
    expect(workflow).toContain('name: package-smoke-macos-arm64');
    expect(workflow).toContain('name: package-smoke-macos-x64');
    expect(workflow).toContain('run_smoke: false');
    expect(workflow).toContain('name: package-smoke-windows-x64');
    expect(workflow).toContain('name: package-smoke-linux-x64');
    expect(workflow).toContain('if [[ "$EXPECTED_MACHO_ARCH" == "x64" ]]; then EXPECTED_MACHO_ARCH="x86_64"; fi');
    expect(workflow).toContain('grep -Fxq "$EXPECTED_MACHO_ARCH"');
    expect(workflow).toContain('node scripts/make-macos-dmg.mjs --arch << parameters.arch >>');
    expect(workflow).toContain('--targets=@electron-forge/maker-zip');
    expect(workflow).toContain('hdiutil verify "$DMG_PATH"');
    expect(workflow).toContain('sudo chmod 4755 out/MongoG-linux-x64/chrome-sandbox');
    expect(workflow).toContain('MONGOG_SMOKE_ALLOW_UNAVAILABLE_SECURE_STORAGE=1');
    expect(workflow).toContain('filters: pipeline.git.branch == "main"');
    expect(workflow).toContain('./node_modules/.bin/electron-forge package --platform=win32 --arch=x64');
    expect(workflow).toContain('ci-artifacts/MongoG-${VERSION}-macOS-<< parameters.arch >>.zip');
    expect(workflow).toContain('ci-artifacts\\MongoG-${version}-win-x64.zip');
    expect(workflow).toContain('ci-artifacts/MongoG-${VERSION}-linux-x64.tar.gz');
    expect(workflow.match(/destination: packages/gu)).toHaveLength(3);
    expect(workflow).not.toContain('--no-sandbox');
  });

  it('stores version-tag release artifacts directly in CircleCI', () => {
    const workflow = readFileSync(path.resolve(process.cwd(), '.circleci', 'config.yml'), 'utf8');

    expect(workflow).toContain('run_release:');
    expect(workflow).toContain('release_tag:');
    expect(workflow).toContain('pipeline.git.tag matches /^v[0-9]+\\.[0-9]+\\.[0-9]+$/');
    expect(workflow).toContain('MONGOG_RELEASE=1 MONGOG_SIGN_RELEASE=1 npm run package -- --platform=darwin');
    expect(workflow).toContain('xcrun notarytool submit "$DMG_PATH"');
    expect(workflow).toContain('xcrun stapler validate "$APP_PATH"');
    expect(workflow).toContain('destination: release-macos-<< parameters.arch >>');
    expect(workflow).not.toContain('publish_release:');
    expect(workflow).not.toContain('GH_TOKEN');
    expect(workflow).toContain('context: release');
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

  it('accepts the CircleCI tag fallback', () => {
    execFileSync(
      process.execPath,
      [script('validate-release-environment.mjs'), '--platform', 'linux'],
      {
        env: {
          ...process.env,
          MONGOG_RELEASE: '1',
          RELEASE_TAG: '',
          CIRCLE_TAG: `v${packageMetadata.version}`,
        },
      },
    );
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

  it('accepts signed macOS artifacts alongside unsigned Windows and Linux artifacts', () => {
    const directory = scratch();
    const names = [
      `MongoG-${packageMetadata.version}-macOS-arm64.dmg`,
      `MongoG-${packageMetadata.version}-macOS-arm64.zip`,
      `MongoG-${packageMetadata.version}-macOS-x64.dmg`,
      `MongoG-${packageMetadata.version}-macOS-x64.zip`,
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
      '--signed-macos',
    ]);

    const checksums = readFileSync(path.join(directory, 'SHA256SUMS.txt'), 'utf8');
    expect(checksums.trim().split('\n')).toHaveLength(9);
    expect(checksums).toContain(`MongoG-${packageMetadata.version}-macOS-arm64.dmg`);
  });
});
