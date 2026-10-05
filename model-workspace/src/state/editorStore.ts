import { create } from 'zustand';
import { uid } from '../core/ids';
import type { CameraState, InstanceState, ProjectDoc, SavedView, SceneSettings, Vec3 } from '../project/types';

export type GizmoMode = 'translate' | 'rotate' | 'scale';
export type SaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

interface Snapshot {
  instances: InstanceState[];
  settings: SceneSettings;
  selection: string[];
  label: string;
}

const HISTORY_LIMIT = 150;
/** Consecutive edits with the same key inside this window merge into one undo step. */
const COALESCE_MS = 700;

export interface AssetLoadState {
  status: 'loading' | 'ready' | 'error';
  progress: number | null;
  phase?: 'download' | 'parse';
  error?: string;
  name?: string;
}

export interface EditorState {
  project: Pick<ProjectDoc, 'id' | 'name' | 'saveCode' | 'createdAt' | 'updatedAt' | 'thumbnail'> | null;
  instances: InstanceState[];
  settings: SceneSettings | null;
  camera: CameraState | null;
  views: SavedView[];
  selection: string[];
  hovered: string | null;
  gizmoMode: GizmoMode;
  gizmoSpace: 'world' | 'local';
  /** Bumped by every persisted change; the autosaver watches it. */
  revision: number;
  /** Camera changes are saved, but do not count as "unsaved work" for history. */
  cameraRevision: number;
  saveStatus: SaveStatus;
  saveError: string | null;
  lastSavedAt: number | null;
  past: Snapshot[];
  future: Snapshot[];
  lastCoalesce: { key: string; at: number } | null;
  assetLoad: Record<string, AssetLoadState>;
  /** Live transform values while a gizmo drag is in progress. */
  dragging: boolean;

  openDoc: (doc: ProjectDoc) => void;
  closeDoc: () => void;
  setProjectMeta: (patch: Partial<NonNullable<EditorState['project']>>) => void;

  commit: (label: string, mutate: (draft: { instances: InstanceState[]; settings: SceneSettings }) => void, opts?: { coalesce?: string; select?: string[] }) => void;
  addInstances: (items: Omit<InstanceState, 'id'>[], label?: string) => string[];
  updateInstance: (id: string, patch: Partial<InstanceState>, label?: string, coalesce?: string) => void;
  setTransform: (id: string, t: { position?: Vec3; rotation?: Vec3; scale?: Vec3 }, label?: string) => void;
  removeInstances: (ids: string[]) => void;
  duplicateInstances: (ids: string[]) => string[];
  renameInstance: (id: string, name: string) => void;
  toggleVisible: (id: string) => void;
  toggleLocked: (id: string) => void;
  reorderInstance: (id: string, toIndex: number) => void;
  updateSettings: (mutate: (s: SceneSettings) => void, label: string, coalesce?: string) => void;
  setCamera: (cam: CameraState) => void;
  /** Camera bookmarks are saved with the project but are not undo steps. */
  setViews: (views: SavedView[]) => void;

  select: (ids: string[], mode?: 'replace' | 'toggle' | 'add') => void;
  setHovered: (id: string | null) => void;
  setGizmoMode: (m: GizmoMode) => void;
  setGizmoSpace: (s: 'world' | 'local') => void;
  setDragging: (d: boolean) => void;
  /** Ticks while a gizmo drag changes the object, so the properties panel can show live values. */
  liveTick: number;
  bumpLive: () => void;

  undo: () => void;
  redo: () => void;

  setSaveStatus: (s: SaveStatus, error?: string | null) => void;
  setAssetLoad: (id: string, s: AssetLoadState | null) => void;
}

const clone = <T,>(v: T): T => structuredClone(v);

