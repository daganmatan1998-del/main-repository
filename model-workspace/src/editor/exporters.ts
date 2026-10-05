import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { useEditor } from '../state/editorStore';
import { registry } from '../scene/registry';
import { viewport } from '../scene/viewportServices';
import { withOriginalMaterials } from '../scene/Inspection';
import { getLoadedAsset } from '../loading/assetCache';

/** Saves a Blob through the browser / WebView download flow. */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function safeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'untitled';
}

function stamp() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}.${p(d.getMinutes())}`;
}

/** High-resolution PNG of the current view (no gizmo, no outlines). */
export async function exportImage(width: number, height: number, hideFloor: boolean): Promise<string> {
  if (!viewport.renderImage) throw new Error('The 3D view is not ready yet.');
  // The capture keeps the current view mode on purpose — a wireframe or clay shot is useful.
  const blob = await viewport.renderImage(width, height, { hideFloor });
  const name = `${safeFilename(useEditor.getState().project?.name ?? 'Workspace')} ${stamp()}.png`;
  downloadBlob(blob, name);
  return name;
}

/**
 * Exports models as one binary glTF. Uses the real materials (not the view
 * mode's), keeps each model's placement, and includes animation clips.
 */
export async function exportGLB(ids: string[]): Promise<string> {
  const st = useEditor.getState();
  const insts = st.instances.filter((i) => ids.includes(i.id));
  if (!insts.length) throw new Error('Nothing to export.');
  const objects = insts.map((i) => registry.get(i.id)).filter((o): o is THREE.Object3D => !!o);
  if (objects.length !== insts.length) throw new Error('Some models are still loading. Try again in a moment.');
  const animations: THREE.AnimationClip[] = [];
  if (insts.length === 1) animations.push(...(getLoadedAsset(insts[0].assetId)?.animations ?? []));

  const exporter = new GLTFExporter();
  const result = await withOriginalMaterials(() =>
    exporter.parseAsync(objects, { binary: true, onlyVisible: false, animations, maxTextureSize: 8192 }),
  );
  const base = insts.length === 1 ? insts[0].name : st.project?.name ?? 'Scene';
  const name = `${safeFilename(base)}.glb`;
  downloadBlob(new Blob([result as ArrayBuffer], { type: 'model/gltf-binary' }), name);
  return name;
}
