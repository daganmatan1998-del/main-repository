import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  Box, Upload, Maximize, Focus, Eye, Ruler, Scissors, RotateCw, ScanSearch, Camera, Download, Bookmark, Undo2, Redo2,
  Copy, Trash2, Settings, Keyboard, Home, Circle, Sparkles, Grid3x3, ScanEye, Columns3, LayoutGrid, PanelsTopLeft, Package,
} from 'lucide-react';
import { useEditor } from '../../state/editorStore';
import { useTools, type ViewMode } from '../../state/toolsStore';
import { cameraApi, type ViewName } from '../../scene/cameraApi';
import { setProjection } from '../../scene/CameraRig';
import { arrangeGrid, placeSideBySide } from '../../editor/arrange';
import { saveCurrentView, goToView } from './ViewsMenu';
import { toggleIsolate } from './ViewportBar';
import { runExport } from './PropertiesPanel';
import { toast } from '../../state/uiStore';

export interface PaletteActions {
  importModels: () => void;
  capture: () => void;
  settings: () => void;
  shortcuts: () => void;
  home: () => void;
  exportProject: () => void;
}

interface Item {
  id: string;
  label: string;
  group: string;
  icon: ReactNode;
  keys?: string;
  run: () => void;
}

function score(q: string, text: string): number {
  if (!q) return 1;
  const t = text.toLowerCase();
  const i = t.indexOf(q);
  if (i === 0) return 3;
  if (i > 0) return 2;
  // all characters in order
  let k = 0;
  for (const ch of t) if (ch === q[k]) k++;
  return k === q.length ? 1 : 0;
}

