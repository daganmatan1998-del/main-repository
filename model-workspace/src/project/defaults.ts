import type { CameraState, SceneSettings } from './types';

export const DEFAULT_CAMERA: CameraState = {
  projection: 'perspective',
  position: [2.6, 3.1, 9.6],
  target: [0, 0.6, 0],
  fov: 40,
  zoom: 1,
};

export const DEFAULT_SETTINGS: SceneSettings = {
  quality: 'balanced',
  lighting: {
    exposure: 1,
    envIntensity: 0.9,
    sunIntensity: 2.4,
    sunAzimuth: 35,
    sunElevation: 52,
    fillIntensity: 0.35,
    shadows: true,
  },
  environment: {
    preset: 'studio',
    horizonColor: '#0c1824',
    skyColor: '#020407',
  },
  grid: {
    visible: true,
    spacing: 1,
    opacity: 0.55,
    floorColor: '#0b1622',
    floorVisible: true,
  },
  snapping: {
    enabled: false,
    translate: 0.25,
    rotate: 15,
    scale: 0.1,
  },
};

export function cloneSettings(s: SceneSettings): SceneSettings {
  return structuredClone(s);
}

/** Colours the app used to ship as defaults; saved projects still using them follow the new theme. */
const LEGACY_DEFAULT_COLOURS: Record<string, string> = {
  '#2a211a': DEFAULT_SETTINGS.environment.horizonColor,
  '#0d0b09': DEFAULT_SETTINGS.environment.skyColor,
  '#4b3326': DEFAULT_SETTINGS.grid.floorColor,
  '#5a4030': DEFAULT_SETTINGS.grid.floorColor,
};

/** Deep-merges persisted settings over defaults so older saves gain new fields. */
export function normalizeSettings(input: unknown): SceneSettings {
  const base = cloneSettings(DEFAULT_SETTINGS);
  if (!input || typeof input !== 'object') return base;
  const src = input as Record<string, unknown>;
  const out = base as unknown as Record<string, unknown>;
  for (const key of Object.keys(base)) {
    const v = src[key];
    if (v === undefined) continue;
    const def = out[key];
    if (def && typeof def === 'object' && v && typeof v === 'object') {
      out[key] = { ...(def as object), ...(v as object) };
    } else if (typeof v === typeof def) {
      out[key] = v;
    }
  }
  const env = base.environment;
  env.horizonColor = LEGACY_DEFAULT_COLOURS[env.horizonColor] ?? env.horizonColor;
  env.skyColor = LEGACY_DEFAULT_COLOURS[env.skyColor] ?? env.skyColor;
  base.grid.floorColor = LEGACY_DEFAULT_COLOURS[base.grid.floorColor] ?? base.grid.floorColor;
  if ((env.preset as string) === 'warm') env.preset = 'cool';
  if (!['studio', 'cool', 'soft'].includes(env.preset)) env.preset = 'studio';
  return base;
}
