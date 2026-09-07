import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { alphaBounds, decodeRgbaPng } from './macos-icon-utils.mjs';
import { buildIco, readIcoEntries, WINDOWS_ICON_SIZES } from './windows-icon-utils.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const windowsDirectory = path.join(root, 'assets', 'windows');
const iconset = path.join(windowsDirectory, 'mongog-icon.iconset');
const icoPath = path.join(windowsDirectory, 'mongog-icon.ico');

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function greenMarkBounds(image) {
  let left = image.width;
  let top = image.height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const offset = (y * image.width + x) * 4;
      const [red, green, blue, alpha] = image.pixels.subarray(offset, offset + 4);
      if (alpha < 64 || green < 80 || green <= red * 1.3 || green <= blue * 1.2) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  return right < left ? null : { left, top, right: right + 1, bottom: bottom + 1 };
}

function verifyOpticalBounds(image, label) {
  const bounds = alphaBounds(image, 16);
  invariant(bounds, `${label} has no visible pixels`);
  const widthRatio = (bounds.right - bounds.left) / image.width;
  const heightRatio = (bounds.bottom - bounds.top) / image.height;
  const minimum = image.width === 16 ? 0.875 : image.width === 20 ? 0.9 : 0.94;
  const maximum = 1;
  invariant(
    widthRatio >= minimum && widthRatio <= maximum,
    `${label} optical width ${(widthRatio * 100).toFixed(1)}% is outside ${minimum * 100}-${maximum * 100}%`,
  );
  invariant(
    heightRatio >= minimum && heightRatio <= maximum,
    `${label} optical height ${(heightRatio * 100).toFixed(1)}% is outside ${minimum * 100}-${maximum * 100}%`,
  );
  const rightMargin = image.width - bounds.right;
  const bottomMargin = image.height - bounds.bottom;
  invariant(Math.abs(bounds.left - rightMargin) <= 1, `${label} must be horizontally centered`);
  invariant(Math.abs(bounds.top - bottomMargin) <= 1, `${label} must be vertically centered`);

  const greenBounds = greenMarkBounds(image);
  invariant(greenBounds, `${label} has no visible green MongoG mark`);
  invariant(
    (greenBounds.right - greenBounds.left) / image.width >= 0.5,
    `${label} green MongoG mark is too narrow`,
  );
  invariant(
    (greenBounds.bottom - greenBounds.top) / image.height >= 0.54,
    `${label} green MongoG mark is too short`,
  );
}

invariant(statSync(iconset).isDirectory(), `${iconset} must be a directory`);
const expectedFiles = WINDOWS_ICON_SIZES.map((size) => `${size}x${size}.png`);
const actualFiles = readdirSync(iconset).sort((left, right) => left.localeCompare(right));
invariant(actualFiles.length === expectedFiles.length, `${iconset} must contain exactly nine PNG files`);
for (const file of actualFiles) invariant(expectedFiles.includes(file), `${iconset} contains unexpected file ${file}`);

const pngEntries = WINDOWS_ICON_SIZES.map((size) => {
  const filePath = path.join(iconset, `${size}x${size}.png`);
  invariant(actualFiles.includes(`${size}x${size}.png`), `${iconset} is missing ${size}x${size}.png`);
  const data = readFileSync(filePath);
  const image = decodeRgbaPng(data, filePath);
  invariant(image.width === size && image.height === size, `${filePath} must be ${size}x${size}`);
  verifyOpticalBounds(image, `${size}x${size}.png`);
  return { size, data };
});

const icoData = readFileSync(icoPath);
const icoEntries = readIcoEntries(icoData, icoPath);
invariant(icoEntries.length === WINDOWS_ICON_SIZES.length, `${icoPath} must contain nine entries`);
icoEntries.forEach((entry, index) => {
  const expectedSize = WINDOWS_ICON_SIZES[index];
  invariant(entry.width === expectedSize && entry.height === expectedSize, `ICO entry ${index} must be ${expectedSize}x${expectedSize}`);
  invariant(entry.colorCount === 0 && entry.reserved === 0, `ICO entry ${index} has invalid directory flags`);
  invariant(entry.planes === 1 && entry.bitCount === 32, `ICO entry ${index} must be 32-bit RGBA`);
  invariant(entry.data.equals(pngEntries[index].data), `ICO entry ${index} is out of sync with its PNG`);
  const image = decodeRgbaPng(entry.data, `ICO ${expectedSize}x${expectedSize}`);
  verifyOpticalBounds(image, `ICO ${expectedSize}x${expectedSize}`);
});
invariant(buildIco(pngEntries).equals(icoData), `${icoPath} must be deterministic`);

console.log('MongoG Windows icon verified: nine centered full-canvas RGBA PNG layers and deterministic ICO.');
