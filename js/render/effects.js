/**
 * The print engine.
 *
 * Every engine takes source pixels and returns pixels that look like ink on
 * paper. They all share one idea: work out how much of each ink covers each
 * spot, then overprint those inks the way a real press would — by multiplying,
 * not by pasting.
 *
 *   engine(srcImageData, options) -> ImageData
 */
import {
  clamp, lerp, smoothstep, lumaOf, makeCanvas, ctxOf,
  hash, fbm2, BAYER8,
} from './core.js';

/* ------------------------------------------------------------------ *
 * Ink separation
 * ------------------------------------------------------------------ */

/**
 * Split an image into one coverage map per ink (0 = bare paper, 1 = solid).
 *
 * 'tone' stacks the inks by darkness, the way a two-colour riso print is
 * usually built: the pale ink carries the midtones, the dark ink drops into
 * the shadows on top.
 *
 * 'colour' does a real subtractive separation — it asks each ink how much of
 * the pixel's missing light it can account for, then hands the remainder on.
 */
export function separate(src, inks, mode = 'tone', opts = {}) {
  const { data, width: w, height: h } = src;
  const n = inks.length;
  const px = w * h;
  const maxInk = opts.maxInk ?? 0.96;
  const spread = opts.spread ?? 0.58;
  const layers = [];
  for (let i = 0; i < n; i++) layers.push(new Float32Array(px));

  if (mode === 'colour') {
    // How much light each ink removes, per channel.
    const demand = inks.map((ink) => [1 - ink[0] / 255, 1 - ink[1] / 255, 1 - ink[2] / 255]);
    const totals = demand.map((d) => d[0] + d[1] + d[2]);

    // Grey component replacement. Printers pull the neutral part of a colour
    // out with black first; without it, the chromatic inks fight over the
    // shadows and one of them wins the whole picture.
    let kIdx = 0;
    for (let i = 1; i < n; i++) if (totals[i] > totals[kIdx]) kIdx = i;
    const useGCR = n > 1 && totals[kIdx] > 2.0;
    const gcr = opts.gcr ?? 0.78;

    // Chromatic inks, palest first — a pale ink can't cover for a strong one.
    const order = inks
      .map((_, i) => i)
      .filter((i) => !(useGCR && i === kIdx))
      .sort((a, b) => totals[a] - totals[b]);

    // Channels this weak can't constrain anything; letting them try just
    // vetoes inks that should have been laid down.
    const FLOOR = 0.12;

    for (let p = 0, i = 0; p < px; p++, i += 4) {
      let rr = 1 - data[i] / 255;
      let gg = 1 - data[i + 1] / 255;
      let bb = 1 - data[i + 2] / 255;

      if (useGCR) {
        const d = demand[kIdx];
        const grey = Math.min(rr, gg, bb);
        const amt = clamp((grey / Math.max(d[0], d[1], d[2])) * gcr, 0, maxInk);
        layers[kIdx][p] = amt;
        rr = Math.max(0, rr - amt * d[0]);
        gg = Math.max(0, gg - amt * d[1]);
        bb = Math.max(0, bb - amt * d[2]);
      }

      for (let k = 0; k < order.length; k++) {
        const idx = order[k];
        const d = demand[idx];
        let amt = Infinity;
        if (d[0] > FLOOR) amt = Math.min(amt, rr / d[0]);
        if (d[1] > FLOOR) amt = Math.min(amt, gg / d[1]);
        if (d[2] > FLOOR) amt = Math.min(amt, bb / d[2]);
        amt = Number.isFinite(amt) ? clamp(amt, 0, maxInk) : 0;
        layers[idx][p] = amt;
        rr = Math.max(0, rr - amt * d[0]);
        gg = Math.max(0, gg - amt * d[1]);
        bb = Math.max(0, bb - amt * d[2]);
      }
    }
    return layers;
  }

  // Tone mode: darkness drives a stack of overlapping ramps.
  const dark = inks.map((ink) => 1 - lumaOf(ink[0], ink[1], ink[2]) / 255);
  const order = inks.map((_, i) => i).sort((a, b) => dark[a] - dark[b]);
  const lo = [];
  const hi = [];
  for (let k = 0; k < n; k++) {
    const start = n === 1 ? 0 : (k / n) * (1 - spread * 0.5);
    lo[order[k]] = start;
    hi[order[k]] = Math.min(1, start + spread);
  }

  for (let p = 0, i = 0; p < px; p++, i += 4) {
    const d = 1 - lumaOf(data[i], data[i + 1], data[i + 2]) / 255;
    for (let k = 0; k < n; k++) {
      layers[k][p] = smoothstep(lo[k], hi[k], d) * maxInk;
    }
  }
  return layers;
}

