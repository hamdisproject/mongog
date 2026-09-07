import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { extractFile, listPackage } from '@electron/asar';
import { FuseV1Options, getCurrentFuseWire } from '@electron/fuses';
import { parseUpdateConfig } from '../src/shared/update-config.mjs';
import {
  packageMetadata,
  packagedApplication,
  parseArguments,
  requireTarget,
  walkFiles,
} from './release-utils.mjs';

const args = parseArguments(process.argv.slice(2));
const platform = String(args.get('platform') ?? process.platform);
const arch = String(args.get('arch') ?? process.arch);
requireTarget(platform, arch);
const release = args.get('release') === true || args.get('release') === 'true' || process.env.MONGOG_RELEASE === '1';
const application = packagedApplication(platform, arch);
const fuseDisabled = '0'.charCodeAt(0);
const fuseEnabled = '1'.charCodeAt(0);

function requiredFile(file, description) {
  if (!existsSync(file) || !statSync(file).isFile() || statSync(file).size === 0) {
    throw new Error(`${description} is missing or empty: ${file}`);
  }
}

requiredFile(application.executable, 'Packaged executable');
const asarPath = path.join(application.resources, 'app.asar');
requiredFile(asarPath, 'Application ASAR');
const packagedMetadata = JSON.parse(extractFile(asarPath, 'package.json').toString('utf8'));
if (packagedMetadata.version !== packageMetadata.version) {
  throw new Error(
    `Packaged version ${String(packagedMetadata.version)} does not match package.json ${packageMetadata.version}.`,
  );
}
const asarFiles = listPackage(asarPath);
for (const forbidden of ['/node_modules/node-sql-parser', '/node_modules/.vite']) {
  if (asarFiles.some((file) => file === forbidden || file.startsWith(`${forbidden}/`))) {
    throw new Error(`Build-only SQL/parser dependency leaked into the packaged ASAR: ${forbidden}`);
  }
}
requiredFile(
  path.join(application.resources, 'app.asar.unpacked', 'runtime-dist', 'query-runtime.cjs'),
  'Unpacked query runtime',
);
const unpackedFiles = walkFiles(path.join(application.resources, 'app.asar.unpacked'));
if (!unpackedFiles.some((file) => /better[-_]sqlite3\.node$/u.test(file))) {
  throw new Error('Packaged better-sqlite3 native binary was not found in app.asar.unpacked.');
}

const updateConfig = path.join(application.resources, 'app-update.yml');
if (platform === 'darwin' || platform === 'linux' || platform === 'win32') {
  requiredFile(updateConfig, 'Packaged updater configuration');
  parseUpdateConfig(readFileSync(updateConfig, 'utf8'));
}
if (platform === 'win32') {
  const packagedIcon = path.join(application.resources, 'mongog-icon.ico');
  requiredFile(packagedIcon, 'Packaged Windows runtime icon');
  const sourceIcon = path.resolve('assets', 'windows', 'mongog-icon.ico');
  if (!readFileSync(packagedIcon).equals(readFileSync(sourceIcon))) {
    throw new Error('Packaged Windows runtime icon is out of sync with the generated Windows icon.');
  }
}
if (platform === 'darwin') {
  const packagedIcon = path.join(application.bundle, 'Contents', 'Resources', 'electron.icns');
  requiredFile(packagedIcon, 'Packaged macOS application icon');
  const sourceIcon = path.resolve('assets', 'legacy', 'mongog-icon.icns');
  if (!readFileSync(packagedIcon).equals(readFileSync(sourceIcon))) {
    throw new Error('Packaged macOS application icon is out of sync with the generated MongoG icon.');
  }
}
if (release && platform === 'linux') {
  const packageType = path.join(application.resources, 'package-type');
  requiredFile(packageType, 'Linux updater package marker');
  if (readFileSync(packageType, 'utf8').trim() !== 'rpm') {
    throw new Error('Official Linux releases must use the RPM updater package marker.');
  }
}

const fuses = await getCurrentFuseWire(application.executable);
function expectFuse(option, state, description) {
  if (fuses[option] !== state) {
    throw new Error(`${description} has state ${String(fuses[option])}; expected ${state}.`);
  }
}
expectFuse(FuseV1Options.RunAsNode, fuseDisabled, 'RunAsNode fuse');
expectFuse(FuseV1Options.EnableNodeOptionsEnvironmentVariable, fuseDisabled, 'Node options fuse');
expectFuse(FuseV1Options.OnlyLoadAppFromAsar, fuseEnabled, 'OnlyLoadAppFromAsar fuse');
expectFuse(FuseV1Options.EnableEmbeddedAsarIntegrityValidation, fuseEnabled, 'ASAR integrity fuse');
expectFuse(
  FuseV1Options.EnableNodeCliInspectArguments,
  release ? fuseDisabled : fuseEnabled,
  'Node CLI inspect fuse',
);

console.log(`Verified ${platform}:${arch} ${release ? 'production release' : 'test'} package at ${application.bundle}.`);
