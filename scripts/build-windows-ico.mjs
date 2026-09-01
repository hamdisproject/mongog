import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeRgbaPng } from './macos-icon-utils.mjs';
import {
  buildIco,
  encodeRgbaPng,
  resizeRgbaImage,
  WINDOWS_ICON_SIZES,
} from './windows-icon-utils.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const macIconset = path.join(root, 'assets', 'mongog-icon.iconset');
const windowsDirectory = path.join(root, 'assets', 'windows');
const windowsIconset = path.join(windowsDirectory, 'mongog-icon.iconset');
const output = path.join(windowsDirectory, 'mongog-icon.ico');
const runtimeOutput = path.join(windowsDirectory, 'mongog-icon.png');

// The macOS iconset already contains hand-tuned representations at these
// tiers. Intermediate Windows DPI sizes are derived from the next matching
// tier instead of shrinking the 1024px master directly.
const sourceBySize = new Map([
  [16, 'icon_16x16.png'],
  [20, 'icon_32x32.png'],
  [24, 'icon_32x32.png'],
  [32, 'icon_32x32.png'],
  [40, 'icon_32x32@2x.png'],
  [48, 'icon_32x32@2x.png'],
  [64, 'icon_32x32@2x.png'],
  [128, 'icon_128x128.png'],
  [256, 'icon_128x128@2x.png'],
]);

function writeAtomically(filePath, data) {
  const temporary = `${filePath}.part`;
  writeFileSync(temporary, data);
  renameSync(temporary, filePath);
}

mkdirSync(windowsIconset, { recursive: true });
const entries = WINDOWS_ICON_SIZES.map((size) => {
  const sourceName = sourceBySize.get(size);
  if (!sourceName) throw new Error(`No source representation configured for ${size}x${size}`);
  const sourcePath = path.join(macIconset, sourceName);
  const sourceData = readFileSync(sourcePath);
  const source = decodeRgbaPng(sourceData, sourcePath);
  const image = resizeRgbaImage(source, size);
  const data = size === source.width ? sourceData : encodeRgbaPng(image);
  writeAtomically(path.join(windowsIconset, `${size}x${size}.png`), data);
  return { size, data };
});

writeAtomically(output, buildIco(entries));
writeAtomically(runtimeOutput, entries.find(({ size }) => size === 256).data);
console.log('MongoG Windows ICO built from nine DPI-specific PNG representations.');