/* ------------------------------------------------------------------ *
 * Compositing
 * ------------------------------------------------------------------ */

/**
 * Lay inked layers down on paper. Inks multiply, so two on top of each other
 * make a third colour instead of hiding one another — that overprint is what
 * sells the look.
 */
export function compose(layers, paper, w, h, blend = 'multiply') {
  const out = new ImageData(w, h);
  const d = out.data;
  const px = w * h;
  // 'screen' is for pale ink on dark stock — blueprints, darkroom negatives —
  // where multiplying would just leave the sheet black.
  const screen = blend === 'screen';
  for (let p = 0, i = 0; p < px; p++, i += 4) {
    let r = paper[0];
    let g = paper[1];
    let b = paper[2];
    for (let k = 0; k < layers.length; k++) {
      const a = layers[k].alpha[p];
      if (a <= 0.002) continue;
      const ink = layers[k].ink;
      if (screen) {
        r = 255 - (255 - r) * (1 - (a * ink[0]) / 255);
        g = 255 - (255 - g) * (1 - (a * ink[1]) / 255);
        b = 255 - (255 - b) * (1 - (a * ink[2]) / 255);
        continue;
      }
      r *= 1 - a + (a * ink[0]) / 255;
      g *= 1 - a + (a * ink[1]) / 255;
      b *= 1 - a + (a * ink[2]) / 255;
    }
    d[i] = r;
    d[i + 1] = g;
    d[i + 2] = b;
    d[i + 3] = 255;
  }
  return out;
}

/** Read a black-on-white scratch canvas back as a coverage map. */
function maskOf(canvas, w, h) {
  const img = ctxOf(canvas).getImageData(0, 0, w, h);
  const src = img.data;
  const out = new Float32Array(w * h);
  for (let p = 0, i = 0; p < w * h; p++, i += 4) out[p] = 1 - src[i] / 255;
  return out;
}

function scratch(w, h) {
  const c = makeCanvas(w, h);
  const ctx = ctxOf(c);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#000';
  ctx.strokeStyle = '#000';
  return { c, ctx };
}

/** Sample a coverage map with a whole-pixel offset, for misregistration. */
function shifted(cov, w, h, dx, dy) {
  if (!dx && !dy) return cov;
  const out = new Float32Array(w * h);
  const ox = Math.round(dx);
  const oy = Math.round(dy);
  for (let y = 0; y < h; y++) {
    const sy = clamp(y - oy, 0, h - 1);
    for (let x = 0; x < w; x++) {
      out[y * w + x] = cov[sy * w + clamp(x - ox, 0, w - 1)];
    }
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Engines
 * ------------------------------------------------------------------ */

/** Continuous tone. The inks sit flat, no screen at all. */
export function duotone(src, o) {
  const { width: w, height: h } = src;
  const cov = separate(src, o.inks, o.sep, o);
  return compose(cov.map((alpha, k) => ({ alpha, ink: o.inks[k] })), o.paper, w, h, o.blend);
}

/**
 * Riso. Stochastic screening plus a deliberately sloppy registration —
 * each colour drum lands a hair off the last one, which is exactly why
 * riso prints look alive.
 */
export function riso(src, o) {
  const { width: w, height: h } = src;
  const scale = o.scale ?? 1;
  const cov = separate(src, o.inks, o.sep, o);
  const grit = clamp(o.grain ?? 0.55, 0, 1);
  const slip = (o.offset ?? 2.2) * scale;
  const density = o.density ?? 0.93;
  // Grain clumps at a fixed size relative to the sheet, not the pixel grid,
  // so the texture survives both the preview and a 4000px print.
  const cs = Math.max(1, Math.round(1.7 * scale));
  const rollScale = 46 * scale;
  const layers = [];

  for (let k = 0; k < cov.length; k++) {
    const ang = (k * 2.399) + 0.6;
    const c = shifted(cov[k], w, h, Math.cos(ang) * slip, Math.sin(ang) * slip);
    const alpha = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      const gy = (y / cs) | 0;
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        const a = c[p];
        if (a <= 0.002) continue;
        // Uneven roller pressure: a slow wobble across the sheet.
        const roll = 0.90 + fbm2(x / rollScale, y / rollScale, 3, k * 11) * 0.24;
        const want = Math.min(1, a * roll);
        // A stochastic screen is a coin flip per grain, weighted by coverage.
        // That keeps grain in the solids too, instead of only in the ramps.
        const screened = want > hash((x / cs) | 0, gy, k * 97 + 3) ? 1 : 0;
        alpha[p] = (want * (1 - grit) + screened * grit) * density;
      }
    }
    layers.push({ alpha, ink: o.inks[k] });
  }
  return compose(layers, o.paper, w, h, o.blend);
}

