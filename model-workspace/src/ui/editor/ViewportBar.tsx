import { useState } from 'react';
import { Box, Circle, Grid3x3, ScanEye, Sparkles, Ruler, Scissors, RotateCw, Focus, Camera, X, Trash2, FlipHorizontal2 } from 'lucide-react';
import { useTools, type ViewMode } from '../../state/toolsStore';
import { useEditor } from '../../state/editorStore';
import { IconButton } from '../common/Tooltip';
import { Segmented, Slider, Toggle } from '../common/fields';
import { formatDistance } from '../../scene/Inspection';
import { toast } from '../../state/uiStore';

const MODES: { value: ViewMode; label: string; icon: typeof Box; title: string; key: string }[] = [
  { value: 'shaded', label: 'Shaded', icon: Circle, title: 'Full materials and textures', key: '' },
  { value: 'clay', label: 'Clay', icon: Sparkles, title: 'Neutral clay — judge form without textures', key: '' },
  { value: 'wireframe', label: 'Wire', icon: Grid3x3, title: 'Wireframe — see the mesh topology', key: '' },
  { value: 'xray', label: 'X-Ray', icon: ScanEye, title: 'See through models', key: '' },
  { value: 'normals', label: 'Normals', icon: Box, title: 'Surface normals — spot flipped or broken faces', key: '' },
];

export function toggleIsolate() {
  const t = useTools.getState();
  if (t.isolated) {
    t.setIsolated(null);
    return;
  }
  const sel = useEditor.getState().selection;
  if (!sel.length) {
    toast('info', 'Select a model to isolate it');
    return;
  }
  t.setIsolated(sel);
}

export function ViewportBar({ onCapture }: { onCapture: () => void }) {
  const mode = useTools((s) => s.viewMode);
  const measuring = useTools((s) => s.measuring);
  const section = useTools((s) => s.section);
  const turntable = useTools((s) => s.turntable);
  const isolated = useTools((s) => s.isolated);
  const [sectionOpen, setSectionOpen] = useState(false);
  const t = useTools.getState;

  return (
    <div className="vp-bar" role="toolbar" aria-label="View tools">
      <Segmented<ViewMode>
        value={mode}
        onChange={(v) => t().setViewMode(v)}
        options={MODES.map((m) => ({ value: m.value, title: `${m.title} (V cycles)`, label: <><m.icon /> {m.label}</> }))}
      />
      <div className="vp-bar-sep" />
      <IconButton label={measuring ? 'Stop measuring' : 'Measure distance'} shortcut="M" active={measuring} onClick={() => t().setMeasuring(!measuring)} data-testid="tool-measure">
        <Ruler />
      </IconButton>
      <div className="vp-pop-anchor">
        <IconButton
          label="Section plane — cut into models"
          shortcut="C"
          active={section.enabled}
          onClick={() => {
            if (!section.enabled) {
              t().setSection({ enabled: true });
              setSectionOpen(true);
            } else setSectionOpen(!sectionOpen);
          }}
          data-testid="tool-section"
        >
          <Scissors />
        </IconButton>
        {section.enabled && sectionOpen && (
          <div className="vp-pop" data-testid="section-panel">
            <div className="vp-pop-head">
              <span>Section plane</span>
              <IconButton size="sm" label="Turn off section" onClick={() => { t().setSection({ enabled: false }); setSectionOpen(false); }}>
                <X />
              </IconButton>
            </div>
            <Segmented
              full
              value={section.axis}
              onChange={(axis) => t().setSection({ axis })}
              options={[{ value: 'x', label: 'X' }, { value: 'y', label: 'Y' }, { value: 'z', label: 'Z' }]}
            />
            <div className="slider-row">
              <span className="k">Position</span>
              <Slider value={section.position} min={0} max={1} step={0.005} onChange={(position) => t().setSection({ position })} />
              <span className="val">{Math.round(section.position * 100)}%</span>
            </div>
            <div className="prop-row">
              <span className="k">Flip side</span>
              <div className="v"><Toggle on={section.flip} label="Flip" onChange={(flip) => t().setSection({ flip })} /><FlipHorizontal2 size={14} style={{ color: 'var(--text-3)' }} /></div>
            </div>
          </div>
        )}
      </div>
      <IconButton label={turntable ? 'Stop turntable' : 'Turntable — slowly orbit the scene'} shortcut="T" active={turntable} onClick={() => t().setTurntable(!turntable)} data-testid="tool-turntable">
        <RotateCw />
      </IconButton>
      <IconButton label={isolated ? 'Exit isolation' : 'Isolate selection — hide everything else'} shortcut="I" active={!!isolated} onClick={toggleIsolate} data-testid="tool-isolate">
        <Focus />
      </IconButton>
      <div className="vp-bar-sep" />
      <IconButton label="Capture image (PNG)" shortcut="P" onClick={onCapture} data-testid="tool-capture">
        <Camera />
      </IconButton>
    </div>
  );
}

export function MeasurePanel() {
  const measuring = useTools((s) => s.measuring);
  const pending = useTools((s) => s.pending);
  const list = useTools((s) => s.measurements);
  if (!measuring && !list.length) return null;
  const dist = (m: (typeof list)[number]) => Math.hypot(m.a[0] - m.b[0], m.a[1] - m.b[1], m.a[2] - m.b[2]);
  return (
    <div className="measure-panel" data-testid="measure-panel">
      <div className="vp-pop-head">
        <span><Ruler size={13} /> Measurements</span>
        {list.length > 0 && (
          <IconButton size="sm" label="Clear all" onClick={() => useTools.getState().clearMeasurements()}><Trash2 /></IconButton>
        )}
        <IconButton size="sm" label="Close measuring" onClick={() => { useTools.getState().setMeasuring(false); useTools.getState().clearMeasurements(); }}><X /></IconButton>
      </div>
      {measuring && (
        <div className="hint">{pending ? 'Click the second point.' : 'Click a point on a model or the floor.'} Esc to stop.</div>
      )}
      {list.map((m, i) => (
        <div className="measure-row" key={m.id}>
          <span className="n">#{i + 1}</span>
          <span className="d mono">{formatDistance(dist(m))}</span>
          <span className="xyz mono" title="ΔX / ΔY / ΔZ">
            {[0, 1, 2].map((k) => Math.abs(m.b[k] - m.a[k]).toFixed(2)).join(' · ')}
          </span>
          <IconButton size="sm" label="Remove" onClick={() => useTools.getState().removeMeasurement(m.id)}><X /></IconButton>
        </div>
      ))}
    </div>
  );
}

export function IsolationBanner() {
  const isolated = useTools((s) => s.isolated);
  if (!isolated) return null;
  return (
    <div className="isolation-banner" data-testid="isolation-banner">
      <Focus size={14} /> Isolation — showing {isolated.length} {isolated.length === 1 ? 'model' : 'models'}
      <button className="btn btn-sm" onClick={() => useTools.getState().setIsolated(null)}>Exit</button>
    </div>
  );
}
