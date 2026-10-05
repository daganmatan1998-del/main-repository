import { DEFAULT_CAMERA, normalizeSettings } from './defaults';
import { PROJECT_SCHEMA_VERSION, type CameraState, type InstanceState, type ProjectDoc, type SavedView, type Vec3 } from './types';

export class ProjectLoadError extends Error {
  constructor(public kind: 'not-found' | 'corrupted', message: string) {
    super(message);
  }
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string';

function vec3(v: unknown, fallback: Vec3): Vec3 {
  if (Array.isArray(v) && v.length === 3 && v.every(isNum)) return [v[0], v[1], v[2]];
  return [...fallback] as Vec3;
}

function instance(v: unknown): InstanceState | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (!isStr(o.id) || !isStr(o.assetId)) return null;
  const scale = vec3(o.scale, [1, 1, 1]);
  return {
    id: o.id,
    assetId: o.assetId,
    name: isStr(o.name) && o.name.trim() ? o.name : 'Model',
    position: vec3(o.position, [0, 0, 0]),
    rotation: vec3(o.rotation, [0, 0, 0]),
    scale: scale.map((s) => (s === 0 ? 1e-4 : s)) as Vec3,
    visible: o.visible !== false,
    locked: o.locked === true,
    animation:
      o.animation && typeof o.animation === 'object'
        ? {
            clip: isStr((o.animation as Record<string, unknown>).clip)
              ? ((o.animation as Record<string, unknown>).clip as string)
              : null,
            playing: (o.animation as Record<string, unknown>).playing === true,
          }
        : undefined,
    notes: isStr(o.notes) && o.notes ? o.notes.slice(0, 20000) : undefined,
  };
}

function camera(v: unknown): CameraState {
  if (!v || typeof v !== 'object') return structuredClone(DEFAULT_CAMERA);
  const o = v as Record<string, unknown>;
  return {
    projection: o.projection === 'orthographic' ? 'orthographic' : 'perspective',
    position: vec3(o.position, DEFAULT_CAMERA.position),
    target: vec3(o.target, DEFAULT_CAMERA.target),
    fov: isNum(o.fov) && o.fov > 5 && o.fov < 120 ? o.fov : DEFAULT_CAMERA.fov,
    zoom: isNum(o.zoom) && o.zoom > 0 ? o.zoom : 1,
  };
}

function views(v: unknown): SavedView[] {
  if (!Array.isArray(v)) return [];
  const out: SavedView[] = [];
  for (const item of v) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    if (!isStr(o.id) || !isStr(o.name)) continue;
    out.push({ id: o.id, name: o.name, camera: camera(o.camera) });
  }
  return out.slice(0, 100);
}

/**
 * Turns an untrusted stored record into a ProjectDoc. Missing optional fields
 * are filled with defaults; a record missing its identity is "corrupted".
 */
export function parseProjectDoc(raw: unknown): ProjectDoc {
  if (!raw || typeof raw !== 'object') {
    throw new ProjectLoadError('corrupted', 'Unable to load project. The saved data is unreadable.');
  }
  const o = raw as Record<string, unknown>;
  if (!isStr(o.id) || !isStr(o.saveCode) || !isStr(o.name)) {
    throw new ProjectLoadError('corrupted', 'Unable to load project. Its identity data is missing or damaged.');
  }
  if (isNum(o.schema) && o.schema > PROJECT_SCHEMA_VERSION) {
    throw new ProjectLoadError(
      'corrupted',
      'Unable to load project. It was saved by a newer version of the application.',
    );
  }
  if (o.instances !== undefined && !Array.isArray(o.instances)) {
    throw new ProjectLoadError('corrupted', 'Unable to load project. The scene data is damaged.');
  }
  const instances: InstanceState[] = [];
  const seen = new Set<string>();
  for (const item of (o.instances as unknown[] | undefined) ?? []) {
    const inst = instance(item);
    if (inst && !seen.has(inst.id)) {
      seen.add(inst.id);
      instances.push(inst);
    }
  }
  const now = Date.now();
  return {
    schema: PROJECT_SCHEMA_VERSION,
    id: o.id,
    saveCode: o.saveCode,
    name: o.name,
    createdAt: isNum(o.createdAt) ? o.createdAt : now,
    updatedAt: isNum(o.updatedAt) ? o.updatedAt : now,
    instances,
    camera: camera(o.camera),
    settings: normalizeSettings(o.settings),
    thumbnail: isStr(o.thumbnail) ? o.thumbnail : null,
    views: views(o.views),
  };
}
