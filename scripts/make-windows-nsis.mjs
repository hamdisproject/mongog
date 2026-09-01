import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { packageMetadata, parseArguments, packagedApplication, requireTarget, rootDirectory } from './release-utils.mjs';

const args = parseArguments(process.argv.slice(2));
const { platform, arch } = requireTarget(
  String(args.get('platform') ?? 'win32'),
  String(args.get('arch') ?? 'x64'),
);
if (process.platform !== 'win32' || platform !== 'win32' || arch !== 'x64') {
  throw new Error('The NSIS release installer must be built on Windows x64.');
}
if (process.env.MONGOG_RELEASE !== '1') {
  throw new Error('NSIS release creation requires MONGOG_RELEASE=1.');
}

const packaged = packagedApplication(platform, arch);

// Invoke electron-builder through the current Node runtime instead of its
// Windows .cmd shim. cmd.exe /s strips the outer quotes from paths under some
// CircleCI invocations, causing a quoted electron-builder.cmd path to be
// treated as part of the executable name.
const builder = path.join(rootDirectory, 'node_modules', 'electron-builder', 'cli.js');
const builderArguments = [
  builder,
  '--win',
  'nsis',
  '--x64',
  '--prepackaged',
  packaged.directory,
  '--publish',
  'never',
];
const builderEnvironment = {
  ...process.env,
  CSC_IDENTITY_AUTO_DISCOVERY: 'false',
};
for (const name of ['CSC_LINK', 'CSC_KEY_PASSWORD', 'WIN_CSC_LINK', 'WIN_CSC_KEY_PASSWORD']) {
  delete builderEnvironment[name];
}
const result = spawnSync(process.execPath, builderArguments, {
  cwd: rootDirectory,
  stdio: 'inherit',
  env: builderEnvironment,
  windowsHide: true,
});
if (result.error) throw result.error;
if (result.status !== 0) throw new Error(`electron-builder failed with exit code ${result.status ?? 'unknown'}.`);

console.log(`Built unsigned MongoG ${packageMetadata.version} NSIS installer with in-app updates enabled.`);
