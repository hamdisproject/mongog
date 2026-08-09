import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { FuseV1Options, getCurrentFuseWire } from '@electron/fuses';
import { packagedApplication, parseArguments, requireTarget, walkFiles } from './release-utils.mjs';

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
requiredFile(path.join(application.resources, 'app.asar'), 'Application ASAR');
requiredFile(
  path.join(application.resources, 'app.asar.unpacked', 'runtime-dist', 'query-runtime.cjs'),
  'Unpacked query runtime',
);
const unpackedFiles = walkFiles(path.join(application.resources, 'app.asar.unpacked'));
if (!unpackedFiles.some((file) => /better[-_]sqlite3\.node$/u.test(file))) {
  throw new Error('Packaged better-sqlite3 native binary was not found in app.asar.unpacked.');
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
