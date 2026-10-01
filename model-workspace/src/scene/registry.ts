import * as THREE from 'three';

/**
 * Live Object3D for each instance id. Lets non-React code (camera framing,
 * arrange tools, outlines) reach the real objects without prop drilling.
 */
const objects = new Map<string, THREE.Object3D>();
const listeners = new Set<() => void>();

export const registry = {
  set(id: string, obj: THREE.Object3D) {
    objects.set(id, obj);
    listeners.forEach((l) => l());
  },
  delete(id: string, obj: THREE.Object3D) {
    if (objects.get(id) === obj) {
      objects.delete(id);
      listeners.forEach((l) => l());
    }
  },
  get(id: string) {
    return objects.get(id);
  },
  ids() {
    return [...objects.keys()];
  },
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
};

const tmp = new THREE.Box3();

/** World bounds of the given instances (or all visible ones). Empty box when nothing qualifies. */
export function boundsOf(ids?: string[], includeHidden = false): THREE.Box3 {
  const box = new THREE.Box3();
  const list = ids ?? registry.ids();
  for (const id of list) {
    const o = objects.get(id);
    if (!o || (!includeHidden && !o.visible)) continue;
    o.updateWorldMatrix(true, true);
    tmp.setFromObject(o, false);
    if (!tmp.isEmpty()) box.union(tmp);
  }
  return box;
}

/** Bounds of one object computed precisely (vertex level) — used for placement and dimensions. */
export function preciseBounds(obj: THREE.Object3D): THREE.Box3 {
  obj.updateWorldMatrix(true, true);
  return new THREE.Box3().setFromObject(obj, true);
}
