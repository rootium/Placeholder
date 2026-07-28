# Changelog

## v1.0.0 — 2026-07-28

First release. Everything below works with no server, no account and no upload.

### Print engine

- Ten engines: risograph, halftone, duotone, ordered dither, error diffusion,
  screenprint, engraving (crosshatch), cyanotype, contour and ASCII mosaic.
- Two ways to separate ink: tone stacking, and a subtractive colour separation
  with grey component replacement.
- Real overprinting. Inks multiply onto the paper, so two of them make a proper
  third colour. A screen blend covers pale ink on dark stock.
- Auto-levels on the source, so dark or flat photos don't screen down to a
  black rectangle.
- Everything is resolution independent — the preview and the 4000px export are
  the same drawing.

### Paper and finish

- Paper fibre, slow cloudy mottling, film grain, edge shading.
- Optional torn deckle edge.

### Layout

- Six layouts: gallery, museum, Swiss, zine, editorial, full bleed.
- Six paper sizes from square to 9:16.
- Typesetting with letter tracking, wrapping and automatic overflow trimming.
- Type colours adapt to the paper, so they stay readable on dark stock.

### Styles

- Sixteen presets built on real Risograph and process ink colours.
- Every ink and the paper colour can be changed.

### The app

- Drop, paste or browse for a photo.
- The style picker renders every style on *your* photo.
- Fine-tune panel: detail, brightness, contrast, warmth, grain, paper texture,
  edge shade.
- "Surprise me" for a random style and layout.
- Export to PNG or JPG at up to 4000px.
- Settings persist between visits. The photo never does.
- Responsive to 390px, keyboard reachable, respects `prefers-reduced-motion`.

### Tools

- `tools/make-samples.mjs` — draws the four sample photos from scratch, with a
  small PNG encoder built on Node's zlib.
- `tools/contact-sheet.html` — every style against every sample on one page.
- `tools/promo.html` — builds the Open Graph and README images from the real
  engine.
