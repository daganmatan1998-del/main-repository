import { useEffect } from 'react';
import { selectPrimary, useEditor } from '../state/editorStore';
import { cameraApi } from '../scene/cameraApi';
import { setProjection } from '../scene/CameraRig';
import { viewport } from '../scene/viewportServices';
import { useTools, type ViewMode } from '../state/toolsStore';
import { toggleIsolate } from '../ui/editor/ViewportBar';

const MODES: ViewMode[] = ['shaded', 'clay', 'wireframe', 'xray', 'normals'];

function typing(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  return t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName);
}

/** Editor keyboard shortcuts. Ignored while typing or when a dialog is open. */
export function useEditorShortcuts(opts: { onShortcuts: () => void; onCapture: () => void; enabled: boolean }) {
  useEffect(() => {
    if (!opts.enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const s = useEditor.getState();
      const t = useTools.getState();
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && key === 'k') {
        e.preventDefault();
        t.setPaletteOpen(!t.paletteOpen);
        return;
      }
      if (typing(e) || document.querySelector('.modal-backdrop, .palette-backdrop')) return;
      const primary = selectPrimary(s);
      if (key === 'tab' && !mod && !e.altKey) {
        e.preventDefault();
        t.setUiHidden(!t.uiHidden);
        return;
      }

      if (mod && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
        return;
      }
      if (mod && key === 'y') {
        e.preventDefault();
        s.redo();
        return;
      }
      if (mod && key === 'd') {
        e.preventDefault();
        if (s.selection.length) s.duplicateInstances(s.selection);
        return;
      }
      if (mod && key === 'a') {
        e.preventDefault();
        s.select(s.instances.filter((i) => i.visible).map((i) => i.id));
        return;
      }
      if (['1', '3', '7'].includes(e.key) && !e.altKey) {
        e.preventDefault();
        const views = { '1': ['front', 'back'], '3': ['right', 'left'], '7': ['top', 'bottom'] } as const;
        cameraApi.setView(views[e.key as '1' | '3' | '7'][mod ? 1 : 0]);
        return;
      }
      if (mod || e.altKey) return;

      switch (key) {
        case 'w': s.setGizmoMode('translate'); break;
        case 'e': s.setGizmoMode('rotate'); break;
        case 'r': s.setGizmoMode('scale'); break;
        case 'x': s.setGizmoSpace(s.gizmoSpace === 'world' ? 'local' : 'world'); break;
        case 's': s.updateSettings((d) => void (d.snapping.enabled = !d.snapping.enabled), 'Snapping'); break;
        case 'f': cameraApi.fitSelected(); break;
        case 'a': cameraApi.fitScene(); break;
        case '5': setProjection(s.camera?.projection === 'orthographic' ? 'perspective' : 'orthographic'); break;
        case 'home': cameraApi.reset(); break;
        case 'h':
          if (s.selection.length) {
            const show = s.instances.filter((i) => s.selection.includes(i.id)).every((i) => !i.visible);
            s.commit(show ? 'Show' : 'Hide', (d) => d.instances.forEach((i) => s.selection.includes(i.id) && (i.visible = show)));
          }
          break;
        case 'l':
          if (primary) s.toggleLocked(primary);
          break;
        case 'f2':
          if (primary) window.dispatchEvent(new CustomEvent('workspace:rename', { detail: primary }));
          break;
        case 'delete':
        case 'backspace':
          if (s.selection.length) {
            e.preventDefault();
            s.removeInstances(s.selection);
          }
          break;
        case 'escape':
          // Leave the innermost mode first: measuring → isolation → selection.
          if (t.measuring) t.setMeasuring(false);
          else if (t.isolated) t.setIsolated(null);
          else if (t.turntable) t.setTurntable(false);
          else s.select([]);
          break;
        case 'm': t.setMeasuring(!t.measuring); break;
        case 't': t.setTurntable(!t.turntable); break;
        case 'i': toggleIsolate(); break;
        case 'c': t.setSection({ enabled: !t.section.enabled }); break;
        case 'v': t.setViewMode(MODES[(MODES.indexOf(t.viewMode) + (e.shiftKey ? MODES.length - 1 : 1)) % MODES.length]); break;
        case 'p': opts.onCapture(); break;
        case '?': opts.onShortcuts(); break;
        case 'arrowleft': cameraApi.orbit(15, 0); break;
        case 'arrowright': cameraApi.orbit(-15, 0); break;
        case 'arrowup': cameraApi.orbit(0, 10); break;
        case 'arrowdown': cameraApi.orbit(0, -10); break;
        default: return;
      }
      viewport.invalidate();
    };
    // Shift held = temporary snapping while dragging the gizmo.
    let tempSnap = false;
    const onShift = (e: KeyboardEvent) => {
      if (e.key !== 'Shift' || typing(e)) return;
      const s = useEditor.getState();
      if (e.type === 'keydown' && !s.settings?.snapping.enabled && s.dragging) {
        tempSnap = true;
        useEditor.setState({ settings: { ...s.settings!, snapping: { ...s.settings!.snapping, enabled: true } } });
      } else if (e.type === 'keyup' && tempSnap) {
        tempSnap = false;
        useEditor.setState({ settings: { ...s.settings!, snapping: { ...s.settings!.snapping, enabled: false } } });
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keydown', onShift);
    window.addEventListener('keyup', onShift);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keydown', onShift);
      window.removeEventListener('keyup', onShift);
    };
  }, [opts.enabled, opts.onShortcuts, opts.onCapture]);
}
