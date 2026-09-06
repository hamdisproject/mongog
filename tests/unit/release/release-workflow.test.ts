import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import packageMetadata from '../../../package.json';
import { isRecoverableDmgDetachFailure } from '../../../scripts/release-utils.mjs';
import { loadYaml, script } from './helpers/release.js';

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
});
