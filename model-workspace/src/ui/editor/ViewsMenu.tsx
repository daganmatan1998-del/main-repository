import { useEffect, useRef, useState } from 'react';
import { Bookmark, Plus, X } from 'lucide-react';
import { useEditor } from '../../state/editorStore';
import { cameraApi } from '../../scene/cameraApi';
import { setProjection } from '../../scene/CameraRig';
import { viewport } from '../../scene/viewportServices';
import { uid } from '../../core/ids';
import { IconButton } from '../common/Tooltip';
import type { SavedView } from '../../project/types';

export function goToView(v: SavedView) {
  const cur = useEditor.getState().camera;
  if (cur && cur.projection !== v.camera.projection) setProjection(v.camera.projection);
  // Projection switches rebuild the controls; apply on the next frame.
  requestAnimationFrame(() => {
    const c = viewport.controls;
    if (!c) return;
    c.setLookAt(...v.camera.position, ...v.camera.target, true);
    if (v.camera.projection === 'orthographic') c.zoomTo(v.camera.zoom, true);
  });
}

export function saveCurrentView(name?: string): SavedView | null {
  const cam = cameraApi.read();
  if (!cam) return null;
  const st = useEditor.getState();
  const view: SavedView = { id: uid('view'), name: name?.trim() || `View ${st.views.length + 1}`, camera: cam };
  st.setViews([...st.views, view]);
  return view;
}

/** Camera bookmarks: save the current angle, jump back to it later. Saved with the project. */
export function ViewsMenu() {
  const views = useEditor((s) => s.views);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);
  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <button className="vbtn" onClick={() => setOpen(!open)} data-testid="views-menu">
        <Bookmark /> Views{views.length ? ` · ${views.length}` : ''}
      </button>
      {open && (
        <div className="views-pop" data-testid="views-pop">
          <div className="vp-pop-head"><span>Saved views</span></div>
          <div className="row">
            <input
              className="input"
              style={{ height: 28, fontSize: 12 }}
              placeholder={`View ${views.length + 1}`}
              value={name}
              maxLength={40}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') { saveCurrentView(name); setName(''); }
              }}
            />
            <button className="btn btn-sm btn-primary" onClick={() => { saveCurrentView(name); setName(''); }} data-testid="save-view">
              <Plus /> Save
            </button>
          </div>
          {views.length === 0 && <div className="hint">Save the current camera angle to come back to it in one click.</div>}
          {views.map((v) => (
            <div className="view-item" key={v.id}>
              <button className="btn btn-sm" onClick={() => goToView(v)} title={`Go to ${v.name}`} data-testid="view-item">
                <Bookmark /> {v.name}
              </button>
              <IconButton size="sm" label="Delete view" onClick={() => useEditor.getState().setViews(views.filter((x) => x.id !== v.id))}>
                <X />
              </IconButton>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