/** Proper rotated dot screens, one angle per ink, like offset litho. */
export function halftone(src, o) {
  const { width: w, height: h } = src;
  const scale = o.scale ?? 1;
  const cell = Math.max(2.2, (o.cell ?? 7) * scale);
  const cov = separate(src, o.inks, o.sep, o);
  const shape = o.shape ?? 'dot';
  const base = (o.angle ?? 15) * (Math.PI / 180);
  const angles = [0, 75, 15, 45, 60].map((a) => base + a * (Math.PI / 180));
  const diag = Math.ceil(Math.hypot(w, h) / cell) + 2;
  const layers = [];

  for (let k = 0; k < cov.length; k++) {
    const { c, ctx } = scratch(w, h);
    const a = angles[k % angles.length];
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const cx = w / 2;
    const cy = h / 2;
    const map = cov[k];

    ctx.beginPath();
    for (let j = -diag; j <= diag; j++) {
      for (let i = -diag; i <= diag; i++) {
        // Grid point, rotated about the middle of the sheet.
        const gx = i * cell;
        const gy = j * cell;
        const x = cx + gx * ca - gy * sa;
        const y = cy + gx * sa + gy * ca;
        if (x < -cell || y < -cell || x > w + cell || y > h + cell) continue;
        const sx = clamp(Math.round(x), 0, w - 1);
        const sy = clamp(Math.round(y), 0, h - 1);
        const v = map[sy * w + sx];
        if (v <= 0.004) continue;
        // Area scales with coverage, so mid-grey really is 50% ink.
        const r = Math.sqrt(v) * cell * 0.78;
        if (shape === 'square') {
          ctx.rect(x - r, y - r, r * 2, r * 2);
        } else if (shape === 'line') {
          ctx.rect(x - cell * 0.6, y - r, cell * 1.2, r * 2);
        } else {
          ctx.moveTo(x + r, y);
          ctx.arc(x, y, r, 0, Math.PI * 2);
        }
      }
    }
    ctx.fill();
    layers.push({ alpha: maskOf(c, w, h), ink: o.inks[k] });
  }
  return compose(layers, o.paper, w, h, o.blend);
}

/**
 * Build the palette a limited-ink press can actually hit: bare paper, each
 * ink alone, and every overprint combination of them.
 */
function overprintPalette(inks, paper) {
  const out = [];
  const n = Math.min(inks.length, 4);
  for (let mask = 0; mask < 1 << n; mask++) {
    let c = [paper[0], paper[1], paper[2]];
    for (let k = 0; k < n; k++) {
      if (mask & (1 << k)) {
        c = [(c[0] * inks[k][0]) / 255, (c[1] * inks[k][1]) / 255, (c[2] * inks[k][2]) / 255];
      }
    }
    out.push(c);
  }
  return out;
}

function nearest(pal, r, g, b) {
  let best = 0;
  let bd = Infinity;
  for (let i = 0; i < pal.length; i++) {
    const dr = r - pal[i][0];
    const dg = g - pal[i][1];
    const db = b - pal[i][2];
    // Weighted to match how the eye actually judges a near miss.
    const d = dr * dr * 0.30 + dg * dg * 0.59 + db * db * 0.11;
    if (d < bd) { bd = d; best = i; }
  }
  return pal[best];
}

/** Ordered dither. Hard, regular, unmistakably printed. */
export function dither(src, o) {
  const { width: w, height: h } = src;
  const scale = Math.max(1, Math.round((o.cell ?? 1) * (o.scale ?? 1)));
  const pal = overprintPalette(o.inks, o.paper);
  const strength = (o.strength ?? 1) * 96;
  const out = new ImageData(w, h);
  const s = src.data;
  const d = out.data;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const t = BAYER8[(((y / scale) | 0) % 8) * 8 + (((x / scale) | 0) % 8)] - 0.5;
      const c = nearest(pal, s[i] + t * strength, s[i + 1] + t * strength, s[i + 2] + t * strength);
      d[i] = c[0];
      d[i + 1] = c[1];
      d[i + 2] = c[2];
      d[i + 3] = 255;
    }
  }
  return out;
}

