import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { useTools, type ViewMode } from '../state/toolsStore';
import { useEditor } from '../state/editorStore';
import { boundsOf, registry } from './registry';
import { viewport } from './viewportServices';
import { formatLength } from '../core/format';

/* ------------------------------------------------------------------ */
/* View modes + section plane: per-mesh material management            */
/* ------------------------------------------------------------------ */

type Mat = THREE.Material | THREE.Material[];
const ORIG = '__workspaceOriginalMaterial';

const overrides: Record<Exclude<ViewMode, 'shaded'>, THREE.Material> = {
  clay: new THREE.MeshStandardMaterial({ name: 'Clay', color: '#c9d4df', roughness: 0.72, metalness: 0 }),
  wireframe: new THREE.MeshBasicMaterial({ name: 'Wireframe', color: '#62c6ff', wireframe: true }),
  xray: new THREE.MeshBasicMaterial({
    name: 'X-Ray', color: '#3fb0ff', transparent: true, opacity: 0.16, depthWrite: false,
    side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
  }),
  normals: new THREE.MeshNormalMaterial({ name: 'Normals' }),
};

const sectionPlane = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0);

function eachMesh(fn: (m: THREE.Mesh) => void) {
  for (const id of registry.ids()) {
    registry.get(id)?.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && !mesh.userData.workspaceHelper) fn(mesh);
    });
  }
}

function forMats(m: Mat, fn: (x: THREE.Material) => void) {
  (Array.isArray(m) ? m : [m]).forEach(fn);
}

function apply(mode: ViewMode, clip: boolean) {
  const planes = clip ? [sectionPlane] : null;
  const touched = new Set<THREE.Material>();
  eachMesh((mesh) => {
    if (mesh.userData[ORIG] === undefined) mesh.userData[ORIG] = mesh.material;
    const orig = mesh.userData[ORIG] as Mat;
    mesh.material = mode === 'shaded' ? orig : overrides[mode];
    forMats(orig, (m) => touched.add(m));
  });
  Object.values(overrides).forEach((m) => touched.add(m));
  for (const m of touched) {
    const had = (m.clippingPlanes?.length ?? 0) > 0;
    if (had === !!planes) continue;
    m.clippingPlanes = planes;
    m.clipShadows = !!planes;
    m.needsUpdate = true;
  }
  viewport.requestShadowUpdate();
}

/** Run something (export, capture) against the models' real materials, unclipped. */
export function withOriginalMaterials<T>(fn: () => T): T {
  const t = useTools.getState();
  apply('shaded', false);
  try {
    return fn();
  } finally {
    apply(t.viewMode, t.section.enabled);
  }
}

export function ViewModes() {
  const mode = useTools((s) => s.viewMode);
  const clip = useTools((s) => s.section.enabled);
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    gl.localClippingEnabled = true;
  }, [gl]);
  useEffect(() => {
    apply(mode, clip);
    // New models (or a model that just finished loading) pick up the current mode.
    return registry.subscribe(() => apply(mode, clip));
  }, [mode, clip]);
  useEffect(() => () => apply('shaded', false), []);
  return null;
}

/* ------------------------------------------------------------------ */
/* Section plane                                                        */
/* ------------------------------------------------------------------ */

const AXIS = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };

export function SectionPlane() {
  const section = useTools((s) => s.section);
  const revision = useEditor((s) => s.revision);
  const [box, setBox] = useState<THREE.Box3 | null>(null);
  useEffect(() => {
    if (!section.enabled) return;
    const update = () => {
      const b = boundsOf();
      setBox(b.isEmpty() ? null : b.expandByScalar(Math.max(0.02, b.getSize(new THREE.Vector3()).length() * 0.01)));
    };
    update();
    return registry.subscribe(update);
  }, [section.enabled, revision]);

  const geom = useMemo(() => {
    if (!box || !section.enabled) return null;
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const ax = section.axis;
    const i = ax === 'x' ? 0 : ax === 'y' ? 1 : 2;
    const at = box.min.getComponent(i) + section.position * size.getComponent(i);
    const n = AXIS[ax].clone().multiplyScalar(section.flip ? 1 : -1);
    sectionPlane.normal.copy(n);
    sectionPlane.constant = section.flip ? -at : at;
    // Quad spanning the bounds on the other two axes.
    const w = ax === 'x' ? size.z : size.x;
    const h = ax === 'y' ? size.z : size.y;
    const pos = center.clone().setComponent(i, at);
    const rot = new THREE.Euler(ax === 'y' ? -Math.PI / 2 : 0, ax === 'x' ? Math.PI / 2 : 0, 0);
    return { w, h, pos, rot };
  }, [box, section]);

  useEffect(() => {
    viewport.requestShadowUpdate();
  }, [geom]);

  if (!geom) return null;
  return (
    <group position={geom.pos} rotation={geom.rot}>
      <mesh raycast={() => null} renderOrder={5} userData={{ workspaceHelper: true }}>
        <planeGeometry args={[geom.w, geom.h]} />
        <meshBasicMaterial color="#38b6ff" transparent opacity={0.07} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <lineSegments raycast={() => null} renderOrder={6} userData={{ workspaceHelper: true }}>
        <edgesGeometry args={[new THREE.PlaneGeometry(geom.w, geom.h)]} />
        <lineBasicMaterial color="#62c6ff" transparent opacity={0.85} depthTest={false} />
      </lineSegments>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Measurements                                                         */
/* ------------------------------------------------------------------ */

export function formatDistance(d: number): string {
  if (d < 1) return `${(d * 100).toFixed(d < 0.1 ? 2 : 1)} cm`;
  return `${formatLength(d)} m`;
}

function Dot({ at }: { at: THREE.Vector3Tuple }) {
  return (
    <points position={at} raycast={() => null} renderOrder={20}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[new Float32Array([0, 0, 0]), 3]} />
      </bufferGeometry>
      <pointsMaterial color="#ffffff" size={9} sizeAttenuation={false} depthTest={false} transparent />
    </points>
  );
}

export function Measurements() {
  const measurements = useTools((s) => s.measurements);
  const pending = useTools((s) => s.pending);
  return (
    <group>
      {measurements.map((m) => {
        const a = new THREE.Vector3(...m.a);
        const b = new THREE.Vector3(...m.b);
        const mid = a.clone().add(b).multiplyScalar(0.5);
        const d = a.distanceTo(b);
        return (
          <group key={m.id}>
            <lineSegments raycast={() => null} renderOrder={19}>
              <bufferGeometry>
                <bufferAttribute attach="attributes-position" args={[new Float32Array([...m.a, ...m.b]), 3]} />
              </bufferGeometry>
              <lineBasicMaterial color="#38b6ff" depthTest={false} transparent />
            </lineSegments>
            <Dot at={m.a} />
            <Dot at={m.b} />
            <Html position={mid} center zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
              <div className="measure-label" data-testid="measure-label">{formatDistance(d)}</div>
            </Html>
          </group>
        );
      })}
      {pending && <Dot at={pending} />}
    </group>
  );
}

/** Pick a point on the floor plane (y = 0) under a screen position — measuring to the ground. */
export function floorPointAt(clientX: number, clientY: number): THREE.Vector3Tuple | null {
  const cam = viewport.camera;
  const canvas = viewport.gl?.domElement;
  if (!cam || !canvas) return null;
  const r = canvas.getBoundingClientRect();
  const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
  const ray = new THREE.Raycaster();
  ray.setFromCamera(ndc, cam);
  const hit = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3());
  return hit ? hit.toArray() : null;
}

/* ------------------------------------------------------------------ */
/* Turntable                                                            */
/* ------------------------------------------------------------------ */

export function Turntable() {
  const on = useTools((s) => s.turntable);
  const invalidate = useThree((s) => s.invalidate);
  const started = useRef(false);
  useEffect(() => {
    if (!on) return;
    started.current = true;
    invalidate();
    // Any manual camera interaction stops the turntable.
    const c = viewport.controls;
    const stop = () => useTools.getState().setTurntable(false);
    c?.addEventListener('controlstart', stop);
    return () => c?.removeEventListener('controlstart', stop);
  }, [on, invalidate]);
  useFrame((state, dt) => {
    if (!on || !viewport.controls) return;
    viewport.controls.rotate(THREE.MathUtils.degToRad(18) * Math.min(dt, 0.05), 0, false);
    state.invalidate();
  });
  return null;
}