export const useEditor = create<EditorState>()((set, get) => ({
  project: null,
  instances: [],
  settings: null,
  camera: null,
  views: [],
  selection: [],
  hovered: null,
  gizmoMode: 'translate',
  gizmoSpace: 'world',
  revision: 0,
  cameraRevision: 0,
  saveStatus: 'idle',
  saveError: null,
  lastSavedAt: null,
  past: [],
  future: [],
  lastCoalesce: null,
  assetLoad: {},
  dragging: false,

  openDoc: (doc) =>
    set({
      project: {
        id: doc.id, name: doc.name, saveCode: doc.saveCode,
        createdAt: doc.createdAt, updatedAt: doc.updatedAt, thumbnail: doc.thumbnail,
      },
      instances: clone(doc.instances),
      settings: clone(doc.settings),
      camera: clone(doc.camera),
      views: clone(doc.views ?? []),
      selection: [],
      hovered: null,
      revision: 0,
      cameraRevision: 0,
      saveStatus: 'saved',
      saveError: null,
      lastSavedAt: doc.updatedAt,
      past: [],
      future: [],
      lastCoalesce: null,
      assetLoad: {},
      dragging: false,
    }),

  closeDoc: () =>
    set({
      project: null, instances: [], settings: null, camera: null, views: [], selection: [], hovered: null,
      past: [], future: [], assetLoad: {}, saveStatus: 'idle', revision: 0, cameraRevision: 0,
    }),

  setProjectMeta: (patch) => {
    const p = get().project;
    if (!p) return;
    set({ project: { ...p, ...patch }, revision: get().revision + 1 });
  },

  commit: (label, mutate, opts) => {
    const s = get();
    if (!s.settings) return;
    const now = performance.now();
    const merge =
      !!opts?.coalesce &&
      s.lastCoalesce?.key === opts.coalesce &&
      now - s.lastCoalesce.at < COALESCE_MS &&
      s.past.length > 0;
    const before: Snapshot = { instances: s.instances, settings: s.settings, selection: s.selection, label };
    const draft = { instances: clone(s.instances), settings: clone(s.settings) };
    mutate(draft);
    const valid = new Set(draft.instances.map((i) => i.id));
    const selection = (opts?.select ?? s.selection).filter((id) => valid.has(id));
    set({
      instances: draft.instances,
      settings: draft.settings,
      selection,
      past: merge ? s.past : [...s.past, before].slice(-HISTORY_LIMIT),
      future: [],
      revision: s.revision + 1,
      lastCoalesce: opts?.coalesce ? { key: opts.coalesce, at: now } : null,
    });
  },

  addInstances: (items, label = 'Import') => {
    const ids = items.map(() => uid('ins'));
    get().commit(label, (d) => {
      items.forEach((it, i) => d.instances.push({ ...clone(it), id: ids[i] }));
    }, { select: ids.slice(-1) });
    return ids;
  },

  updateInstance: (id, patch, label = 'Edit', coalesce) =>
    get().commit(label, (d) => {
      const inst = d.instances.find((i) => i.id === id);
      if (inst) Object.assign(inst, clone(patch));
    }, { coalesce }),

  setTransform: (id, t, label = 'Transform') =>
    get().commit(label, (d) => {
      const inst = d.instances.find((i) => i.id === id);
      if (!inst) return;
      if (t.position) inst.position = [...t.position];
      if (t.rotation) inst.rotation = [...t.rotation];
      if (t.scale) inst.scale = [...t.scale];
    }),

  removeInstances: (ids) => {
    if (!ids.length) return;
    const rm = new Set(ids);
    get().commit(ids.length > 1 ? `Delete ${ids.length} models` : 'Delete', (d) => {
      d.instances = d.instances.filter((i) => !rm.has(i.id));
    }, { select: [] });
  },

  duplicateInstances: (ids) => {
    const src = get().instances.filter((i) => ids.includes(i.id));
    if (!src.length) return [];
    const newIds = src.map(() => uid('ins'));
    get().commit('Duplicate', (d) => {
      src.forEach((s, i) => {
        const copy = clone(s);
        copy.id = newIds[i];
        copy.name = nextCopyName(s.name, d.instances.map((x) => x.name));
        copy.locked = false;
        const at = d.instances.findIndex((x) => x.id === s.id);
        d.instances.splice(at + 1 + i, 0, copy);
      });
    }, { select: newIds });
    return newIds;
  },

  renameInstance: (id, name) => {
    const n = name.trim();
    if (!n) return;
    get().updateInstance(id, { name: n }, 'Rename');
  },

  toggleVisible: (id) => {
    const inst = get().instances.find((i) => i.id === id);
    if (inst) get().updateInstance(id, { visible: !inst.visible }, inst.visible ? 'Hide' : 'Show');
  },

  toggleLocked: (id) => {
    const inst = get().instances.find((i) => i.id === id);
    if (inst) get().updateInstance(id, { locked: !inst.locked }, inst.locked ? 'Unlock' : 'Lock');
  },

  reorderInstance: (id, toIndex) =>
    get().commit('Reorder', (d) => {
      const from = d.instances.findIndex((i) => i.id === id);
      if (from < 0) return;
      const [it] = d.instances.splice(from, 1);
      d.instances.splice(Math.max(0, Math.min(toIndex, d.instances.length)), 0, it);
    }),

  updateSettings: (mutate, label, coalesce) =>
    get().commit(label, (d) => mutate(d.settings), { coalesce: coalesce ?? label }),

  setCamera: (cam) => set({ camera: cam, cameraRevision: get().cameraRevision + 1 }),
  setViews: (views) => set({ views, revision: get().revision + 1 }),

  select: (ids, mode = 'replace') => {
    const cur = get().selection;
    let next: string[];
    if (mode === 'replace') next = [...ids];
    else if (mode === 'add') next = [...cur.filter((i) => !ids.includes(i)), ...ids];
    else {
      next = [...cur];
      for (const id of ids) {
        const at = next.indexOf(id);
        if (at >= 0) next.splice(at, 1);
        else next.push(id);
      }
    }
    if (next.length === cur.length && next.every((v, i) => v === cur[i])) return;
    set({ selection: next });
  },

  setHovered: (id) => {
    if (get().hovered !== id) set({ hovered: id });
  },
  setGizmoMode: (m) => set({ gizmoMode: m }),
  setGizmoSpace: (s) => set({ gizmoSpace: s }),
  setDragging: (d) => set({ dragging: d }),
  liveTick: 0,
  bumpLive: () => set({ liveTick: get().liveTick + 1 }),

  undo: () => {
    const s = get();
    const prev = s.past[s.past.length - 1];
    if (!prev || !s.settings) return;
    set({
      instances: prev.instances,
      settings: prev.settings,
      selection: prev.selection.filter((id) => prev.instances.some((i) => i.id === id)),
      past: s.past.slice(0, -1),
      future: [{ instances: s.instances, settings: s.settings, selection: s.selection, label: prev.label }, ...s.future],
      revision: s.revision + 1,
      lastCoalesce: null,
    });
  },

  redo: () => {
    const s = get();
    const next = s.future[0];
    if (!next || !s.settings) return;
    set({
      instances: next.instances,
      settings: next.settings,
      selection: next.selection.filter((id) => next.instances.some((i) => i.id === id)),
      past: [...s.past, { instances: s.instances, settings: s.settings, selection: s.selection, label: next.label }],
      future: s.future.slice(1),
      revision: s.revision + 1,
      lastCoalesce: null,
    });
  },

  setSaveStatus: (status, error = null) =>
    set({
      saveStatus: status,
      saveError: error,
      ...(status === 'saved' ? { lastSavedAt: Date.now() } : {}),
    }),

  setAssetLoad: (id, st) => {
    const next = { ...get().assetLoad };
    if (st) next[id] = st;
    else delete next[id];
    set({ assetLoad: next });
  },
}));

function nextCopyName(name: string, existing: string[]): string {
  const base = name.replace(/\s\(\d+\)$/, '');
  let n = 2;
  while (existing.includes(`${base} (${n})`)) n++;
  return `${base} (${n})`;
}

export const selectPrimary = (s: EditorState) => s.selection[s.selection.length - 1] ?? null;
