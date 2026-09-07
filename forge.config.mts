import { FuseV1Options, FuseVersion } from '@electron/fuses';
import type { ForgeConfig } from '@electron-forge/shared-types';
import type { OsxSignOptions } from '@electron/packager';
import { existsSync } from 'node:fs';
import path from 'node:path';

// Electron Packager 18.4.4 implements this compatibility switch in
// signAppIfSpecified/createSignOpts, but omits it from its exported option type.
type PackagerOsxSignOptions = OsxSignOptions & { continueOnError?: boolean };

// Homebrew may place a just-released Python ahead of macOS's system Python.
// Native dependencies can lag behind that release, so prefer the Xcode-backed
// system interpreter for node-gyp unless the caller selected one explicitly.
if (process.platform === 'darwin' && !process.env.PYTHON && existsSync('/usr/bin/python3')) {
  process.env.PYTHON = '/usr/bin/python3';
}

const isProductionRelease = process.env.MONGOG_RELEASE === '1';
const isSignedRelease = isProductionRelease && process.env.MONGOG_SIGN_RELEASE === '1';
const homepage = 'https://github.com/hamdisproject/mongog';
const applicationId = 'com.mongog.desktop';

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for a signed production ${process.platform} release.`);
  return value;
}

const macRelease = isSignedRelease && process.platform === 'darwin'
  ? {
      identity: requiredEnvironment('MACOS_SIGN_IDENTITY'),
      keychain: requiredEnvironment('MACOS_KEYCHAIN'),
      apiKeyPath: requiredEnvironment('APPLE_API_KEY_PATH'),
      apiKeyId: requiredEnvironment('APPLE_API_KEY_ID'),
      apiIssuer: requiredEnvironment('APPLE_API_ISSUER_ID'),
    }
  : null;

const macSignOptions: PackagerOsxSignOptions | null = macRelease
  ? {
      identity: macRelease.identity,
      keychain: macRelease.keychain,
      // Electron Packager otherwise continues to notarization after a
      // codesign failure and hides the actionable signing error.
      continueOnError: false,
      // @electron/osx-sign enables hardened runtime by default and supplies
      // its Electron-compatible built-in entitlements.
    }
  : null;

// Electron Packager probes sibling .icon and .icns files for the same basename.
// Use the isolated ICNS copy on macOS so the archived Icon Composer source is
// never compiled into Assets.car for the compact default package.
const packagerIcon = process.platform === 'darwin'
  ? 'assets/legacy/mongog-icon'
  : process.platform === 'win32'
    ? 'assets/windows/mongog-icon'
    : 'assets/mongog-icon';
const extraResources = [
  process.platform === 'win32'
    ? 'assets/windows/mongog-icon.png'
    : 'assets/mongog-icon.png',
  // Packager copies extraResource before applying the app signature. The
  // updater reads this file during download even when setFeedURL is used.
  ...(['darwin', 'win32', 'linux'].includes(process.platform) ? ['build/app-update.yml'] : []),
  ...(process.platform === 'linux' ? ['build/package-type'] : []),
];

const config: ForgeConfig = {
  packagerConfig: {
    name: 'MongoG',
    executableName: 'MongoG',
    appBundleId: applicationId,
    appCategoryType: 'public.app-category.developer-tools',
    appCopyright: `Copyright © ${new Date().getFullYear()} Hamdis Project`,
    icon: packagerIcon,
    extraResource: extraResources,
    extendInfo: {
      LSMinimumSystemVersion: '12.0',
    },
    win32metadata: {
      CompanyName: 'Hamdis Project',
      FileDescription: 'MongoG MongoDB desktop IDE',
      ProductName: 'MongoG',
      InternalName: 'MongoG',
      OriginalFilename: 'MongoG.exe',
      'requested-execution-level': 'asInvoker',
    },
    ...(macRelease
      ? {
          osxSign: macSignOptions!,
          osxNotarize: {
            appleApiKey: macRelease.apiKeyPath,
            appleApiKeyId: macRelease.apiKeyId,
            appleApiIssuer: macRelease.apiIssuer,
          },
        }
      : {}),
    asar: {
      // utilityProcess.fork() must load a real file path: keep the query
      // runtime outside the asar archive (see src/main/runtime/paths.ts).
      unpack: '{**/runtime-dist/query-runtime.cjs,**/runtime-dist/query-runtime.cjs.map}',
    },
    // plugin-vite's default ignore keeps only /.vite. The main bundle keeps
    // native modules external, so production node_modules must also be copied
    // (Packager's prune step still removes devDependencies). The runtime
    // bundle is a separate real file for utilityProcess.fork().
    ignore: (file: string) => {
      if (!file) return false;
      if (file.startsWith('/node_modules/.vite') || file.startsWith('/node_modules/node-sql-parser')) {
        return true;
      }
      return !(
        file.startsWith('/.vite') ||
        file.startsWith('/runtime-dist') ||
        file.startsWith('/node_modules')
      );
    },
  },
  // npm rebuild (used to restore the host Node ABI for Vitest) leaves
  // electron-rebuild's .forge-meta marker behind. Without force, Forge trusts
  // that stale marker and can launch Electron with a Node-ABI native binary.
  rebuildConfig: { force: true },
  makers: [
    { name: '@electron-forge/maker-zip', platforms: ['darwin'], config: {} },
    {
      name: '@electron-forge/maker-dmg',
      platforms: ['darwin'],
      config: {
        format: 'ULFO',
        // electron-installer-dmg otherwise uses its bundled Electron icon for
        // the mounted volume even when the .app has a custom application icon.
        icon: path.resolve('assets/legacy/mongog-icon.icns'),
        // appdmg's legacy HFS+ path invokes `bless --openfolder` on Intel.
        // On hosted macOS runners Finder can race the subsequent detach and
        // unmount the temporary volume first. APFS skips that legacy step and
        // is supported by MongoG's macOS 12 minimum deployment target.
        additionalDMGOptions: { filesystem: 'APFS' },
        ...(macRelease
          ? {
              'code-sign': {
                'signing-identity': macRelease.identity,
                identifier: applicationId,
              },
            }
          : {}),
      },
    },
    {
      name: '@electron-forge/maker-rpm',
      platforms: ['linux'],
      config: {
        options: {
          name: 'mongog',
          productName: 'MongoG',
          genericName: 'MongoDB IDE',
          description: 'Production-grade MongoDB desktop IDE',
          productDescription: 'MongoG is a desktop IDE for querying, browsing, and administering MongoDB.',
          license: 'MIT',
          group: 'Development/Tools',
          homepage,
          bin: 'MongoG',
          icon: path.resolve('assets/mongog-icon.png'),
          categories: ['Development'],
        },
      },
    },
  ],
  plugins: [
    {
      name: '@electron-forge/plugin-vite',
      config: {
        build: [
          { entry: 'src/main/main.ts', config: 'vite.main.config.mts', target: 'main' },
          { entry: 'src/preload/preload.ts', config: 'vite.preload.config.mts', target: 'preload' },
        ],
        renderer: [{ name: 'main_window', config: 'vite.renderer.config.mts' }],
      },
    },
    { name: '@electron-forge/plugin-auto-unpack-natives', config: {} },
    {
      name: '@electron-forge/plugin-fuses',
      config: {
        version: FuseVersion.V1,
        // Flipping fuses mutates Electron's existing ad-hoc signature. Reset
        // the bundle signature before Packager applies the Developer ID
        // signature, otherwise codesign sees stale CodeResources metadata.
        resetAdHocDarwinSignature: true,
        // utilityProcess is the recommended replacement; child_process.fork
        // is intentionally not used anywhere in this codebase.
        [FuseV1Options.RunAsNode]: false,
        [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
        [FuseV1Options.EnableCookieEncryption]: true,
        [FuseV1Options.OnlyLoadAppFromAsar]: true,
        [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
        [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
        // ADR-13: keep inspect args ENABLED in spike/test builds so Playwright
        // _electron can attach. Flip to false for production release builds.
        [FuseV1Options.EnableNodeCliInspectArguments]: !isProductionRelease,
      },
    },
  ],
};

export default config;
