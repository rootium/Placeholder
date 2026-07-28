/**
 * Pressd beta — one decision per screen.
 *
 * Same print engine as the full version. The difference is the shape of the
 * UI: the preview is pinned at the top and never moves, the choices for the
 * current step sit under it, and back/next stay put at the bottom.
 *
 * Nothing here touches the stable app. Even the saved settings live under
 * their own key, so trying the beta can't disturb index.html.
 */
import { PRESETS, PRESET_BY_ID } from './presets.js';
import { LAYOUTS, SIZES } from './render/layout.js';
import { renderPoster, renderSwatch, canvasToBlob } from './render/pipeline.js';
import { SAMPLES, defaults, adoptPreset } from './state.js';

const $ = (s) => document.querySelector(s);
const KEY = 'pressd.beta.v1';

const els = {
  preview: $('#preview'),
  poster: $('#poster'),
  step: $('#step'),
  progress: $('#progress-fill'),
  counter: $('#counter'),
  prev: $('#btn-prev'),
  next: $('#btn-next'),
  shuffle: $('#btn-shuffle'),
  drop: $('#drop'),
  file: $('#file'),
  samples: $('#samples'),
  swatches: $('#swatches'),
  lookHint: $('#look-hint'),
  layouts: $('#layouts'),
  sizes: $('#sizes'),
  qualities: $('#qualities'),
  formats: $('#formats'),
  title: $('#txt-title'),
  subtitle: $('#txt-subtitle'),
  caption: $('#txt-caption'),
  download: $('#btn-download'),
  busy: $('#busy'),
  busyText: $('#busy-text'),
  toast: $('#toast'),
};

const STEPS = ['photo', 'look', 'shape', 'words', 'save'];
const QUALITIES = [
  [1080, 'Web'],
  [2000, 'Big'],
  [3000, 'Print'],
  [4000, 'Huge'],
];
const FORMATS = [
  ['image/png', 'PNG'],
  ['image/jpeg', 'JPG'],
];

let state = loadState();
let image = null;
let stepIndex = 0;
let swatchesBuilt = false;
let swatchToken = 0;

function loadState() {
  const base = adoptPreset(defaults(), defaults().presetId);
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (!saved || !PRESET_BY_ID[saved.presetId]) return base;
    return {
      ...base,
      ...saved,
      tone: { ...base.tone, ...(saved.tone || {}) },
      text: { ...base.text, ...(saved.text || {}) },
    };
  } catch {
    return base;
  }
}

function saveState() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* private mode — not worth bothering anyone about */
  }
}

/* ------------------------------------------------------------------ *
 * Preview
 * ------------------------------------------------------------------ */

let frame = 0;

/** Space the preview band has, measured before the canvas is touched. */
function previewRoom() {
  const box = els.preview.getBoundingClientRect();
  return {
    w: Math.max(140, box.width - 28),
    h: Math.max(140, box.height - 28),
  };
}

function paint() {
  const preset = PRESET_BY_ID[state.presetId] || PRESETS[0];
  const room = previewRoom();
  const ratio = (SIZES[state.size] || SIZES.portrait).ratio;

  let w = room.w;
  let h = w / ratio;
  if (h > room.h) {
    h = room.h;
    w = h * ratio;
  }

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const longEdge = Math.round(Math.max(320, Math.min(1200, (ratio >= 1 ? w : h) * dpr)));
  const canvas = renderPoster({ image, preset, settings: state, text: state.text, longEdge });

  const out = els.poster;
  out.style.width = `${Math.round(w)}px`;
  out.style.height = `${Math.round(h)}px`;
  out.width = canvas.width;
  out.height = canvas.height;
  out.getContext('2d').drawImage(canvas, 0, 0);
}

function render() {
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(paint);
  saveState();
}

/* ------------------------------------------------------------------ *
 * Step machine
 * ------------------------------------------------------------------ */

function showStep(i) {
  stepIndex = Math.max(0, Math.min(STEPS.length - 1, i));
  const name = STEPS[stepIndex];

  for (const pane of els.step.querySelectorAll('.pane')) {
    pane.hidden = pane.dataset.step !== name;
  }
  els.step.scrollTop = 0;

  els.progress.style.width = `${((stepIndex + 1) / STEPS.length) * 100}%`;
  els.counter.textContent = `${stepIndex + 1} / ${STEPS.length}`;
  els.prev.disabled = stepIndex === 0;
  const last = stepIndex === STEPS.length - 1;
  els.next.textContent = last ? 'Download' : 'Next';

  // The style tiles are the expensive bit, so they wait until they're needed.
  if (name === 'look' && !swatchesBuilt) {
    buildSwatches();
    swatchesBuilt = true;
    renderSwatches();
  }
  // The preview band resizes a little as panes change height.
  render();
}

