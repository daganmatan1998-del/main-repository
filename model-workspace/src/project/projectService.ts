import { generateSaveCode, normalizeSaveCode, uid } from '../core/ids';
import { cloneSettings, DEFAULT_CAMERA, DEFAULT_SETTINGS } from './defaults';
import { PROJECT_SCHEMA_VERSION, type ProjectDoc } from './types';
import { parseProjectDoc, ProjectLoadError } from './validate';
import {
  deleteProjectRecord,
  getProject,
  getProjectBySaveCode,
  listProjectRecords,
  putProject,
} from '../persistence/projectRepo';
import { deleteAsset, listAssetInfos } from '../persistence/assetRepo';
import { isBuiltinAsset } from '../assets/builtins';

export interface ProjectSummary {
  id: string;
  name: string;
  saveCode: string;
  createdAt: number;
  updatedAt: number;
  modelCount: number;
  thumbnail: string | null;
  corrupted: boolean;
}

async function uniqueSaveCode(): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const code = generateSaveCode();
    if (!(await getProjectBySaveCode(code))) return code;
  }
  throw new Error('Could not allocate a unique save code.');
}

export async function createProject(name: string): Promise<ProjectDoc> {
  const now = Date.now();
  const doc: ProjectDoc = {
    schema: PROJECT_SCHEMA_VERSION,
    id: uid('prj'),
    saveCode: await uniqueSaveCode(),
    name: name.trim() || 'Untitled Project',
    createdAt: now,
    updatedAt: now,
    instances: [],
    camera: structuredClone(DEFAULT_CAMERA),
    settings: cloneSettings(DEFAULT_SETTINGS),
    thumbnail: null,
  };
  await putProject(doc);
  return doc;
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const records = await listProjectRecords();
  const out: ProjectSummary[] = [];
  for (const raw of records) {
    try {
      const d = parseProjectDoc(raw);
      out.push({
        id: d.id,
        name: d.name,
        saveCode: d.saveCode,
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
        modelCount: d.instances.length,
        thumbnail: d.thumbnail,
        corrupted: false,
      });
    } catch {
      // Keep damaged records visible so the user can delete them.
      const o = (raw ?? {}) as Record<string, unknown>;
      if (typeof o.id === 'string') {
        out.push({
          id: o.id,
          name: typeof o.name === 'string' ? o.name : 'Damaged project',
          saveCode: typeof o.saveCode === 'string' ? o.saveCode : '—',
          createdAt: 0,
          updatedAt: typeof o.updatedAt === 'number' ? o.updatedAt : 0,
          modelCount: 0,
          thumbnail: null,
          corrupted: true,
        });
      }
    }
  }
  return out;
}

export async function loadProject(id: string): Promise<ProjectDoc> {
  let raw: unknown;
  try {
    raw = await getProject(id);
  } catch (e) {
    throw new ProjectLoadError('corrupted', `Unable to load project. ${(e as Error).message}`);
  }
  if (!raw) throw new ProjectLoadError('not-found', 'Project not found.');
  return parseProjectDoc(raw);
}

export async function findProjectByCode(input: string): Promise<ProjectDoc> {
  const code = normalizeSaveCode(input);
  if (!code) {
    throw new ProjectLoadError('not-found', 'That doesn’t look like a save code. Codes look like 3D-7K29-XP4M.');
  }
  const raw = await getProjectBySaveCode(code);
  if (!raw) throw new ProjectLoadError('not-found', 'Project not found.');
  return parseProjectDoc(raw);
}

export async function saveProject(doc: ProjectDoc): Promise<void> {
  await putProject(doc);
}

export async function renameProject(id: string, name: string): Promise<ProjectDoc> {
  const doc = await loadProject(id);
  doc.name = name.trim() || doc.name;
  doc.updatedAt = Date.now();
  await putProject(doc);
  return doc;
}

export async function duplicateProject(id: string): Promise<ProjectDoc> {
  const src = await loadProject(id);
  const now = Date.now();
  const copy: ProjectDoc = {
    ...structuredClone(src),
    id: uid('prj'),
    saveCode: await uniqueSaveCode(),
    name: `${src.name} (copy)`,
    createdAt: now,
    updatedAt: now,
  };
  // Instances get fresh ids so the two projects never share identity.
  copy.instances = copy.instances.map((i) => ({ ...i, id: uid('ins') }));
  await putProject(copy);
  return copy;
}

/** Deletes the project, then any stored asset no remaining project references. */
export async function deleteProject(id: string): Promise<void> {
  await deleteProjectRecord(id);
  await collectGarbageAssets();
}

export async function collectGarbageAssets(): Promise<number> {
  const records = await listProjectRecords();
  const used = new Set<string>();
  for (const raw of records) {
    const inst = (raw as { instances?: { assetId?: string }[] })?.instances;
    if (Array.isArray(inst)) for (const i of inst) if (i?.assetId) used.add(i.assetId);
  }
  let removed = 0;
  for (const a of await listAssetInfos()) {
    if (!used.has(a.id) && !isBuiltinAsset(a.id)) {
      await deleteAsset(a.id);
      removed++;
    }
  }
  return removed;
}
