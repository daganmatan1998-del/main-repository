import { useEffect } from 'react';
import { useEditor } from '../state/editorStore';
import { saveProject } from '../project/projectService';
import { PROJECT_SCHEMA_VERSION, type ProjectDoc } from '../project/types';
import { viewport } from '../scene/viewportServices';
import { cameraApi } from '../scene/cameraApi';
import { DEFAULT_CAMERA } from '../project/defaults';

const EDIT_DEBOUNCE_MS = 700;
const CAMERA_DEBOUNCE_MS = 1500;
const THUMBNAIL_MIN_INTERVAL_MS = 2500;

let timer: ReturnType<typeof setTimeout> | null = null;
let inFlight: Promise<void> | null = null;
let rerun = false;
let lastThumbAt = 0;
let pendingEdits = false;

/** Snapshot of the editor as a persistable document. */
export function buildDoc(withThumbnail: boolean): ProjectDoc | null {
  const s = useEditor.getState();
  if (!s.project || !s.settings) return null;
  let thumbnail = s.project.thumbnail;
  if (withThumbnail && viewport.capture) {
    try {
      thumbnail = viewport.capture(640) ?? thumbnail;
      lastThumbAt = Date.now();
    } catch {
      /* keep previous thumbnail */
    }
  }
  return {
    schema: PROJECT_SCHEMA_VERSION,
    id: s.project.id,
    saveCode: s.project.saveCode,
    name: s.project.name,
    createdAt: s.project.createdAt,
    updatedAt: Date.now(),
    instances: s.instances,
    camera: cameraApi.read() ?? s.camera ?? DEFAULT_CAMERA,
    settings: s.settings,
    thumbnail,
    views: s.views,
  };
}

async function runSave(forceThumb: boolean): Promise<void> {
  const st = useEditor.getState();
  const wantThumb = forceThumb || Date.now() - lastThumbAt > THUMBNAIL_MIN_INTERVAL_MS;
  const doc = buildDoc(wantThumb);
  if (!doc) return;
  st.setSaveStatus('saving');
  pendingEdits = false;
  try {
    await saveProject(doc);
    const cur = useEditor.getState();
    if (cur.project?.id === doc.id) {
      useEditor.setState({ project: { ...cur.project, updatedAt: doc.updatedAt, thumbnail: doc.thumbnail } });
      if (pendingEdits || timer) cur.setSaveStatus('pending');
      else cur.setSaveStatus('saved');
    }
  } catch (e) {
    const quota = (e as DOMException)?.name === 'QuotaExceededError';
    useEditor.getState().setSaveStatus(
      'error',
      quota ? 'Local storage is full — changes are not being saved.' : `Save failed: ${(e as Error).message}`,
    );
    throw e;
  }
}

/** Saves now (waiting for any save in progress). Used before leaving the editor. */
export async function flushSave(forceThumb = true): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (inFlight) await inFlight.catch(() => {});
  inFlight = runSave(forceThumb).finally(() => {
    inFlight = null;
  });
  await inFlight;
}

function schedule(delay: number) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(async () => {
    timer = null;
    if (inFlight) {
      rerun = true;
      return;
    }
    inFlight = runSave(false)
      .catch(() => {})
      .finally(() => {
        inFlight = null;
        if (rerun) {
          rerun = false;
          schedule(100);
        }
      });
  }, delay);
}

/** Watches the editor store and saves after a short quiet period. */
export function useAutosave() {
  useEffect(() => {
    lastThumbAt = 0;
    const unsub = useEditor.subscribe((s, p) => {
      if (!s.project || s.project.id !== p.project?.id) return;
      if (s.revision !== p.revision) {
        pendingEdits = true;
        if (s.saveStatus !== 'pending' && s.saveStatus !== 'error') s.setSaveStatus('pending');
        schedule(s.dragging ? 1500 : EDIT_DEBOUNCE_MS);
      } else if (s.cameraRevision !== p.cameraRevision && !timer) {
        schedule(CAMERA_DEBOUNCE_MS);
      }
    });
    const onHide = () => {
      if (document.visibilityState === 'hidden') flushSave(true).catch(() => {});
    };
    const onUnload = () => {
      // Best effort: IndexedDB writes usually complete during unload.
      if (pendingEdits || timer) flushSave(false).catch(() => {});
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onUnload);
    window.addEventListener('beforeunload', onUnload);
    return () => {
      unsub();
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onUnload);
      window.removeEventListener('beforeunload', onUnload);
      if (timer) clearTimeout(timer);
      timer = null;
    };
  }, []);
}

export function hasUnsavedChanges() {
  return pendingEdits || !!timer || !!inFlight;
}