/* ------------------------------------------------------------------ *
 * Building the choices
 * ------------------------------------------------------------------ */

function tile({ checked, label, node, onPick, role = 'radio' }) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'tile';
  btn.setAttribute('role', role);
  btn.setAttribute(role === 'radio' ? 'aria-checked' : 'aria-pressed', String(checked));
  btn.append(node);
  if (label) {
    const b = document.createElement('b');
    b.textContent = label;
    btn.append(b);
  }
  btn.addEventListener('click', () => onPick(btn));
  return btn;
}

function buildSamples() {
  els.samples.innerHTML = '';
  for (const sample of SAMPLES) {
    const img = document.createElement('img');
    img.src = sample.src;
    img.alt = sample.label;
    img.loading = 'lazy';
    const btn = tile({
      checked: state.sampleId === sample.id,
      node: img,
      role: 'button',
      onPick: (self) => {
        for (const t of els.samples.children) t.setAttribute('aria-pressed', 'false');
        self.setAttribute('aria-pressed', 'true');
        useSample(sample);
      },
    });
    btn.title = sample.label;
    els.samples.append(btn);
  }
}

function buildSwatches() {
  els.swatches.innerHTML = '';
  for (const preset of PRESETS) {
    const ph = document.createElement('div');
    ph.className = 'ph';
    const btn = tile({
      checked: state.presetId === preset.id,
      label: preset.label,
      node: ph,
      onPick: (self) => {
        for (const t of els.swatches.children) t.setAttribute('aria-checked', 'false');
        self.setAttribute('aria-checked', 'true');
        adoptPreset(state, preset.id);
        els.lookHint.textContent = preset.hint;
        render();
      },
    });
    btn.dataset.id = preset.id;
    els.swatches.append(btn);
  }
}

/** Draw each style onto the current photo, a couple at a time. */
function renderSwatches() {
  if (!image || !swatchesBuilt) return;
  const token = ++swatchToken;
  const nodes = [...els.swatches.querySelectorAll('.tile')];
  let i = 0;

  const step = () => {
    if (token !== swatchToken) return;
    const end = Math.min(i + 2, nodes.length);
    for (; i < end; i++) {
      const preset = PRESET_BY_ID[nodes[i].dataset.id];
      if (!preset) continue;
      const canvas = renderSwatch({ image, preset, settings: state, size: 320 });
      const fresh = document.createElement('canvas');
      fresh.width = canvas.width;
      fresh.height = canvas.height;
      fresh.getContext('2d').drawImage(canvas, 0, 0);
      nodes[i].querySelector('canvas, .ph').replaceWith(fresh);
    }
    if (i < nodes.length) setTimeout(step, 0);
  };
  setTimeout(step, 0);
}

function buildChips(host, entries, isOn, onPick) {
  host.innerHTML = '';
  for (const [key, label] of entries) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chip';
    btn.dataset.key = key;
    btn.setAttribute('role', 'radio');
    btn.setAttribute('aria-checked', String(isOn(key)));
    btn.textContent = label;
    btn.addEventListener('click', () => {
      for (const c of host.children) c.setAttribute('aria-checked', String(c === btn));
      onPick(key);
    });
    host.append(btn);
  }
}

/* ------------------------------------------------------------------ *
 * Photo handling
 * ------------------------------------------------------------------ */

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('That image would not open.'));
    img.src = src;
  });
}

async function useSample(sample) {
  try {
    image = await loadImage(sample.src);
    state.sampleId = sample.id;
    if (!state.text.title && !state.text.subtitle && !state.text.caption) {
      state.text = { ...sample.text };
      syncText();
    }
    render();
    renderSwatches();
  } catch (err) {
    toast(err.message);
  }
}

