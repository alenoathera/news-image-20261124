import { mkdirSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

// Minimal CRC32 implementation conforming to PNG specification
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  }
  CRC_TABLE[n] = c;
}

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createPngChunk(type, data) {
  const len = data.length;
  const chunk = Buffer.alloc(12 + len);
  chunk.writeUInt32BE(len, 0);
  chunk.write(type, 4, 4, 'ascii');
  data.copy(chunk, 8);
  const chunkCrc = crc32(chunk.subarray(4, 8 + len));
  chunk.writeUInt32BE(chunkCrc, 8 + len);
  return chunk;
}

function encodeRgbPng(width, height, rgbBuffer) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  // IHDR chunk
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // 8 bits per channel
  ihdrData[9] = 2; // RGB color type
  ihdrData[10] = 0; // Deflate compression
  ihdrData[11] = 0; // Standard filter
  ihdrData[12] = 0; // No interlace
  const ihdrChunk = createPngChunk('IHDR', ihdrData);

  // Raw uncompressed scanlines with Filter None (0x00) prefix
  const bytesPerRow = width * 3;
  const rawScanlines = Buffer.alloc(height * (1 + bytesPerRow));
  for (let y = 0; y < height; y++) {
    const rawOffset = y * (1 + bytesPerRow);
    rawScanlines[rawOffset] = 0; // Filter None
    const rgbOffset = y * bytesPerRow;
    rgbBuffer.copy(rawScanlines, rawOffset + 1, rgbOffset, rgbOffset + bytesPerRow);
  }

  // IDAT chunk
  const compressed = deflateSync(rawScanlines, { level: 9 });
  const idatChunk = createPngChunk('IDAT', compressed);

  // IEND chunk
  const iendChunk = createPngChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

