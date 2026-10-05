import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

/**
 * Procedural sample models, so the library is useful before anything is imported.
 * They are generated in code (never stored), and use real PBR materials,
 * textures and — for the robot — an animation clip.
 */
export interface BuiltinDef {
  id: string;
  name: string;
  category: string;
  build: () => { scene: THREE.Group; animations: THREE.AnimationClip[] };
}

const PREFIX = 'builtin:';
export const isBuiltinAsset = (id: string) => id.startsWith(PREFIX);

let woodTex: THREE.Texture | null = null;
function woodTexture(): THREE.Texture {
  if (woodTex) return woodTex;
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 512;
  const g = c.getContext('2d')!;
  g.fillStyle = '#7a5235';
  g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 160; i++) {
    const y = Math.random() * 512;
    g.strokeStyle = `rgba(${40 + Math.random() * 40},${22 + Math.random() * 20},${10},${0.15 + Math.random() * 0.25})`;
    g.lineWidth = 1 + Math.random() * 3;
    g.beginPath();
    g.moveTo(0, y);
    for (let x = 0; x <= 512; x += 32) g.lineTo(x, y + Math.sin(x / 60 + i) * 4);
    g.stroke();
  }
  woodTex = new THREE.CanvasTexture(c);
  woodTex.colorSpace = THREE.SRGBColorSpace;
  woodTex.wrapS = woodTex.wrapT = THREE.RepeatWrapping;
  woodTex.name = 'wood_albedo';
  return woodTex;
}

const wood = () =>
  new THREE.MeshStandardMaterial({ name: 'Walnut', map: woodTexture(), roughness: 0.62, metalness: 0 });
const metal = (color: string, roughness = 0.25) =>
  new THREE.MeshStandardMaterial({ name: 'Metal', color, metalness: 1, roughness });
const plastic = (color: string, roughness = 0.45, name = 'Plastic') =>
  new THREE.MeshStandardMaterial({ name, color, roughness, metalness: 0 });

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, name: string, pos: [number, number, number]) {
  const m = new THREE.Mesh(geo, mat);
  m.name = name;
  m.position.set(...pos);
  return m;
}

function chair() {
  const g = new THREE.Group();
  const w = wood();
  const leg = new THREE.CylinderGeometry(0.025, 0.02, 0.45, 16);
  for (const [x, z] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]] as const) {
    g.add(mesh(leg, w, 'Leg', [x, 0.225, z]));
  }
  g.add(mesh(new RoundedBoxGeometry(0.5, 0.05, 0.5, 3, 0.015), w, 'Seat', [0, 0.47, 0]));
  const cushion = new THREE.MeshPhysicalMaterial({ name: 'Leather', color: '#2b1d15', roughness: 0.55, sheen: 0.4 });
  g.add(mesh(new RoundedBoxGeometry(0.44, 0.04, 0.44, 4, 0.02), cushion, 'Cushion', [0, 0.51, 0.01]));
  for (const x of [-0.2, 0.2]) g.add(mesh(new THREE.CylinderGeometry(0.02, 0.022, 0.5, 12), w, 'BackPost', [x, 0.74, -0.22]));
  g.add(mesh(new RoundedBoxGeometry(0.46, 0.18, 0.03, 3, 0.012), w, 'Backrest', [0, 0.88, -0.22]));
  return { scene: g, animations: [] };
}

function table() {
  const g = new THREE.Group();
  const w = wood();
  g.add(mesh(new RoundedBoxGeometry(1.6, 0.06, 0.9, 4, 0.02), w, 'Top', [0, 0.75, 0]));
  const legMat = metal('#1b1b1d', 0.35);
  const leg = new RoundedBoxGeometry(0.06, 0.72, 0.06, 2, 0.01);
  for (const [x, z] of [[-0.72, -0.37], [0.72, -0.37], [-0.72, 0.37], [0.72, 0.37]] as const) {
    g.add(mesh(leg, legMat, 'Leg', [x, 0.36, z]));
  }
  return { scene: g, animations: [] };
}

