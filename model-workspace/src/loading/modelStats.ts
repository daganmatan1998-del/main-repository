import * as THREE from 'three';

export interface TextureInfo {
  name: string;
  slot: string;
  width: number;
  height: number;
}

export interface ModelStats {
  triangles: number;
  vertices: number;
  meshes: number;
  materials: number;
  materialNames: string[];
  textures: TextureInfo[];
  animations: string[];
  pbr: boolean;
}

const TEXTURE_SLOTS = [
  'map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap', 'bumpMap',
  'displacementMap', 'clearcoatMap', 'clearcoatNormalMap', 'clearcoatRoughnessMap', 'sheenColorMap',
  'transmissionMap', 'thicknessMap', 'specularMap', 'specularColorMap', 'specularIntensityMap', 'lightMap',
  'iridescenceMap', 'anisotropyMap',
] as const;

export function forEachTexture(mat: THREE.Material, fn: (tex: THREE.Texture, slot: string) => void) {
  const rec = mat as unknown as Record<string, unknown>;
  for (const slot of TEXTURE_SLOTS) {
    const t = rec[slot];
    if (t && (t as THREE.Texture).isTexture) fn(t as THREE.Texture, slot);
  }
}

export function materialsOf(obj: THREE.Object3D): THREE.Material[] {
  const m = (obj as THREE.Mesh).material;
  if (!m) return [];
  return Array.isArray(m) ? m : [m];
}

export function computeModelStats(root: THREE.Object3D, clips: THREE.AnimationClip[]): ModelStats {
  let triangles = 0;
  let vertices = 0;
  let meshes = 0;
  let pbr = false;
  const mats = new Set<THREE.Material>();
  const textures = new Map<THREE.Texture, TextureInfo>();

  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!(mesh.isMesh || (o as THREE.Points).isPoints || (o as THREE.Line).isLine)) return;
    meshes++;
    const geo = mesh.geometry as THREE.BufferGeometry;
    const pos = geo?.attributes?.position;
    if (pos) {
      vertices += pos.count;
      if (mesh.isMesh) triangles += (geo.index ? geo.index.count : pos.count) / 3;
    }
    for (const m of materialsOf(o)) {
      mats.add(m);
      if ((m as THREE.MeshStandardMaterial).isMeshStandardMaterial) pbr = true;
      forEachTexture(m, (t, slot) => {
        if (textures.has(t)) return;
        const img = t.image as { width?: number; height?: number } | undefined;
        textures.set(t, {
          name: t.name || slot,
          slot,
          width: img?.width ?? 0,
          height: img?.height ?? 0,
        });
      });
    }
  });

  return {
    triangles: Math.round(triangles),
    vertices,
    meshes,
    materials: mats.size,
    materialNames: [...mats].map((m, i) => m.name || `Material ${i + 1}`),
    textures: [...textures.values()],
    animations: clips.map((c) => c.name || 'Clip'),
    pbr,
  };
}
