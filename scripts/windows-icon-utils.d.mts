import type { RgbaImage } from './macos-icon-utils.mjs';

export interface IcoSourceEntry {
  size: number;
  data: Buffer;
}

export interface IcoEntry {
  width: number;
  height: number;
  colorCount: number;
  reserved: number;
  planes: number;
  bitCount: number;
  data: Buffer;
}

export const WINDOWS_ICON_SIZES: readonly number[];
export function encodeRgbaPng(image: RgbaImage): Buffer;
export function resizeRgbaImage(image: RgbaImage, targetSize: number): RgbaImage;
export function buildIco(entries: IcoSourceEntry[]): Buffer;
export function readIcoEntries(data: Buffer, label?: string): IcoEntry[];
