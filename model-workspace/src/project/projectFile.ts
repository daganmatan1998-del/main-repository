import { generateSaveCode, uid } from '../core/ids';
import { getAsset, findAssetByHash, putAsset } from '../persistence/assetRepo';
import { getProject, getProjectBySaveCode, putProject } from '../persistence/projectRepo';
import { isBuiltinAsset } from '../assets/builtins';
import { parseProjectDoc, ProjectLoadError } from './validate';
import type { AssetRecord, ProjectDoc } from './types';

/**
 * Single-file project archive (.3dws): everything needed to rebuild a project
 * on another machine or in the desktop app — the document plus every model
 * file it uses.
 *
 *   "3DWS" | u32 version | u32 header length | header JSON | file bytes…
 */
const MAGIC = '3DWS';
const VERSION = 1;
export const PROJECT_FILE_EXT = '.3dws';

interface HeaderFile { name: string; type: string; size: number }
interface HeaderAsset extends Omit<AssetRecord, 'files'> { files: HeaderFile[] }
interface Header { app: '3d-workspace'; project: ProjectDoc; assets: HeaderAsset[] }

export async function buildProjectFile(doc: ProjectDoc): Promise<Blob> {
  const ids = [...new Set(doc.instances.map((i) => i.assetId))].filter((id) => !isBuiltinAsset(id));
  const assets: HeaderAsset[] = [];
  const blobs: Blob[] = [];
  for (const id of ids) {
    const rec = await getAsset(id);
    if (!rec) continue; // missing asset: the instance will show as missing, like it does now
    assets.push({ ...rec, files: rec.files.map((f) => ({ name: f.name, type: f.type, size: f.blob.size })) });
    blobs.push(...rec.files.map((f) => f.blob));
  }
  const header: Header = { app: '3d-workspace', project: doc, assets };
  const json = new TextEncoder().encode(JSON.stringify(header));
  const pre = new Uint8Array(12);
  pre.set(new TextEncoder().encode(MAGIC), 0);
  const view = new DataView(pre.buffer);
  view.setUint32(4, VERSION, true);
  view.setUint32(8, json.byteLength, true);
  return new Blob([pre, json, ...blobs], { type: 'application/octet-stream' });
}

/** Imports a .3dws file as a project. Never overwrites: clashing ids / codes get new ones. */
export async function importProjectFile(file: Blob): Promise<ProjectDoc> {
  const bad = () => new ProjectLoadError('corrupted', 'Unable to load project. This is not a valid 3D Workspace project file.');
  if (file.size < 12) throw bad();
  const pre = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (new TextDecoder().decode(pre.slice(0, 4)) !== MAGIC) throw bad();
  const view = new DataView(pre.buffer);
  const version = view.getUint32(4, true);
  if (version > VERSION) throw new ProjectLoadError('corrupted', 'Unable to load project. It was exported by a newer version of the app.');
  const len = view.getUint32(8, true);
  if (12 + len > file.size) throw bad();
  let header: Header;
  try {
    header = JSON.parse(await file.slice(12, 12 + len).text());
  } catch {
    throw bad();
  }
  if (header?.app !== '3d-workspace' || !Array.isArray(header.assets)) throw bad();
  const doc = parseProjectDoc(header.project);

  // Assets: reuse identical ones already stored, otherwise store under a free id.
  const remap = new Map<string, string>();
  let offset = 12 + len;
  for (const a of header.assets) {
    const files = a.files.map((f) => {
      const blob = file.slice(offset, offset + f.size, f.type);
      offset += f.size;
      return { name: f.name, type: f.type, blob };
    });
    if (offset > file.size) throw bad();
    const same = await findAssetByHash(a.hash);
    if (same) {
      remap.set(a.id, same.id);
      continue;
    }
    const id = (await getAsset(a.id)) ? uid('ast') : a.id;
    // Copy bytes out of the archive so the stored blob doesn't pin the whole file.
    const owned = await Promise.all(files.map(async (f) => ({ ...f, blob: new Blob([await f.blob.arrayBuffer()], { type: f.type }) })));
    await putAsset({ ...a, id, files: owned });
    remap.set(a.id, id);
  }
  doc.instances = doc.instances.map((i) => ({ ...i, assetId: remap.get(i.assetId) ?? i.assetId }));

  const idTaken = !!(await getProject(doc.id));
  if (idTaken) {
    doc.id = uid('prj');
    doc.name = `${doc.name} (imported)`;
  }
  if (await getProjectBySaveCode(doc.saveCode)) {
    let code = generateSaveCode();
    while (await getProjectBySaveCode(code)) code = generateSaveCode();
    doc.saveCode = code;
  }
  doc.updatedAt = Date.now();
  await putProject(doc);
  return doc;
}
