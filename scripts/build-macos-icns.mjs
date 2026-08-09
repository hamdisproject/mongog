import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildIcns, decodeRgbaPng, encodeArgb } from './macos-icon-utils.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const iconset = path.join(root, 'assets', 'mongog-icon.iconset');
const output = path.join(root, 'assets', 'mongog-icon.icns');
const legacyOutput = path.join(root, 'assets', 'legacy', 'mongog-icon.icns');

const representations = [
  ['ic04', 'icon_16x16.png', 16, true],
  ['ic05', 'icon_32x32.png', 32, true],
  ['ic11', 'icon_16x16@2x.png', 32, false],
  ['ic12', 'icon_32x32@2x.png', 64, false],
  ['ic07', 'icon_128x128.png', 128, false],
  ['ic08', 'icon_256x256.png', 256, false],
  ['ic13', 'icon_128x128@2x.png', 256, false],
  ['ic09', 'icon_512x512.png', 512, false],
  ['ic14', 'icon_256x256@2x.png', 512, false],
  ['ic10', 'icon_512x512@2x.png', 1024, false],
];

const entries = representations.map(([type, filename, expectedSize, legacyArgb]) => {
  const filePath = path.join(iconset, filename);
  const png = readFileSync(filePath);
  const image = decodeRgbaPng(png, filename);
  if (image.width !== expectedSize || image.height !== expectedSize) {
    throw new Error(`${filename} must be ${expectedSize}x${expectedSize}`);
  }
  return [type, legacyArgb ? encodeArgb(image) : png];
});

const result = buildIcns(entries);
const temporary = `${output}.part`;
writeFileSync(temporary, result);
renameSync(temporary, output);
mkdirSync(path.dirname(legacyOutput), { recursive: true });
copyFileSync(output, legacyOutput);
console.log('MongoG compact ICNS built from ten standard iconset representations.');