function lamp() {
  const g = new THREE.Group();
  const brass = metal('#c6a36a', 0.22);
  g.add(mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.03, 48), brass, 'Base', [0, 0.015, 0]));
  g.add(mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.3, 16), brass, 'Stem', [0, 0.67, 0]));
  const shade = new THREE.MeshPhysicalMaterial({
    name: 'Shade', color: '#eef4fa', roughness: 0.8, transparent: true, opacity: 0.88, side: THREE.DoubleSide,
  });
  g.add(mesh(new THREE.CylinderGeometry(0.14, 0.24, 0.3, 48, 1, true), shade, 'Shade', [0, 1.3, 0]));
  const bulb = new THREE.MeshStandardMaterial({ name: 'Bulb', color: '#fff4dc', emissive: '#ffd59a', emissiveIntensity: 4 });
  g.add(mesh(new THREE.SphereGeometry(0.05, 24, 16), bulb, 'Bulb', [0, 1.24, 0]));
  return { scene: g, animations: [] };
}

function car() {
  const g = new THREE.Group();
  const paint = new THREE.MeshPhysicalMaterial({
    name: 'CarPaint', color: '#7b1f1a', metalness: 0.6, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.06,
  });
  const glass = new THREE.MeshPhysicalMaterial({
    name: 'Glass', color: '#1c2a36', metalness: 0.2, roughness: 0.04, transparent: true, opacity: 0.55, envMapIntensity: 1.6,
  });
  const tyre = plastic('#121212', 0.85, 'Rubber');
  const rim = metal('#d0d0d4', 0.18);
  g.add(mesh(new RoundedBoxGeometry(3.9, 0.55, 1.75, 6, 0.22), paint, 'Body', [0, 0.55, 0]));
  g.add(mesh(new RoundedBoxGeometry(2.1, 0.5, 1.5, 6, 0.2), glass, 'Cabin', [-0.2, 1.0, 0]));
  const wheel = new THREE.CylinderGeometry(0.36, 0.36, 0.26, 40);
  wheel.rotateX(Math.PI / 2);
  const rimGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.28, 24);
  rimGeo.rotateX(Math.PI / 2);
  for (const [x, z] of [[-1.25, -0.82], [1.3, -0.82], [-1.25, 0.82], [1.3, 0.82]] as const) {
    g.add(mesh(wheel, tyre, 'Tyre', [x, 0.36, z]));
    g.add(mesh(rimGeo, rim, 'Rim', [x, 0.36, z]));
  }
  const light = new THREE.MeshStandardMaterial({ name: 'Headlight', color: '#fff', emissive: '#fff1d6', emissiveIntensity: 3 });
  for (const z of [-0.6, 0.6]) g.add(mesh(new THREE.BoxGeometry(0.04, 0.1, 0.32), light, 'Headlight', [1.95, 0.62, z]));
  const tail = new THREE.MeshStandardMaterial({ name: 'Taillight', color: '#400', emissive: '#ff2a1a', emissiveIntensity: 2 });
  for (const z of [-0.6, 0.6]) g.add(mesh(new THREE.BoxGeometry(0.04, 0.08, 0.3), tail, 'Taillight', [-1.95, 0.65, z]));
  return { scene: g, animations: [] };
}

