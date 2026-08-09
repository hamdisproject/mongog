import { inflateSync } from 'node:zlib';

const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function paeth(left, up, upperLeft) {
  const estimate = left + up - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= upDistance && leftDistance <= upperLeftDistance) return left;
  return upDistance <= upperLeftDistance ? up : upperLeft;
}

export function decodeRgbaPng(data, label = 'PNG') {
  if (!data.subarray(0, 8).equals(pngSignature)) throw new Error(`${label} is not a PNG`);

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const compressed = [];

  while (offset + 12 <= data.length) {
    const length = data.readUInt32BE(offset);
    const type = data.subarray(offset + 4, offset + 8).toString('ascii');
    const start = offset + 8;
    const end = start + length;
    if (end + 4 > data.length) throw new Error(`${label} contains a truncated ${type} chunk`);
    if (type === 'IHDR') {
      width = data.readUInt32BE(start);
      height = data.readUInt32BE(start + 4);
      bitDepth = data[start + 8];
      colorType = data[start + 9];
      interlace = data[start + 12];
    } else if (type === 'IDAT') {
      compressed.push(data.subarray(start, end));
    } else if (type === 'IEND') {
      break;
    }
    offset = end + 4;
  }

  if (!width || !height) throw new Error(`${label} is missing IHDR dimensions`);
  if (bitDepth !== 8 || colorType !== 6 || interlace !== 0) {
    throw new Error(`${label} must be an 8-bit, non-interlaced RGBA PNG`);
  }
  if (compressed.length === 0) throw new Error(`${label} contains no image data`);

  const bytesPerPixel = 4;
  const stride = width * bytesPerPixel;
  const inflated = inflateSync(Buffer.concat(compressed));
  if (inflated.length !== height * (stride + 1)) {
    throw new Error(`${label} has an unexpected decompressed size`);
  }

  const pixels = Buffer.alloc(width * height * bytesPerPixel);
  let inputOffset = 0;
  let previous = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = inflated[inputOffset];
    inputOffset += 1;
    const current = Buffer.alloc(stride);
    for (let x = 0; x < stride; x += 1) {
      const source = inflated[inputOffset + x];
      const left = x >= bytesPerPixel ? current[x - bytesPerPixel] : 0;
      const up = previous[x];
      const upperLeft = x >= bytesPerPixel ? previous[x - bytesPerPixel] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = up;
      else if (filter === 3) predictor = Math.floor((left + up) / 2);
      else if (filter === 4) predictor = paeth(left, up, upperLeft);
      else if (filter !== 0) throw new Error(`${label} uses unsupported PNG filter ${filter}`);
      current[x] = (source + predictor) & 0xff;
    }
    current.copy(pixels, y * stride);
    previous = current;
    inputOffset += stride;
  }

  return { width, height, pixels };
}

export function alphaBounds(image, threshold = 16) {
  let left = image.width;
  let top = image.height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (image.pixels[(y * image.width + x) * 4 + 3] < threshold) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  if (right < left || bottom < top) return null;
  return { left, top, right: right + 1, bottom: bottom + 1 };
}

function packByteRuns(channel) {
  const encoded = [];
  const literals = [];
  const flushLiterals = () => {
    if (literals.length === 0) return;
    encoded.push(literals.length - 1, ...literals);
    literals.length = 0;
  };

  let offset = 0;
  while (offset < channel.length) {
    let runLength = 1;
    while (
      offset + runLength < channel.length
      && channel[offset + runLength] === channel[offset]
    ) {
      runLength += 1;
    }

    if (runLength >= 3) {
      flushLiterals();
      let remaining = runLength;
      while (remaining >= 3) {
        const count = Math.min(remaining, 130);
        if (count < 3) break;
        encoded.push(count + 0x7d, channel[offset]);
        offset += count;
        remaining -= count;
      }
      continue;
    }

    literals.push(channel[offset]);
    offset += 1;
    if (literals.length === 128) flushLiterals();
  }
  flushLiterals();
  return Buffer.from(encoded);
}

export function encodeArgb(image) {
  const pixelCount = image.width * image.height;
  const channels = Array.from({ length: 4 }, () => Buffer.alloc(pixelCount));
  for (let index = 0; index < pixelCount; index += 1) {
    const pixelOffset = index * 4;
    channels[0][index] = image.pixels[pixelOffset + 3];
    channels[1][index] = image.pixels[pixelOffset];
    channels[2][index] = image.pixels[pixelOffset + 1];
    channels[3][index] = image.pixels[pixelOffset + 2];
  }
  return Buffer.concat([Buffer.from('ARGB'), ...channels.map(packByteRuns)]);
}

function icnsChunk(type, data) {
  const header = Buffer.alloc(8);
  header.write(type, 0, 4, 'ascii');
  header.writeUInt32BE(data.length + 8, 4);
  return Buffer.concat([header, data]);
}

export function buildIcns(entries) {
  const tableOfContents = Buffer.concat(entries.map(([type, data]) => {
    const header = Buffer.alloc(8);
    header.write(type, 0, 4, 'ascii');
    header.writeUInt32BE(data.length + 8, 4);
    return header;
  }));
  const chunks = [icnsChunk('TOC ', tableOfContents), ...entries.map(([type, data]) => icnsChunk(type, data))];
  const totalSize = 8 + chunks.reduce((total, chunk) => total + chunk.length, 0);
  const header = Buffer.alloc(8);
  header.write('icns', 0, 4, 'ascii');
  header.writeUInt32BE(totalSize, 4);
  return Buffer.concat([header, ...chunks]);
}

export function readIcnsTypes(data, label = 'ICNS') {
  if (data.subarray(0, 4).toString('ascii') !== 'icns') throw new Error(`${label} is not ICNS`);
  if (data.readUInt32BE(4) !== data.length) throw new Error(`${label} has an invalid container length`);
  const types = new Set();
  for (let offset = 8; offset + 8 <= data.length;) {
    const type = data.subarray(offset, offset + 4).toString('ascii');
    const size = data.readUInt32BE(offset + 4);
    if (size < 8 || offset + size > data.length) throw new Error(`${label} contains an invalid ${type} chunk`);
    types.add(type);
    offset += size;
  }
  return types;
}
