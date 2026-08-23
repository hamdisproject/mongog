import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  expectedReleaseAssetNames,
  packageMetadata,
  parseArguments,
  releaseTagVersion,
  rootDirectory,
} from './release-utils.mjs';

const args = parseArguments(process.argv.slice(2));
const directory = path.resolve(String(args.get('directory') ?? path.join(rootDirectory, 'release-artifacts')));
const tag = String(args.get('tag') ?? process.env.RELEASE_TAG ?? `v${packageMetadata.version}`);
const version = releaseTagVersion(tag);
const unsigned = args.get('unsigned') === true || args.get('unsigned') === 'true';
const signedMacos = args.get('signed-macos') === true || args.get('signed-macos') === 'true';
if (version !== packageMetadata.version) throw new Error(`${tag} does not match package.json ${packageMetadata.version}.`);
if (!existsSync(directory)) throw new Error(`Release artifact directory does not exist: ${directory}`);

const expected = expectedReleaseAssetNames(version, {
  unsigned,
  ...(signedMacos ? { macosUnsigned: false } : {}),
});
const actual = readdirSync(directory)
  .filter((name) => name !== 'SHA256SUMS.txt')
  .sort((left, right) => left.localeCompare(right));
if (JSON.stringify(actual) !== JSON.stringify(expected)) {
  throw new Error(`Release artifact set is incomplete.\nExpected:\n${expected.join('\n')}\nActual:\n${actual.join('\n')}`);
}

async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

const checksumLines = [];
for (const name of expected) {
  const file = path.join(directory, name);
  if (!statSync(file).isFile() || statSync(file).size === 0) throw new Error(`Release artifact is empty: ${name}`);
  checksumLines.push(`${await sha256(file)}  ${name}`);
}
writeFileSync(path.join(directory, 'SHA256SUMS.txt'), `${checksumLines.join('\n')}\n`, 'utf8');
console.log(`Verified ${expected.length} release artifacts and wrote SHA256SUMS.txt.`);
