import { baseName, extOf } from '../core/format';
import { sha256Hex, uid } from '../core/ids';
import { findAssetByHash, putAsset } from '../persistence/assetRepo';
import { MULTI_FILE_FORMATS, SIDECAR_EXTENSIONS, modelFormatOf } from '../loading/formats';
import { acquireAsset, releaseAsset, onAssetProgress } from '../loading/assetCache';
import { useEditor } from '../state/editorStore';
import { toast } from '../state/uiStore';
import type { AssetRecord, InstanceState, StoredFile, Vec3 } from '../project/types';
import { instanceBox, unionBox } from './bounds';
import { cameraApi } from '../scene/cameraApi';
import { getBuiltin } from '../assets/builtins';

/** A file plus its path inside a dropped folder (for resolving relative references). */
export interface PickedFile {
  file: File;
  path: string;
}

/** Reads a DataTransfer, descending into dropped folders. */
export async function filesFromDataTransfer(dt: DataTransfer): Promise<PickedFile[]> {
  const out: PickedFile[] = [];
  const entries: FileSystemEntry[] = [];
  for (const item of Array.from(dt.items)) {
    const entry = item.webkitGetAsEntry?.();
    if (entry) entries.push(entry);
  }
  if (!entries.length) {
    return Array.from(dt.files).map((f) => ({ file: f, path: f.name }));
  }
  const walk = async (entry: FileSystemEntry, prefix: string): Promise<void> => {
    if (entry.isFile) {
      const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
      out.push({ file, path: prefix + file.name });
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      let batch: FileSystemEntry[];
      do {
        batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
        for (const e of batch) await walk(e, `${prefix}${entry.name}/`);
      } while (batch.length);
    }
  };
  for (const e of entries) await walk(e, '');
  return out;
}

/**
 * Turns a set of picked files into stored assets. Each model file becomes one
 * asset; textures/.bin/.mtl travel with the multi-file formats that need them.
 * Identical files are stored once (content hash).
 */
async function storeAssets(picked: PickedFile[]): Promise<{ assets: AssetRecord[]; skipped: string[] }> {
  const models = picked.filter((p) => modelFormatOf(p.file.name));
  const sidecars = picked.filter((p) => SIDECAR_EXTENSIONS.has(extOf(p.file.name)));
  const skipped = picked
    .filter((p) => !modelFormatOf(p.file.name) && !SIDECAR_EXTENSIONS.has(extOf(p.file.name)))
    .map((p) => p.file.name);
  const assets: AssetRecord[] = [];

  for (const m of models) {
    const format = modelFormatOf(m.file.name)!;
    const dir = m.path.includes('/') ? m.path.slice(0, m.path.lastIndexOf('/') + 1) : '';
    // Sidecar paths are stored relative to the model, so "textures/a.png" resolves.
    const rel = (p: string) => (dir && p.startsWith(dir) ? p.slice(dir.length) : p);
    const files: StoredFile[] = [{ name: m.file.name, type: m.file.type, blob: m.file }];
    if (MULTI_FILE_FORMATS.has(format)) {
      for (const s of sidecars) files.push({ name: rel(s.path), type: s.file.type, blob: s.file });
    }
    const hash = await sha256Hex(m.file);
    const sidecarKey = files.length > 1 ? `+${files.length - 1}` : '';
    const existing = await findAssetByHash(hash + sidecarKey);
    if (existing) {
      assets.push(existing);
      continue;
    }
    const rec: AssetRecord = {
      id: uid('ast'),
      name: baseName(m.file.name),
      format,
      mainFile: m.file.name,
      files,
      size: files.reduce((n, f) => n + f.blob.size, 0),
      hash: hash + sidecarKey,
      createdAt: Date.now(),
    };
    try {
      await putAsset(rec);
    } catch (e) {
      const quota = (e as DOMException)?.name === 'QuotaExceededError';
      throw new Error(
        quota
          ? `Not enough local storage to keep ${m.file.name}. Free up space by deleting unused projects.`
          : `Couldn’t store ${m.file.name}: ${(e as Error).message}`,
      );
    }
    assets.push(rec);
  }
  return { assets, skipped };
}

/** Where the next model goes: right of everything already placed, standing on the floor. */
export function placeBeside(existing: InstanceState[], assetId: string, bounds: { min: Vec3; max: Vec3 }): Vec3 {
  const sizeX = bounds.max[0] - bounds.min[0];
  const sizeZ = bounds.max[2] - bounds.min[2];
  const y = -bounds.min[1];
  const centerOffsetZ = -(bounds.min[2] + bounds.max[2]) / 2;
  if (!existing.length) {
    return [-(bounds.min[0] + bounds.max[0]) / 2, y, centerOffsetZ];
  }
  const scene = unionBox(existing);
  const sceneSize = scene.getSize(scene.min.clone());
  const gap = Math.max(0.25, 0.2 * Math.max(sizeX, sizeZ, Math.min(sceneSize.x, sceneSize.z)));
  const sceneCenterZ = (scene.min.z + scene.max.z) / 2;
  void assetId;
  return [scene.max.x + gap - bounds.min[0], y, sceneCenterZ + centerOffsetZ];
}

