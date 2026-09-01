import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { alphaBounds, decodeRgbaPng } from '../../scripts/macos-icon-utils.mjs';
import { buildIco, readIcoEntries, WINDOWS_ICON_SIZES } from '../../scripts/windows-icon-utils.mjs';

const windowsAssets = path.resolve(process.cwd(), 'assets', 'windows');
const iconset = path.join(windowsAssets, 'mongog-icon.iconset');

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

  it('keeps every representation centered with a compact macOS-sized footprint', () => {
    for (const size of WINDOWS_ICON_SIZES) {
      const png = readFileSync(path.join(iconset, `${size}x${size}.png`));
      const image = decodeRgbaPng(png, `${size}x${size}.png`);
      const bounds = alphaBounds(image, 16);
      expect(image).toMatchObject({ width: size, height: size });
      expect(bounds).not.toBeNull();
      if (!bounds) throw new Error(`${size}x${size}.png has no visible pixels`);

      const widthRatio = (bounds.right - bounds.left) / size;
      const heightRatio = (bounds.bottom - bounds.top) / size;
      expect(widthRatio).toBeGreaterThanOrEqual(size === 16 ? 0.75 : 0.78);
      expect(widthRatio).toBeLessThanOrEqual(size === 16 ? 0.88 : 0.85);
      expect(heightRatio).toBeGreaterThanOrEqual(size === 16 ? 0.75 : 0.78);
      expect(heightRatio).toBeLessThanOrEqual(size === 16 ? 0.88 : 0.85);
      expect(Math.abs(bounds.left - (size - bounds.right))).toBeLessThanOrEqual(1);
      expect(Math.abs(bounds.top - (size - bounds.bottom))).toBeLessThanOrEqual(1);
    }
  });

  it('uses the 256px Windows layer for the runtime window icon', () => {
    expect(
      readFileSync(path.join(windowsAssets, 'mongog-icon.png')).equals(
        readFileSync(path.join(iconset, '256x256.png')),
      ),
    ).toBe(true);
  });
});
