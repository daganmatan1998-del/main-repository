import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { CameraControls } from '@react-three/drei';
import type CameraControlsImpl from 'camera-controls';
import * as THREE from 'three';
import { useEditor } from '../state/editorStore';
import { viewport } from './viewportServices';
import { cameraApi } from './cameraApi';
import { DEFAULT_CAMERA } from '../project/defaults';

/**
 * Owns the perspective and orthographic cameras and the orbit controls.
 * Left-drag orbits, right-drag pans, wheel zooms toward the cursor and keeps
 * going past the target ("infinity dolly"), so you can get arbitrarily close.
 */
export function CameraRig() {
  const set = useThree((s) => s.set);
  const size = useThree((s) => s.size);
  const projection = useEditor((s) => s.camera?.projection ?? 'perspective');
  // Callback ref: the setup effect runs whenever a controls instance actually exists.
  const [controls, setControls] = useState<CameraControlsImpl | null>(null);

  const persp = useMemo(() => new THREE.PerspectiveCamera(DEFAULT_CAMERA.fov, 1, 0.01, 5000), []);
  const ortho = useMemo(() => new THREE.OrthographicCamera(-1, 1, 1, -1, -20000, 20000), []);
  const active = projection === 'orthographic' ? ortho : persp;

  useLayoutEffect(() => {
    persp.aspect = size.width / Math.max(1, size.height);
    persp.updateProjectionMatrix();
    ortho.left = -size.width / 2;
    ortho.right = size.width / 2;
    ortho.top = size.height / 2;
    ortho.bottom = -size.height / 2;
    ortho.updateProjectionMatrix();
  }, [size, persp, ortho]);

  useLayoutEffect(() => {
    set({ camera: active });
    viewport.camera = active;
  }, [active, set]);

  // Configure + restore whenever a controls instance is created (mount, projection switch).
  useEffect(() => {
    const c = controls;
    if (!c) return;
    viewport.controls = c;
    c.smoothTime = 0.16;
    c.draggingSmoothTime = 0.05;
    c.dollyToCursor = true;
    c.infinityDolly = true;
    c.minDistance = 0.02;
    c.maxDistance = 8000;
    c.minZoom = 0.5;
    c.maxZoom = 200000;
    c.minPolarAngle = 0;
    c.maxPolarAngle = Math.PI;
    c.dollySpeed = 0.8;
    c.truckSpeed = 1.6;
    const saved = useEditor.getState().camera ?? DEFAULT_CAMERA;
    c.setLookAt(...saved.position, ...saved.target, false);
    if (projection === 'orthographic') c.zoomTo(saved.zoom, false);
    else {
      persp.fov = saved.fov;
      persp.updateProjectionMatrix();
    }
    const save = () => {
      const st = cameraApi.read();
      if (st) useEditor.getState().setCamera(st);
    };
    c.addEventListener('rest', save);
    c.addEventListener('controlend', save);
    return () => {
      c.removeEventListener('rest', save);
      c.removeEventListener('controlend', save);
      if (viewport.controls === c) viewport.controls = null;
    };
  }, [controls, projection, persp]);

  // Depth range follows the orbit distance: close-up inspection without z-fighting far away.
  const tgt = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    const c = controls;
    if (!c || projection !== 'perspective') return;
    c.getTarget(tgt);
    const dist = persp.position.distanceTo(tgt);
    const near = THREE.MathUtils.clamp(dist * 0.002, 0.0005, 0.5);
    const far = Math.max(3000, dist * 400);
    if (Math.abs(persp.near - near) / near > 0.2 || persp.far !== far) {
      persp.near = near;
      persp.far = far;
      persp.updateProjectionMatrix();
    }
  });

  return <CameraControls ref={setControls} camera={active} makeDefault />;
}

/** Switches projection while keeping the framing as close as possible. */
export function setProjection(next: 'perspective' | 'orthographic') {
  const st = useEditor.getState();
  const cur = cameraApi.read();
  const cam = viewport.camera as THREE.PerspectiveCamera | THREE.OrthographicCamera | null;
  if (!cur || !cam || cur.projection === next) return;
  const pos = new THREE.Vector3(...cur.position);
  const tgt = new THREE.Vector3(...cur.target);
  const dist = pos.distanceTo(tgt);
  const fovRad = THREE.MathUtils.degToRad(cur.fov);
  const heightPx = viewport.gl?.domElement.clientHeight ?? 800;
  let zoom = cur.zoom;
  if (next === 'orthographic') {
    zoom = heightPx / (2 * dist * Math.tan(fovRad / 2));
  } else {
    const o = cam as THREE.OrthographicCamera;
    const visibleH = (o.top - o.bottom) / o.zoom;
    const d = visibleH / (2 * Math.tan(fovRad / 2));
    const dir = pos.clone().sub(tgt).normalize();
    pos.copy(tgt).addScaledVector(dir, d);
  }
  st.setCamera({ ...cur, projection: next, position: pos.toArray(), zoom });
}
