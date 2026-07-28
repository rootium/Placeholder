/**
 * Poster layouts.
 *
 * Each layout works out where the artwork sits, then draws the type around it.
 * Everything is sized as a fraction of the poster width, so a 1080px preview
 * and a 4000px print come out identical.
 */
import { clamp, lumaOf } from './core.js';

const SANS = '"Helvetica Neue", Helvetica, Arial, "Segoe UI", Roboto, sans-serif';
const SERIF = 'Georgia, "Iowan Old Style", "Times New Roman", Times, serif';
const MONO = 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace';

/* ------------------------------------------------------------------ *
 * Typesetting
 * ------------------------------------------------------------------ */

function setFont(ctx, size, family, weight = 400, italic = false) {
  ctx.font = `${italic ? 'italic ' : ''}${weight} ${Math.max(1, size)}px ${family}`;
}

function widthOf(ctx, str, track) {
  let w = 0;
  let n = 0;
  for (const ch of str) {
    w += ctx.measureText(ch).width + track;
    n++;
  }
  return n ? w - track : 0;
}

/** Draw a line letter by letter so we control the tracking ourselves. */
function fillTracked(ctx, str, x, y, track, align = 'left') {
  const w = widthOf(ctx, str, track);
  let cx = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
  const prevAlign = ctx.textAlign;
  ctx.textAlign = 'left';
  for (const ch of str) {
    ctx.fillText(ch, cx, y);
    cx += ctx.measureText(ch).width + track;
  }
  ctx.textAlign = prevAlign;
  return w;
}

