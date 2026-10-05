import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { EnvironmentPreset } from '../project/types';

/** Cool tech studio: neutral key softbox, blue fill and rim strips (JARVIS lab). */
function coolStudioScene(): THREE.Scene {
  const s = new THREE.Scene();
  const room = new THREE.Mesh(
    new THREE.BoxGeometry(20, 12, 20),
    new THREE.MeshBasicMaterial({ color: '#0a1018', side: THREE.BackSide }),
  );
  room.position.y = 4;
  s.add(room);
  const panel = (w: number, h: number, color: THREE.ColorRepresentation, intensity: number, pos: THREE.Vector3Tuple) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide }),
    );
    m.position.set(...pos);
    m.lookAt(0, 1, 0);
    s.add(m);
  };
  panel(7, 4, '#f4f8ff', 9, [-5, 7, 5]); // key
  panel(5, 3, '#9fd2ff', 3.2, [7, 3, 3]); // fill
  panel(1.2, 8, '#5cc4ff', 7, [0, 4, -8.5]); // rim
  panel(14, 14, '#14263a', 0.9, [0, -1.9, 0]); // floor bounce
  return s;
}

/** Overcast dome: soft and even, good for judging silhouettes and materials. */
function softDomeScene(): THREE.Scene {
  const s = new THREE.Scene();
  const geo = new THREE.SphereGeometry(10, 48, 24);
  const colors: number[] = [];
  const top = new THREE.Color('#f1f6ff').multiplyScalar(2.2);
  const mid = new THREE.Color('#9fb2c6').multiplyScalar(1.2);
  const bottom = new THREE.Color('#122030');
  const pos = geo.attributes.position;
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 10;
    if (y > 0) c.lerpColors(mid, top, Math.pow(y, 0.6));
    else c.lerpColors(mid, bottom, Math.min(1, -y * 3));
    colors.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  s.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  return s;
}

const cache = new Map<EnvironmentPreset, THREE.Texture>();

export function getEnvironmentMap(renderer: THREE.WebGLRenderer, preset: EnvironmentPreset): THREE.Texture {
  const hit = cache.get(preset);
  if (hit) return hit;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const scene =
    preset === 'cool' ? coolStudioScene() : preset === 'soft' ? softDomeScene() : new RoomEnvironment();
  const tex = pmrem.fromScene(scene, 0.035).texture;
  pmrem.dispose();
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
  });
  cache.set(preset, tex);
  return tex;
}

export function disposeEnvironmentMaps() {
  cache.forEach((t) => t.dispose());
  cache.clear();
}
