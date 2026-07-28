/**
 * One render, start to finish.
 *
 * paper -> artwork rectangle -> ink engine -> type -> grain
 *
 * The same function draws the 700px preview and the 4000px print. Every
 * spatial value is scaled off the artwork width, so what you see is what
 * comes out.
 */
import { fitCover, preAdjust, hexToRgb, makeCanvas, ctxOf } from './core.js';
import { ENGINES } from './effects.js';
import { layPaper, addGrain, vignette, deckleMask, maskCanvas } from './paper.js';
import { planLayout, dimensions, typeColours } from './layout.js';
import { detailValue } from '../presets.js';

/** Engine options are tuned against a 1000px-wide artwork. */
const REFERENCE_WIDTH = 1000;

/**
 * @param {object} job
 * @param {HTMLImageElement} job.image   source photo
 * @param {object} job.preset            entry from presets.js
 * @param {object} job.settings          user settings (see state.js)
 * @param {object} job.text              { title, subtitle, caption }
 * @param {number} job.longEdge          output size in pixels
 * @returns {HTMLCanvasElement}
 */
export function renderPoster({ image, preset, settings, text, longEdge }) {
  const { W, H } = dimensions(settings.size, longEdge);
  const canvas = makeCanvas(W, H);
  const ctx = ctxOf(canvas);

  const inks = (settings.inks?.length ? settings.inks : preset.inks).map(hexToRgb);
  const paper = hexToRgb(settings.paper || preset.paper);
  const colours = typeColours(inks, paper);

  // 1. The sheet.
  layPaper(ctx, W, H, { colour: paper, fibre: settings.fibre, seed: settings.seed ?? 7 });

  // 2. Where the artwork goes.
  const { art, drawType } = planLayout(settings.layout, W, H, { ...text, ...colours }, ctx);

  // 3. Ink it.
  if (image) {
    const src = preAdjust(fitCover(image, art.w, art.h), settings.tone);
    // Swatches force a scale so their texture stays readable when small —
    // a true-to-size halftone at 100px would just be a flat colour.
    const scale = settings.scaleOverride ?? art.w / REFERENCE_WIDTH;
    const opts = {
      ...preset.params,
      inks,
      paper,
      blend: preset.blend || 'multiply',
      sep: settings.sep || preset.sep || 'tone',
      scale,
    };
    const detail = detailValue(preset, settings.detail);
    if (detail) opts[detail.key] = detail.value;

    const engine = ENGINES[preset.engine] || ENGINES.duotone;
    const artData = engine(src, opts);

    const artCanvas = makeCanvas(art.w, art.h);
    ctxOf(artCanvas).putImageData(artData, 0, 0);
    if (settings.deckle) maskCanvas(artCanvas, deckleMask(art.w, art.h, 1));
    ctx.drawImage(artCanvas, art.x, art.y);
  }

  // 4. Words.
  drawType(ctx, art);

  // 5. Finishing pass over the whole sheet.
  vignette(ctx, W, H, settings.vignette);
  addGrain(ctx, W, H, settings.grain, (settings.seed ?? 7) + 5);

  return canvas;
}

/**
 * Small square swatch of one style, used for the picker. No type, no margin —
 * just enough to see what the style does to your photo.
 */
export function renderSwatch({ image, preset, settings, size = 320 }) {
  return renderPoster({
    image,
    preset,
    settings: {
      ...settings,
      size: 'square',
      layout: 'bleed',
      deckle: false,
      scaleOverride: 0.5,
      // Swatches use the style's own look, not the user's fine-tuning, so the
      // picker keeps showing what each style actually is.
      detail: preset.detail?.value ?? 0.3,
      inks: null,
      paper: null,
      tone: preset.tone,
      grain: preset.finish.grain * 0.6,
      fibre: preset.finish.fibre * 0.5,
      vignette: preset.finish.vignette,
      sep: preset.sep,
    },
    text: {},
    longEdge: size,
  });
}

export function canvasToBlob(canvas, type = 'image/png', quality = 0.94) {
  if (canvas.convertToBlob) return canvas.convertToBlob({ type, quality });
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}
