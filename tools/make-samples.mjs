/**
 * Builds the sample photographs that ship with Pressd.
 *
 * Everything here is drawn from scratch with maths — no stock photos, no
 * dependencies, no licence to worry about. Writes real PNGs using Node's
 * built-in zlib.
 *
 *   node tools/make-samples.mjs
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'samples');

/* ------------------------------------------------------------------ *
 * PNG writer
 * ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** Pick the row filter with the smallest total deviation. Standard heuristic,
 *  and it makes these gradient-heavy images compress about 4x better. */
function filterRows(rgb, w, h) {
  const bpp = 3;
  const stride = w * bpp;
  const out = Buffer.alloc((stride + 1) * h);
  const prev = Buffer.alloc(stride);
  const cand = [Buffer.alloc(stride), Buffer.alloc(stride), Buffer.alloc(stride), Buffer.alloc(stride), Buffer.alloc(stride)];

  for (let y = 0; y < h; y++) {
    const row = rgb.subarray(y * stride, y * stride + stride);
    const score = [0, 0, 0, 0, 0];

    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? row[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      const p = a + b - c;
      const pa = Math.abs(p - a);
      const pb = Math.abs(p - b);
      const pc = Math.abs(p - c);
      const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;

      cand[0][i] = row[i];
      cand[1][i] = (row[i] - a) & 0xff;
      cand[2][i] = (row[i] - b) & 0xff;
      cand[3][i] = (row[i] - ((a + b) >> 1)) & 0xff;
      cand[4][i] = (row[i] - pr) & 0xff;

      for (let f = 0; f < 5; f++) {
        const v = cand[f][i];
        score[f] += v < 128 ? v : 256 - v;
      }
    }

    let best = 0;
    for (let f = 1; f < 5; f++) if (score[f] < score[best]) best = f;

    out[y * (stride + 1)] = best;
    cand[best].copy(out, y * (stride + 1) + 1);
    row.copy(prev);
  }
  return out;
}

function writePNG(path, rgb, w, h) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 2;   // truecolour
  const idat = deflateSync(filterRows(rgb, w, h), { level: 9 });
  writeFileSync(path, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]));
  return idat.length;
}

/* ------------------------------------------------------------------ *
 * Maths helpers
 * ------------------------------------------------------------------ */

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);
const mix = (c1, c2, t) => [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];

function hash2(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

function valueNoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = smooth(x - xi), yf = smooth(y - yi);
  return lerp(
    lerp(hash2(xi, yi), hash2(xi + 1, yi), xf),
    lerp(hash2(xi, yi + 1), hash2(xi + 1, yi + 1), xf),
    yf,
  );
}

function fbm(x, y, octaves = 5) {
  let v = 0, amp = 0.5, freq = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    v += valueNoise(x * freq, y * freq) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return v / norm;
}

/** A canvas that draws in floating point, so gradients stay clean. */
class Surface {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.buf = new Float32Array(w * h * 3);
  }
  set(x, y, c) {
    const i = (y * this.w + x) * 3;
    this.buf[i] = c[0]; this.buf[i + 1] = c[1]; this.buf[i + 2] = c[2];
  }
  get(x, y) {
    const i = (y * this.w + x) * 3;
    return [this.buf[i], this.buf[i + 1], this.buf[i + 2]];
  }
  /** Alpha-blend a colour over a pixel. */
  over(x, y, c, a) {
    if (a <= 0 || x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 3;
    this.buf[i] = lerp(this.buf[i], c[0], a);
    this.buf[i + 1] = lerp(this.buf[i + 1], c[1], a);
    this.buf[i + 2] = lerp(this.buf[i + 2], c[2], a);
  }
  /** Soft grain + a gentle lens vignette. Makes it read as a photo. */
  finish(grain = 0, vignette = 0.32) {
    const { w, h } = this;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 3;
        const dx = (x / w - 0.5) * 2, dy = (y / h - 0.5) * 2;
        const d = Math.sqrt(dx * dx + dy * dy) / 1.414;
        const v = 1 - vignette * d * d;
        const g = (hash2(x * 0.731, y * 1.317) - 0.5) * grain;
        this.buf[i] = this.buf[i] * v + g;
        this.buf[i + 1] = this.buf[i + 1] * v + g;
        this.buf[i + 2] = this.buf[i + 2] * v + g;
      }
    }
  }
  toRGB() {
    const out = Buffer.alloc(this.w * this.h * 3);
    for (let i = 0; i < out.length; i++) out[i] = clamp(Math.round(this.buf[i]), 0, 255);
    return out;
  }
}

