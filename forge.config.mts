import { FuseV1Options, FuseVersion } from '@electron/fuses';
import type { ForgeConfig } from '@electron-forge/shared-types';

const config: ForgeConfig = {
  packagerConfig: {
    name: 'MongoG',
    executableName: 'MongoG',
    appBundleId: 'com.mongog.desktop',
    icon: 'assets/mongog-icon',
    extraResource: ['assets/mongog-icon.png', 'assets/mongog-icon-macos.png'],
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
    { name: '@electron-forge/maker-dmg', platforms: ['darwin'], config: { format: 'ULFO' } },
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
        [FuseV1Options.EnableNodeCliInspectArguments]: true,
      },
    },
  ],
};

export default config;
