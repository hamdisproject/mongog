import { copyFileSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import {
  findSingleFile,
  packageMetadata,
  parseArguments,
  releaseAssetNames,
  requireTarget,
  rootDirectory,
  walkFiles,
} from './release-utils.mjs';

const args = parseArguments(process.argv.slice(2));
const platform = String(args.get('platform') ?? process.platform);
const arch = String(args.get('arch') ?? process.arch);
requireTarget(platform, arch);
const sourceDirectory = path.resolve(String(args.get('source') ?? path.join(rootDirectory, 'out', 'make')));
const outputDirectory = path.resolve(String(args.get('output') ?? path.join(rootDirectory, 'release-artifacts')));
const unsigned = args.get('unsigned') === true || args.get('unsigned') === 'true';
if (args.get('clean')) rmSync(outputDirectory, { recursive: true, force: true });
mkdirSync(outputDirectory, { recursive: true });

const files = walkFiles(sourceDirectory);
const destinationNames = releaseAssetNames(platform, arch, packageMetadata.version, { unsigned });
const sourceFiles = platform === 'darwin'
  ? [
      findSingleFile(files, (file) => file.endsWith('.dmg'), 'macOS DMG'),
      findSingleFile(files, (file) => file.endsWith('.zip'), 'macOS ZIP'),
    ]
  : platform === 'win32'
    ? [
        findSingleFile(
          files,
          (file) => /^MongoG-Setup-.*-win-x64\.exe$/iu.test(path.basename(file)),
          'Windows Setup executable',
        ),
      ]
    : [
        findSingleFile(files, (file) => file.endsWith('.rpm'), 'RPM package'),
      ];

for (let index = 0; index < sourceFiles.length; index += 1) {
  const destination = path.join(outputDirectory, destinationNames[index]);
  copyFileSync(sourceFiles[index], destination);
  console.log(`${sourceFiles[index]} -> ${destination}`);
}
