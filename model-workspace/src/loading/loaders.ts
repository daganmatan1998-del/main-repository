import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import type { AssetRecord } from '../project/types';
import { extOf } from '../core/format';

export interface ParsedModel {
  scene: THREE.Group;
  animations: THREE.AnimationClip[];
}

export type ProgressFn = (fraction: number | null, phase: 'download' | 'parse') => void;

const BASE = import.meta.env.BASE_URL;
const VIRTUAL_ROOT = 'https://asset.local/';

let renderer: THREE.WebGLRenderer | null = null;
let draco: DRACOLoader | null = null;
let ktx2: KTX2Loader | null = null;

/** The KTX2 loader needs to know what the GPU supports; the viewport registers its renderer here. */
export function setLoaderRenderer(r: THREE.WebGLRenderer) {
  renderer = r;
  if (ktx2) ktx2.detectSupport(r);
}

function dracoLoader() {
  if (!draco) {
    draco = new DRACOLoader();
    draco.setDecoderPath(`${BASE}decoders/draco/`);
    draco.setWorkerLimit(2);
  }
  return draco;
}

function ktx2Loader() {
  if (!ktx2) {
    ktx2 = new KTX2Loader();
    ktx2.setTranscoderPath(`${BASE}decoders/basis/`);
    if (renderer) ktx2.detectSupport(renderer);
  }
  return ktx2;
}

/**
 * Builds a LoadingManager that resolves every relative reference a model makes
 * (buffers, textures, .mtl) against the files the user imported together.
 */
function createFileManager(rec: AssetRecord) {
  const urls = new Map<string, string>();
  const byBase = new Map<string, string>();
  const created: string[] = [];
  for (const f of rec.files) {
    const url = URL.createObjectURL(f.blob);
    created.push(url);
    const norm = f.name.replace(/\\/g, '/').toLowerCase();
    urls.set(norm, url);
    byBase.set(norm.split('/').pop()!, url);
  }
  const manager = new THREE.LoadingManager();
  const missing: string[] = [];
  manager.setURLModifier((url) => {
    if (url.startsWith('data:') || url.startsWith('blob:')) return url;
    let rel = url.startsWith(VIRTUAL_ROOT) ? url.slice(VIRTUAL_ROOT.length) : url;
    try {
      rel = decodeURIComponent(rel);
    } catch {
      /* keep raw */
    }
    rel = rel.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
    const hit = urls.get(rel) ?? byBase.get(rel.split('/').pop() ?? '');
    if (hit) return hit;
    missing.push(rel);
    return url;
  });
  const mainUrl = VIRTUAL_ROOT + encodeURIComponent(rec.mainFile).replace(/%2F/g, '/');
  return {
    manager,
    mainUrl,
    missing,
    dispose: () => created.forEach((u) => URL.revokeObjectURL(u)),
  };
}

function onProg(progress?: ProgressFn) {
  return (e: ProgressEvent) => {
    if (!progress) return;
    progress(e.lengthComputable && e.total > 0 ? e.loaded / e.total : null, 'download');
  };
}

function defaultMaterial(geo: THREE.BufferGeometry) {
  return new THREE.MeshStandardMaterial({
    name: 'Default',
    color: geo.hasAttribute('color') ? 0xffffff : 0xb9b0a6,
    vertexColors: geo.hasAttribute('color'),
    roughness: 0.55,
    metalness: 0.05,
  });
}

function geometryToGroup(geo: THREE.BufferGeometry, name: string): THREE.Group {
  const group = new THREE.Group();
  const hasFaces = !!geo.index || geo.attributes.position.count % 3 === 0;
  if (!geo.hasAttribute('normal') && hasFaces) geo.computeVertexNormals();
  // A PLY with no faces is a point cloud.
  const isPoints = !geo.index && !geo.hasAttribute('normal') && !hasFaces;
  const obj = isPoints
    ? new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.01, vertexColors: geo.hasAttribute('color') }))
    : new THREE.Mesh(geo, defaultMaterial(geo));
  obj.name = name;
  group.add(obj);
  return group;
}

export async function parseAsset(rec: AssetRecord, progress?: ProgressFn): Promise<ParsedModel> {
  const fm = createFileManager(rec);
  try {
    const fmt = rec.format;
    if (fmt === 'glb' || fmt === 'gltf') {
      const loader = new GLTFLoader(fm.manager);
      loader.setDRACOLoader(dracoLoader());
      loader.setKTX2Loader(ktx2Loader());
      loader.setMeshoptDecoder(MeshoptDecoder);
      const gltf = await loader.loadAsync(fm.mainUrl, onProg(progress));
      progress?.(1, 'parse');
      const scene = gltf.scene ?? gltf.scenes?.[0];
      if (!scene) throw new Error('The file contains no scene.');
      return { scene, animations: gltf.animations ?? [] };
    }
    if (fmt === 'obj') {
      const loader = new OBJLoader(fm.manager);
      const mtl = rec.files.find((f) => extOf(f.name) === 'mtl');
      if (mtl) {
        const mtlLoader = new MTLLoader(fm.manager);
        mtlLoader.setResourcePath(VIRTUAL_ROOT);
        const materials = mtlLoader.parse(await mtl.blob.text(), VIRTUAL_ROOT);
        materials.preload();
        loader.setMaterials(materials);
      }
      const obj = await loader.loadAsync(fm.mainUrl, onProg(progress));
      if (!mtl) {
        obj.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) m.material = defaultMaterial(m.geometry);
        });
      }
      return { scene: obj, animations: [] };
    }
    if (fmt === 'fbx') {
      const loader = new FBXLoader(fm.manager);
      const obj = await loader.loadAsync(fm.mainUrl, onProg(progress));
      return { scene: obj, animations: obj.animations ?? [] };
    }
    if (fmt === 'stl') {
      const geo = await new STLLoader(fm.manager).loadAsync(fm.mainUrl, onProg(progress));
      return { scene: geometryToGroup(geo, rec.name), animations: [] };
    }
    if (fmt === 'ply') {
      const geo = await new PLYLoader(fm.manager).loadAsync(fm.mainUrl, onProg(progress));
      return { scene: geometryToGroup(geo, rec.name), animations: [] };
    }
    throw new Error(`Unsupported format: ${fmt}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(friendlyLoadError(msg, rec));
  } finally {
    if (fm.missing.length) {
      console.warn(`[load] ${rec.name}: unresolved references`, fm.missing);
    }
    // Textures decode from blob URLs asynchronously; revoke once they have had time to load.
    setTimeout(fm.dispose, 60_000);
  }
}

function friendlyLoadError(msg: string, rec: AssetRecord): string {
  if (/Failed to fetch|404|NetworkError/i.test(msg) && rec.format === 'gltf') {
    return `${rec.mainFile} references files that weren’t imported with it. Drop the .gltf together with its .bin and texture files (or use .glb).`;
  }
  if (/Unexpected token|JSON/i.test(msg)) return `${rec.mainFile} is not a valid ${rec.format.toUpperCase()} file.`;
  if (/magic|Unsupported asset|version/i.test(msg)) return `${rec.mainFile}: ${msg}`;
  return `Couldn’t load ${rec.mainFile}: ${msg}`;
}
