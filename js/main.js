/**
 * Pressd — wiring.
 *
 * Keeps the DOM and the render pipeline in step. Preview renders are cheap and
 * frequent; the full-size render only happens when you hit download.
 */
import { PRESETS, PRESET_BY_ID } from './presets.js';
import { LAYOUTS, SIZES, dimensions } from './render/layout.js';
import { renderPoster, renderSwatch, canvasToBlob } from './render/pipeline.js';
import { SAMPLES, load, save, adoptPreset } from './state.js';

const $ = (sel) => document.querySelector(sel);

const els = {
  stage: $('#stage'),
  poster: $('#poster'),
  badge: $('#stage-badge'),
  note: $('#stage-note'),
  drop: $('#drop'),
  file: $('#file'),
  samples: $('#samples'),
  swatches: $('#swatches'),
  layouts: $('#layouts'),
  sizes: $('#sizes'),
  sliders: $('#sliders'),
  inks: $('#inks'),
  deckle: $('#opt-deckle'),
  reset: $('#btn-reset'),
  title: $('#txt-title'),
  subtitle: $('#txt-subtitle'),
  caption: $('#txt-caption'),
  exportSize: $('#export-size'),
  exportFormat: $('#export-format'),
  download: $('#btn-download'),
  download2: $('#btn-download-2'),
  shuffle: $('#btn-shuffle'),
  busy: $('#busy'),
  busyText: $('#busy-text'),
  toast: $('#toast'),
};

const state = load();
let image = null;
let swatchToken = 0;

/* ------------------------------------------------------------------ *
 * Rendering
 * ------------------------------------------------------------------ */

const PREVIEW_CAP = 1400;
const DRAFT_SCALE = 0.62;

let frame = 0;
let settleTimer = 0;

/**
 * Room available for the poster, in CSS pixels. Always measured before the
 * canvas is touched — measuring after would read a box the canvas itself
 * just inflated.
 */
function stageRoom() {
  const box = els.stage.getBoundingClientRect();
  return {
    w: Math.max(200, box.width - 52),
    h: Math.max(200, box.height - 84),
  };
}

/** Fit a ratio into the room, returning the display size. */
function fitInto(room, ratio) {
  let w = room.w;
  let h = w / ratio;
  if (h > room.h) {
    h = room.h;
    w = h * ratio;
  }
  return { w, h };
}

function paint(quality) {
  const preset = PRESET_BY_ID[state.presetId] || PRESETS[0];
  const room = stageRoom();
  const ratio = (SIZES[state.size] || SIZES.portrait).ratio;
  const disp = fitInto(room, ratio);

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const css = ratio >= 1 ? disp.w : disp.h;
  const longEdge = Math.round(Math.max(360, Math.min(PREVIEW_CAP, css * dpr * quality)));

  const canvas = renderPoster({ image, preset, settings: state, text: state.text, longEdge });

  const out = els.poster;
  // Pin the display size first, so the new backing store never lays out at
  // its own intrinsic size, even for a frame.
  out.style.width = `${Math.round(disp.w)}px`;
  out.style.height = `${Math.round(disp.h)}px`;
  out.width = canvas.width;
  out.height = canvas.height;
  out.getContext('2d').drawImage(canvas, 0, 0);
  els.badge.textContent = preset.label;
}

/**
 * Draw soon. While a control is being dragged we render small and fast, then
 * quietly follow up with a sharp one once things go quiet.
 */
function render({ draft = false } = {}) {
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(() => paint(draft ? DRAFT_SCALE : 1));
  clearTimeout(settleTimer);
  if (draft) {
    settleTimer = setTimeout(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => paint(1));
    }, 230);
  }
  save(state);
}

/** Re-render the style picker against the current photo, a couple at a time. */
function renderSwatches() {
  if (!image) return;
  const token = ++swatchToken;
  const nodes = [...els.swatches.querySelectorAll('.swatch')];
  let i = 0;

  const step = () => {
    if (token !== swatchToken) return;
    const end = Math.min(i + 2, nodes.length);
    for (; i < end; i++) {
      const node = nodes[i];
      const preset = PRESET_BY_ID[node.dataset.id];
      if (!preset) continue;
      const canvas = renderSwatch({ image, preset, settings: state, size: 320 });
      const slot = node.querySelector('canvas, .ph');
      const fresh = document.createElement('canvas');
      fresh.width = canvas.width;
      fresh.height = canvas.height;
      fresh.getContext('2d').drawImage(canvas, 0, 0);
      slot.replaceWith(fresh);
    }
    if (i < nodes.length) setTimeout(step, 0);
  };
  setTimeout(step, 0);
}

