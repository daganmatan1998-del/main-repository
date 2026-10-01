import * as THREE from 'three';
import type { Bounds, InstanceState } from '../project/types';
import { getLoadedAsset } from '../loading/assetCache';
import { cachedAssetInfo } from '../persistence/assetRepo';

const UNIT: Bounds = { min: [-0.5, 0, -0.5], max: [0.5, 1, 0.5] };

/** Local bounds of an instance's asset, from the loaded model or the stored record. */
export function assetBounds(assetId: string): Bounds {
  return getLoadedAsset(assetId)?.bounds ?? cachedAssetInfo(assetId)?.bounds ?? UNIT;
}

const m = new THREE.Matrix4();
const q = new THREE.Quaternion();
const e = new THREE.Euler();
const v = new THREE.Vector3();
const s = new THREE.Vector3();

/**
 * World AABB of an instance computed from data alone (no rendered object needed),
 * so placement works the instant a model is added.
 */
export function instanceBox(inst: Pick<InstanceState, 'assetId' | 'position' | 'rotation' | 'scale'>, bounds = assetBounds(inst.assetId)): THREE.Box3 {
  m.compose(v.fromArray(inst.position), q.setFromEuler(e.set(...inst.rotation)), s.fromArray(inst.scale));
  const local = new THREE.Box3(new THREE.Vector3().fromArray(bounds.min), new THREE.Vector3().fromArray(bounds.max));
  return local.applyMatrix4(m);
}

export function unionBox(insts: InstanceState[]): THREE.Box3 {
  const box = new THREE.Box3();
  for (const i of insts) box.union(instanceBox(i));
  return box;
}
