import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const packageMetadata = JSON.parse(
  await import('node:fs/promises').then(({ readFile }) => readFile(path.join(rootDirectory, 'package.json'), 'utf8')),
);

export const supportedTargets = new Set([
  'darwin:arm64',
  'darwin:x64',
  'win32:x64',
  'linux:x64',
]);

export function parseArguments(argv) {
  const values = new Map();
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument?.startsWith('--')) {
      positional.push(argument);
      continue;
    }
    const name = argument.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      values.set(name, true);
      continue;
    }
    values.set(name, next);
    index += 1;
  }
  // npm on Windows consumes its own --platform/--arch config switches even
  // after `npm run ... --`, leaving only their values for the child script.
  // All release tools share the same optional target pair, so accept exactly
  // that transformed form while continuing to reject arbitrary positionals.
  if (positional.length > 0) {
    if (positional.length > 2 || values.has('platform') || values.has('arch')) {
      throw new Error(`Unexpected positional arguments: ${positional.join(' ')}`);
    }
    values.set('platform', positional[0]);
    if (positional[1]) values.set('arch', positional[1]);
  }
  return values;
}

export function requireTarget(platform, arch) {
  const key = `${platform}:${arch}`;
  if (!supportedTargets.has(key)) throw new Error(`Unsupported release target: ${key}`);
  return { platform, arch };
}

export function packagedApplication(platform, arch, root = rootDirectory) {
  requireTarget(platform, arch);
  const directory = path.join(root, 'out', `MongoG-${platform}-${arch}`);
  if (platform === 'darwin') {
    return {
      directory,
      executable: path.join(directory, 'MongoG.app', 'Contents', 'MacOS', 'MongoG'),
      resources: path.join(directory, 'MongoG.app', 'Contents', 'Resources'),
      bundle: path.join(directory, 'MongoG.app'),
    };
  }
  const executableCandidates = platform === 'win32'
    ? ['MongoG.exe', 'mongog.exe']
    : ['mongog', 'MongoG'];
  const executable = executableCandidates
    .map((name) => path.join(directory, name))
    .find(existsSync) ?? path.join(directory, executableCandidates[0]);
  return {
    directory,
    executable,
    resources: path.join(directory, 'resources'),
    bundle: directory,
  };
}

export function walkFiles(directory) {
  if (!existsSync(directory)) return [];
  const result = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...walkFiles(absolute));
    else if (entry.isFile()) result.push(absolute);
  }
  return result;
}

export function releaseAssetNames(platform, arch, version = packageMetadata.version, options = {}) {
  requireTarget(platform, arch);
  const unsigned = options.unsigned === true;
  const marker = unsigned ? '-UNSIGNED' : '';
  if (platform === 'darwin') {
    return [`MongoG-${version}${marker}-macOS-${arch}.dmg`, `MongoG-${version}${marker}-macOS-${arch}.zip`];
  }
  if (platform === 'win32') {
    return [`MongoG-Setup-${version}${marker}-win-${arch}.exe`, `MongoG-${version}${marker}-win-${arch}.zip`];
  }
  return [
    `mongog_${version}${marker}_amd64.deb`,
    `mongog-${version}${marker}-1.x86_64.rpm`,
    `MongoG-${version}${marker}-linux-${arch}.zip`,
  ];
}

export function expectedReleaseAssetNames(version = packageMetadata.version, options = {}) {
  const unsigned = options.unsigned === true;
  const macosUnsigned = options.macosUnsigned ?? unsigned;
  return [
    ...releaseAssetNames('darwin', 'arm64', version, { unsigned: macosUnsigned }),
    ...releaseAssetNames('darwin', 'x64', version, { unsigned: macosUnsigned }),
    ...releaseAssetNames('win32', 'x64', version, options),
    ...releaseAssetNames('linux', 'x64', version, options),
  ].sort((left, right) => left.localeCompare(right));
}

export function findSingleFile(files, predicate, description) {
  const matches = files.filter(predicate);
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one ${description}; found ${matches.length}.\n${matches.join('\n')}`);
  }
  if (statSync(matches[0]).size === 0) throw new Error(`${description} is empty: ${matches[0]}`);
  return matches[0];
}

export function releaseTagVersion(tag) {
  if (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(tag)) {
    throw new Error(`Release tag must use vX.Y.Z syntax: ${tag || '<empty>'}`);
  }
  return tag.slice(1);
}

export function isRecoverableDmgDetachFailure(output) {
  return output.includes('hdiutil detach') && output.includes('No such file or directory');
}
