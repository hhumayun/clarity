import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { createHash } from "node:crypto";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "icons");
const TEAL = [0x3e, 0x8e, 0x8c, 0xff];
const WHITE = [0xff, 0xff, 0xff, 0xff];

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4);
  data.copy(out, 8);
  const crcBuf = Buffer.concat([Buffer.from(type), data]);
  out.writeUInt32BE(crc32(crcBuf), 8 + data.length);
  return out;
}

function encodePng(width, height, pixels) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    pixels.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function fill(pixels, color) {
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = color[0];
    pixels[i + 1] = color[1];
    pixels[i + 2] = color[2];
    pixels[i + 3] = color[3];
  }
}

function blend(pixels, width, x, y, color, a) {
  if (x < 0 || y < 0 || x >= width || y >= width) return;
  const i = (y * width + x) * 4;
  const ia = 1 - a;
  pixels[i] = Math.round(pixels[i] * ia + color[0] * a);
  pixels[i + 1] = Math.round(pixels[i + 1] * ia + color[1] * a);
  pixels[i + 2] = Math.round(pixels[i + 2] * ia + color[2] * a);
  pixels[i + 3] = 255;
}

function strokeLine(pixels, width, x0, y0, x1, y1, radius, color) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const steps = Math.max(2, Math.ceil(Math.hypot(dx, dy) * 2));
  for (let s = 0; s <= steps; s++) {
    const cx = x0 + (dx * s) / steps;
    const cy = y0 + (dy * s) / steps;
    const minX = Math.floor(cx - radius - 1);
    const maxX = Math.ceil(cx + radius + 1);
    const minY = Math.floor(cy - radius - 1);
    const maxY = Math.ceil(cy + radius + 1);
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        const a = Math.max(0, Math.min(1, radius + 0.55 - d));
        if (a > 0) blend(pixels, width, x, y, color, a);
      }
    }
  }
}

function strokeEllipse(pixels, size, cx, cy, rx, ry, angle, radius, color) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const steps = Math.ceil(2 * Math.PI * Math.max(rx, ry) * 2);
  for (let s = 0; s <= steps; s++) {
    const t = (s / steps) * Math.PI * 2;
    const lx = Math.cos(t) * rx;
    const ly = Math.sin(t) * ry;
    const x = cx + lx * cos - ly * sin;
    const y = cy + lx * sin + ly * cos;
    const minX = Math.floor(x - radius - 1);
    const maxX = Math.ceil(x + radius + 1);
    const minY = Math.floor(y - radius - 1);
    const maxY = Math.ceil(y + radius + 1);
    for (let py = minY; py <= maxY; py++) {
      for (let px = minX; px <= maxX; px++) {
        const d = Math.hypot(px + 0.5 - x, py + 0.5 - y);
        const a = Math.max(0, Math.min(1, radius + 0.55 - d));
        if (a > 0) blend(pixels, size, px, py, color, a);
      }
    }
  }
}

function drawFeather(pixels, size, inset = 0.22) {
  const cx = size * 0.5;
  const cy = size * 0.5;
  const span = size * (0.5 - inset);
  const angle = -Math.PI / 4;
  const stroke = size * 0.026;
  // Leaf-shaped vane, then the quill through its centre.
  strokeEllipse(pixels, size, cx, cy, span * 1.05, span * 0.38, angle, stroke, WHITE);
  strokeLine(
    pixels,
    size,
    cx - Math.cos(angle) * span * 1.15,
    cy - Math.sin(angle) * span * 1.15,
    cx + Math.cos(angle) * span * 1.15,
    cy + Math.sin(angle) * span * 1.15,
    stroke,
    WHITE,
  );
  // Two veins, like Lucide's Feather.
  const mid = size * 0.12;
  strokeLine(
    pixels,
    size,
    cx - mid,
    cy + mid * 0.15,
    cx + mid * 0.35,
    cy - mid * 0.15,
    stroke * 0.85,
    WHITE,
  );
  strokeLine(
    pixels,
    size,
    cx + mid * 0.55,
    cy - mid * 0.85,
    cx + mid * 1.05,
    cy - mid * 0.35,
    stroke * 0.75,
    WHITE,
  );
}

function makeIcon(size, inset) {
  const pixels = Buffer.alloc(size * size * 4);
  fill(pixels, TEAL);
  drawFeather(pixels, size, inset);
  return encodePng(size, size, pixels);
}

await mkdir(ROOT, { recursive: true });
const files = {
  "icon-512.png": makeIcon(512, 0.22),
  "icon-192.png": makeIcon(192, 0.22),
  "apple-touch-icon.png": makeIcon(180, 0.22),
  "icon-maskable-512.png": makeIcon(512, 0.3),
};
for (const [name, data] of Object.entries(files)) {
  const path = join(ROOT, name);
  await new Promise((resolve, reject) => {
    createWriteStream(path).end(data, (err) => (err ? reject(err) : resolve()));
  });
  const hash = createHash("sha1").update(data).digest("hex").slice(0, 8);
  console.log(`${name} ${data.length} bytes png ${hash}`);
}
