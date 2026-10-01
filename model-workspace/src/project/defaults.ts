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
    horizonColor: '#2a211a',
    skyColor: '#0d0b09',
  },
  grid: {
    visible: true,
    spacing: 1,
    opacity: 0.55,
    floorColor: '#4b3326',
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
  return base;
}
