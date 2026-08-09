import { FuseV1Options, FuseVersion } from '@electron/fuses';
import type { ForgeConfig } from '@electron-forge/shared-types';
import path from 'node:path';

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

const windowsRelease = isSignedRelease && process.platform === 'win32'
  ? {
      certificateFile: requiredEnvironment('WINDOWS_CERTIFICATE_FILE'),
      certificatePassword: requiredEnvironment('WINDOWS_CERTIFICATE_PASSWORD'),
    }
  : null;

// Electron Packager probes sibling .icon and .icns files for the same basename.
// Use the isolated ICNS copy on macOS so the archived Icon Composer source is
// never compiled into Assets.car for the compact default package.
const packagerIcon = process.platform === 'darwin'
  ? 'assets/legacy/mongog-icon'
  : 'assets/mongog-icon';

const config: ForgeConfig = {
  packagerConfig: {
    name: 'MongoG',
    executableName: 'MongoG',
    appBundleId: applicationId,
    appCategoryType: 'public.app-category.developer-tools',
    appCopyright: `Copyright © ${new Date().getFullYear()} Hamdis Project`,
    icon: packagerIcon,
    extraResource: ['assets/mongog-icon.png'],
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
          osxSign: {
            identity: macRelease.identity,
            keychain: macRelease.keychain,
            // @electron/osx-sign enables hardened runtime by default and
            // supplies its Electron-compatible built-in entitlements.
          },
          osxNotarize: {
            appleApiKey: macRelease.apiKeyPath,
            appleApiKeyId: macRelease.apiKeyId,
            appleApiIssuer: macRelease.apiIssuer,
          },
        }
      : {}),
    ...(windowsRelease
      ? {
          windowsSign: {
            certificateFile: windowsRelease.certificateFile,
            certificatePassword: windowsRelease.certificatePassword,
            description: 'MongoG MongoDB desktop IDE',
            website: homepage,
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
      return !(
        file.startsWith('/.vite') ||
        file.startsWith('/runtime-dist') ||
        file.startsWith('/node_modules')
      );
    },
  },
  rebuildConfig: {},
  makers: [
    { name: '@electron-forge/maker-zip', platforms: ['darwin', 'linux', 'win32'], config: {} },
    {
      name: '@electron-forge/maker-dmg',
      platforms: ['darwin'],
      config: {
        format: 'ULFO',
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
      name: '@electron-forge/maker-squirrel',
      platforms: ['win32'],
      config: {
        name: 'MongoG',
        authors: 'Hamdis Project',
        description: 'MongoG - production-grade MongoDB desktop IDE',
        setupIcon: path.resolve('assets/mongog-icon.ico'),
        ...(windowsRelease
          ? {
              windowsSign: {
                certificateFile: windowsRelease.certificateFile,
                certificatePassword: windowsRelease.certificatePassword,
                description: 'MongoG MongoDB desktop IDE',
                website: homepage,
              },
            }
          : {}),
      },
    },
    {
      name: '@electron-forge/maker-deb',
      platforms: ['linux'],
      config: {
        options: {
          name: 'mongog',
          productName: 'MongoG',
          genericName: 'MongoDB IDE',
          description: 'Production-grade MongoDB desktop IDE',
          productDescription: 'MongoG is a desktop IDE for querying, browsing, and administering MongoDB.',
          section: 'database',
          priority: 'optional',
          maintainer: 'Hamdis Project <hamditugmobil@gmail.com>',
          homepage,
          bin: 'MongoG',
          icon: path.resolve('assets/mongog-icon.png'),
          categories: ['Development'],
        },
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