/* ------------------------------------------------------------------ *
 * Building the controls
 * ------------------------------------------------------------------ */

function buildSamples() {
  els.samples.innerHTML = '';
  for (const sample of SAMPLES) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.title = sample.label;
    btn.setAttribute('aria-label', sample.label);
    btn.setAttribute('aria-pressed', String(state.sampleId === sample.id));
    const img = document.createElement('img');
    img.src = sample.src;
    img.alt = '';
    img.loading = 'lazy';
    btn.append(img);
    btn.addEventListener('click', () => useSample(sample));
    els.samples.append(btn);
  }
}

function buildSwatches() {
  els.swatches.innerHTML = '';
  for (const preset of PRESETS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'swatch';
    btn.dataset.id = preset.id;
    btn.setAttribute('role', 'radio');
    btn.setAttribute('aria-checked', String(state.presetId === preset.id));
    btn.title = preset.hint;
    const ph = document.createElement('div');
    ph.className = 'ph';
    const name = document.createElement('b');
    name.textContent = preset.label;
    btn.append(ph, name);
    btn.addEventListener('click', () => choosePreset(preset.id));
    els.swatches.append(btn);
  }
}

function buildChips(host, entries, current, onPick) {
  host.innerHTML = '';
  for (const [key, def] of entries) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chip';
    btn.dataset.key = key;
    btn.setAttribute('role', 'radio');
    btn.setAttribute('aria-checked', String(current === key));
    btn.textContent = def.label;
    btn.addEventListener('click', () => {
      onPick(key);
      [...host.children].forEach((c) => c.setAttribute('aria-checked', String(c.dataset.key === key)));
    });
    host.append(btn);
  }
}

const SLIDERS = [
  { key: 'detail', label: null, min: 0, max: 1, step: 0.01, format: (v) => `${Math.round(v * 100)}%` },
  { key: 'tone.exposure', label: 'Brightness', min: -0.6, max: 0.9, step: 0.01, format: (v) => v.toFixed(2) },
  { key: 'tone.contrast', label: 'Contrast', min: -0.3, max: 0.9, step: 0.01, format: (v) => v.toFixed(2) },
  { key: 'tone.warmth', label: 'Warmth', min: -0.6, max: 0.6, step: 0.01, format: (v) => v.toFixed(2) },
  { key: 'grain', label: 'Grain', min: 0, max: 1, step: 0.01, format: (v) => `${Math.round(v * 100)}%` },
  { key: 'fibre', label: 'Paper texture', min: 0, max: 1, step: 0.01, format: (v) => `${Math.round(v * 100)}%` },
  { key: 'vignette', label: 'Edge shade', min: 0, max: 1, step: 0.01, format: (v) => `${Math.round(v * 100)}%` },
];

const getPath = (obj, path) => path.split('.').reduce((o, k) => o?.[k], obj);
function setPath(obj, path, value) {
  const parts = path.split('.');
  const last = parts.pop();
  parts.reduce((o, k) => o[k], obj)[last] = value;
}

function buildSliders() {
  const preset = PRESET_BY_ID[state.presetId] || PRESETS[0];
  els.sliders.innerHTML = '';
  for (const spec of SLIDERS) {
    const label = spec.label ?? preset.detail?.label ?? 'Detail';
    if (spec.key === 'detail' && !preset.detail) continue;

    const row = document.createElement('div');
    row.className = 'slider-row';
    const id = `sl-${spec.key.replace('.', '-')}`;
    const lab = document.createElement('label');
    lab.setAttribute('for', id);
    lab.textContent = label;
    const out = document.createElement('output');
    const input = document.createElement('input');
    input.type = 'range';
    input.id = id;
    input.min = spec.min;
    input.max = spec.max;
    input.step = spec.step;
    input.value = getPath(state, spec.key);
    out.textContent = spec.format(Number(input.value));

    input.addEventListener('input', () => {
      const v = Number(input.value);
      setPath(state, spec.key, v);
      out.textContent = spec.format(v);
      render({ draft: true });
    });

    row.append(lab, out, input);
    els.sliders.append(row);
  }
}

