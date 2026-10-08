// Rewrites an opaque RGBA PNG as RGB. App Store Connect rejects the 1024px app icon if it
// has an alpha channel at all (ITMS-90717), even a fully opaque one, and
// safari-web-extension-converter generates it as RGBA.
// Usage: node scripts/strip-icon-alpha.mjs <icon.png>...
import { readFileSync, writeFileSync } from "node:fs";
import { deflateSync, inflateSync, crc32 } from "node:zlib";

function chunks(buf) {
  const out = [];
  for (let pos = 8; pos < buf.length;) {
    const len = buf.readUInt32BE(pos);
    out.push({
      type: buf.toString("latin1", pos + 4, pos + 8),
      data: buf.subarray(pos + 8, pos + 8 + len),
    });
    pos += 12 + len;
  }
  return out;
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
  return Buffer.concat([head, data, crc]);
}

function unfilter(raw, width, height, bpp) {
  const stride = width * bpp;
  const out = Buffer.alloc(stride * height);
  for (let y = 0, i = 0; y < height; y++) {
    const filter = raw[i++];
    for (let x = 0; x < stride; x++, i++) {
      const a = x >= bpp ? out[y * stride + x - bpp] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y > 0 ? out[(y - 1) * stride + x - bpp] : 0;
      let pred = 0;
      if (filter === 1) pred = a;
      else if (filter === 2) pred = b;
      else if (filter === 3) pred = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a),
          pb = Math.abs(p - b),
          pc = Math.abs(p - c);
        pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[y * stride + x] = (raw[i] + pred) & 255;
    }
  }
  return out;
}

for (const file of process.argv.slice(2)) {
  const png = readFileSync(file);
  const parts = chunks(png);
  const ihdr = parts.find((c) => c.type === "IHDR").data;
  const [width, height, depth, colorType, , , interlace] = [
    ihdr.readUInt32BE(0),
    ihdr.readUInt32BE(4),
    ihdr[8],
    ihdr[9],
    ihdr[10],
    ihdr[11],
    ihdr[12],
  ];
  if (colorType !== 6) {
    console.log(`${file}: no alpha channel, unchanged`);
    continue;
  }
  if (depth !== 8 || interlace !== 0)
    throw new Error(`${file}: only 8-bit, non-interlaced PNGs are supported`);
  const rgba = unfilter(
    inflateSync(Buffer.concat(parts.filter((c) => c.type === "IDAT").map((c) => c.data))),
    width,
    height,
    4,
  );
  const rgb = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0, o = 0; y < height; y++) {
    rgb[o++] = 0;
    for (let x = 0; x < width; x++) {
      const p = (y * width + x) * 4;
      if (rgba[p + 3] !== 255)
        throw new Error(`${file}: has transparent pixels; flatten it onto a background first`);
      rgb[o++] = rgba[p];
      rgb[o++] = rgba[p + 1];
      rgb[o++] = rgba[p + 2];
    }
  }
  const header = Buffer.from(ihdr);
  header[9] = 2; // truecolor, no alpha
  writeFileSync(
    file,
    Buffer.concat([
      png.subarray(0, 8),
      chunk("IHDR", header),
      chunk("IDAT", deflateSync(rgb, { level: 9 })),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
  console.log(`${file}: alpha channel removed`);
}
