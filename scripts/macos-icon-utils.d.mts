export interface RgbaImage {
  width: number;
  height: number;
  pixels: Buffer;
}

export interface ImageBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function decodeRgbaPng(data: Buffer, label?: string): RgbaImage;
export function alphaBounds(image: RgbaImage, threshold?: number): ImageBounds | null;
export function encodeArgb(image: RgbaImage): Buffer;
export function buildIcns(entries: Array<[string, Buffer]>): Buffer;
export function readIcnsTypes(data: Buffer, label?: string): Set<string>;
