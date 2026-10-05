import * as THREE from 'three';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import { parseAsset, type ProgressFn } from './loaders';
import { computeModelStats, forEachTexture, materialsOf, type ModelStats } from './modelStats';
import { getBuiltin } from '../assets/builtins';
import { getAsset, setAssetBounds } from '../persistence/assetRepo';
import type { Bounds, ModelFormat } from '../project/types';

// BVH-accelerated raycasting: hover/pick stays fast on multi-million-triangle models.
// (three-mesh-bvh ships its own type augmentation for these prototype methods.)
const geoProto = THREE.BufferGeometry.prototype as unknown as Record<string, unknown>;
geoProto.computeBoundsTree = computeBoundsTree;
geoProto.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

export interface LoadedAsset {
  id: string;
  name: string;
  format: ModelFormat;
  fileSize: number;
  scene: THREE.Group;
  animations: THREE.AnimationClip[];
  stats: ModelStats;
  bounds: Bounds;
  hasSkinning: boolean;
}

interface Entry {
  promise: Promise<LoadedAsset>;
  value?: LoadedAsset;
  refs: number;
  disposeTimer?: ReturnType<typeof setTimeout>;
}

const cache = new Map<string, Entry>();
let anisotropy = 8;

type Listener = (id: string, fraction: number | null, phase: 'download' | 'parse') => void;
const progressListeners = new Set<Listener>();
export function onAssetProgress(fn: Listener) {
  progressListeners.add(fn);
  return () => {
    progressListeners.delete(fn);
  };
}

export function setTextureAnisotropy(value: number) {
  anisotropy = value;
  for (const e of cache.values()) if (e.value) applyAnisotropy(e.value.scene);
}

function applyAnisotropy(root: THREE.Object3D) {
  root.traverse((o) => {
    for (const m of materialsOf(o)) {
      forEachTexture(m, (t) => {
        if (t.anisotropy !== anisotropy) {
          t.anisotropy = anisotropy;
          t.needsUpdate = true;
        }
      });
    }
  });
}

function prepare(scene: THREE.Object3D): boolean {
  let skinned = false;
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = true;
    if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) {
      skinned = true;
      // Skinned bounds change with the pose; never cull on stale bind-pose bounds.
      mesh.frustumCulled = false;
      return;
    }
    const geo = mesh.geometry;
    if (!geo.boundingSphere) geo.computeBoundingSphere();
    if (!geo.boundsTree && geo.attributes.position && geo.attributes.position.count > 3000) {
      try {
        geo.computeBoundsTree();
      } catch {
        /* fall back to plain raycasting */
      }
    }
  });
  applyAnisotropy(scene);
  return skinned;
}

async function load(id: string, progress: ProgressFn): Promise<LoadedAsset> {
  const builtin = getBuiltin(id);
  let name: string;
  let format: ModelFormat;
  let fileSize = 0;
  let parsed: { scene: THREE.Group; animations: THREE.AnimationClip[] };
  if (builtin) {
    parsed = builtin.build();
    name = builtin.name;
    format = 'builtin';
  } else {
    const rec = await getAsset(id);
    if (!rec) throw new Error('This model’s stored file is missing from local storage.');
    name = rec.name;
    format = rec.format;
    fileSize = rec.size;
    parsed = await parseAsset(rec, progress);
  }
  progress(1, 'parse');
  // Let the loader paint progress before the synchronous post-processing.
  await new Promise((r) => setTimeout(r, 0));
  const hasSkinning = prepare(parsed.scene);
  parsed.scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(parsed.scene, true);
  if (box.isEmpty()) box.set(new THREE.Vector3(-0.5, 0, -0.5), new THREE.Vector3(0.5, 1, 0.5));
  const bounds: Bounds = { min: box.min.toArray(), max: box.max.toArray() };
  if (!builtin) setAssetBounds(id, bounds).catch(() => {});
  return {
    id,
    name,
    format,
    fileSize,
    scene: parsed.scene,
    animations: parsed.animations,
    stats: computeModelStats(parsed.scene, parsed.animations),
    bounds,
    hasSkinning,
  };
}

/** Loads (or reuses) an asset and takes a reference on it. Pair with releaseAsset. */
export function acquireAsset(id: string): Promise<LoadedAsset> {
  let e = cache.get(id);
  if (!e) {
    const report: ProgressFn = (f, phase) => progressListeners.forEach((l) => l(id, f, phase));
    const entry: Entry = { refs: 0, promise: null as unknown as Promise<LoadedAsset> };
    entry.promise = load(id, report).then((v) => {
      entry.value = v;
      return v;
    });
    entry.promise.catch(() => cache.delete(id));
    cache.set(id, entry);
    e = entry;
  }
  e.refs++;
  if (e.disposeTimer) {
    clearTimeout(e.disposeTimer);
    e.disposeTimer = undefined;
  }
  return e.promise;
}

/** Drops a reference; GPU resources are freed a little later so undo doesn’t reload. */
export function releaseAsset(id: string) {
  const e = cache.get(id);
  if (!e) return;
  e.refs = Math.max(0, e.refs - 1);
  if (e.refs === 0 && !e.disposeTimer) {
    e.disposeTimer = setTimeout(() => {
      if (e.refs === 0) {
        cache.delete(id);
        if (e.value) disposeObject(e.value.scene);
      }
    }, 30_000);
  }
}

export function getLoadedAsset(id: string): LoadedAsset | undefined {
  return cache.get(id)?.value;
}

/** Frees everything — used when leaving a project. */
export function disposeAllAssets() {
  for (const [id, e] of cache) {
    if (e.disposeTimer) clearTimeout(e.disposeTimer);
    if (e.value) disposeObject(e.value.scene);
    cache.delete(id);
  }
}

export function disposeObject(root: THREE.Object3D) {
  const textures = new Set<THREE.Texture>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry) {
      mesh.geometry.disposeBoundsTree?.();
      mesh.geometry.dispose();
    }
    for (const m of materialsOf(o)) {
      forEachTexture(m, (t) => textures.add(t));
      m.dispose();
    }
  });
  textures.forEach((t) => t.dispose());
}

/**
 * A new instance of a loaded asset. Geometry, materials and textures are shared
 * with every other instance (one GPU copy); skeletons are rebound correctly.
 */
export function cloneAssetScene(asset: LoadedAsset): THREE.Object3D {
  return asset.hasSkinning ? SkeletonUtils.clone(asset.scene) : asset.scene.clone(true);
}
