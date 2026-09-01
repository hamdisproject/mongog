import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { alphaBounds, decodeRgbaPng } from './macos-icon-utils.mjs';
import { buildIco, readIcoEntries, WINDOWS_ICON_SIZES } from './windows-icon-utils.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const windowsDirectory = path.join(root, 'assets', 'windows');
const iconset = path.join(windowsDirectory, 'mongog-icon.iconset');
const icoPath = path.join(windowsDirectory, 'mongog-icon.ico');
const runtimeIconPath = path.join(windowsDirectory, 'mongog-icon.png');

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function verifyOpticalBounds(image, label) {
  const bounds = alphaBounds(image, 16);
  invariant(bounds, `${label} has no visible pixels`);
  const widthRatio = (bounds.right - bounds.left) / image.width;
  const heightRatio = (bounds.bottom - bounds.top) / image.height;
  const minimum = image.width === 16 ? 0.75 : 0.78;
  const maximum = image.width === 16 ? 0.88 : 0.85;
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
invariant(
  readFileSync(runtimeIconPath).equals(pngEntries.find(({ size }) => size === 256).data),
  `${runtimeIconPath} must match the 256x256 Windows layer`,
);

console.log('MongoG Windows icon verified: nine centered RGBA PNG layers and deterministic ICO.');
