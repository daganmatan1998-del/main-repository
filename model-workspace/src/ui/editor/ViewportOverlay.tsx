import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { Move, Rotate3d, Scaling, Globe, Magnet, Upload, Box, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Sparkles } from 'lucide-react';
import { useEditor, type GizmoMode } from '../../state/editorStore';
import { IconButton } from '../common/Tooltip';
import { viewport } from '../../scene/viewportServices';
import { cameraApi, type ViewName } from '../../scene/cameraApi';

export function GizmoToolbar() {
  const mode = useEditor((s) => s.gizmoMode);
  const space = useEditor((s) => s.gizmoSpace);
  const snap = useEditor((s) => s.settings!.snapping.enabled);
  const set = (m: GizmoMode) => useEditor.getState().setGizmoMode(m);
  return (
    <div className="vp-toolbar" role="toolbar" aria-label="Transform tools">
      <IconButton side="right" label="Move" shortcut="W" active={mode === 'translate'} onClick={() => set('translate')} data-testid="tool-move"><Move /></IconButton>
      <IconButton side="right" label="Rotate" shortcut="E" active={mode === 'rotate'} onClick={() => set('rotate')} data-testid="tool-rotate"><Rotate3d /></IconButton>
      <IconButton side="right" label="Scale" shortcut="R" active={mode === 'scale'} onClick={() => set('scale')} data-testid="tool-scale"><Scaling /></IconButton>
      <div className="sep" />
      <IconButton
        side="right"
        label={space === 'world' ? 'World space (click for local)' : 'Local space (click for world)'}
        shortcut="X"
        active={space === 'local'}
        onClick={() => useEditor.getState().setGizmoSpace(space === 'world' ? 'local' : 'world')}
      >
        {space === 'world' ? <Globe /> : <Box />}
      </IconButton>
      <IconButton
        side="right"
        label={snap ? 'Snapping on' : 'Snapping off'}
        shortcut="S"
        active={snap}
        onClick={() => useEditor.getState().updateSettings((d) => void (d.snapping.enabled = !d.snapping.enabled), 'Snapping')}
        data-testid="tool-snap"
      >
        <Magnet />
      </IconButton>
    </div>
  );
}

export function PanelToggles({ left, right, onLeft, onRight }: { left: boolean; right: boolean; onLeft: () => void; onRight: () => void }) {
  return (
    <>
      <div className="vp-collapse l">
        <IconButton label={left ? 'Show scene panel' : 'Hide scene panel'} onClick={onLeft} side="right">
          {left ? <PanelLeftOpen /> : <PanelLeftClose />}
        </IconButton>
      </div>
      <div className="vp-collapse r">
        <IconButton label={right ? 'Show properties panel' : 'Hide properties panel'} onClick={onRight} side="left">
          {right ? <PanelRightOpen /> : <PanelRightClose />}
        </IconButton>
      </div>
    </>
  );
}

const AXES: { key: ViewName; neg: ViewName; dir: THREE.Vector3; color: string; label: string }[] = [
  { key: 'right', neg: 'left', dir: new THREE.Vector3(1, 0, 0), color: '#ff5f6d', label: 'X' },
  { key: 'top', neg: 'bottom', dir: new THREE.Vector3(0, 1, 0), color: '#5fe39a', label: 'Y' },
  { key: 'front', neg: 'back', dir: new THREE.Vector3(0, 0, 1), color: '#4aa8ff', label: 'Z' },
];

/** Orientation widget: shows the world axes from the camera; click an end to look along it. */
export function AxisWidget() {
  const [items, setItems] = useState<{ x: number; y: number; z: number; color: string; label: string; view: ViewName; positive: boolean }[]>([]);
  const last = useRef('');
  useEffect(() => {
    let raf = 0;
    const q = new THREE.Quaternion();
    const v = new THREE.Vector3();
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const cam = viewport.camera;
      if (!cam) return;
      q.copy(cam.quaternion).invert();
      const next: typeof items = [];
      for (const a of AXES) {
        for (const positive of [true, false]) {
          v.copy(a.dir).multiplyScalar(positive ? 1 : -1).applyQuaternion(q);
          next.push({ x: v.x * 34, y: -v.y * 34, z: v.z, color: a.color, label: positive ? a.label : '', view: positive ? a.key : a.neg, positive });
        }
      }
      next.sort((p, r) => p.z - r.z);
      const sig = next.map((n) => `${n.x.toFixed(1)},${n.y.toFixed(1)}`).join('|');
      if (sig !== last.current) {
        last.current = sig;
        setItems(next);
      }
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div className="axis-widget" title="Click an axis to view along it">
      <svg viewBox="-48 -48 96 96">
        {items.map((it) => (
          <g key={it.view} className="ax" onClick={() => cameraApi.setView(it.view)}>
            {it.positive && <line x1={0} y1={0} x2={it.x} y2={it.y} stroke={it.color} strokeWidth={2} strokeLinecap="round" opacity={0.9} />}
            <circle cx={it.x} cy={it.y} r={it.positive ? 8 : 5.5} fill={it.positive ? it.color : 'rgba(4,8,12,0.9)'} stroke={it.color} strokeWidth={it.positive ? 0 : 1.5} opacity={it.z < 0 && !it.positive ? 0.65 : 1} />
            {it.positive && <text x={it.x} y={it.y + 3} textAnchor="middle">{it.label}</text>}
          </g>
        ))}
      </svg>
    </div>
  );
}

export function EmptyState({ onImport, onAssets }: { onImport: () => void; onAssets: () => void }) {
  const count = useEditor((s) => s.instances.length);
  if (count > 0) return null;
  return (
    <div className="vp-empty">
      <div className="vp-empty-card">
        <div className="ring"><Upload /></div>
        <h3>Drop 3D models here</h3>
        <p>GLB, glTF, OBJ, FBX, STL and PLY. Drop several at once — they’ll be placed side by side.</p>
        <div className="row">
          <button className="btn btn-primary" onClick={onImport}><Upload /> Import models</button>
          <button className="btn" onClick={onAssets}><Sparkles /> Try a sample</button>
        </div>
      </div>
    </div>
  );
}

export function LoadingPanel() {
  const loads = useEditor((s) => s.assetLoad);
  const entries = Object.entries(loads).filter(([, l]) => l.status === 'loading');
  if (!entries.length) return null;
  return (
    <div className="loading-panel" data-testid="loading-panel">
      {entries.map(([id, l]) => (
        <div className="loading-item" key={id}>
          <div className="top">
            <span className="spinner" />
            <span className="n">{l.name ?? 'Model'}</span>
            <span className="p">{l.phase === 'parse' ? 'Processing' : l.progress !== null ? `${Math.round(l.progress * 100)}%` : 'Loading'}</span>
          </div>
          <div className={`progress ${l.progress === null || l.phase === 'parse' ? 'indeterminate' : ''}`}>
            <div style={{ width: `${Math.round((l.progress ?? 0) * 100)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function SelectionChip() {
  const primary = useEditor((s) => s.instances.find((i) => i.id === s.selection[s.selection.length - 1]));
  const n = useEditor((s) => s.selection.length);
  const mode = useEditor((s) => s.gizmoMode);
  if (!primary) return null;
  return (
    <div className="vp-hud tl" style={{ top: 58, left: 62 }}>
      <span className="vp-chip">
        {n > 1 ? <b>{n} selected</b> : <b>{primary.name}</b>}
        <span>· {primary.locked ? 'Locked' : mode === 'translate' ? 'Move' : mode === 'rotate' ? 'Rotate' : 'Scale'}</span>
      </span>
    </div>
  );
}
