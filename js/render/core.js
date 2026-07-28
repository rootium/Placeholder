/**
 * Small shared helpers for the print engine.
 * Colour maths, canvas plumbing, noise.
 */

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;

export function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0 || 1e-6), 0, 1);
  return t * t * (3 - 2 * t);
}

/** '#ff5544' or '#f54' -> [255, 85, 68] */
export function hexToRgb(hex) {
  let h = hex.replace('#', '').trim();
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]) {
  const c = (v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Perceptual luminance, 0-255. */
export const lumaOf = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** Two colours multiplied, the way two translucent inks overprint. */
export function multiply(a, b) {
  return [(a[0] * b[0]) / 255, (a[1] * b[1]) / 255, (a[2] * b[2]) / 255];
}

export function makeCanvas(w, h) {
  const c = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(w, h)
    : Object.assign(document.createElement('canvas'), { width: w, height: h });
  c.width = w;
  c.height = h;
  return c;
}

export function ctxOf(canvas, opts) {
  return canvas.getContext('2d', { willReadFrequently: true, ...opts });
}

/**
 * Draw a source image into a w x h box, cropping to fill (like CSS
 * object-fit: cover). Returns the ImageData.
 */
export function fitCover(img, w, h) {
  const c = makeCanvas(w, h);
  const ctx = ctxOf(c);
  const sw = img.naturalWidth || img.width;
  const sh = img.naturalHeight || img.height;
  const scale = Math.max(w / sw, h / sh);
  const dw = sw * scale;
  const dh = sh * scale;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
  return ctx.getImageData(0, 0, w, h);
}

/**
 * Exposure / contrast / warmth, applied before any ink is separated out.
 * Working on the source keeps every engine consistent.
 */
export function preAdjust(img, { exposure = 0, contrast = 0, warmth = 0, autoLevel = 0.7 } = {}) {
  const d = img.data;
  // Most photos don't use the full tonal range, and an ink engine only has
  // the range it's given — a flat, dark snapshot screens down to a black
  // rectangle. Stretch it first and every style behaves.
  if (autoLevel > 0) {
    const hist = new Uint32Array(256);
    for (let i = 0; i < d.length; i += 4) hist[lumaOf(d[i], d[i + 1], d[i + 2]) | 0]++;
    const total = d.length / 4;
    const cut = total * 0.005;
    let lo = 0;
    let hi = 255;
    for (let sum = 0, v = 0; v < 256; v++) { sum += hist[v]; if (sum > cut) { lo = v; break; } }
    for (let sum = 0, v = 255; v >= 0; v--) { sum += hist[v]; if (sum > cut) { hi = v; break; } }

    // Don't amplify an image that genuinely has no range — that's just noise.
    if (hi - lo > 28) {
      const gain = 255 / (hi - lo);
      const map = new Uint8ClampedArray(256);
      for (let v = 0; v < 256; v++) {
        map[v] = clamp(v + ((v - lo) * gain - v) * autoLevel, 0, 255);
      }
      for (let i = 0; i < d.length; i += 4) {
        d[i] = map[d[i]];
        d[i + 1] = map[d[i + 1]];
        d[i + 2] = map[d[i + 2]];
      }
    }
  }
  const exp = Math.pow(2, exposure);
  const con = 1 + contrast;
  const wr = 1 + warmth * 0.28;
  const wb = 1 - warmth * 0.28;
  const lut = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) {
    let v = (i / 255) * exp;
    v = (v - 0.5) * con + 0.5;
    lut[i] = clamp(v * 255, 0, 255);
  }
  for (let i = 0; i < d.length; i += 4) {
    d[i] = clamp(lut[d[i]] * wr, 0, 255);
    d[i + 1] = lut[d[i + 1]];
    d[i + 2] = clamp(lut[d[i + 2]] * wb, 0, 255);
  }
  return img;
}

/* ------------------------------------------------------------------ *
 * Noise
 * ------------------------------------------------------------------ */

/** Deterministic per-pixel hash, 0..1. Same input, same grain, every render. */
export function hash(x, y, seed = 0) {
  let n = (x * 374761393 + y * 668265263 + seed * 1274126177) | 0;
  n = (n ^ (n >> 13)) * 1274126177;
  return ((n ^ (n >> 16)) >>> 0) / 4294967295;
}

/** Smooth value noise, for paper fibre and cloudy ink washes. */
export function noise2(x, y, seed = 0) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  return lerp(
    lerp(hash(xi, yi, seed), hash(xi + 1, yi, seed), u),
    lerp(hash(xi, yi + 1, seed), hash(xi + 1, yi + 1, seed), u),
    v,
  );
}

export function fbm2(x, y, octaves = 4, seed = 0) {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let f = 1;
  for (let i = 0; i < octaves; i++) {
    sum += noise2(x * f, y * f, seed + i * 37) * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return sum / norm;
}

/** The classic 8x8 ordered-dither threshold matrix, normalised to 0..1. */
export const BAYER8 = (() => {
  const m = [
    [0, 32, 8, 40, 2, 34, 10, 42],
    [48, 16, 56, 24, 50, 18, 58, 26],
    [12, 44, 4, 36, 14, 46, 6, 38],
    [60, 28, 52, 20, 62, 30, 54, 22],
    [3, 35, 11, 43, 1, 33, 9, 41],
    [51, 19, 59, 27, 49, 17, 57, 25],
    [15, 47, 7, 39, 13, 45, 5, 37],
    [63, 31, 55, 23, 61, 29, 53, 21],
  ];
  const out = new Float32Array(64);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) out[y * 8 + x] = (m[y][x] + 0.5) / 64;
  return out;
})();