function buildInks() {
  const preset = PRESET_BY_ID[state.presetId] || PRESETS[0];
  const inks = state.inks?.length ? state.inks : preset.inks;
  els.inks.innerHTML = '';

  inks.forEach((hex, i) => {
    els.inks.append(colourChip(hex, `Ink ${i + 1}`, (value) => {
      const next = [...(state.inks?.length ? state.inks : preset.inks)];
      next[i] = value;
      state.inks = next;
      render({ draft: true });
      queueSwatches();
    }));
  });

  els.inks.append(colourChip(state.paper || preset.paper, 'Paper', (value) => {
    state.paper = value;
    render({ draft: true });
    queueSwatches();
  }));
}

function colourChip(hex, label, onChange) {
  const wrap = document.createElement('label');
  wrap.className = 'ink-chip';
  wrap.title = label;
  const input = document.createElement('input');
  input.type = 'color';
  input.value = hex;
  const dot = document.createElement('span');
  dot.style.background = hex;
  const cap = document.createElement('small');
  cap.textContent = label;
  input.addEventListener('input', () => {
    dot.style.background = input.value;
    onChange(input.value);
  });
  wrap.append(input, dot, cap);
  return wrap;
}

let swatchTimer = 0;
function queueSwatches() {
  clearTimeout(swatchTimer);
  swatchTimer = setTimeout(renderSwatches, 320);
}

/* ------------------------------------------------------------------ *
 * Actions
 * ------------------------------------------------------------------ */

function choosePreset(id) {
  adoptPreset(state, id);
  [...els.swatches.children].forEach((c) => c.setAttribute('aria-checked', String(c.dataset.id === id)));
  buildSliders();
  buildInks();
  render();
}

function syncControls() {
  els.title.value = state.text.title;
  els.subtitle.value = state.text.subtitle;
  els.caption.value = state.text.caption;
  els.deckle.checked = state.deckle;
  els.exportSize.value = String(state.exportSize);
  els.exportFormat.value = state.exportFormat;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('That image would not open.'));
    img.src = src;
  });
}

async function useSample(sample) {
  try {
    image = await loadImage(sample.src);
    state.sampleId = sample.id;
    // Give the sample its own words, but never overwrite something typed.
    if (!state.text.title && !state.text.subtitle && !state.text.caption) {
      state.text = { ...sample.text };
      syncControls();
    }
    [...els.samples.children].forEach((c, i) => c.setAttribute('aria-pressed', String(SAMPLES[i].id === sample.id)));
    render();
    renderSwatches();
  } catch (err) {
    toast(err.message);
  }
}

async function useFile(file) {
  if (!file || !file.type.startsWith('image/')) {
    toast('That needs to be an image file.');
    return;
  }
  const url = URL.createObjectURL(file);
  try {
    image = await loadImage(url);
    state.sampleId = null;
    [...els.samples.children].forEach((c) => c.setAttribute('aria-pressed', 'false'));
    els.note.textContent = 'Your photo stays on your device. Nothing is uploaded.';
    render();
    renderSwatches();
    toast('Photo loaded.');
  } catch (err) {
    toast(err.message);
  } finally {
    // The <img> has decoded by now, so the blob URL can go.
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
}

function busy(on, text = 'Printing…') {
  els.busyText.textContent = text;
  els.busy.hidden = !on;
}

let toastTimer = 0;
function toast(message) {
  els.toast.textContent = message;
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { els.toast.hidden = true; }, 2600);
}

