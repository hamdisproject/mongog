import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  packageMetadata,
  parseArguments,
  releaseAssetNames,
  releaseTagVersion,
  rootDirectory,
} from './release-utils.mjs';

const UPDATE_MANIFESTS = {
  darwin: 'latest-mac.yml',
  win32: 'latest.yml',
  linux: 'latest-linux.yml',
};

async function fileMetadata(file) {
  const hash = createHash('sha512');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return {
    sha512: hash.digest('base64'),
    size: (await stat(file)).size,
  };
}

async function updateFile(directory, name) {
  const file = path.join(directory, name);
  const metadata = await fileMetadata(file);
  if (metadata.size === 0) throw new Error(`Update artifact is empty: ${name}`);
  return { name, ...metadata };
}

function manifestYaml(version, files) {
  if (files.length === 0) throw new Error('An update manifest requires at least one file.');
  const primary = files[0];
  return [
    `version: ${JSON.stringify(version)}`,
    'files:',
    ...files.flatMap((file) => [
      `  - url: ${JSON.stringify(file.name)}`,
      `    sha512: ${JSON.stringify(file.sha512)}`,
      `    size: ${file.size}`,
    ]),
    `path: ${JSON.stringify(primary.name)}`,
    `sha512: ${JSON.stringify(primary.sha512)}`,
    '',
  ].join('\n');
}

export async function generateUpdateManifests(directory, version = packageMetadata.version) {
  const macArm = releaseAssetNames('darwin', 'arm64', version)[1];
  const macX64 = releaseAssetNames('darwin', 'x64', version)[1];
  const windows = releaseAssetNames('win32', 'x64', version, { unsigned: true })[0];
  const linux = releaseAssetNames('linux', 'x64', version)[0];

  const manifests = [
    {
      name: UPDATE_MANIFESTS.darwin,
      files: await Promise.all([
        updateFile(directory, macArm),
        updateFile(directory, macX64),
      ]),
    },
    {
      name: UPDATE_MANIFESTS.win32,
      files: [await updateFile(directory, windows)],
    },
    {
      name: UPDATE_MANIFESTS.linux,
      files: [await updateFile(directory, linux)],
    },
  ];

  for (const manifest of manifests) {
    await writeFile(
      path.join(directory, manifest.name),
      manifestYaml(version, manifest.files),
      'utf8',
    );
  }
  return manifests.map((manifest) => manifest.name);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  const args = parseArguments(process.argv.slice(2));
  const directory = path.resolve(String(
    args.get('directory') ?? path.join(rootDirectory, 'release-artifacts'),
  ));
  const tag = String(args.get('tag') ?? process.env.RELEASE_TAG ?? `v${packageMetadata.version}`);
  const version = releaseTagVersion(tag);
  if (version !== packageMetadata.version) {
    throw new Error(`${tag} does not match package.json ${packageMetadata.version}.`);
  }
  const names = await generateUpdateManifests(directory, version);
  console.log(`Generated updater manifests: ${names.join(', ')}`);
}
