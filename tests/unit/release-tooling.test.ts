import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';
import packageMetadata from '../../package.json';
import { generateUpdateManifests } from '../../scripts/generate-update-manifests.mjs';
import { isRecoverableDmgDetachFailure } from '../../scripts/release-utils.mjs';

const scratchDirectories: string[] = [];
const { load: loadYaml } = createRequire(import.meta.url)('js-yaml') as {
  load: (source: string) => {
    workflows: { ci: { jobs: unknown[] }; release: { jobs: Record<string, unknown>[] } };
    jobs: Record<string, unknown>;
  };
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
  it('keeps the complete CircleCI platform, release, and hardening contract', () => {
    const workflow = readFileSync(path.resolve(process.cwd(), '.circleci', 'config.yml'), 'utf8');

    expect(workflow).toContain('image: cimg/node:22.13.0');
    expect(workflow).toContain("image: ubuntu-2404:current");
    expect(workflow).toContain('resource_class: medium');
    expect(workflow).not.toContain('resource_class: xlarge');
    expect(workflow).toContain('executor: win/server-2022');
    expect(workflow).toContain("$nodeRoot = 'C:\\tools\\node-v22.13.0'");
    expect(workflow).toContain('test "$(node --version)" = "v22.13.0"');
    expect(workflow).not.toContain('choco install');
    expect(workflow).toContain('https://www.python.org/ftp/python/3.12.10/python-3.12.10-amd64.exe');
    expect(workflow).toContain('Get-FileHash -LiteralPath $Destination -Algorithm SHA256');
    expect(workflow).toContain('67b5635e80ea51072b87941312d00ec8927c4db9ba18938f7ad2d27b328b95fb');
    expect(workflow).toContain('$attempt -le 4');
    expect(workflow).toContain('$installer.ExitCode -notin @(0, 3010)');
    expect(workflow).toContain("struct.calcsize('P') == 8");
    expect(workflow).toContain('Python 3.12.10 x64 verification failed.');
    expect(workflow).toContain("npm_config_msvs_version='2022'");
    expect(workflow).toContain('resource_class: m4pro.medium');
    const parsed = loadYaml(workflow);
    expect(parsed.workflows.ci.jobs).toEqual(['quality']);
    expect(Object.keys(parsed.jobs).some((job) => job.startsWith('package_smoke_'))).toBe(false);
    expect(parsed.workflows.release.jobs.map((job) => Object.keys(job)[0])).toEqual([
      'release_macos', 'release_macos', 'release_windows', 'release_linux', 'release_metadata',
    ]);
    expect(workflow).toContain('npm run smoke:packaged -- --platform darwin --arch arm64');
    expect(workflow).toContain('npm run smoke:packaged -- --platform win32 --arch x64');
    expect(workflow).toContain('xvfb-run -a npm run smoke:packaged -- --platform linux --arch x64');
    expect(workflow).toContain('if [[ "$EXPECTED_MACHO_ARCH" == "x64" ]]; then EXPECTED_MACHO_ARCH="x86_64"; fi');
    expect(workflow).toContain('[[ " $MACHO_ARCHS " == *" $EXPECTED_MACHO_ARCH "* ]]');
    expect(workflow).toContain('[[ "$SIGNING_IDENTITIES" == *"$MACOS_SIGN_IDENTITY"* ]]');
    expect(workflow).not.toMatch(/\| grep -[^\n]*q/u);
    expect(workflow).toContain('node scripts/make-macos-dmg.mjs --arch << parameters.arch >>');
    expect(workflow).toContain('--targets=@electron-forge/maker-zip');
    expect(workflow).toContain('hdiutil verify "$DMG_PATH"');
    expect(workflow).toContain('sudo chmod 4755 out/MongoG-linux-x64/chrome-sandbox');
    expect(workflow).toContain('./node_modules/.bin/electron-forge package --platform=win32 --arch=x64');
    expect(workflow).not.toContain('--no-sandbox');

    const forgeConfig = readFileSync(path.resolve(process.cwd(), 'forge.config.mts'), 'utf8');
    expect(forgeConfig).toContain('continueOnError: false');
    expect(forgeConfig).toContain('resetAdHocDarwinSignature: true');
    expect(forgeConfig).toContain('rebuildConfig: { force: true }');

    const windowsMaker = readFileSync(script('make-windows-nsis.mjs'), 'utf8');
    expect(windowsMaker).toContain("CSC_IDENTITY_AUTO_DISCOVERY: 'false'");
    expect(windowsMaker).toContain("app-update.yml");
    expect(windowsMaker).toContain("'electron-builder', 'cli.js'");
    expect(windowsMaker).toContain('spawnSync(process.execPath, builderArguments');
    expect(windowsMaker).not.toContain("'node_modules', '.bin', 'electron-builder.cmd'");
    expect(windowsMaker).not.toContain("process.env.ComSpec || 'cmd.exe'");
    expect(windowsMaker).not.toContain('prepareWindowsUpdateRuntime');

    const builderConfig = readFileSync(path.resolve(process.cwd(), 'electron-builder.yml'), 'utf8');
    expect(builderConfig).not.toContain('publish:');
    expect(builderConfig).not.toContain('verifyUpdateCodeSignature');
  });

  it('stores version-tag release artifacts directly in CircleCI', () => {
    const workflow = readFileSync(path.resolve(process.cwd(), '.circleci', 'config.yml'), 'utf8');

    expect(workflow).toContain('run_release:');
    expect(workflow).toContain('release_tag:');
    expect(workflow).toContain('pipeline.git.tag matches /^v[0-9]+\\.[0-9]+\\.[0-9]+$/');
    expect(workflow).toContain('MONGOG_RELEASE=1 MONGOG_SIGN_RELEASE=1 npm run package -- --platform=darwin');
    expect(workflow).toContain('MONGOG_RELEASE=1 npm run package -- --platform=win32');
    expect(workflow).toContain('MONGOG_RELEASE=1 npm run make:windows:nsis');
    expect(workflow).not.toContain('WINDOWS_CERTIFICATE_PFX_BASE64');
    expect(workflow).not.toContain('WINDOWS_CERTIFICATE_PASSWORD');
    expect(workflow).toContain("Get-AuthenticodeSignature");
    expect(workflow).toContain("$signature.Status -ne 'NotSigned'");
    expect(workflow).toContain('--unsigned-windows');
    expect(workflow).toContain("cat \"$PACKAGE_TYPE_PATH\"");
    expect(workflow).toContain('xcrun notarytool submit "$DMG_PATH"');
    expect(workflow).toContain('xcrun stapler validate "$APP_PATH"');
    expect(workflow).toContain('destination: release-macos-<< parameters.arch >>');
    expect(workflow).toContain('name: release-metadata');
    expect(workflow).toContain('npm run generate:update-manifests');
    expect(workflow.match(/persist_to_workspace:/gu)).toHaveLength(3);
    expect(workflow.match(/filters: pipeline\.parameters\.run_release or \(pipeline\.git\.tag matches/g)).toHaveLength(5);
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
      'latest-linux.yml',
    ]);
    const macManifest = readFileSync(path.join(directory, 'latest-mac.yml'), 'utf8');
    const linuxManifest = readFileSync(path.join(directory, 'latest-linux.yml'), 'utf8');
    expect(macManifest).toContain(`version: "${packageMetadata.version}"`);
    expect(macManifest).toContain(`MongoG-${packageMetadata.version}-macOS-arm64.zip`);
    expect(macManifest).toContain(`MongoG-${packageMetadata.version}-macOS-x64.zip`);
    expect(macManifest).not.toContain('.dmg');
    expect(linuxManifest).toContain(`mongog-${packageMetadata.version}-1.x86_64.rpm`);
    expect(readdirSync(directory)).not.toContain('latest.yml');
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