async function useFile(file) {
  if (!file || !file.type.startsWith('image/')) {
    toast('That needs to be an image.');
    return;
  }
  const url = URL.createObjectURL(file);
  try {
    image = await loadImage(url);
    state.sampleId = null;
    for (const t of els.samples.children) t.setAttribute('aria-pressed', 'false');
    render();
    renderSwatches();
    toast('Photo loaded.');
  } catch (err) {
    toast(err.message);
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
}

/* ------------------------------------------------------------------ *
 * Bits and pieces
 * ------------------------------------------------------------------ */

function syncText() {
  els.title.value = state.text.title;
  els.subtitle.value = state.text.subtitle;
  els.caption.value = state.text.caption;
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

  els.busyText.textContent = longEdge >= 3000
    ? 'Printing a big one. Give it a few seconds…'
    : 'Printing…';
  els.busy.hidden = false;
  await new Promise((r) => setTimeout(r, 60));

  try {
    const canvas = renderPoster({ image, preset, settings: state, text: state.text, longEdge });
    const blob = await canvasToBlob(canvas, format, 0.94);
    if (!blob) throw new Error('The browser would not save that file.');

    const ext = format === 'image/jpeg' ? 'jpg' : 'png';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `pressd-${preset.id}-${new Date().toISOString().slice(0, 10)}.${ext}`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 8000);
    toast(`Saved — ${canvas.width}×${canvas.height}`);
  } catch (err) {
    toast(err.message || 'Something went wrong saving that.');
  } finally {
    els.busy.hidden = true;
  }
}

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function shuffle() {
  const preset = pick(PRESETS.filter((p) => p.id !== state.presetId));
  adoptPreset(state, preset.id);
  state.layout = pick(Object.keys(LAYOUTS));

  for (const t of els.swatches.children) {
    t.setAttribute('aria-checked', String(t.dataset.id === preset.id));
  }
  for (const c of els.layouts.children) {
    c.setAttribute('aria-checked', String(c.dataset.key === state.layout));
  }
  render();
  toast(`${preset.label} · ${LAYOUTS[state.layout].label}`);
}

/* ------------------------------------------------------------------ *
 * Wiring
 * ------------------------------------------------------------------ */

function bind() {
  els.prev.addEventListener('click', () => showStep(stepIndex - 1));
  els.next.addEventListener('click', () => {
    if (stepIndex === STEPS.length - 1) download();
    else showStep(stepIndex + 1);
  });
  els.download.addEventListener('click', download);
  els.shuffle.addEventListener('click', shuffle);

  els.drop.addEventListener('click', () => els.file.click());
  els.file.addEventListener('change', () => {
    if (els.file.files?.[0]) useFile(els.file.files[0]);
    els.file.value = '';
  });

  window.addEventListener('dragover', (e) => {
    e.preventDefault();
    els.drop.classList.add('over');
  });
  window.addEventListener('dragleave', () => els.drop.classList.remove('over'));
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    els.drop.classList.remove('over');
    if (e.dataTransfer?.files?.[0]) useFile(e.dataTransfer.files[0]);
  });
  window.addEventListener('paste', (e) => {
    const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
    if (item) useFile(item.getAsFile());
  });

  const timers = {};
  const bindText = (el, key) => {
    el.addEventListener('input', () => {
      state.text[key] = el.value;
      clearTimeout(timers[key]);
      timers[key] = setTimeout(render, 160);
    });
  };
  bindText(els.title, 'title');
  bindText(els.subtitle, 'subtitle');
  bindText(els.caption, 'caption');

  let resizeTimer = 0;
  const onResize = () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(render, 180);
  };
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);
}

async function start() {
  buildSamples();
  buildChips(
    els.layouts,
    Object.entries(LAYOUTS).map(([k, v]) => [k, v.label]),
    (k) => state.layout === k,
    (k) => { state.layout = k; render(); },
  );
  buildChips(
    els.sizes,
    Object.entries(SIZES).map(([k, v]) => [k, v.label]),
    (k) => state.size === k,
    (k) => { state.size = k; render(); },
  );
  buildChips(
    els.qualities,
    QUALITIES.map(([v, l]) => [String(v), l]),
    (k) => String(state.exportSize) === k,
    (k) => { state.exportSize = Number(k); saveState(); },
  );
  buildChips(
    els.formats,
    FORMATS,
    (k) => state.exportFormat === k,
    (k) => { state.exportFormat = k; saveState(); },
  );

  els.lookHint.textContent = (PRESET_BY_ID[state.presetId] || PRESETS[0]).hint;
  syncText();
  bind();

  const sample = SAMPLES.find((s) => s.id === state.sampleId) || SAMPLES[0];
  if (!state.text.title && !state.text.subtitle && !state.text.caption) {
    state.text = { ...sample.text };
    syncText();
  }
  try {
    image = await loadImage(sample.src);
  } catch {
    toast('Could not load the sample. Pick a photo of your own.');
  }
  showStep(0);
}

start();