/** Floyd-Steinberg. Softer and more organic than the ordered grid. */
export function diffuse(src, o) {
  const { width: w, height: h } = src;
  const pal = overprintPalette(o.inks, o.paper);
  const buf = new Float32Array(w * h * 3);
  const s = src.data;
  for (let p = 0, i = 0; p < w * h; p++, i += 4) {
    buf[p * 3] = s[i];
    buf[p * 3 + 1] = s[i + 1];
    buf[p * 3 + 2] = s[i + 2];
  }
  const out = new ImageData(w, h);
  const d = out.data;
  const bleed = o.strength ?? 1;

  for (let y = 0; y < h; y++) {
    // Serpentine scanning stops the error from streaking one way.
    const ltr = y % 2 === 0;
    for (let n = 0; n < w; n++) {
      const x = ltr ? n : w - 1 - n;
      const p = y * w + x;
      const c = nearest(pal, buf[p * 3], buf[p * 3 + 1], buf[p * 3 + 2]);
      const er = (buf[p * 3] - c[0]) * bleed;
      const eg = (buf[p * 3 + 1] - c[1]) * bleed;
      const eb = (buf[p * 3 + 2] - c[2]) * bleed;
      const i = p * 4;
      d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;

      const push = (xx, yy, f) => {
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) return;
        const q = (yy * w + xx) * 3;
        buf[q] += er * f;
        buf[q + 1] += eg * f;
        buf[q + 2] += eb * f;
      };
      const step = ltr ? 1 : -1;
      push(x + step, y, 7 / 16);
      push(x - step, y + 1, 3 / 16);
      push(x, y + 1, 5 / 16);
      push(x + step, y + 1, 1 / 16);
    }
  }
  return out;
}

/** Screenprint: flat blocks of solid ink, no gradient anywhere. */
export function screenprint(src, o) {
  const { width: w, height: h } = src;
  const levels = Math.max(2, o.levels ?? 4);
  const cov = separate(src, o.inks, o.sep, o);
  const layers = cov.map((c, k) => {
    const alpha = new Float32Array(c.length);
    for (let p = 0; p < c.length; p++) {
      // Quantise, then let the edges wobble like a hand-pulled squeegee.
      const q = Math.round(c[p] * (levels - 1)) / (levels - 1);
      alpha[p] = q;
    }
    return { alpha, ink: o.inks[k] };
  });
  // Soften the hard steps with a touch of paper texture at the boundaries.
  const wob = o.wobble ?? 0.5;
  if (wob > 0) {
    for (const L of layers) {
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const p = y * w + x;
          if (L.alpha[p] > 0.02 && L.alpha[p] < 0.99) {
            const f = 9 * (o.scale ?? 1);
            L.alpha[p] = clamp(L.alpha[p] + (fbm2(x / f, y / f, 2, 5) - 0.5) * 0.10 * wob, 0, 1);
          }
        }
      }
    }
  }
  return compose(layers, o.paper, w, h, o.blend);
}

const ASCII_RAMP = ' .:-=+*o#%@';