/* ------------------------------------------------------------------ *
 * Scene 1 — mountain ridges at dusk
 * ------------------------------------------------------------------ */

function ridges(w, h) {
  const s = new Surface(w, h);
  const skyTop = [38, 44, 82], skyMid = [216, 118, 96], skyLow = [247, 190, 122];
  const sunX = w * 0.62, sunY = h * 0.40, sunR = w * 0.085;

  for (let y = 0; y < h; y++) {
    const t = y / h;
    const c = t < 0.55 ? mix(skyTop, skyMid, smooth(t / 0.55)) : mix(skyMid, skyLow, smooth((t - 0.55) / 0.45));
    for (let x = 0; x < w; x++) {
      let col = c;
      // sun disc with a soft halo
      const d = Math.hypot(x - sunX, y - sunY);
      if (d < sunR * 6) {
        const halo = Math.pow(clamp(1 - d / (sunR * 6), 0, 1), 2.6);
        col = mix(col, [255, 233, 186], halo * 0.55);
      }
      if (d < sunR) col = mix(col, [255, 246, 214], smooth(clamp((sunR - d) / (sunR * 0.35), 0, 1)));
      s.set(x, y, col);
    }
  }

  // thin cloud bands
  for (let y = 0; y < h * 0.6; y++) {
    for (let x = 0; x < w; x++) {
      const n = fbm(x / (w * 0.35), y / (h * 0.05) + 4, 4);
      const band = Math.pow(clamp((n - 0.52) * 3.2, 0, 1), 1.5) * (1 - y / (h * 0.6));
      if (band > 0.01) s.over(x, y, [255, 214, 190], band * 0.5);
    }
  }

  // six ridge layers, far to near
  const layers = 6;
  for (let L = 0; L < layers; L++) {
    const k = L / (layers - 1);
    const base = h * (0.50 + k * 0.44);
    const amp = h * (0.055 + k * 0.10);
    const near = [26, 24, 40], far = [150, 122, 138];
    const col = mix(far, near, Math.pow(k, 0.75));
    for (let x = 0; x < w; x++) {
      const n = fbm(x / (w * 0.30) + L * 13.7, L * 5.1, 5);
      const n2 = fbm(x / (w * 0.08) + L * 3.3, 9.4, 3);
      const top = base - amp * (n * 1.6 - 0.35) - amp * 0.22 * n2;
      for (let y = Math.max(0, Math.floor(top)); y < h; y++) {
        // a touch of atmospheric haze right at the ridgeline
        const haze = clamp((y - top) / (h * 0.06), 0, 1);
        s.set(x, y, mix(mix(col, [232, 168, 150], 0.22 * (1 - k)), col, haze));
      }
    }
  }

  s.finish(0, 0.30);
  return s;
}

/* ------------------------------------------------------------------ *
 * Scene 2 — city skyline under a big moon
 * ------------------------------------------------------------------ */