/** Ctrl/Cmd+K: run any command or jump to any model by typing. */
export function CommandPalette({ actions }: { actions: PaletteActions }) {
  const open = useTools((s) => s.paletteOpen);
  const instances = useEditor((s) => s.instances);
  const views = useEditor((s) => s.views);
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const items = useMemo<Item[]>(() => {
    const st = useEditor.getState;
    const t = useTools.getState;
    const sel = () => st().selection;
    const viewModes: [ViewMode, string, ReactNode][] = [
      ['shaded', 'Shaded', <Circle key="s" />], ['clay', 'Clay', <Sparkles key="c" />], ['wireframe', 'Wireframe', <Grid3x3 key="w" />],
      ['xray', 'X-Ray', <ScanEye key="x" />], ['normals', 'Normals', <Box key="n" />],
    ];
    const cams: [ViewName, string, string][] = [['front', 'Front', '1'], ['back', 'Back', 'Ctrl 1'], ['left', 'Left', 'Ctrl 3'], ['right', 'Right', '3'], ['top', 'Top', '7'], ['bottom', 'Bottom', 'Ctrl 7']];
    return [
      { id: 'import', label: 'Import models…', group: 'File', icon: <Upload />, keys: '', run: actions.importModels },
      { id: 'capture', label: 'Capture image (PNG)…', group: 'File', icon: <Camera />, keys: 'P', run: actions.capture },
      { id: 'export-sel', label: 'Export selection as GLB', group: 'File', icon: <Download />, run: () => (sel().length ? runExport(sel()) : toast('info', 'Select models to export')) },
      { id: 'export-all', label: 'Export whole scene as GLB', group: 'File', icon: <Download />, run: () => runExport(st().instances.filter((i) => i.visible).map((i) => i.id)) },
      { id: 'export-proj', label: 'Export project file (.3dws)', group: 'File', icon: <Package />, run: actions.exportProject },
      { id: 'fit', label: 'Fit scene', group: 'Camera', icon: <Maximize />, keys: 'A', run: () => cameraApi.fitScene() },
      { id: 'focus', label: 'Focus selected', group: 'Camera', icon: <Focus />, keys: 'F', run: () => cameraApi.fitSelected() },
      ...cams.map(([v, l, k]) => ({ id: `cam-${v}`, label: `${l} view`, group: 'Camera', icon: <Eye />, keys: k, run: () => cameraApi.setView(v) })),
      { id: 'proj', label: 'Toggle perspective / orthographic', group: 'Camera', icon: <Box />, keys: '5', run: () => setProjection(st().camera?.projection === 'orthographic' ? 'perspective' : 'orthographic') },
      { id: 'save-view', label: 'Save current view', group: 'Camera', icon: <Bookmark />, run: () => { const v = saveCurrentView(); if (v) toast('success', `Saved “${v.name}”`); } },
      ...views.map((v) => ({ id: `goto-${v.id}`, label: `Go to view: ${v.name}`, group: 'Camera', icon: <Bookmark />, run: () => goToView(v) })),
      { id: 'turntable', label: 'Toggle turntable', group: 'Camera', icon: <RotateCw />, keys: 'T', run: () => t().setTurntable(!t().turntable) },
      ...viewModes.map(([m, l, icon]) => ({ id: `vm-${m}`, label: `View mode: ${l}`, group: 'Display', icon, keys: 'V', run: () => t().setViewMode(m) })),
      { id: 'section', label: 'Toggle section plane', group: 'Display', icon: <Scissors />, keys: 'C', run: () => t().setSection({ enabled: !t().section.enabled }) },
      { id: 'isolate', label: 'Isolate selection', group: 'Display', icon: <ScanSearch />, keys: 'I', run: toggleIsolate },
      { id: 'ui', label: 'Hide / show panels', group: 'Display', icon: <PanelsTopLeft />, keys: 'Tab', run: () => t().setUiHidden(!t().uiHidden) },
      { id: 'measure', label: 'Measure distance', group: 'Tools', icon: <Ruler />, keys: 'M', run: () => t().setMeasuring(true) },
      { id: 'side', label: 'Place side by side', group: 'Arrange', icon: <Columns3 />, run: () => placeSideBySide('x') },
      { id: 'grid', label: 'Arrange in grid', group: 'Arrange', icon: <LayoutGrid />, run: arrangeGrid },
      { id: 'undo', label: 'Undo', group: 'Edit', icon: <Undo2 />, keys: 'Ctrl Z', run: () => st().undo() },
      { id: 'redo', label: 'Redo', group: 'Edit', icon: <Redo2 />, keys: 'Ctrl ⇧ Z', run: () => st().redo() },
      { id: 'dup', label: 'Duplicate selection', group: 'Edit', icon: <Copy />, keys: 'Ctrl D', run: () => st().duplicateInstances(sel()) },
      { id: 'del', label: 'Delete selection', group: 'Edit', icon: <Trash2 />, keys: 'Del', run: () => st().removeInstances(sel()) },
      { id: 'settings', label: 'Project settings', group: 'App', icon: <Settings />, run: actions.settings },
      { id: 'keys', label: 'Keyboard shortcuts', group: 'App', icon: <Keyboard />, keys: '?', run: actions.shortcuts },
      { id: 'home', label: 'Back to projects', group: 'App', icon: <Home />, run: actions.home },
      ...instances.map((i) => ({
        id: `model-${i.id}`, label: i.name, group: 'Model', icon: <Box />,
        run: () => { st().select([i.id]); setTimeout(() => cameraApi.focus(i.id), 30); },
      })),
    ];
  }, [actions, instances, views]);

  const query = q.trim().toLowerCase();
  const results = useMemo(
    () => items.map((it) => ({ it, s: score(query, `${it.label} ${it.group}`) })).filter((r) => r.s > 0).sort((a, b) => b.s - a.s).map((r) => r.it).slice(0, 60),
    [items, query],
  );

  useEffect(() => {
    if (open) {
      setQ('');
      setIdx(0);
    }
  }, [open]);
  useEffect(() => setIdx(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector('.palette-item.on')?.scrollIntoView({ block: 'nearest' });
  }, [idx]);

  if (!open) return null;
  const close = () => useTools.getState().setPaletteOpen(false);
  const run = (it: Item) => {
    close();
    setTimeout(it.run, 0);
  };
  return createPortal(
    <div className="palette-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="palette" role="dialog" aria-label="Command palette" data-testid="palette">
        <input
          autoFocus
          placeholder="Type a command or a model name…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Escape') close();
            if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(results.length - 1, i + 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)); }
            if (e.key === 'Enter' && results[idx]) run(results[idx]);
          }}
        />
        <div className="palette-list" ref={listRef}>
          {results.length === 0 && <div className="palette-empty">No matching commands or models.</div>}
          {results.map((it, i) => (
            <button key={it.id} className={`palette-item ${i === idx ? 'on' : ''}`} onMouseEnter={() => setIdx(i)} onClick={() => run(it)}>
              {it.icon}
              {it.label}
              <span className="grp">{it.group}</span>
              {it.keys && <kbd>{it.keys}</kbd>}
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
