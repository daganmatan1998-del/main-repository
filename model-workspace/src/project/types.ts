export type Vec3 = [number, number, number];

export type ModelFormat = 'glb' | 'gltf' | 'obj' | 'fbx' | 'stl' | 'ply' | 'builtin';

export type QualityMode = 'performance' | 'balanced' | 'ultra';
export type EnvironmentPreset = 'studio' | 'cool' | 'soft';

export interface InstanceAnimation {
  clip: string | null;
  playing: boolean;
}

/** One placed copy of an asset in the scene. Everything here is persisted. */
export interface InstanceState {
  id: string;
  assetId: string;
  name: string;
  position: Vec3;
  /** Euler XYZ, radians. */
  rotation: Vec3;
  scale: Vec3;
  visible: boolean;
  locked: boolean;
  animation?: InstanceAnimation;
  /** Free-text notes about this model. */
  notes?: string;
}

/** A named camera position the user saved to come back to. */
export interface SavedView {
  id: string;
  name: string;
  camera: CameraState;
}

export interface CameraState {
  projection: 'perspective' | 'orthographic';
  position: Vec3;
  target: Vec3;
  fov: number;
  /** Orthographic zoom. */
  zoom: number;
}

export interface LightingSettings {
  exposure: number;
  envIntensity: number;
  sunIntensity: number;
  /** Degrees around Y. */
  sunAzimuth: number;
  /** Degrees above the horizon. */
  sunElevation: number;
  fillIntensity: number;
  shadows: boolean;
}

export interface EnvironmentSettings {
  preset: EnvironmentPreset;
  horizonColor: string;
  skyColor: string;
}

export interface GridSettings {
  visible: boolean;
  /** Distance between parallel diagonal lines, world units. */
  spacing: number;
  opacity: number;
  floorColor: string;
  floorVisible: boolean;
}

export interface SnapSettings {
  enabled: boolean;
  translate: number;
  /** Degrees. */
  rotate: number;
  scale: number;
}

export interface SceneSettings {
  quality: QualityMode;
  lighting: LightingSettings;
  environment: EnvironmentSettings;
  grid: GridSettings;
  snapping: SnapSettings;
}

export const PROJECT_SCHEMA_VERSION = 1;

/** The full persisted project document. */
export interface ProjectDoc {
  schema: number;
  id: string;
  saveCode: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  /** Order is the scene hierarchy order. */
  instances: InstanceState[];
  camera: CameraState;
  settings: SceneSettings;
  /** JPEG data URL of the viewport, captured on save. */
  thumbnail: string | null;
  /** Saved camera bookmarks. */
  views: SavedView[];
}

export interface Bounds {
  min: Vec3;
  max: Vec3;
}

export interface StoredFile {
  name: string;
  type: string;
  blob: Blob;
}

/** An imported model's source files, stored once and shared by every instance. */
export interface AssetRecord {
  id: string;
  name: string;
  format: ModelFormat;
  mainFile: string;
  files: StoredFile[];
  size: number;
  hash: string;
  createdAt: number;
  /** Local-space bounds of the loaded model, filled in after the first load. */
  bounds?: Bounds;
}

/** Lightweight description used by the UI (no blobs). */
export interface AssetInfo {
  id: string;
  name: string;
  format: ModelFormat;
  size: number;
  builtin: boolean;
  bounds?: Bounds;
}