function city(w, h) {
  const s = new Surface(w, h);
  const top = [18, 22, 46], bot = [92, 74, 122];
  for (let y = 0; y < h; y++) {
    const c = mix(top, bot, smooth(y / h));
    for (let x = 0; x < w; x++) s.set(x, y, c);
  }

  // stars
  for (let y = 0; y < h * 0.7; y++) {
    for (let x = 0; x < w; x++) {
      const r = hash2(x * 3.11, y * 7.77);
      if (r > 0.99935) s.over(x, y, [255, 255, 240], clamp((r - 0.99935) * 1400, 0, 1) * (1 - y / (h * 0.7)));
    }
  }

  // moon
  const mx = w * 0.30, my = h * 0.22, mr = w * 0.14;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const d = Math.hypot(x - mx, y - my);
      if (d < mr * 4) s.over(x, y, [232, 226, 255], Math.pow(clamp(1 - d / (mr * 4), 0, 1), 3) * 0.4);
      if (d < mr) {
        const crater = fbm(x / (w * 0.02), y / (h * 0.02), 3);
        s.over(x, y, mix([248, 246, 238], [214, 210, 202], crater * 0.7), smooth(clamp((mr - d) / (mr * 0.06), 0, 1)));
      }
    }
  }

  // three depth layers of buildings
  const bands = [
    { base: 0.80, hMin: 0.10, hMax: 0.30, w: 0.055, col: [46, 42, 74], lit: 0.10 },
    { base: 0.88, hMin: 0.14, hMax: 0.40, w: 0.042, col: [30, 27, 52], lit: 0.16 },
    { base: 1.00, hMin: 0.18, hMax: 0.52, w: 0.068, col: [14, 13, 26], lit: 0.22 },
  ];

  for (let bi = 0; bi < bands.length; bi++) {
    const b = bands[bi];
    let x = -Math.floor(hash2(bi, 1) * w * b.w);
    while (x < w) {
      const bw = Math.floor(w * b.w * (0.6 + hash2(x, bi * 3.7) * 0.9));
      const bh = h * lerp(b.hMin, b.hMax, hash2(x * 0.5, bi * 9.1));
      const top = h * b.base - bh;
      for (let yy = Math.max(0, Math.floor(top)); yy < Math.min(h, h * b.base); yy++) {
        for (let xx = Math.max(0, x); xx < Math.min(w, x + bw); xx++) s.set(xx, yy, b.col);
      }
      // lit windows
      const gx = Math.max(3, Math.floor(bw / 7));
      const gy = Math.max(3, Math.floor(bw / 6));
      for (let wy = Math.floor(top) + gy; wy < h * b.base - gy; wy += gy * 2) {
        for (let wx = x + gx; wx < x + bw - gx; wx += gx * 2) {
          if (hash2(wx * 1.7, wy * 2.3) > 1 - b.lit) {
            const glow = mix([255, 214, 138], [255, 246, 214], hash2(wx, wy));
            for (let yy = wy; yy < wy + Math.max(2, gy * 0.8); yy++)
              for (let xx = wx; xx < wx + Math.max(2, gx * 0.7); xx++) s.over(xx, yy, glow, 0.92);
          }
        }
      }
      x += bw + Math.floor(w * 0.004);
    }
  }

  s.finish(0, 0.40);
  return s;
}

/* ------------------------------------------------------------------ *
 * Scene 3 — ocean swell, seen from above
 * ------------------------------------------------------------------ */

function waves(w, h) {
  const s = new Surface(w, h);
  const deep = [12, 46, 84], mid = [26, 104, 148], shal = [88, 192, 196], foam = [238, 248, 250];

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = x / w, v = y / h;
      // stacked swells travelling at slightly different angles
      const s1 = Math.sin((u * 7.5 + v * 2.1) * Math.PI + fbm(u * 3, v * 3, 4) * 3.4);
      const s2 = Math.sin((u * 13.0 - v * 4.4) * Math.PI + fbm(u * 5 + 9, v * 5, 3) * 2.2) * 0.55;
      const s3 = Math.sin((u * 26.0 + v * 9.0) * Math.PI) * 0.18;
      const wave = (s1 + s2 + s3) / 1.73;
      const depth = clamp(v * 1.15 + wave * 0.10, 0, 1);

      let col = depth > 0.5 ? mix(mid, deep, smooth((depth - 0.5) / 0.5)) : mix(shal, mid, smooth(depth / 0.5));
      // sun glitter on the crests
      const crest = clamp((wave - 0.55) / 0.45, 0, 1);
      col = mix(col, foam, Math.pow(crest, 2.2) * 0.85);
      // fine specular sparkle
      const sp = fbm(u * 120, v * 120, 2);
      if (crest > 0.3 && sp > 0.62) col = mix(col, [255, 255, 255], (sp - 0.62) * 1.6 * crest);
      s.set(x, y, col);
    }
  }
  s.finish(0, 0.34);
  return s;
}

/* ------------------------------------------------------------------ *
 * Scene 4 — still life, hard studio light
 * ------------------------------------------------------------------ */

