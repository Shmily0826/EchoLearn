/**
 * Generate PWA icons from scratch using pure Node.js (zlib + Buffer).
 * Creates purple-backgrounded lightning bolt icons at required PWA sizes.
 */
import { writeFileSync } from 'fs';
import { deflateSync } from 'zlib';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const SIZES = [
  { size: 192, name: 'pwa-192x192.png' },
  { size: 512, name: 'pwa-512x512.png' },
  { size: 180, name: 'apple-touch-icon.png' },
];

// Purple color from favicon: #863bff → rgb(134, 59, 255)
const BG = [134, 59, 255];
const BOLT = [237, 230, 255]; // light lavender #ede6ff

function createPNG(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.42; // rounded rect radius feel

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;

      // Rounded rectangle mask
      const margin = size * 0.08;
      const cornerR = size * 0.18;
      const inRect = isInRoundedRect(x, y, margin, margin, size - margin * 2, size - margin * 2, cornerR);

      if (!inRect) {
        // Transparent outside
        pixels[idx] = 0;
        pixels[idx + 1] = 0;
        pixels[idx + 2] = 0;
        pixels[idx + 3] = 0;
        continue;
      }

      // Lightning bolt shape (normalized coordinates 0-1)
      const nx = (x - margin) / (size - margin * 2);
      const ny = (y - margin) / (size - margin * 2);

      if (isInBolt(nx, ny)) {
        pixels[idx] = BOLT[0];
        pixels[idx + 1] = BOLT[1];
        pixels[idx + 2] = BOLT[2];
        pixels[idx + 3] = 255;
      } else {
        pixels[idx] = BG[0];
        pixels[idx + 1] = BG[1];
        pixels[idx + 2] = BG[2];
        pixels[idx + 3] = 255;
      }
    }
  }

  return encodePNG(pixels, size, size);
}

function isInRoundedRect(px, py, rx, ry, rw, rh, cr) {
  if (px < rx || px >= rx + rw || py < ry || py >= ry + rh) return false;
  // Check corners
  const corners = [
    [rx + cr, ry + cr],
    [rx + rw - cr, ry + cr],
    [rx + cr, ry + rh - cr],
    [rx + rw - cr, ry + rh - cr],
  ];
  for (const [ccx, ccy] of corners) {
    const inCornerZone =
      (px < rx + cr && py < ry + cr) ||
      (px >= rx + rw - cr && py < ry + cr) ||
      (px < rx + cr && py >= ry + rh - cr) ||
      (px >= rx + rw - cr && py >= ry + rh - cr);
    if (inCornerZone) {
      const dx = px - ccx;
      const dy = py - ccy;
      if (dx * dx + dy * dy > cr * cr) return false;
    }
  }
  return true;
}

function isInBolt(nx, ny) {
  // Lightning bolt polygon (normalized 0-1 coordinates)
  // Simplified bolt shape pointing downward
  const bolt = [
    [0.56, 0.08], // top right
    [0.30, 0.50], // mid left after first diagonal
    [0.46, 0.50], // mid left inner
    [0.34, 0.92], // bottom left
    [0.72, 0.46], // mid right
    [0.54, 0.46], // mid right inner
    [0.68, 0.08], // top right outer
  ];
  return pointInPolygon(nx, ny, bolt);
}

function pointInPolygon(x, y, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0], yi = polygon[i][1];
    const xj = polygon[j][0], yj = polygon[j][1];
    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function encodePNG(pixels, width, height) {
  // Add filter byte (0 = None) to each row
  const rawData = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    rawData[y * (1 + width * 4)] = 0; // filter = None
    pixels.copy(rawData, y * (1 + width * 4) + 1, y * width * 4, (y + 1) * width * 4);
  }

  const compressed = deflateSync(rawData);

  // PNG signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // IDAT chunk (compressed pixel data)
  const idat = compressed;

  // IEND chunk
  const iend = Buffer.alloc(0);

  const chunks = [
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', idat),
    makeChunk('IEND', iend),
  ];

  return Buffer.concat([signature, ...chunks]);
}

function makeChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);

  const typeBuffer = Buffer.from(type, 'ascii');
  const crcData = Buffer.concat([typeBuffer, data]);
  const crc = crc32(crcData);
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc, 0);

  return Buffer.concat([length, typeBuffer, data, crcBuffer]);
}

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// Generate all icons
const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(__dirname, '..', 'public');
for (const { size, name } of SIZES) {
  const png = createPNG(size);
  const path = resolve(outDir, name);
  writeFileSync(path, png);
  console.log(`Created ${name} (${size}x${size}, ${png.length} bytes)`);
}
