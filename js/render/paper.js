/**
 * Paper.
 *
 * Half of why a print looks like a print is the sheet it sits on: fibre,
 * blotchy absorption, a soft falloff at the edges. This module fakes all of
 * that, and adds the grain that goes over the top of everything.
 */
import { clamp, hash, fbm2, makeCanvas, ctxOf } from './core.js';

/**
 * Fill a canvas with paper stock. Fibre is fine high-frequency tooth; the
 * mottle is the slow, cloudy variation you see when you hold a sheet to light.
 */
export function layPaper(ctx, w, h, { colour, fibre = 0.5, seed = 7 }) {
  ctx.fillStyle = `rgb(${colour[0]}, ${colour[1]}, ${colour[2]})`;
  ctx.fillRect(0, 0, w, h);
  if (fibre <= 0) return;

  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const grit = 9 * fibre;
  const cloud = 13 * fibre;
  const step = Math.max(1, Math.round(Math.min(w, h) / 900));

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const f = (hash(x, y, seed) - 0.5) * grit;
      const m = (fbm2(x / (110 * step), y / (110 * step), 4, seed + 3) - 0.5) * cloud;
      const v = f + m;
      d[i] = clamp(d[i] + v, 0, 255);
      d[i + 1] = clamp(d[i + 1] + v, 0, 255);
      d[i + 2] = clamp(d[i + 2] + v * 0.92, 0, 255);
    }
  }
  ctx.putImageData(img, 0, 0);
}

/**
 * Film/print grain over the finished piece. Scales with darkness a little,
 * because shadows always look grainier than highlights.
 */
export function addGrain(ctx, w, h, amount, seed = 11) {
  if (amount <= 0) return;
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const k = amount * 26;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const lum = (d[i] + d[i + 1] + d[i + 2]) / 765;
      const weight = 0.45 + (1 - lum) * 0.85;
      const n = (hash(x, y, seed) - 0.5) * k * weight;
      d[i] = clamp(d[i] + n, 0, 255);
      d[i + 1] = clamp(d[i + 1] + n, 0, 255);
      d[i + 2] = clamp(d[i + 2] + n, 0, 255);
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** A slow darkening toward the corners. Keep it subtle or it looks like 2011. */
export function vignette(ctx, w, h, amount) {
  if (amount <= 0) return;
  const g = ctx.createRadialGradient(
    w / 2, h / 2, Math.min(w, h) * 0.28,
    w / 2, h / 2, Math.hypot(w, h) * 0.62,
  );
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, `rgba(20,14,10,${clamp(amount, 0, 1) * 0.55})`);
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

/**
 * A torn, hand-made edge on the artwork. Builds an irregular mask and knocks
 * the art back out of it, so the paper shows through.
 */
export function deckleMask(w, h, roughness = 1) {
  const c = makeCanvas(w, h);
  const ctx = ctxOf(c);
  const img = ctx.createImageData(w, h);
  const d = img.data;
  const bite = Math.max(3, Math.min(w, h) * 0.014 * roughness);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      // Wander the edge in and out with layered noise.
      const nx = fbm2(x / 26, y / 26, 3, 41) - 0.5;
      const edge = Math.min(x, y, w - 1 - x, h - 1 - y) + nx * bite * 2.4;
      const a = clamp(edge / bite, 0, 1);
      d[i] = 255; d[i + 1] = 255; d[i + 2] = 255;
      d[i + 3] = Math.round(a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Apply a mask's alpha to a canvas in place. */
export function maskCanvas(canvas, mask) {
  const ctx = ctxOf(canvas);
  ctx.save();
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(mask, 0, 0, canvas.width, canvas.height);
  ctx.restore();
}
