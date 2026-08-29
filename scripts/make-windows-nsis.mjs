import { rmSync } from 'node:fs';
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
// Unsigned Windows releases are manual-download only. Remove any stale updater
// configuration so this package can never opt into unauthenticated updates.
rmSync(path.join(packaged.resources, 'app-update.yml'), { force: true });

const builder = path.join(rootDirectory, 'node_modules', '.bin', 'electron-builder.cmd');
const command = `"${builder}" --win nsis --x64 --prepackaged "${packaged.directory}" --publish never`;
const builderEnvironment = {
  ...process.env,
  CSC_IDENTITY_AUTO_DISCOVERY: 'false',
};
for (const name of ['CSC_LINK', 'CSC_KEY_PASSWORD', 'WIN_CSC_LINK', 'WIN_CSC_KEY_PASSWORD']) {
  delete builderEnvironment[name];
}
const result = spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', command], {
  cwd: rootDirectory,
  stdio: 'inherit',
  env: builderEnvironment,
});
if (result.status !== 0) throw new Error(`electron-builder failed with exit code ${result.status ?? 'unknown'}.`);

console.log(`Built unsigned MongoG ${packageMetadata.version} NSIS installer (manual updates only).`);
