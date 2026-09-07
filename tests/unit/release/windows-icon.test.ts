import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { alphaBounds, decodeRgbaPng } from '../../../scripts/macos-icon-utils.mjs';
import { buildIco, readIcoEntries, WINDOWS_ICON_SIZES } from '../../../scripts/windows-icon-utils.mjs';

const windowsAssets = path.resolve(process.cwd(), 'assets', 'windows');
const iconset = path.join(windowsAssets, 'mongog-icon.iconset');

function greenMarkBounds(image: ReturnType<typeof decodeRgbaPng>) {
  let left = image.width;
  let top = image.height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const offset = (y * image.width + x) * 4;
      const red = image.pixels[offset]!;
      const green = image.pixels[offset + 1]!;
      const blue = image.pixels[offset + 2]!;
      const alpha = image.pixels[offset + 3]!;
      if (alpha < 64 || green < 80 || green <= red * 1.3 || green <= blue * 1.2) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  return right < left ? null : { left, top, right: right + 1, bottom: bottom + 1 };
}

describe('Windows application icon', () => {
  it('contains a deterministic 32-bit PNG layer for every Windows DPI size', () => {
    const ico = readFileSync(path.join(windowsAssets, 'mongog-icon.ico'));
    const entries = readIcoEntries(ico);

    expect(entries.map(({ width }) => width)).toEqual(WINDOWS_ICON_SIZES);
    const sourceEntries = entries.map((entry, index) => {
      const size = WINDOWS_ICON_SIZES[index];
      if (size === undefined) throw new Error(`Unexpected ICO entry ${index}`);
      const source = readFileSync(path.join(iconset, `${size}x${size}.png`));
      expect(entry).toMatchObject({
        width: size,
        height: size,
        colorCount: 0,
        reserved: 0,
        planes: 1,
        bitCount: 32,
      });
      expect(entry.data.equals(source)).toBe(true);
      return { size, data: source };
    });

    expect(buildIco(sourceEntries).equals(ico)).toBe(true);
  });

  it('keeps every representation centered with a near-full Windows footprint', () => {
    for (const size of WINDOWS_ICON_SIZES) {
      const png = readFileSync(path.join(iconset, `${size}x${size}.png`));
      const image = decodeRgbaPng(png, `${size}x${size}.png`);
      const bounds = alphaBounds(image, 16);
      expect(image).toMatchObject({ width: size, height: size });
      expect(bounds).not.toBeNull();
      if (!bounds) throw new Error(`${size}x${size}.png has no visible pixels`);

      const widthRatio = (bounds.right - bounds.left) / size;
      const heightRatio = (bounds.bottom - bounds.top) / size;
      const minimum = size === 16 ? 0.875 : size === 20 ? 0.9 : 0.94;
      expect(widthRatio).toBeGreaterThanOrEqual(minimum);
      expect(widthRatio).toBeLessThanOrEqual(1);
      expect(heightRatio).toBeGreaterThanOrEqual(minimum);
      expect(heightRatio).toBeLessThanOrEqual(1);
      expect(Math.abs(bounds.left - (size - bounds.right))).toBeLessThanOrEqual(1);
      expect(Math.abs(bounds.top - (size - bounds.bottom))).toBeLessThanOrEqual(1);
    }
  });

  it('keeps the green MongoG mark prominent at every DPI tier', () => {
    for (const size of WINDOWS_ICON_SIZES) {
      const png = readFileSync(path.join(iconset, `${size}x${size}.png`));
      const image = decodeRgbaPng(png, `${size}x${size}.png`);
      const bounds = greenMarkBounds(image);
      expect(bounds).not.toBeNull();
      if (!bounds) throw new Error(`${size}x${size}.png has no visible green MongoG mark`);

      expect((bounds.right - bounds.left) / size).toBeGreaterThanOrEqual(0.5);
      expect((bounds.bottom - bounds.top) / size).toBeGreaterThanOrEqual(0.54);
    }
  });

  it('does not retain a single-resolution runtime PNG', () => {
    expect(existsSync(path.join(windowsAssets, 'mongog-icon.png'))).toBe(false);
  });
});