// 5x7 bitmap font covering ASCII 32 through 122
const FONT = {
  ' ': [0, 0, 0, 0, 0, 0, 0],
  '!': [0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0, 0b00100],
  '\'': [0b00100, 0b00100, 0b01000, 0, 0, 0, 0],
  '(': [0b00010, 0b00100, 0b01000, 0b01000, 0b01000, 0b00100, 0b00010],
  ')': [0b01000, 0b00100, 0b00010, 0b00010, 0b00010, 0b00100, 0b01000],
  ',': [0, 0, 0, 0, 0, 0b00100, 0b01000],
  '-': [0, 0, 0, 0b11111, 0, 0, 0],
  '.': [0, 0, 0, 0, 0, 0b00100, 0b00100],
  '/': [0b00001, 0b00010, 0b00100, 0b00100, 0b01000, 0b10000, 0],
  ':': [0, 0b01100, 0b01100, 0, 0b01100, 0b01100, 0],
  '0': [0b01110, 0b10011, 0b10101, 0b10101, 0b11001, 0b10001, 0b01110],
  '1': [0b00100, 0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
  '2': [0b01110, 0b10001, 0b00001, 0b00010, 0b00100, 0b01000, 0b11111],
  '3': [0b11110, 0b00001, 0b00001, 0b01110, 0b00001, 0b00001, 0b11110],
  '4': [0b00010, 0b00110, 0b01010, 0b10010, 0b11111, 0b00010, 0b00010],
  '5': [0b11111, 0b10000, 0b11110, 0b00001, 0b00001, 0b10001, 0b01110],
  '6': [0b00110, 0b01000, 0b10000, 0b11110, 0b10001, 0b10001, 0b01110],
  '7': [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b01000, 0b01000],
  '8': [0b01110, 0b10001, 0b10001, 0b01110, 0b10001, 0b10001, 0b01110],
  '9': [0b01110, 0b10001, 0b10001, 0b01111, 0b00001, 0b00010, 0b01100],
  'A': [0b01110, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
  'B': [0b11110, 0b10001, 0b10001, 0b11110, 0b10001, 0b10001, 0b11110],
  'C': [0b01111, 0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b01111],
  'D': [0b11110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b11110],
  'E': [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b11111],
  'F': [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b10000],
  'G': [0b01111, 0b10000, 0b10000, 0b10111, 0b10001, 0b10001, 0b01110],
  'H': [0b10001, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
  'I': [0b01110, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
  'J': [0b00001, 0b00001, 0b00001, 0b00001, 0b10001, 0b10001, 0b01110],
  'K': [0b10001, 0b10010, 0b10100, 0b11000, 0b10100, 0b10010, 0b10001],
  'L': [0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b11111],
  'M': [0b10001, 0b11011, 0b10101, 0b10101, 0b10001, 0b10001, 0b10001],
  'N': [0b10001, 0b11001, 0b10101, 0b10011, 0b10001, 0b10001, 0b10001],
  'O': [0b01110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
  'P': [0b11110, 0b10001, 0b10001, 0b11110, 0b10000, 0b10000, 0b10000],
  'Q': [0b01110, 0b10001, 0b10001, 0b10001, 0b10101, 0b10010, 0b01101],
  'R': [0b11110, 0b10001, 0b10001, 0b11110, 0b10100, 0b10010, 0b10001],
  'S': [0b01111, 0b10000, 0b10000, 0b01110, 0b00001, 0b00001, 0b11110],
  'T': [0b11111, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100],
  'U': [0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
  'V': [0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01010, 0b00100],
  'W': [0b10001, 0b10001, 0b10001, 0b10101, 0b10101, 0b11011, 0b10001],
  'X': [0b10001, 0b10001, 0b01010, 0b00100, 0b01010, 0b10001, 0b10001],
  'Y': [0b10001, 0b10001, 0b01010, 0b00100, 0b00100, 0b00100, 0b00100],
  'Z': [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b10000, 0b11111],
  'a': [0, 0, 0b01110, 0b00001, 0b01111, 0b10001, 0b01111],
  'b': [0b10000, 0b10000, 0b11110, 0b10001, 0b10001, 0b10001, 0b11110],
  'c': [0, 0, 0b01111, 0b10000, 0b10000, 0b10000, 0b01111],
  'd': [0b00001, 0b00001, 0b01111, 0b10001, 0b10001, 0b10001, 0b01111],
  'e': [0, 0, 0b01110, 0b10001, 0b11111, 0b10000, 0b01111],
  'f': [0b00110, 0b01000, 0b11110, 0b01000, 0b01000, 0b01000, 0b01000],
  'g': [0, 0, 0b01111, 0b10001, 0b01111, 0b00001, 0b01110],
  'h': [0b10000, 0b10000, 0b11110, 0b10001, 0b10001, 0b10001, 0b10001],
  'i': [0b00100, 0, 0b01100, 0b00100, 0b00100, 0b00100, 0b01110],
  'j': [0b00010, 0, 0b00110, 0b00010, 0b00010, 0b10010, 0b01100],
  'k': [0b10000, 0b10000, 0b10010, 0b10100, 0b11000, 0b10100, 0b10010],
  'l': [0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
  'm': [0, 0, 0b11010, 0b10101, 0b10101, 0b10101, 0b10101],
  'n': [0, 0, 0b11110, 0b10001, 0b10001, 0b10001, 0b10001],
  'o': [0, 0, 0b01110, 0b10001, 0b10001, 0b10001, 0b01110],
  'p': [0, 0, 0b11110, 0b10001, 0b11110, 0b10000, 0b10000],
  'q': [0, 0, 0b01111, 0b10001, 0b01111, 0b00001, 0b00001],
  'r': [0, 0, 0b10110, 0b11001, 0b10000, 0b10000, 0b10000],
  's': [0, 0, 0b01111, 0b10000, 0b01110, 0b00001, 0b11110],
  't': [0b01000, 0b01000, 0b11110, 0b01000, 0b01000, 0b01001, 0b00110],
  'u': [0, 0, 0b10001, 0b10001, 0b10001, 0b10011, 0b01101],
  'v': [0, 0, 0b10001, 0b10001, 0b10001, 0b01010, 0b00100],
  'w': [0, 0, 0b10001, 0b10101, 0b10101, 0b10101, 0b01010],
  'x': [0, 0, 0b10001, 0b01010, 0b00100, 0b01010, 0b10001],
  'y': [0, 0, 0b10001, 0b10001, 0b01111, 0b00001, 0b01110],
  'z': [0, 0, 0b11111, 0b00010, 0b00100, 0b01000, 0b11111]
};

class Canvas {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.buffer = Buffer.alloc(width * height * 3);
  }

  setPixel(x, y, r, g, b) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    if (ix < 0 || ix >= this.width || iy < 0 || iy >= this.height) return;
    const offset = (iy * this.width + ix) * 3;
    this.buffer[offset] = r;
    this.buffer[offset + 1] = g;
    this.buffer[offset + 2] = b;
  }

  fillRect(x, y, w, h, r, g, b) {
    const startX = Math.max(0, Math.floor(x));
    const endX = Math.min(this.width, Math.floor(x + w));
    const startY = Math.max(0, Math.floor(y));
    const endY = Math.min(this.height, Math.floor(y + h));

    for (let cy = startY; cy < endY; cy++) {
      let offset = (cy * this.width + startX) * 3;
      for (let cx = startX; cx < endX; cx++) {
        this.buffer[offset++] = r;
        this.buffer[offset++] = g;
        this.buffer[offset++] = b;
      }
    }
  }

  drawRect(x, y, w, h, r, g, b, thickness = 1) {
    this.fillRect(x, y, w, thickness, r, g, b); // Top
    this.fillRect(x, y + h - thickness, w, thickness, r, g, b); // Bottom
    this.fillRect(x, y, thickness, h, r, g, b); // Left
    this.fillRect(x + w - thickness, y, thickness, h, r, g, b); // Right
  }

  drawCircle(cx, cy, radius, r, g, b, fill = true) {
    const r2 = radius * radius;
    const startX = Math.max(0, Math.floor(cx - radius));
    const endX = Math.min(this.width, Math.ceil(cx + radius));
    const startY = Math.max(0, Math.floor(cy - radius));
    const endY = Math.min(this.height, Math.ceil(cy + radius));

    for (let y = startY; y <= endY; y++) {
      for (let x = startX; x <= endX; x++) {
        const d2 = (x - cx) * (x - cx) + (y - cy) * (y - cy);
        if (fill) {
          if (d2 <= r2) this.setPixel(x, y, r, g, b);
        } else {
          if (Math.abs(d2 - r2) <= radius * 1.5) this.setPixel(x, y, r, g, b);
        }
      }
    }
  }

  drawLine(x0, y0, x1, y1, r, g, b, thickness = 1) {
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;

    let cx = x0;
    let cy = y0;
    const halfThick = Math.floor(thickness / 2);

    while (true) {
      if (thickness <= 1) {
        this.setPixel(cx, cy, r, g, b);
      } else {
        this.fillRect(cx - halfThick, cy - halfThick, thickness, thickness, r, g, b);
      }

      if (cx === x1 && cy === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        cx += sx;
      }
      if (e2 < dx) {
        err += dx;
        cy += sy;
      }
    }
  }

  drawChar(ch, x, y, scale, r, g, b) {
    const rows = FONT[ch] ?? FONT[' '];
    for (let rowIdx = 0; rowIdx < 7; rowIdx++) {
      const bitmask = rows[rowIdx];
      for (let colIdx = 0; colIdx < 5; colIdx++) {
        if ((bitmask >> (4 - colIdx)) & 1) {
          this.fillRect(x + colIdx * scale, y + rowIdx * scale, scale, scale, r, g, b);
        }
      }
    }
  }

  drawText(text, x, y, scale, r, g, b, spacing = 2) {
    let cursorX = x;
    const charWidth = 5 * scale;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      this.drawChar(ch, cursorX, y, scale, r, g, b);
      cursorX += charWidth + spacing;
    }
    return cursorX;
  }

  measureText(text, scale, spacing = 2) {
    if (text.length === 0) return 0;
    return text.length * (5 * scale) + (text.length - 1) * spacing;
  }

  drawWrappedText(text, x, y, maxWidth, scale, r, g, b, lineHeight = 24, spacing = 2) {
    const words = text.split(' ');
    const lines = [];
    let currentLine = '';

    for (const word of words) {
      const testLine = currentLine.length === 0 ? word : currentLine + ' ' + word;
      if (this.measureText(testLine, scale, spacing) <= maxWidth) {
        currentLine = testLine;
      } else {
        if (currentLine.length > 0) lines.push(currentLine);
        currentLine = word;
      }
    }
    if (currentLine.length > 0) lines.push(currentLine);

    let curY = y;
    for (const line of lines) {
      this.drawText(line, x, curY, scale, r, g, b, spacing);
      curY += lineHeight;
    }
    return curY;
  }
}

// Procedural pictogram generators
function drawRiyadhTower(cv, ox, oy) {
  // ox, oy: top-left of pictogram box (140x238)
  const cx = ox + 70;
  const base = oy + 215;

  // Tower body (stepped / tapering modern skyscraper)
  cv.fillRect(cx - 24, oy + 70, 48, base - (oy + 70), 51, 65, 85);
  cv.fillRect(cx - 20, oy + 50, 40, 20, 71, 85, 105);
  cv.fillRect(cx - 14, oy + 32, 28, 18, 100, 116, 139);
  // Architectural fin highlights
  cv.fillRect(cx - 24, oy + 70, 3, base - (oy + 70), 148, 163, 184);
  cv.fillRect(cx + 21, oy + 70, 3, base - (oy + 70), 148, 163, 184);
  // Spire with glowing tip
  cv.fillRect(cx - 2, oy + 12, 4, 20, 203, 213, 225);
  cv.drawCircle(cx, oy + 12, 3, 254, 240, 138, true);

  // Vertical window columns
  for (let wy = oy + 74; wy < base - 10; wy += 8) {
    cv.fillRect(cx - 18, wy, 6, 4, 254, 240, 138); // window
    cv.fillRect(cx - 8, wy, 6, 4, 147, 197, 253);
    cv.fillRect(cx + 2, wy, 6, 4, 147, 197, 253);
    cv.fillRect(cx + 12, wy, 6, 4, 254, 240, 138);
  }

  // Strike impact burst near upper tier
  const blastX = cx + 8;
  const blastY = oy + 65;
  cv.drawCircle(blastX, blastY, 24, 239, 68, 68, true);
  cv.drawCircle(blastX, blastY, 16, 249, 115, 22, true);
  cv.drawCircle(blastX, blastY, 8, 254, 240, 138, true);
  // Explosive flash rays
  cv.drawLine(blastX - 22, blastY - 14, blastX + 22, blastY + 14, 254, 240, 138, 2);
  cv.drawLine(blastX - 14, blastY + 22, blastX + 14, blastY - 22, 254, 240, 138, 2);
  // Smoke puffs
  cv.drawCircle(blastX + 18, blastY - 16, 11, 100, 116, 139, true);
  cv.drawCircle(blastX + 28, blastY - 26, 8, 71, 85, 105, true);
}

function drawHuaweiCourthouse(cv, ox, oy) {
  const cx = ox + 70;
  const base = oy + 215;

  // Stepped foundation plinths
  cv.fillRect(cx - 52, base - 10, 104, 10, 148, 163, 184);
  cv.fillRect(cx - 46, base - 18, 92, 8, 203, 213, 225);
  cv.fillRect(cx - 40, base - 26, 80, 8, 226, 232, 240);

  // 4 classical columns
  const colY = oy + 88;
  const colH = base - 26 - colY;
  const colXPositions = [cx - 34, cx - 12, cx + 10, cx + 32];
  for (const px of colXPositions) {
    // Column shaft
    cv.fillRect(px - 4, colY, 8, colH, 241, 245, 249);
    // Capital & base
    cv.fillRect(px - 6, colY - 3, 12, 4, 203, 213, 225);
    cv.fillRect(px - 6, colY + colH - 2, 12, 4, 203, 213, 225);
  }

  // Entablature beam
  cv.fillRect(cx - 46, colY - 12, 92, 9, 226, 232, 240);

  // Triangular pediment (roof)
  const peakY = oy + 42;
  const roofW = 96;
  for (let r = 0; r < 34; r++) {
    const halfSpan = Math.floor((roofW / 2) * (r / 34));
    cv.fillRect(cx - halfSpan, colY - 12 - r, halfSpan * 2, 1, 203, 213, 225);
  }
  // Pediment border
  cv.drawLine(cx - 48, colY - 12, cx, peakY, 248, 250, 252, 2);
  cv.drawLine(cx + 48, colY - 12, cx, peakY, 248, 250, 252, 2);

  // Gavel / scales emblem inside pediment
  cv.drawCircle(cx, colY - 22, 6, 245, 158, 11, true);
}

function drawZaporizhzhiaStrike(cv, ox, oy) {
  const cx = ox + 70;
  const base = oy + 215;
  const buildingLeft = cx - 44;
  const buildingWidth = 88;
  const buildingTop = oy + 48;
  const buildingHeight = base - buildingTop;

  // Solid concrete facade
  cv.fillRect(buildingLeft, buildingTop, buildingWidth, buildingHeight, 71, 85, 105);

  // Windows grid
  for (let wy = buildingTop + 14; wy < base - 16; wy += 22) {
    for (let wx = buildingLeft + 8; wx < buildingLeft + buildingWidth - 12; wx += 18) {
      // Don't draw intact windows in strike destruction zone
      if (wx > cx && wy < buildingTop + 70) continue;
      cv.fillRect(wx, wy, 10, 14, 254, 240, 138); // glowing window
      cv.fillRect(wx + 4, wy, 2, 14, 51, 65, 85); // mullion
    }
  }

  // Strike destruction crater (top right corner destroyed)
  cv.fillRect(cx + 4, buildingTop, 42, 64, 13, 19, 33); // crater cutout
  cv.drawLine(cx + 4, buildingTop, cx + 2, buildingTop + 64, 239, 68, 68, 2);
  cv.drawLine(cx + 2, buildingTop + 64, cx + 46, buildingTop + 64, 239, 68, 68, 2);

  // Structural cracks spreading down
  cv.drawLine(cx + 6, buildingTop + 64, cx - 10, buildingTop + 110, 30, 41, 59, 2);
  cv.drawLine(cx - 10, buildingTop + 110, cx + 8, buildingTop + 150, 30, 41, 59, 2);

  // Burning embers & rubble
  cv.drawCircle(cx + 10, buildingTop + 58, 9, 249, 115, 22, true);
  cv.drawCircle(cx + 22, buildingTop + 60, 6, 239, 68, 68, true);
  cv.fillRect(buildingLeft + 50, base - 8, 14, 8, 100, 116, 139);
  cv.fillRect(buildingLeft + 68, base - 10, 12, 10, 71, 85, 105);
}

function drawCartagenaMarket(cv, ox, oy) {
  const cx = ox + 70;
  const base = oy + 215;
  const storeLeft = cx - 48;
  const storeWidth = 96;
  const storeTop = oy + 54;

  // Storefront building wall
  cv.fillRect(storeLeft, storeTop, storeWidth, base - storeTop, 100, 116, 139);

  // Signboard banner: "MARKET"
  cv.fillRect(storeLeft + 4, storeTop + 8, storeWidth - 8, 24, 15, 23, 42);
  cv.drawRect(storeLeft + 4, storeTop + 8, storeWidth - 8, 24, 245, 158, 11, 2);
  cv.drawText('MARKET', storeLeft + 16, storeTop + 14, 1, 254, 240, 138, 2);

  // Striped awning canopy
  const awningTop = storeTop + 36;
  const awningH = 24;
  const stripeW = 8;
  for (let sx = storeLeft - 2; sx < storeLeft + storeWidth + 2; sx += stripeW) {
    const isRed = Math.floor((sx - (storeLeft - 2)) / stripeW) % 2 === 0;
    const col = isRed ? [220, 38, 38] : [248, 250, 252];
    cv.fillRect(sx, awningTop, stripeW, awningH, col[0], col[1], col[2]);
  }

  // Large display windows & central double door
  const groundTop = awningTop + awningH + 6;
  const groundH = base - groundTop;
  cv.fillRect(storeLeft + 6, groundTop, 24, groundH - 6, 147, 197, 253); // left display
  cv.fillRect(storeLeft + storeWidth - 30, groundTop, 24, groundH - 6, 147, 197, 253); // right display

  // Double glass doors in center
  const doorLeft = cx - 14;
  const doorWidth = 28;
  cv.fillRect(doorLeft, groundTop, doorWidth, groundH, 30, 41, 59);
  cv.drawRect(doorLeft, groundTop, doorWidth, groundH, 203, 213, 225, 2);
  cv.fillRect(cx - 1, groundTop + 2, 2, groundH - 2, 203, 213, 225); // split
  cv.fillRect(cx - 5, groundTop + 24, 2, 14, 245, 158, 11); // left handle
  cv.fillRect(cx + 3, groundTop + 24, 2, 14, 245, 158, 11); // right handle

  // Police / cordon bar indicator at door base
  cv.fillRect(storeLeft - 4, base - 8, storeWidth + 8, 6, 234, 179, 8);
}

function drawHelicopterCrash(cv, ox, oy) {
  const cx = ox + 70;
  const cy = oy + 120;

  // Main rotor mast & spinning blades
  cv.fillRect(cx + 2, cy - 32, 6, 12, 148, 163, 184); // mast
  cv.fillRect(cx - 52, cy - 36, 114, 4, 248, 250, 252); // rotor blade
  cv.fillRect(cx - 56, cy - 38, 6, 8, 239, 68, 68); // blade tip
  cv.fillRect(cx + 56, cy - 38, 6, 8, 239, 68, 68); // blade tip

  // Fuselage body (military helicopter profile)
  cv.fillRect(cx - 24, cy - 20, 56, 34, 71, 85, 105);
  // Rounded nose
  cv.fillRect(cx + 32, cy - 14, 14, 22, 71, 85, 105);
  // Cockpit canopy window (tinted)
  cv.fillRect(cx + 18, cy - 18, 24, 16, 56, 189, 248);

  // Tail boom extending left
  cv.fillRect(cx - 58, cy - 14, 34, 12, 71, 85, 105);
  // Vertical tail stabilizer
  cv.fillRect(cx - 64, cy - 30, 8, 28, 100, 116, 139);
  // Tail rotor blade
  cv.fillRect(cx - 68, cy - 34, 4, 18, 203, 213, 225);

  // Landing skids
  cv.fillRect(cx - 8, cy + 14, 4, 16, 148, 163, 184); // strut 1
  cv.fillRect(cx + 20, cy + 14, 4, 16, 148, 163, 184); // strut 2
  cv.fillRect(cx - 20, cy + 30, 56, 4, 203, 213, 225); // skid rail
  cv.fillRect(cx + 34, cy + 26, 6, 4, 203, 213, 225); // curved tip

  // Warning exclamation / emergency indicator badge
  cv.drawCircle(cx, oy + 196, 15, 239, 68, 68, true);
  cv.drawCircle(cx, oy + 196, 17, 254, 240, 138, false);
  cv.drawText('!', cx - 4, oy + 188, 2, 255, 255, 255, 0);
}

function drawGrokLawsuit(cv, ox, oy) {
  const cx = ox + 70;
  const base = oy + 215;

  // Smartphone body
  const phoneW = 72;
  const phoneH = 142;
  const phoneX = cx - 36;
  const phoneY = oy + 42;

  cv.fillRect(phoneX, phoneY, phoneW, phoneH, 51, 65, 85);
  cv.drawRect(phoneX, phoneY, phoneW, phoneH, 100, 116, 139, 2);

  // Screen area
  cv.fillRect(phoneX + 6, phoneY + 12, phoneW - 12, phoneH - 24, 15, 23, 42);

  // Speaker notch & home indicator
  cv.fillRect(cx - 8, phoneY + 4, 16, 3, 148, 163, 184);
  cv.fillRect(cx - 10, phoneY + phoneH - 7, 20, 2, 148, 163, 184);

  // Chat speech bubbles
  // Outgoing user bubble (right side)
  cv.fillRect(phoneX + 18, phoneY + 24, 38, 22, 37, 99, 235);
  cv.fillRect(phoneX + 22, phoneY + 30, 24, 3, 255, 255, 255);
  cv.fillRect(phoneX + 22, phoneY + 36, 16, 3, 255, 255, 255);

  // Incoming Grok AI bubble (left side)
  cv.fillRect(phoneX + 10, phoneY + 54, 42, 26, 30, 41, 59);
  cv.fillRect(phoneX + 14, phoneY + 60, 32, 3, 244, 63, 94);
  cv.fillRect(phoneX + 14, phoneY + 66, 26, 3, 244, 63, 94);
  cv.fillRect(phoneX + 14, phoneY + 72, 18, 3, 244, 63, 94);

  // Legal balance scale badge in front of lower screen
  const scaleY = phoneY + 98;
  cv.fillRect(cx - 2, scaleY, 4, 26, 245, 158, 11); // stem
  cv.fillRect(cx - 18, scaleY + 4, 36, 3, 245, 158, 11); // crossbeam
  // Left pan
  cv.drawLine(cx - 16, scaleY + 5, cx - 22, scaleY + 16, 245, 158, 11, 1);
  cv.drawLine(cx - 16, scaleY + 5, cx - 10, scaleY + 16, 245, 158, 11, 1);
  cv.fillRect(cx - 24, scaleY + 16, 16, 3, 245, 158, 11);
  // Right pan
  cv.drawLine(cx + 16, scaleY + 5, cx + 10, scaleY + 16, 245, 158, 11, 1);
  cv.drawLine(cx + 16, scaleY + 5, cx + 22, scaleY + 16, 245, 158, 11, 1);
  cv.fillRect(cx + 8, scaleY + 16, 16, 3, 245, 158, 11);
  // Base
  cv.fillRect(cx - 10, scaleY + 24, 20, 3, 245, 158, 11);
}

// Generate the complete deterministic poster
function generatePoster() {
  const width = 1024;
  const height = 1024;
  const cv = new Canvas(width, height);

  // Canvas background (deep obsidian)
  cv.fillRect(0, 0, width, height, 9, 13, 22);

  // Top banner (y: 0 to 110)
  cv.fillRect(0, 0, width, 110, 15, 23, 42);
  cv.fillRect(0, 108, width, 3, 56, 189, 248); // Cyan bottom accent line

  // Banner titles
  const titleText = 'WORLD NEWS';
  const titleW = cv.measureText(titleText, 5, 4);
  cv.drawText(titleText, Math.floor((width - titleW) / 2), 22, 5, 255, 255, 255, 4);

  const dateText = 'TUESDAY, 24 NOVEMBER 2026';
  const dateW = cv.measureText(dateText, 2, 2);
  cv.drawText(dateText, Math.floor((width - dateW) / 2), 74, 2, 251, 191, 36, 2);

  // Six story definitions (exact wording from specification)
  const stories = [
    {
      col: 0,
      row: 0,
      accent: [239, 68, 68],
      headline: 'Riyadh tower hit again, 11 wounded',
      sublabel: null,
      drawPictogram: drawRiyadhTower
    },
    {
      col: 1,
      row: 0,
      accent: [245, 158, 11],
      headline: 'Huawei convicted on 10 of 12 counts',
      sublabel: 'Brooklyn jury',
      drawPictogram: drawHuaweiCourthouse
    },
    {
      col: 0,
      row: 1,
      accent: [244, 63, 94],
      headline: 'Zaporizhzhia strike: 2 killed, dozens wounded',
      sublabel: null,
      drawPictogram: drawZaporizhzhiaStrike
    },
    {
      col: 1,
      row: 1,
      accent: [168, 85, 247],
      headline: '25 held hostage in Cartagena supermarket',
      sublabel: null,
      drawPictogram: drawCartagenaMarket
    },
    {
      col: 0,
      row: 2,
      accent: [14, 165, 233],
      headline: 'Turkish military helicopter crash kills 5',
      sublabel: null,
      drawPictogram: drawHelicopterCrash
    },
    {
      col: 1,
      row: 2,
      accent: [16, 185, 129],
      headline: 'US states sue SpaceX over Grok images',
      sublabel: null,
      drawPictogram: drawGrokLawsuit
    }
  ];

  // Grid dimensions
  const colW = 472;
  const rowH = 270;
  const colX = [24, 528];
  const rowY = [130, 425, 720];

  for (const story of stories) {
    const cardX = colX[story.col];
    const cardY = rowY[story.row];

    // Card background & borders
    cv.fillRect(cardX, cardY, colW, rowH, 24, 33, 47);
    cv.drawRect(cardX, cardY, colW, rowH, 45, 59, 82, 1);
    // Card top accent bar
    cv.fillRect(cardX, cardY, colW, 3, story.accent[0], story.accent[1], story.accent[2]);

    // Pictogram panel
    const picX = cardX + 16;
    const picY = cardY + 16;
    const picW = 140;
    const picH = 238;
    cv.fillRect(picX, picY, picW, picH, 13, 19, 33);
    cv.drawRect(picX, picY, picW, picH, 34, 46, 68, 1);

    // Draw the story pictogram
    story.drawPictogram(cv, picX, picY);

    // Text area
    const textX = cardX + 172;
    const textY = cardY + 36;
    const maxTextW = 284;

    const endY = cv.drawWrappedText(story.headline, textX, textY, maxTextW, 2, 248, 250, 252, 26, 2);

    // Optional sublabel pill
    if (story.sublabel) {
      const pillY = endY + 16;
      const subW = cv.measureText(story.sublabel, 2, 2);
      cv.fillRect(textX, pillY, subW + 20, 28, 30, 41, 59);
      cv.drawRect(textX, pillY, subW + 20, 28, 71, 85, 105, 1);
      cv.drawText(story.sublabel, textX + 10, pillY + 7, 2, 147, 197, 253, 2);
    }
  }

  return encodeRgbPng(width, height, cv.buffer);
}

// Main execution
const targetDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const targetFile = join(targetDir, 'entry.png');

mkdirSync(targetDir, { recursive: true });

const pngData = generatePoster();
writeFileSync(targetFile, pngData);

const stat = statSync(targetFile);
if (!stat.isFile() || stat.size === 0) {
  throw new Error(`Output file invalid or empty at ${targetFile}`);
}

const MAX_BYTES = 1048576; // 1 MiB limit
if (stat.size > MAX_BYTES) {
  throw new Error(`Output file exceeds 1 MiB limit (${stat.size} > ${MAX_BYTES})`);
}

console.log(`Generated ${targetFile} (${stat.size} bytes, dimensions 1024x1024)`);
