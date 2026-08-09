import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const iconPackage = path.join(root, 'assets', 'mongog-icon.icon');
const manifestPath = path.join(iconPackage, 'icon.json');
const packageAssets = path.join(iconPackage, 'Assets');
const fallbackIcns = path.join(root, 'assets', 'mongog-icon.icns');
const legacyIcns = path.join(root, 'assets', 'legacy', 'mongog-icon.icns');
const fallbackMaster = path.join(root, 'assets', 'mongog-icon-macos.png');

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function readPngHeader(filePath) {
  const data = readFileSync(filePath);
  invariant(
    data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
    `${filePath} is not a PNG`,
  );
  invariant(data.subarray(12, 16).toString('ascii') === 'IHDR', `${filePath} has no IHDR`);
  return {
    width: data.readUInt32BE(16),
    height: data.readUInt32BE(20),
    bitDepth: data[24],
    colorType: data[25],
  };
}

function verifyPng(filePath, { alpha = false } = {}) {
  const header = readPngHeader(filePath);
  invariant(header.width === 1024 && header.height === 1024, `${filePath} must be 1024x1024`);
  invariant(header.bitDepth === 8, `${filePath} must use 8-bit channels`);
  if (alpha) {
    invariant(
      header.colorType === 4 || header.colorType === 6,
      `${filePath} must contain an alpha channel`,
    );
  }
  if (process.platform === 'darwin') {
    const info = execFileSync('sips', ['-g', 'profile', '-g', 'hasAlpha', filePath], {
      encoding: 'utf8',
    });
    invariant(/profile:\s+.*sRGB/i.test(info), `${filePath} must be tagged as sRGB`);
    if (alpha) invariant(/hasAlpha:\s+yes/i.test(info), `${filePath} must report alpha`);
  }
}

function verifyIconPackage() {
  invariant(statSync(iconPackage).isDirectory(), `${iconPackage} must be a package directory`);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  invariant(manifest['supported-platforms']?.squares === 'shared', 'Square platforms must be shared');
  invariant(Array.isArray(manifest.groups) && manifest.groups.length === 3, 'Expected three icon groups');
  invariant(
    manifest['fill-specializations']?.some((entry) => entry.appearance === 'dark'),
    'Dark background specialization is missing',
  );

  const referencedAssets = new Set();
  for (const [groupIndex, group] of manifest.groups.entries()) {
    invariant(group.layers?.length === 1, `Group ${groupIndex + 1} must contain one aligned layer`);
    const layer = group.layers[0];
    if (layer['image-name']) referencedAssets.add(layer['image-name']);
    const variants = layer['image-name-specializations'];
    invariant(Array.isArray(variants) && variants.length === 3, `${layer.name} needs Default, Dark and Mono assets`);
    invariant(variants.some((entry) => !entry.appearance), `${layer.name} is missing its Default asset`);
    invariant(variants.some((entry) => entry.appearance === 'dark'), `${layer.name} is missing its Dark asset`);
    invariant(variants.some((entry) => entry.appearance === 'tinted'), `${layer.name} is missing its Mono asset`);
    for (const entry of variants) referencedAssets.add(entry.value);
  }

  invariant(manifest.groups[0].layers[0].glass === true, 'Database group must use Liquid Glass');
  invariant(manifest.groups[1].layers[0].glass === true, 'Badge group must use Liquid Glass');
  invariant(manifest.groups[2].layers[0].glass === false, 'Glyph group must remain crisp');

  const actualAssets = new Set(readdirSync(packageAssets));
  for (const asset of referencedAssets) {
    invariant(actualAssets.has(asset), `Missing Icon Composer asset: ${asset}`);
    verifyPng(path.join(packageAssets, asset), { alpha: true });
  }
  for (const asset of actualAssets) {
    invariant(referencedAssets.has(asset), `Unreferenced Icon Composer asset: ${asset}`);
  }
}

function readIcnsTypes(filePath) {
  const data = readFileSync(filePath);
  invariant(data.subarray(0, 4).toString('ascii') === 'icns', `${filePath} is not ICNS`);
  invariant(data.readUInt32BE(4) === data.length, `${filePath} has an invalid container length`);
  const types = new Set();
  for (let offset = 8; offset + 8 <= data.length;) {
    const type = data.subarray(offset, offset + 4).toString('ascii');
    const size = data.readUInt32BE(offset + 4);
    invariant(size >= 8 && offset + size <= data.length, `${filePath} contains an invalid ${type} chunk`);
    types.add(type);
    offset += size;
  }
  return types;
}

function verifyIcns() {
  const expectedTypes = ['ic04', 'ic05', 'ic11', 'ic12', 'ic07', 'ic08', 'ic13', 'ic09', 'ic14', 'ic10'];
  const types = readIcnsTypes(fallbackIcns);
  for (const type of expectedTypes) invariant(types.has(type), `Fallback ICNS is missing ${type}`);
  invariant(readFileSync(fallbackIcns).equals(readFileSync(legacyIcns)), 'Legacy ICNS copy is out of sync');
  verifyPng(fallbackMaster, { alpha: true });

  if (process.platform !== 'darwin') return;
  const scratch = mkdtempSync(path.join(tmpdir(), 'mongog-icon-'));
  try {
    const output = path.join(scratch, 'MongoG.iconset');
    execFileSync('iconutil', ['-c', 'iconset', fallbackIcns, '-o', output]);
    const files = new Set(readdirSync(output));
    for (const filename of [
      'icon_16x16.png',
      'icon_16x16@2x.png',
      'icon_32x32.png',
      'icon_32x32@2x.png',
      'icon_128x128.png',
      'icon_256x256.png',
      'icon_512x512@2x.png',
    ]) {
      invariant(files.has(filename), `iconutil did not expose ${filename}`);
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

function findIcTool() {
  return [
    '/Applications/Icon Composer.app/Contents/Executables/ictool',
    '/Applications/Xcode.app/Contents/Applications/Icon Composer.app/Contents/Executables/ictool',
  ].find(existsSync);
}

function verifyAdaptiveRenditions() {
  if (process.platform !== 'darwin' || process.env.MONGOG_SKIP_ICTOOL === '1') return;
  const ictool = findIcTool();
  invariant(ictool, 'Icon Composer/ictool is required for the adaptive macOS icon build');
  const scratch = mkdtempSync(path.join(tmpdir(), 'mongog-renditions-'));
  try {
    for (const rendition of ['Default', 'Dark', 'ClearLight', 'ClearDark', 'TintedLight', 'TintedDark']) {
      const output = path.join(scratch, `${rendition}.png`);
      const args = [
        iconPackage,
        '--export-image',
        '--output-file', output,
        '--platform', 'macOS',
        '--rendition', rendition,
        '--width', '1024',
        '--height', '1024',
        '--scale', '1',
      ];
      if (rendition.startsWith('Tinted')) {
        args.push('--tint-color', '0.33', '--tint-strength', '0.72');
      }
      execFileSync(ictool, args, { stdio: 'pipe' });
      const header = readPngHeader(output);
      invariant(header.width === 1024 && header.height === 1024, `${rendition} rendition has the wrong size`);
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

verifyIconPackage();
verifyIcns();
verifyAdaptiveRenditions();
console.log('MongoG macOS icons verified: layered .icon, six adaptive renditions, and legacy .icns.');
