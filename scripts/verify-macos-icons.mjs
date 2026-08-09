import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { alphaBounds, decodeRgbaPng, readIcnsTypes } from './macos-icon-utils.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const iconset = path.join(root, 'assets', 'mongog-icon.iconset');
const fallbackIcns = path.join(root, 'assets', 'mongog-icon.icns');
const legacyIcns = path.join(root, 'assets', 'legacy', 'mongog-icon.icns');
const fallbackMaster = path.join(root, 'assets', 'mongog-icon-macos.png');

const representations = new Map([
  ['icon_16x16.png', 16],
  ['icon_16x16@2x.png', 32],
  ['icon_32x32.png', 32],
  ['icon_32x32@2x.png', 64],
  ['icon_128x128.png', 128],
  ['icon_128x128@2x.png', 256],
  ['icon_256x256.png', 256],
  ['icon_256x256@2x.png', 512],
  ['icon_512x512.png', 512],
  ['icon_512x512@2x.png', 1024],
]);

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function verifyPng(filePath, expectedSize, { requireSrgb = true } = {}) {
  const image = decodeRgbaPng(readFileSync(filePath), filePath);
  invariant(
    image.width === expectedSize && image.height === expectedSize,
    `${filePath} must be ${expectedSize}x${expectedSize}`,
  );
  if (requireSrgb && process.platform === 'darwin') {
    const info = execFileSync('sips', ['-g', 'profile', '-g', 'hasAlpha', filePath], {
      encoding: 'utf8',
    });
    invariant(/profile:\s+.*sRGB/i.test(info), `${filePath} must be tagged as sRGB`);
    invariant(/hasAlpha:\s+yes/i.test(info), `${filePath} must report alpha`);
  }
  return image;
}

function verifyOpticalBounds(image, label) {
  const bounds = alphaBounds(image, 16);
  invariant(bounds, `${label} has no visible pixels`);
  const widthRatio = (bounds.right - bounds.left) / image.width;
  const heightRatio = (bounds.bottom - bounds.top) / image.height;
  const minimum = image.width === 16 ? 0.75 : 0.78;
  const maximum = image.width === 16 ? 0.88 : 0.83;
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

function verifyMasterAndIconset() {
  invariant(statSync(iconset).isDirectory(), `${iconset} must be a directory`);
  const actual = new Set(readdirSync(iconset));
  invariant(actual.size === representations.size, `${iconset} must contain exactly ten PNG files`);
  for (const [filename, size] of representations) {
    invariant(actual.has(filename), `${iconset} is missing ${filename}`);
    const image = verifyPng(path.join(iconset, filename), size);
    verifyOpticalBounds(image, filename);
  }
  for (const filename of actual) {
    invariant(representations.has(filename), `${iconset} contains unexpected file ${filename}`);
  }

  const master = verifyPng(fallbackMaster, 1024);
  const bounds = alphaBounds(master, 16);
  invariant(
    bounds?.left === 100 && bounds.top === 100 && bounds.right === 924 && bounds.bottom === 924,
    `${fallbackMaster} must use the exact (100, 100)-(924, 924) optical bounds`,
  );
}

function verifyIcns() {
  const expectedTypes = ['TOC ', 'ic04', 'ic05', 'ic11', 'ic12', 'ic07', 'ic08', 'ic13', 'ic09', 'ic14', 'ic10'];
  const types = readIcnsTypes(readFileSync(fallbackIcns), fallbackIcns);
  for (const type of expectedTypes) invariant(types.has(type), `Compact ICNS is missing ${type}`);
  invariant(readFileSync(fallbackIcns).equals(readFileSync(legacyIcns)), 'Legacy ICNS copy is out of sync');

  if (process.platform !== 'darwin') return;
  const scratch = mkdtempSync(path.join(tmpdir(), 'mongog-icon-'));
  try {
    const output = path.join(scratch, 'MongoG.iconset');
    execFileSync('iconutil', ['-c', 'iconset', fallbackIcns, '-o', output]);
    const files = new Set(readdirSync(output));
    for (const [filename, size] of representations) {
      invariant(files.has(filename), `iconutil did not expose ${filename}`);
      const image = verifyPng(path.join(output, filename), size, { requireSrgb: false });
      verifyOpticalBounds(image, `ICNS ${filename}`);
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

verifyMasterAndIconset();
verifyIcns();
console.log('MongoG macOS icon verified: compact 1024 master, ten standard iconset images, and ICNS.');
