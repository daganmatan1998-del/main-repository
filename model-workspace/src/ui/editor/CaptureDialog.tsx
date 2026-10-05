import { useState } from 'react';
import { Camera } from 'lucide-react';
import { Modal } from '../common/Modal';
import { Toggle } from '../common/fields';
import { exportImage } from '../../editor/exporters';
import { viewport } from '../../scene/viewportServices';
import { toast } from '../../state/uiStore';

function presets() {
  const c = viewport.gl?.domElement;
  const w = c?.clientWidth ?? 1600;
  const h = c?.clientHeight ?? 900;
  return [
    { id: 'view1', label: `Viewport · ${w}×${h}`, w, h },
    { id: 'view2', label: `Viewport ×2 · ${w * 2}×${h * 2}`, w: w * 2, h: h * 2 },
    { id: 'fhd', label: 'Full HD · 1920×1080', w: 1920, h: 1080 },
    { id: '4k', label: '4K UHD · 3840×2160', w: 3840, h: 2160 },
    { id: 'sq', label: 'Square · 2048×2048', w: 2048, h: 2048 },
  ];
}

export function CaptureDialog({ onClose }: { onClose: () => void }) {
  const list = presets();
  const [sel, setSel] = useState('view2');
  const [hideFloor, setHideFloor] = useState(false);
  const [busy, setBusy] = useState(false);
  const cap = async () => {
    const p = list.find((x) => x.id === sel)!;
    const max = viewport.gl?.capabilities.maxTextureSize ?? 4096;
    const scale = Math.min(1, max / Math.max(p.w, p.h));
    setBusy(true);
    try {
      const name = await exportImage(Math.round(p.w * scale), Math.round(p.h * scale), hideFloor);
      toast('success', 'Image saved', name);
      onClose();
    } catch (e) {
      toast('error', 'Capture failed', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Capture image"
      subtitle="Renders the current view as a PNG — without the gizmo or selection outlines. The view mode (clay, wireframe…) is kept."
      icon={<Camera />}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy} onClick={cap} data-testid="capture-go">
            {busy ? <span className="spinner" /> : <Camera />} Capture
          </button>
        </>
      }
    >
      <div className="capture-list">
        {list.map((p) => (
          <label key={p.id} className={`capture-opt ${sel === p.id ? 'on' : ''}`}>
            <input type="radio" name="size" checked={sel === p.id} onChange={() => setSel(p.id)} />
            {p.label}
          </label>
        ))}
      </div>
      <div className="prop-row" style={{ marginTop: 12 }}>
        <span className="k" style={{ fontSize: 12.5 }}>Hide floor & grid</span>
        <div className="v"><Toggle on={hideFloor} label="Hide floor" onChange={setHideFloor} /></div>
      </div>
    </Modal>
  );
}