/** Type mosaic. Every cell becomes the character with the right weight. */
export function ascii(src, o) {
  const { width: w, height: h } = src;
  const scale = o.scale ?? 1;
  const cell = Math.max(4, (o.cell ?? 10) * scale);
  const { data } = src;
  const { c, ctx } = scratch(w, h);
  ctx.font = `700 ${cell * 1.16}px ui-monospace, "SF Mono", Menlo, Consolas, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#000';

  // On dark stock the ink is the light, so a bright pixel wants the heavy
  // character — otherwise a terminal renders as its own negative.
  const invert = o.blend === 'screen';
  const cols = Math.ceil(w / cell);
  const rows = Math.ceil(h / cell);
  for (let ry = 0; ry < rows; ry++) {
    for (let rx = 0; rx < cols; rx++) {
      // Average the cell rather than point-sampling it, or fine detail flickers.
      let sum = 0;
      let count = 0;
      const x0 = rx * cell;
      const y0 = ry * cell;
      for (let y = y0 | 0; y < Math.min(h, y0 + cell); y += 2) {
        for (let x = x0 | 0; x < Math.min(w, x0 + cell); x += 2) {
          const i = (y * w + x) * 4;
          sum += lumaOf(data[i], data[i + 1], data[i + 2]);
          count++;
        }
      }
      if (!count) continue;
      const mean = sum / count / 255;
      const dark = invert ? mean : 1 - mean;
      const idx = Math.round(dark * (ASCII_RAMP.length - 1));
      const ch = ASCII_RAMP[idx];
      if (ch === ' ') continue;
      ctx.fillText(ch, x0 + cell / 2, y0 + cell / 2);
    }
  }
  return compose([{ alpha: maskOf(c, w, h), ink: o.inks[o.inks.length - 1] }], o.paper, w, h, o.blend);
}

/** Cyanotype: the old sun-print process. Exposed blue, bleached highlights. */
export function sunprint(src, o) {
  const { width: w, height: h } = src;
  const { data } = src;
  const alpha = new Float32Array(w * h);
  const bloom = o.bloom ?? 0.45;
  for (let p = 0, i = 0; p < w * h; p++, i += 4) {
    const l = lumaOf(data[i], data[i + 1], data[i + 2]) / 255;
    // Sun prints blow out their highlights and hold shadow detail.
    let v = 1 - Math.pow(l, 1 + bloom * 1.4);
    v = clamp(v * 1.06 - 0.04, 0, 1);
    alpha[p] = v;
  }
  // Uneven brush-coated emulsion around the edges.
  if (o.wash !== false) {
    const wf = 70 * (o.scale ?? 1);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        const edge = Math.min(x / (w * 0.06), y / (h * 0.06), (w - x) / (w * 0.06), (h - y) / (h * 0.06));
        const brush = 0.55 + fbm2(x / wf, y / wf, 3, 21) * 0.75;
        alpha[p] *= lerp(brush, 1, clamp(edge, 0, 1));
      }
    }
  }
  const ink = o.inks[o.inks.length - 1];
  return compose([{ alpha, ink }], o.paper, w, h, o.blend);
}

/** Topographic map: the image sliced into height bands with lines between. */
export function contour(src, o) {
  const { width: w, height: h } = src;
  const { data } = src;
  const levels = Math.max(3, o.levels ?? 9);
  const band = new Uint8Array(w * h);
  for (let p = 0, i = 0; p < w * h; p++, i += 4) {
    band[p] = Math.round((lumaOf(data[i], data[i + 1], data[i + 2]) / 255) * (levels - 1));
  }
  const fill = new Float32Array(w * h);
  const line = new Float32Array(w * h);
  const lineW = Math.max(1, Math.round((o.lineWidth ?? 1) * (o.scale ?? 1)));

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      const b = band[p];
      fill[p] = (1 - b / (levels - 1)) * (o.fill ?? 0.5);
      let edge = false;
      for (let d = 1; d <= lineW && !edge; d++) {
        if (x + d < w && band[p + d] !== b) edge = true;
        if (y + d < h && band[p + d * w] !== b) edge = true;
      }
      if (edge) line[p] = 1;
    }
  }
  const inks = o.inks;
  return compose([
    { alpha: fill, ink: inks[0] },
    { alpha: line, ink: inks[inks.length - 1] },
  ], o.paper, w, h, o.blend);
}

/**
 * Crosshatch, the way an engraver builds tone: one direction for the light
 * greys, more layers crossing over as it gets darker.
 */
export function hatch(src, o) {
  const { width: w, height: h } = src;
  const { data } = src;
  const scale = o.scale ?? 1;
  const gap = Math.max(2.5, (o.spacing ?? 7) * scale);
  // Never let a hatch line fall below a pixel, or the whole plate greys out.
  const thick = Math.max(0.9, (o.lineWidth ?? 1.5) * scale);
  const dirs = [30, 120, 75, 165].map((d) => d * (Math.PI / 180));
  const passes = Math.min(4, Math.max(1, o.passes ?? 4));
  const inks = o.inks;
  const layers = inks.map((ink) => ({ alpha: new Float32Array(w * h), ink }));

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      const i = p * 4;
      const dark = 1 - lumaOf(data[i], data[i + 1], data[i + 2]) / 255;
      for (let k = 0; k < passes; k++) {
        const need = (k + 0.55) / (passes + 0.4);
        if (dark < need) continue;
        const a = dirs[k];
        // Distance to the nearest hatch line in this direction.
        const t = (x * Math.cos(a) + y * Math.sin(a)) / gap;
        const dist = Math.abs(t - Math.round(t)) * gap;
        const cov = 1 - smoothstep(thick * 0.5 - 0.6, thick * 0.5 + 0.6, dist);
        if (cov <= 0) continue;
        const strength = clamp((dark - need) * 3.2, 0.35, 1);
        const layer = layers[k % layers.length];
        layer.alpha[p] = Math.max(layer.alpha[p], cov * strength);
      }
    }
  }
  return compose(layers, o.paper, w, h, o.blend);
}

export const ENGINES = {
  duotone, riso, halftone, dither, diffuse, screenprint, ascii, sunprint, contour, hatch,
};