function stillLife(w, h) {
  const s = new Surface(w, h);
  const wallTop = [226, 208, 186], wallBot = [198, 174, 150], table = [148, 106, 78];
  const horizon = h * 0.68;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (y < horizon) {
        // soft studio falloff from the top-left key light
        const fall = 1 - Math.hypot(x / w - 0.30, y / h - 0.12) * 0.62;
        s.set(x, y, mix(wallBot, wallTop, clamp(fall, 0, 1)));
      } else {
        const t = (y - horizon) / (h - horizon);
        s.set(x, y, mix(table, [96, 66, 48], smooth(t)));
      }
    }
  }

  // contact shadows on the table
  const shadow = (cx, cy, rx, ry, a) => {
    for (let y = Math.max(0, Math.floor(cy - ry)); y < Math.min(h, cy + ry); y++)
      for (let x = Math.max(0, Math.floor(cx - rx)); x < Math.min(w, cx + rx); x++) {
        const d = Math.hypot((x - cx) / rx, (y - cy) / ry);
        if (d < 1) s.over(x, y, [52, 34, 28], Math.pow(1 - d, 1.8) * a);
      }
  };

  // a lit sphere with a terminator and a bounce highlight
  const sphere = (cx, cy, r, base, dark) => {
    shadow(cx + r * 0.55, cy + r * 1.02, r * 1.5, r * 0.30, 0.55);
    for (let y = Math.max(0, Math.floor(cy - r)); y < Math.min(h, cy + r); y++) {
      for (let x = Math.max(0, Math.floor(cx - r)); x < Math.min(w, cx + r); x++) {
        const nx = (x - cx) / r, ny = (y - cy) / r;
        const d2 = nx * nx + ny * ny;
        if (d2 > 1) continue;
        const nz = Math.sqrt(1 - d2);
        const light = clamp(nx * -0.52 + ny * -0.60 + nz * 0.61, 0, 1);
        let col = mix(dark, base, Math.pow(light, 0.75));
        const spec = Math.pow(clamp(nx * -0.42 + ny * -0.66 + nz * 0.62, 0, 1), 26);
        col = mix(col, [255, 252, 244], spec * 0.9);
        // bounce from the table
        col = mix(col, [214, 158, 116], clamp(ny, 0, 1) * 0.22);
        const edge = smooth(clamp((1 - Math.sqrt(d2)) / 0.02, 0, 1));
        s.over(x, y, col, edge);
      }
    }
  };

  // a tall vessel
  const vase = (cx, baseY, hh, rw, base, dark) => {
    shadow(cx + rw * 0.9, baseY + hh * 0.02, rw * 2.1, hh * 0.045, 0.5);
    for (let y = Math.floor(baseY - hh); y < baseY; y++) {
      const t = (y - (baseY - hh)) / hh;
      // neck, shoulder, belly, foot
      const prof = 0.42 + 0.58 * Math.sin(Math.pow(t, 0.82) * Math.PI * 0.92 + 0.30);
      const r = rw * clamp(prof, 0.30, 1);
      for (let x = Math.floor(cx - r); x < cx + r; x++) {
        const nx = (x - cx) / r;
        const nz = Math.sqrt(clamp(1 - nx * nx, 0, 1));
        const light = clamp(nx * -0.55 + nz * 0.83, 0, 1);
        let col = mix(dark, base, Math.pow(light, 0.8));
        col = mix(col, [255, 250, 240], Math.pow(clamp(nx * -0.48 + nz * 0.87, 0, 1), 22) * 0.75);
        const edge = smooth(clamp((1 - Math.abs(nx)) / 0.05, 0, 1));
        s.over(x, y, col, edge);
      }
    }
  };

  vase(w * 0.38, horizon + h * 0.075, h * 0.46, w * 0.115, [206, 92, 74], [78, 28, 30]);
  sphere(w * 0.62, horizon + h * 0.005, w * 0.115, [222, 176, 60], [82, 56, 20]);
  sphere(w * 0.755, horizon + h * 0.045, w * 0.072, [120, 148, 92], [38, 50, 32]);

  s.finish(0, 0.36);
  return s;
}

/* ------------------------------------------------------------------ *
 * Build
 * ------------------------------------------------------------------ */

mkdirSync(OUT, { recursive: true });

const jobs = [
  ['ridge.png', ridges, 1280, 1600],
  ['city.png', city, 1280, 1600],
  ['waves.png', waves, 1600, 1200],
  ['still-life.png', stillLife, 1400, 1400],
];

for (const [name, fn, w, h] of jobs) {
  const t0 = Date.now();
  const surf = fn(w, h);
  const bytes = writePNG(resolve(OUT, name), surf.toRGB(), w, h);
  console.log(`${name.padEnd(16)} ${w}x${h}  ${(bytes / 1024).toFixed(0)} KB  ${Date.now() - t0}ms`);
}