function wrapLines(ctx, str, maxWidth, track) {
  const words = String(str).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (widthOf(ctx, test, track) > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Draw a block of text and report how tall it was.
 * `y` is the top of the block, not a baseline — easier to stack things.
 */
function block(ctx, str, o) {
  if (!str) return 0;
  const {
    x, y, size, family = SANS, weight = 400, italic = false,
    track = 0, align = 'left', colour = '#000', upper = false,
    maxWidth = Infinity, leading = 1.15, maxLines = 4,
  } = o;
  setFont(ctx, size, family, weight, italic);
  ctx.fillStyle = colour;
  ctx.textBaseline = 'alphabetic';
  const text = upper ? String(str).toUpperCase() : String(str);
  let lines = wrapLines(ctx, text, maxWidth, track);
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    lines[maxLines - 1] = `${lines[maxLines - 1].replace(/[\s.,;:]+$/, '')}…`;
  }
  const step = size * leading;
  lines.forEach((line, i) => fillTracked(ctx, line, x, y + size * 0.80 + i * step, track, align));
  return step * (lines.length - 1) + size * 1.02;
}

function rule(ctx, x, y, w, thickness, colour) {
  ctx.fillStyle = colour;
  ctx.fillRect(x, y, w, Math.max(1, thickness));
}

/* ------------------------------------------------------------------ *
 * Layouts
 * ------------------------------------------------------------------ */

const has = (o) => Boolean((o.title || '').trim() || (o.subtitle || '').trim() || (o.caption || '').trim());

/** Wide bottom margin, type ranged left. The default gallery hang. */
function gallery(W, H, o) {
  const m = W * 0.085;
  if (!has(o)) {
    const s = Math.min(m, H * 0.06);
    return { art: { x: s, y: s, w: W - s * 2, h: H - s * 2 }, type: () => {} };
  }
  const foot = W * 0.255;
  const art = { x: m, y: m, w: W - m * 2, h: H - m - foot };
  return {
    art,
    type(ctx) {
      let y = art.y + art.h + W * 0.062;
      y += block(ctx, o.title, {
        x: m, y, size: W * 0.058, family: SERIF, weight: 400,
        track: W * -0.0004, colour: o.ink, maxWidth: W - m * 2, maxLines: 2, leading: 1.08,
      });
      if (o.subtitle) {
        y += W * 0.022;
        block(ctx, o.subtitle, {
          x: m, y, size: W * 0.0175, family: MONO, weight: 500, upper: true,
          track: W * 0.0022, colour: o.muted, maxWidth: W * 0.58, maxLines: 1,
        });
      }
      if (o.caption) {
        block(ctx, o.caption, {
          x: W - m, y: art.y + art.h + W * 0.062, size: W * 0.0175, family: MONO,
          weight: 500, upper: true, track: W * 0.0022, align: 'right',
          colour: o.muted, maxWidth: W * 0.34, maxLines: 1,
        });
      }
    },
  };
}

/** Keyline frame and a centred plaque underneath, like a wall label. */
function museum(W, H, o) {
  const m = W * 0.095;
  const foot = has(o) ? W * 0.245 : m;
  const art = { x: m, y: m, w: W - m * 2, h: H - m - foot };
  return {
    art,
    type(ctx) {
      // Hairline keyline just outside the artwork.
      const k = Math.max(1, W * 0.0012);
      ctx.strokeStyle = o.muted;
      ctx.lineWidth = k;
      ctx.strokeRect(art.x - k * 3, art.y - k * 3, art.w + k * 6, art.h + k * 6);
      if (!has(o)) return;

      const cx = W / 2;
      let y = art.y + art.h + W * 0.070;
      if (o.subtitle) {
        y += block(ctx, o.subtitle, {
          x: cx, y, size: W * 0.0165, family: MONO, weight: 500, upper: true,
          track: W * 0.0040, align: 'center', colour: o.muted, maxWidth: W - m * 2, maxLines: 1,
        }) + W * 0.020;
      }
      y += block(ctx, o.title, {
        x: cx, y, size: W * 0.049, family: SERIF, italic: true, weight: 400,
        align: 'center', colour: o.ink, maxWidth: W - m * 2.4, maxLines: 2, leading: 1.12,
      });
      if (o.caption) {
        y += W * 0.018;
        block(ctx, o.caption, {
          x: cx, y, size: W * 0.0155, family: MONO, weight: 400, upper: true,
          track: W * 0.0026, align: 'center', colour: o.muted, maxWidth: W - m * 2, maxLines: 1,
        });
      }
    },
  };
}

/** Big display type up top, rule, then the artwork. Swiss poster grammar. */
function swiss(W, H, o) {
  const m = W * 0.068;
  if (!has(o)) return gallery(W, H, o);

  // Measure the headline before committing to an artwork height.
  const probe = { size: W * 0.098, lines: 1 };
  return {
    art: null,
    plan(ctx) {
      setFont(ctx, probe.size, SANS, 800);
      const lines = wrapLines(ctx, (o.title || '').toUpperCase(), W - m * 2, probe.size * -0.030);
      probe.lines = Math.max(1, Math.min(3, lines.length));
      const head = m + probe.size * 0.92 * probe.lines + W * 0.030;
      const foot = W * 0.058;
      return { x: m, y: head, w: W - m * 2, h: H - head - foot };
    },
    type(ctx, art) {
      block(ctx, o.title, {
        x: m, y: m, size: probe.size, family: SANS, weight: 800, upper: true,
        track: probe.size * -0.030, colour: o.ink, maxWidth: W - m * 2,
        maxLines: 3, leading: 0.92,
      });
      rule(ctx, m, art.y - W * 0.020, W - m * 2, W * 0.0035, o.ink);
      const baseY = art.y + art.h + W * 0.032;
      if (o.subtitle) {
        block(ctx, o.subtitle, {
          x: m, y: baseY, size: W * 0.0172, family: MONO, weight: 500, upper: true,
          track: W * 0.0024, colour: o.muted, maxWidth: W * 0.60, maxLines: 1,
        });
      }
      if (o.caption) {
        block(ctx, o.caption, {
          x: W - m, y: baseY, size: W * 0.0172, family: MONO, weight: 500, upper: true,
          track: W * 0.0024, align: 'right', colour: o.muted, maxWidth: W * 0.36, maxLines: 1,
        });
      }
    },
  };
}

/** Full bleed with a solid ink block knocked out of the bottom corner. */
function zine(W, H, o) {
  const art = { x: 0, y: 0, w: W, h: H };
  return {
    art,
    type(ctx) {
      if (!has(o)) return;
      const pad = W * 0.045;
      const size = W * 0.070;
      setFont(ctx, size, SANS, 800);
      const lines = wrapLines(ctx, (o.title || '').toUpperCase(), W * 0.72, size * -0.02).slice(0, 2);
      const subH = o.subtitle ? W * 0.040 : 0;
      const boxH = pad * 2 + size * 0.92 * lines.length + subH;
      const boxW = Math.min(W * 0.86, Math.max(
        W * 0.42,
        Math.max(...lines.map((l) => widthOf(ctx, l, size * -0.02))) + pad * 2,
      ));
      const boxY = H - boxH - H * 0.055;

      ctx.fillStyle = o.accent;
      ctx.fillRect(0, boxY, boxW, boxH);

      let y = boxY + pad;
      y += block(ctx, o.title, {
        x: pad, y, size, family: SANS, weight: 800, upper: true, track: size * -0.02,
        colour: o.paperHex, maxWidth: boxW - pad * 2, maxLines: 2, leading: 0.92,
      });
      if (o.subtitle) {
        y += W * 0.012;
        block(ctx, o.subtitle, {
          x: pad, y, size: W * 0.0175, family: MONO, weight: 600, upper: true,
          track: W * 0.0026, colour: o.paperHex, maxWidth: boxW - pad * 2, maxLines: 1,
        });
      }
      if (o.caption) {
        block(ctx, o.caption, {
          x: W - W * 0.045, y: H - H * 0.055 - W * 0.030, size: W * 0.0165, family: MONO,
          weight: 600, upper: true, track: W * 0.0026, align: 'right',
          colour: o.paperHex, maxWidth: W * 0.30, maxLines: 1,
        });
      }
    },
  };
}

/** Editorial: a narrow column of type beside a tall block of artwork. */
function index(W, H, o) {
  const m = W * 0.060;
  if (!has(o)) return gallery(W, H, o);
  const col = W * 0.255;
  const gap = W * 0.045;
  const art = { x: m + col + gap, y: m, w: W - m * 2 - col - gap, h: H - m * 2 };
  return {
    art,
    type(ctx) {
      let y = m;
      rule(ctx, m, y, col, W * 0.0030, o.ink);
      y += W * 0.026;
      y += block(ctx, o.title, {
        x: m, y, size: W * 0.042, family: SERIF, weight: 400, colour: o.ink,
        maxWidth: col, maxLines: 4, leading: 1.10,
      });
      if (o.subtitle) {
        y += W * 0.022;
        y += block(ctx, o.subtitle, {
          x: m, y, size: W * 0.0155, family: MONO, weight: 500, upper: true,
          track: W * 0.0022, colour: o.muted, maxWidth: col, maxLines: 3, leading: 1.5,
        });
      }
      if (o.caption) {
        block(ctx, o.caption, {
          x: m, y: H - m - W * 0.020, size: W * 0.0150, family: MONO, weight: 500,
          upper: true, track: W * 0.0022, colour: o.muted, maxWidth: col, maxLines: 2, leading: 1.5,
        });
      }
    },
  };
}

/** No type, no margin. Just the picture. */
function bleed(W, H) {
  return { art: { x: 0, y: 0, w: W, h: H }, type: () => {} };
}

export const LAYOUTS = {
  gallery: { label: 'Gallery', build: gallery },
  museum: { label: 'Museum', build: museum },
  swiss: { label: 'Swiss', build: swiss },
  zine: { label: 'Zine', build: zine },
  index: { label: 'Editorial', build: index },
  bleed: { label: 'Full bleed', build: bleed },
};

/* ------------------------------------------------------------------ *
 * Paper sizes
 * ------------------------------------------------------------------ */

export const SIZES = {
  square: { label: 'Square', ratio: 1 },
  portrait: { label: 'Portrait 4:5', ratio: 4 / 5 },
  print: { label: 'A-print', ratio: 1 / Math.SQRT2 },
  story: { label: 'Story 9:16', ratio: 9 / 16 },
  landscape: { label: 'Landscape 3:2', ratio: 3 / 2 },
  wide: { label: 'Wide 16:9', ratio: 16 / 9 },
};

/** Poster pixel dimensions for a ratio at a given longest edge. */
export function dimensions(sizeKey, longEdge) {
  const ratio = (SIZES[sizeKey] || SIZES.portrait).ratio;
  if (ratio >= 1) return { W: Math.round(longEdge), H: Math.round(longEdge / ratio) };
  return { W: Math.round(longEdge * ratio), H: Math.round(longEdge) };
}

/**
 * Resolve a layout to a final artwork rectangle plus a type-drawing callback.
 * Some layouts need the canvas to measure their headline first.
 */
export function planLayout(name, W, H, textOpts, ctx) {
  const def = LAYOUTS[name] || LAYOUTS.gallery;
  const built = def.build(W, H, textOpts);
  const art = built.art || built.plan(ctx);
  return {
    art: {
      x: Math.round(art.x),
      y: Math.round(art.y),
      w: Math.max(8, Math.round(art.w)),
      h: Math.max(8, Math.round(art.h)),
    },
    drawType: (c, rect) => built.type(c, rect),
  };
}

/**
 * Pick type colours that stay readable whatever the stock is.
 * Dark paper flips the whole thing: the palest ink becomes the type colour.
 */
export function typeColours(inks, paper) {
  const paperLum = lumaOf(paper[0], paper[1], paper[2]);
  const onDark = paperLum < 118;
  const sorted = [...inks].sort((a, b) => lumaOf(...a) - lumaOf(...b));
  const darkest = sorted[0];
  const lightest = sorted[sorted.length - 1];

  let ink = onDark ? lightest : darkest;
  // Not enough separation from the sheet? Use plain black or plain white.
  if (Math.abs(lumaOf(...ink) - paperLum) < 55) ink = onDark ? [244, 241, 234] : [30, 27, 25];

  const hex = (c) => `rgb(${Math.round(c[0])}, ${Math.round(c[1])}, ${Math.round(c[2])})`;
  const muted = ink.map((v, i) => clamp(v * 0.62 + paper[i] * 0.38, 0, 255));
  // The zine block needs an ink that the paper colour reads clearly against.
  const accent = onDark ? lightest : darkest;
  return { ink: hex(ink), muted: hex(muted), paperHex: hex(paper), accent: hex(accent) };
}
