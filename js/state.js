/**
 * App state.
 *
 * One plain object, saved to localStorage so a refresh doesn't lose your work.
 * The photo itself is never saved — it stays in memory and dies with the tab.
 */
import { PRESET_BY_ID, PRESETS } from './presets.js';

const KEY = 'pressd.v1';

export const SAMPLES = [
  {
    id: 'ridge',
    src: 'assets/samples/ridge.png',
    label: 'Ridges at dusk',
    text: { title: 'Northern Ridge', subtitle: 'Series 01', caption: 'Edition of 50' },
  },
  {
    id: 'city',
    src: 'assets/samples/city.png',
    label: 'City at night',
    text: { title: 'Nine Til Late', subtitle: 'Series 02', caption: 'Edition of 50' },
  },
  {
    id: 'waves',
    src: 'assets/samples/waves.png',
    label: 'Open water',
    text: { title: 'Long Swell', subtitle: 'Series 03', caption: 'Edition of 50' },
  },
  {
    id: 'still-life',
    src: 'assets/samples/still-life.png',
    label: 'Still life',
    text: { title: 'Three Objects', subtitle: 'Series 04', caption: 'Edition of 50' },
  },
];

export function defaults() {
  return {
    presetId: PRESETS[0].id,
    layout: 'gallery',
    size: 'portrait',
    detail: 0.33,
    tone: { exposure: 0.05, contrast: 0.14, warmth: 0 },
    grain: 0.30,
    fibre: 0.55,
    vignette: 0.10,
    deckle: false,
    seed: 7,
    inks: null,
    paper: null,
    sep: null,
    text: { title: '', subtitle: '', caption: '' },
    exportSize: 2000,
    exportFormat: 'image/png',
    sampleId: 'ridge',
  };
}

/**
 * Adopt a style's own settings. Switching looks should feel like switching
 * looks — the sliders come with it, the words and the shape stay put.
 */
export function adoptPreset(state, presetId) {
  const preset = PRESET_BY_ID[presetId] || PRESETS[0];
  state.presetId = preset.id;
  state.detail = preset.detail?.value ?? 0.3;
  state.tone = { ...preset.tone };
  state.grain = preset.finish.grain;
  state.fibre = preset.finish.fibre;
  state.vignette = preset.finish.vignette;
  state.inks = [...preset.inks];
  state.paper = preset.paper;
  state.sep = preset.sep || null;
  return state;
}

export function load() {
  const base = adoptPreset(defaults(), defaults().presetId);
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return base;
    const saved = JSON.parse(raw);
    // Merge shallowly, then repair anything that no longer exists.
    const merged = { ...base, ...saved, tone: { ...base.tone, ...(saved.tone || {}) }, text: { ...base.text, ...(saved.text || {}) } };
    if (!PRESET_BY_ID[merged.presetId]) return base;
    if (!Array.isArray(merged.inks) || !merged.inks.length) merged.inks = [...PRESET_BY_ID[merged.presetId].inks];
    return merged;
  } catch {
    return base;
  }
}

export function save(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* private mode, quota, whatever — not worth bothering anyone about */
  }
}
