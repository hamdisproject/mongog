import { deflateSync } from 'node:zlib';

const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export const WINDOWS_ICON_SIZES = Object.freeze([16, 20, 24, 32, 40, 48, 64, 128, 256]);

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(data) {
  let value = 0xffffffff;
  for (const byte of data) value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function pngChunk(type, payload) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const header = Buffer.alloc(8);
  header.writeUInt32BE(payload.length, 0);
  typeBuffer.copy(header, 4);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, payload])), 0);
  return Buffer.concat([header, payload, checksum]);
}

export function encodeRgbaPng(image) {
  const { width, height, pixels } = image;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error('PNG dimensions must be positive integers');
  }
  if (!Buffer.isBuffer(pixels) || pixels.length !== width * height * 4) {
    throw new Error('PNG pixels must contain exactly one RGBA value per pixel');
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const stride = width * 4;
  const scanlines = Buffer.alloc(height * (stride + 1));
  for (let row = 0; row < height; row += 1) {
    pixels.copy(scanlines, row * (stride + 1) + 1, row * stride, (row + 1) * stride);
  }

  return Buffer.concat([
    pngSignature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(scanlines, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function sinc(value) {
  if (value === 0) return 1;
  const angle = Math.PI * value;
  return Math.sin(angle) / angle;
}

function lanczos(value, radius = 3) {
  const absolute = Math.abs(value);
  return absolute >= radius ? 0 : sinc(value) * sinc(value / radius);
}

function clampByte(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

export function resizeRgbaImage(image, targetSize) {
  if (!Number.isInteger(targetSize) || targetSize <= 0) {
    throw new Error('Target icon size must be a positive integer');
  }
  if (image.width !== image.height) throw new Error('Windows icon sources must be square');
  if (targetSize > image.width) throw new Error('Windows icon layers must not upscale their source');
  if (targetSize === image.width) return { ...image, pixels: Buffer.from(image.pixels) };

  const scale = image.width / targetSize;
  const filterScale = Math.max(1, scale);
  const support = 3 * filterScale;
  const pixels = Buffer.alloc(targetSize * targetSize * 4);

  for (let targetY = 0; targetY < targetSize; targetY += 1) {
    const sourceY = (targetY + 0.5) * scale - 0.5;
    const top = Math.max(0, Math.ceil(sourceY - support));
    const bottom = Math.min(image.height - 1, Math.floor(sourceY + support));
    for (let targetX = 0; targetX < targetSize; targetX += 1) {
      const sourceX = (targetX + 0.5) * scale - 0.5;
      const left = Math.max(0, Math.ceil(sourceX - support));
      const right = Math.min(image.width - 1, Math.floor(sourceX + support));
      let totalWeight = 0;
      let alpha = 0;
      let red = 0;
      let green = 0;
      let blue = 0;

      for (let y = top; y <= bottom; y += 1) {
        const verticalWeight = lanczos((sourceY - y) / filterScale);
        for (let x = left; x <= right; x += 1) {
          const weight = verticalWeight * lanczos((sourceX - x) / filterScale);
          if (weight === 0) continue;
          const sourceOffset = (y * image.width + x) * 4;
          const sourceAlpha = image.pixels[sourceOffset + 3] / 255;
          totalWeight += weight;
          alpha += sourceAlpha * weight;
          red += image.pixels[sourceOffset] * sourceAlpha * weight;
          green += image.pixels[sourceOffset + 1] * sourceAlpha * weight;
          blue += image.pixels[sourceOffset + 2] * sourceAlpha * weight;
        }
      }

      const targetOffset = (targetY * targetSize + targetX) * 4;
      const normalizedAlpha = totalWeight === 0 ? 0 : Math.max(0, Math.min(1, alpha / totalWeight));
      const outputAlpha = clampByte(normalizedAlpha * 255);
      // Lanczos can create a faint one-pixel alpha ring around small icons.
      // Removing that imperceptible fringe keeps Windows' 20–48px shell
      // representations crisp and aligned to their intended pixel bounds.
      if (outputAlpha < 32) continue;
      if (Math.abs(alpha) > Number.EPSILON) {
        pixels[targetOffset] = clampByte(red / alpha);
        pixels[targetOffset + 1] = clampByte(green / alpha);
        pixels[targetOffset + 2] = clampByte(blue / alpha);
      }
      pixels[targetOffset + 3] = outputAlpha;
    }
  }

  return { width: targetSize, height: targetSize, pixels };
}

export function buildIco(entries) {
  if (entries.length === 0 || entries.length > 0xffff) {
    throw new Error('ICO must contain between one and 65535 images');
  }

  const directory = Buffer.alloc(6 + entries.length * 16);
  directory.writeUInt16LE(0, 0);
  directory.writeUInt16LE(1, 2);
  directory.writeUInt16LE(entries.length, 4);
  let imageOffset = directory.length;

  entries.forEach(({ size, data }, index) => {
    if (!Number.isInteger(size) || size < 1 || size > 256) {
      throw new Error(`ICO size ${size} must be an integer between 1 and 256`);
    }
    if (!Buffer.isBuffer(data) || !data.subarray(0, pngSignature.length).equals(pngSignature)) {
      throw new Error(`ICO ${size}x${size} entry must be PNG data`);
    }
    const offset = 6 + index * 16;
    directory[offset] = size === 256 ? 0 : size;
    directory[offset + 1] = size === 256 ? 0 : size;
    directory[offset + 2] = 0;
    directory[offset + 3] = 0;
    directory.writeUInt16LE(1, offset + 4);
    directory.writeUInt16LE(32, offset + 6);
    directory.writeUInt32LE(data.length, offset + 8);
    directory.writeUInt32LE(imageOffset, offset + 12);
    imageOffset += data.length;
  });

  return Buffer.concat([directory, ...entries.map(({ data }) => data)]);
}

export function readIcoEntries(data, label = 'ICO') {
  if (!Buffer.isBuffer(data) || data.length < 6) throw new Error(`${label} is truncated`);
  if (data.readUInt16LE(0) !== 0 || data.readUInt16LE(2) !== 1) {
    throw new Error(`${label} has an invalid icon directory`);
  }
  const count = data.readUInt16LE(4);
  if (count === 0 || data.length < 6 + count * 16) throw new Error(`${label} has an invalid entry count`);

  return Array.from({ length: count }, (_, index) => {
    const directoryOffset = 6 + index * 16;
    const width = data[directoryOffset] || 256;
    const height = data[directoryOffset + 1] || 256;
    const colorCount = data[directoryOffset + 2];
    const reserved = data[directoryOffset + 3];
    const planes = data.readUInt16LE(directoryOffset + 4);
    const bitCount = data.readUInt16LE(directoryOffset + 6);
    const length = data.readUInt32LE(directoryOffset + 8);
    const imageOffset = data.readUInt32LE(directoryOffset + 12);
    if (length === 0 || imageOffset < 6 + count * 16 || imageOffset + length > data.length) {
      throw new Error(`${label} entry ${index} points outside the container`);
    }
    return {
      width,
      height,
      colorCount,
      reserved,
      planes,
      bitCount,
      data: data.subarray(imageOffset, imageOffset + length),
    };
  });
}