let importing = 0;

/** Full import: store files, load each model (with progress), place it, select it, frame the scene. */
export async function importFiles(picked: PickedFile[]): Promise<void> {
  if (!picked.length) return;
  const st = useEditor.getState();
  if (!st.project) return;
  let stored: Awaited<ReturnType<typeof storeAssets>>;
  try {
    stored = await storeAssets(picked);
  } catch (e) {
    toast('error', 'Import failed', (e as Error).message);
    return;
  }
  if (!stored.assets.length) {
    toast(
      'warning',
      'No 3D models found',
      stored.skipped.length
        ? `Unsupported: ${stored.skipped.slice(0, 3).join(', ')}. Use GLB, glTF, OBJ, FBX, STL or PLY.`
        : 'Drop GLB, glTF, OBJ, FBX, STL or PLY files.',
    );
    return;
  }
  importing++;
  const added: string[] = [];
  try {
    for (const rec of stored.assets) {
      const ids = await addAssetInstance(rec.id, rec.name);
      added.push(...ids);
    }
  } finally {
    importing--;
  }
  if (added.length) {
    useEditor.getState().select(added.slice(-1));
    toast('success', added.length === 1 ? 'Model imported' : `${added.length} models imported`);
    if (!importing) setTimeout(() => cameraApi.fitScene(), 60);
  }
}

/** Loads an asset (stored or built-in) and adds one placed instance of it. Returns the new ids. */
export async function addAssetInstance(assetId: string, name?: string): Promise<string[]> {
  const builtin = getBuiltin(assetId);
  const label = name ?? builtin?.name ?? 'Model';
  const { setAssetLoad } = useEditor.getState();
  setAssetLoad(assetId, { status: 'loading', progress: null, name: label });
  const off = onAssetProgress((id, progress, phase) => {
    if (id === assetId) useEditor.getState().setAssetLoad(assetId, { status: 'loading', progress, phase, name: label });
  });
  try {
    const asset = await acquireAsset(assetId);
    const st = useEditor.getState();
    if (!st.project) return [];
    const unit = builtin ? 1 : unitScaleFor(asset.bounds);
    const scaled = {
      min: asset.bounds.min.map((v) => v * unit) as Vec3,
      max: asset.bounds.max.map((v) => v * unit) as Vec3,
    };
    const position = placeBeside(st.instances, assetId, scaled);
    if (unit !== 1) {
      const size = Math.max(...asset.bounds.max.map((v, i) => v - asset.bounds.min[i]));
      toast('info', `Scaled “${label}” ×${unit}`, `It was ${size.toFixed(size > 100 ? 0 : 3)} units across — likely authored in ${unit < 1 ? 'centimetres or millimetres' : 'kilometres or metres at tiny scale'}. Reset transform restores the original size.`, 6000);
    }
    const ids = st.addInstances(
      [
        {
          assetId,
          name: uniqueName(label, st.instances.map((i) => i.name)),
          position,
          rotation: [0, 0, 0],
          scale: [unit, unit, unit],
          visible: true,
          locked: false,
          animation: asset.animations.length ? { clip: asset.animations[0].name, playing: false } : undefined,
        },
      ],
      'Add model',
    );
    // The instance component now holds its own reference.
    releaseAsset(assetId);
    useEditor.getState().setAssetLoad(assetId, null);
    return ids;
  } catch (e) {
    useEditor.getState().setAssetLoad(assetId, null);
    toast('error', `Couldn’t load “${label}”`, (e as Error).message);
    return [];
  } finally {
    off();
  }
}

/**
 * Unit normalisation: files authored in centimetres / millimetres (common for FBX,
 * STL, PLY) arrive 100–1000× larger than metre-based glTF. A power-of-ten scale
 * brings them into a 0.05–12 unit range (metres: anything from a ring to a bus), so models sit together sensibly while
 * proportions within the same unit system are preserved. Geometry is untouched.
 */
export function unitScaleFor(bounds: { min: Vec3; max: Vec3 }): number {
  const size = Math.max(...bounds.max.map((v, i) => v - bounds.min[i]));
  if (!Number.isFinite(size) || size <= 0) return 1;
  let scale = 1;
  while (size * scale > 12 && scale > 1e-6) scale /= 10;
  while (size * scale < 0.05 && scale < 1e6) scale *= 10;
  return Number(scale.toPrecision(1));
}

function uniqueName(name: string, existing: string[]): string {
  if (!existing.includes(name)) return name;
  let n = 2;
  while (existing.includes(`${name} (${n})`)) n++;
  return `${name} (${n})`;
}

export { instanceBox };