async function download() {
  const preset = PRESET_BY_ID[state.presetId] || PRESETS[0];
  const longEdge = Number(state.exportSize) || 2000;
  const format = state.exportFormat || 'image/png';
  const { W, H } = dimensions(state.size, longEdge);

  busy(true, longEdge >= 3000 ? `Printing at ${W}×${H}. Big ones take a moment…` : 'Printing…');
  // Let the overlay actually paint before we hog the main thread.
  await new Promise((r) => setTimeout(r, 60));

  try {
    const canvas = renderPoster({ image, preset, settings: state, text: state.text, longEdge });
    const blob = await canvasToBlob(canvas, format, 0.94);
    if (!blob) throw new Error('The browser would not save that file.');

    const ext = format === 'image/jpeg' ? 'jpg' : 'png';
    const stamp = new Date().toISOString().slice(0, 10);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `pressd-${preset.id}-${stamp}.${ext}`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 8000);
    toast(`Saved — ${W}×${H}, ${(blob.size / 1024 / 1024).toFixed(1)} MB`);
  } catch (err) {
    toast(err.message || 'Something went wrong saving that.');
  } finally {
    busy(false);
  }
}

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function shuffle() {
  const preset = pick(PRESETS.filter((p) => p.id !== state.presetId));
  adoptPreset(state, preset.id);
  state.layout = pick(Object.keys(LAYOUTS));
  state.seed = Math.floor(Math.random() * 9999);
  // Nudge the style off its default so two shuffles never look identical.
  state.detail = Math.min(1, Math.max(0, state.detail + (Math.random() - 0.5) * 0.3));

  [...els.swatches.children].forEach((c) => c.setAttribute('aria-checked', String(c.dataset.id === preset.id)));
  [...els.layouts.children].forEach((c) => c.setAttribute('aria-checked', String(c.dataset.key === state.layout)));
  buildSliders();
  buildInks();
  render();
  toast(`${preset.label} · ${LAYOUTS[state.layout].label}`);
}

/* ------------------------------------------------------------------ *
 * Events
 * ------------------------------------------------------------------ */

function bind() {
  els.drop.addEventListener('click', () => els.file.click());
  els.drop.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      els.file.click();
    }
  });
  els.file.addEventListener('change', () => {
    if (els.file.files?.[0]) useFile(els.file.files[0]);
    els.file.value = '';
  });

  // Drag and drop anywhere on the page.
  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragDepth++;
    document.body.classList.add('dragging');
    els.drop.classList.add('over');
  });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('dragleave', () => {
    if (--dragDepth <= 0) {
      dragDepth = 0;
      document.body.classList.remove('dragging');
      els.drop.classList.remove('over');
    }
  });
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    document.body.classList.remove('dragging');
    els.drop.classList.remove('over');
    const file = e.dataTransfer?.files?.[0];
    if (file) useFile(file);
  });

  // Paste a screenshot straight in.
  window.addEventListener('paste', (e) => {
    const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
    if (item) useFile(item.getAsFile());
  });

  const textDebounce = {};
  const bindText = (el, key) => {
    el.addEventListener('input', () => {
      state.text[key] = el.value;
      clearTimeout(textDebounce[key]);
      textDebounce[key] = setTimeout(() => render(), 140);
    });
  };
  bindText(els.title, 'title');
  bindText(els.subtitle, 'subtitle');
  bindText(els.caption, 'caption');

  els.deckle.addEventListener('change', () => {
    state.deckle = els.deckle.checked;
    render();
  });

  els.reset.addEventListener('click', () => {
    choosePreset(state.presetId);
    toast('Back to the original look.');
  });

  els.exportSize.addEventListener('change', () => { state.exportSize = Number(els.exportSize.value); save(state); });
  els.exportFormat.addEventListener('change', () => { state.exportFormat = els.exportFormat.value; save(state); });

  els.download.addEventListener('click', download);
  els.download2.addEventListener('click', download);
  els.shuffle.addEventListener('click', shuffle);

  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => render(), 180);
  });
}

/* ------------------------------------------------------------------ *
 * Start
 * ------------------------------------------------------------------ */

async function start() {
  buildSamples();
  buildSwatches();
  buildChips(els.layouts, Object.entries(LAYOUTS), state.layout, (key) => {
    state.layout = key;
    render();
  });
  buildChips(els.sizes, Object.entries(SIZES), state.size, (key) => {
    state.size = key;
    render();
  });
  buildSliders();
  buildInks();
  syncControls();
  bind();

  const sample = SAMPLES.find((s) => s.id === state.sampleId) || SAMPLES[0];
  if (!state.text.title && !state.text.subtitle && !state.text.caption) {
    state.text = { ...sample.text };
    syncControls();
  }

  try {
    image = await loadImage(sample.src);
  } catch {
    els.note.textContent = 'Could not load the sample. Drop in a photo of your own to start.';
  }
  render();
  renderSwatches();
}

start();
