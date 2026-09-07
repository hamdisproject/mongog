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
const masterPath = path.join(root, 'assets', 'icon-composer', 'fallback-source-default.png');
const windowsDirectory = path.join(root, 'assets', 'windows');
const windowsIconset = path.join(windowsDirectory, 'mongog-icon.iconset');
const output = path.join(windowsDirectory, 'mongog-icon.ico');

// Windows supplies its own taskbar padding, so use the full-canvas composite
// instead of inheriting the compact 80.5% macOS optical envelope. Build a
// descending pyramid so every small representation is resized from a nearby
// larger tier and remains crisp without repeatedly sampling the 1024px master.
const pyramid = [
  [256, null],
  [128, 256],
  [64, 128],
  [48, 64],
  [40, 64],
  [32, 64],
  [24, 32],
  [20, 32],
  [16, 32],
];

function writeAtomically(filePath, data) {
  const temporary = `${filePath}.part`;
  writeFileSync(temporary, data);
  renameSync(temporary, filePath);
}

mkdirSync(windowsIconset, { recursive: true });
const master = decodeRgbaPng(readFileSync(masterPath), masterPath);
if (master.width !== 1024 || master.height !== 1024) {
  throw new Error(`${masterPath} must be a 1024x1024 RGBA PNG`);
}

const images = new Map();
for (const [size, sourceSize] of pyramid) {
  const source = sourceSize === null ? master : images.get(sourceSize);
  if (!source) throw new Error(`No Windows icon source configured for ${size}x${size}`);
  images.set(size, resizeRgbaImage(source, size));
}

const entries = WINDOWS_ICON_SIZES.map((size) => {
  const image = images.get(size);
  if (!image) throw new Error(`No Windows icon representation generated for ${size}x${size}`);
  const data = encodeRgbaPng(image);
  writeAtomically(path.join(windowsIconset, `${size}x${size}.png`), data);
  return { size, data };
});

writeAtomically(output, buildIco(entries));
console.log('MongoG full-canvas Windows ICO built from nine DPI-specific PNG representations.');
