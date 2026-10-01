import type { ModelFormat } from '../project/types';
import { extOf } from '../core/format';

export const MODEL_EXTENSIONS: Record<string, Exclude<ModelFormat, 'builtin'>> = {
  glb: 'glb',
  gltf: 'gltf',
  obj: 'obj',
  fbx: 'fbx',
  stl: 'stl',
  ply: 'ply',
};

/** Formats that may reference sibling files (buffers, textures, .mtl). */
export const MULTI_FILE_FORMATS = new Set<ModelFormat>(['gltf', 'obj', 'fbx']);

export const SIDECAR_EXTENSIONS = new Set([
  'bin', 'mtl', 'png', 'jpg', 'jpeg', 'webp', 'ktx2', 'basis', 'tga', 'bmp', 'gif', 'avif', 'dds', 'tif', 'tiff',
]);

export const ACCEPT_ATTR = [
  ...Object.keys(MODEL_EXTENSIONS),
  ...SIDECAR_EXTENSIONS,
].map((e) => `.${e}`).join(',');

export function modelFormatOf(name: string): Exclude<ModelFormat, 'builtin'> | null {
  return MODEL_EXTENSIONS[extOf(name)] ?? null;
}

export const FORMAT_LABEL: Record<ModelFormat, string> = {
  glb: 'GLB',
  gltf: 'glTF',
  obj: 'OBJ',
  fbx: 'FBX',
  stl: 'STL',
  ply: 'PLY',
  builtin: 'Sample',
};
