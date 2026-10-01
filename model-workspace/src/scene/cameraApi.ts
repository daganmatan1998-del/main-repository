import * as THREE from 'three';
import { viewport } from './viewportServices';
import { boundsOf } from './registry';
import { useEditor } from '../state/editorStore';
import { DEFAULT_CAMERA } from '../project/defaults';
import type { CameraState } from '../project/types';

export type ViewName = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom';

const VIEW_DIRS: Record<ViewName, THREE.Vector3> = {
  front: new THREE.Vector3(0, 0, 1),
  back: new THREE.Vector3(0, 0, -1),
  right: new THREE.Vector3(1, 0, 0),
  left: new THREE.Vector3(-1, 0, 0),
  top: new THREE.Vector3(0, 1, 0),
  bottom: new THREE.Vector3(0, -1, 0),
};

function focusBox(ids?: string[]): THREE.Box3 | null {
  const box = boundsOf(ids);
  return box.isEmpty() ? null : box;
}

/** Frames a box from the given direction (or the current one), smoothly. */
function frame(box: THREE.Box3, dir?: THREE.Vector3, smooth = true) {
  const c = viewport.controls;
  const cam = viewport.camera as THREE.PerspectiveCamera | THREE.OrthographicCamera | null;
  if (!c || !cam) return;
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const radius = Math.max(sphere.radius, 0.05);
  const center = sphere.center;
  const pos = new THREE.Vector3();
  const tgt = new THREE.Vector3();
  c.getPosition(pos);
  c.getTarget(tgt);
  const d = dir ? dir.clone() : pos.sub(tgt).normalize();
  if (d.lengthSq() < 1e-6) d.set(0.6, 0.45, 0.8).normalize();
  // Nudge exact top/bottom views off the pole so the orbit keeps a stable heading.
  if (Math.abs(d.y) > 0.9999) d.set(0, Math.sign(d.y), 1e-4).normalize();

  if ((cam as THREE.OrthographicCamera).isOrthographicCamera) {
    const o = cam as THREE.OrthographicCamera;
    const w = o.right - o.left;
    const h = o.top - o.bottom;
    const dist = radius * 4 + 10;
    c.setLookAt(center.x + d.x * dist, center.y + d.y * dist, center.z + d.z * dist, center.x, center.y, center.z, smooth);
    c.zoomTo(Math.min(w, h) / (radius * 2.3), smooth);
  } else {
    // Tight fit: every box corner must land inside the frustum (with a margin).
    const p = cam as THREE.PerspectiveCamera;
    const tanV = Math.tan(THREE.MathUtils.degToRad(p.fov) / 2) * 0.86;
    const tanH = tanV * p.aspect;
    const fwd = d.clone().negate();
    const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0));
    if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
    right.normalize();
    const up = new THREE.Vector3().crossVectors(right, fwd).normalize();
    let dist = 0;
    const corner = new THREE.Vector3();
    for (let i = 0; i < 8; i++) {
      corner.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).sub(center);
      const x = Math.abs(corner.dot(right));
      const y = Math.abs(corner.dot(up));
      const z = corner.dot(d); // towards the camera
      dist = Math.max(dist, x / tanH + z, y / tanV + z);
    }
    dist = Math.max(dist, radius * 0.6, 0.1);
    c.setLookAt(center.x + d.x * dist, center.y + d.y * dist, center.z + d.z * dist, center.x, center.y, center.z, smooth);
  }
}

export const cameraApi = {
  setView(view: ViewName) {
    const sel = useEditor.getState().selection;
    const box = focusBox(sel.length ? sel : undefined) ?? focusBox() ?? new THREE.Box3(new THREE.Vector3(-1, 0, -1), new THREE.Vector3(1, 1.5, 1));
    frame(box, VIEW_DIRS[view]);
  },
  fitSelected() {
    const sel = useEditor.getState().selection;
    const box = sel.length ? focusBox(sel) : focusBox();
    if (box) frame(box);
  },
  focus(id: string) {
    const box = focusBox([id]);
    if (box) frame(box);
  },
  fitScene() {
    const box = focusBox();
    if (box) frame(box);
    else cameraApi.reset();
  },
  reset() {
    const c = viewport.controls;
    if (!c) return;
    const d = DEFAULT_CAMERA;
    c.setLookAt(...d.position, ...d.target, true);
    if ((viewport.camera as THREE.OrthographicCamera | null)?.isOrthographicCamera) c.zoomTo(60, true);
  },
  orbit(azimuthDeg: number, polarDeg: number) {
    viewport.controls?.rotate(THREE.MathUtils.degToRad(azimuthDeg), THREE.MathUtils.degToRad(polarDeg), true);
  },
  /** Current camera as persisted state. */
  read(): CameraState | null {
    const c = viewport.controls;
    const cam = viewport.camera as THREE.PerspectiveCamera | THREE.OrthographicCamera | null;
    if (!c || !cam) return null;
    const pos = c.getPosition(new THREE.Vector3());
    const tgt = c.getTarget(new THREE.Vector3());
    const prev = useEditor.getState().camera ?? DEFAULT_CAMERA;
    return {
      projection: (cam as THREE.OrthographicCamera).isOrthographicCamera ? 'orthographic' : 'perspective',
      position: pos.toArray(),
      target: tgt.toArray(),
      fov: (cam as THREE.PerspectiveCamera).isPerspectiveCamera ? (cam as THREE.PerspectiveCamera).fov : prev.fov,
      zoom: cam.zoom,
    };
  },
};