function robot() {
  const g = new THREE.Group();
  const shell = new THREE.MeshPhysicalMaterial({ name: 'Shell', color: '#e9e4dc', roughness: 0.3, clearcoat: 0.6 });
  const joint = metal('#3a3a3e', 0.4);
  const eye = new THREE.MeshStandardMaterial({ name: 'Eye', color: '#111', emissive: '#d89a5b', emissiveIntensity: 3 });
  g.add(mesh(new RoundedBoxGeometry(0.6, 0.7, 0.4, 4, 0.08), shell, 'Torso', [0, 1.05, 0]));
  const head = new THREE.Group();
  head.name = 'Head';
  head.position.set(0, 1.62, 0);
  head.add(mesh(new RoundedBoxGeometry(0.42, 0.34, 0.36, 4, 0.08), shell, 'HeadShell', [0, 0, 0]));
  for (const x of [-0.09, 0.09]) head.add(mesh(new THREE.SphereGeometry(0.035, 16, 12), eye, 'Eye', [x, 0.02, 0.18]));
  g.add(head);
  g.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.1, 16), joint, 'Neck', [0, 1.44, 0]));
  for (const x of [-0.14, 0.14]) {
    g.add(mesh(new RoundedBoxGeometry(0.16, 0.66, 0.18, 3, 0.05), shell, 'Leg', [x, 0.36, 0]));
    g.add(mesh(new RoundedBoxGeometry(0.2, 0.06, 0.28, 2, 0.02), joint, 'Foot', [x, 0.03, 0.04]));
  }
  const arms: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.name = side < 0 ? 'ArmR' : 'ArmL';
    pivot.position.set(side * 0.38, 1.33, 0);
    pivot.add(mesh(new THREE.SphereGeometry(0.07, 16, 12), joint, 'Shoulder', [0, 0, 0]));
    pivot.add(mesh(new RoundedBoxGeometry(0.12, 0.55, 0.14, 3, 0.04), shell, 'Arm', [0, -0.3, 0]));
    g.add(pivot);
    arms.push(pivot);
  }
  const wave = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 2.4));
  const wave2 = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 2.0));
  const rest = new THREE.Quaternion();
  const clip = new THREE.AnimationClip('Wave', 2.4, [
    new THREE.QuaternionKeyframeTrack(
      'ArmL.quaternion',
      [0, 0.5, 0.9, 1.3, 1.7, 2.4],
      [...rest.toArray(), ...wave.toArray(), ...wave2.toArray(), ...wave.toArray(), ...wave2.toArray(), ...rest.toArray()],
    ),
    new THREE.NumberKeyframeTrack('Head.rotation[y]', [0, 1.2, 2.4], [0, 0.35, 0]),
  ]);
  const idle = new THREE.AnimationClip('Idle', 3, [
    new THREE.NumberKeyframeTrack('Head.rotation[y]', [0, 1.5, 3], [-0.25, 0.25, -0.25]),
  ]);
  return { scene: g, animations: [clip, idle] };
}

function materialSpheres() {
  const g = new THREE.Group();
  const geo = new THREE.SphereGeometry(0.3, 64, 48);
  const mats: THREE.Material[] = [
    metal('#e8c48c', 0.15),
    metal('#b8b8bc', 0.55),
    plastic('#6f4630', 0.35, 'Clay'),
    new THREE.MeshPhysicalMaterial({ name: 'Glass', color: '#dbefff', roughness: 0, metalness: 0.1, transparent: true, opacity: 0.35, envMapIntensity: 2 }),
    new THREE.MeshStandardMaterial({ name: 'Emissive', color: '#222', emissive: '#e08b4a', emissiveIntensity: 2 }),
  ];
  mats.forEach((m, i) => g.add(mesh(geo, m, m.name, [(i - 2) * 0.72, 0.3, 0])));
  return { scene: g, animations: [] };
}

export const BUILTINS: BuiltinDef[] = [
  { id: `${PREFIX}car`, name: 'Car', category: 'Vehicle', build: car },
  { id: `${PREFIX}chair`, name: 'Chair', category: 'Furniture', build: chair },
  { id: `${PREFIX}table`, name: 'Table', category: 'Furniture', build: table },
  { id: `${PREFIX}robot`, name: 'Robot', category: 'Character', build: robot },
  { id: `${PREFIX}lamp`, name: 'Lamp', category: 'Lighting', build: lamp },
  { id: `${PREFIX}spheres`, name: 'Material Spheres', category: 'Reference', build: materialSpheres },
];

export function getBuiltin(id: string): BuiltinDef | undefined {
  return BUILTINS.find((b) => b.id === id);
}
