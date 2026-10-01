import { memo, useEffect, useState } from 'react';
import {
  Box, Eye, EyeOff, Lock, Unlock, Trash2, ChevronDown, Search, Pencil, Copy, Focus, LayoutGrid, Upload,
  AlertCircle, Car, Armchair, Table2, Bot, Lamp, CircleDot, Package, Columns3, AlignCenterHorizontal, AlignHorizontalSpaceAround, Crosshair,
} from 'lucide-react';
import { selectPrimary, useEditor } from '../../state/editorStore';
import { IconButton } from '../common/Tooltip';
import { useMenu, type MenuEntry } from '../common/Menu';
import { BUILTINS } from '../../assets/builtins';
import { listAssetInfos } from '../../persistence/assetRepo';
import type { AssetInfo, InstanceState } from '../../project/types';
import { addAssetInstance } from '../../editor/importFlow';
import { cameraApi } from '../../scene/cameraApi';
import { FORMAT_LABEL } from '../../loading/formats';
import { formatBytes } from '../../core/format';
import { arrangeGrid, centerOnOrigin, distribute, placeSideBySide, align } from '../../editor/arrange';
import { toast } from '../../state/uiStore';

const BUILTIN_ICONS: Record<string, typeof Box> = {
  'builtin:car': Car, 'builtin:chair': Armchair, 'builtin:table': Table2, 'builtin:robot': Bot, 'builtin:lamp': Lamp, 'builtin:spheres': CircleDot,
};

export function instanceMenu(inst: InstanceState): MenuEntry[] {
  const st = useEditor.getState();
  const ids = st.selection.includes(inst.id) ? st.selection : [inst.id];
  return [
    { label: 'Focus', icon: <Focus />, shortcut: 'F', onSelect: () => cameraApi.focus(inst.id) },
    { label: 'Rename', icon: <Pencil />, shortcut: 'F2', onSelect: () => window.dispatchEvent(new CustomEvent('workspace:rename', { detail: inst.id })) },
    { label: 'Duplicate', icon: <Copy />, shortcut: 'Ctrl D', onSelect: () => st.duplicateInstances(ids) },
    'separator',
    { label: inst.visible ? 'Hide' : 'Show', icon: inst.visible ? <EyeOff /> : <Eye />, shortcut: 'H', onSelect: () => st.toggleVisible(inst.id) },
    { label: inst.locked ? 'Unlock' : 'Lock', icon: inst.locked ? <Unlock /> : <Lock />, shortcut: 'L', onSelect: () => st.toggleLocked(inst.id) },
    'separator',
    { label: ids.length > 1 ? `Delete ${ids.length} models` : 'Delete', icon: <Trash2 />, danger: true, shortcut: 'Del', onSelect: () => st.removeInstances(ids) },
  ];
}

const TreeRow = memo(function TreeRow({
  inst, selected, primary, hovered, index, onMenu, dropMark, onDragStart, onDragOver, onDrop,
}: {
  inst: InstanceState; selected: boolean; primary: boolean; hovered: boolean; index: number;
  onMenu: (x: number, y: number, inst: InstanceState) => void;
  dropMark: 'before' | 'after' | null;
  onDragStart: (id: string) => void;
  onDragOver: (index: number, after: boolean) => void;
  onDrop: () => void;
}) {
  const load = useEditor((s) => s.assetLoad[inst.assetId]);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(inst.name);

  useEffect(() => {
    const onRename = (e: Event) => {
      if ((e as CustomEvent<string>).detail === inst.id) {
        setDraft(inst.name);
        setRenaming(true);
      }
    };
    window.addEventListener('workspace:rename', onRename);
    return () => window.removeEventListener('workspace:rename', onRename);
  }, [inst.id, inst.name]);

  const st = useEditor.getState;
  const commit = () => {
    setRenaming(false);
    if (draft.trim() && draft.trim() !== inst.name) st().renameInstance(inst.id, draft);
  };

  return (
    <div
      className={`tree-row ${selected ? 'selected' : ''} ${primary ? 'primary' : ''} ${hovered ? 'hovered' : ''} ${inst.visible ? '' : 'hidden-model'} ${dropMark ? `drop-${dropMark}` : ''}`}
      style={{ animationDelay: `${Math.min(index, 20) * 18}ms` }}
      data-testid="tree-row"
      data-id={inst.id}
      draggable={!renaming}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('application/x-instance', inst.id);
        onDragStart(inst.id);
      }}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('application/x-instance')) return;
        e.preventDefault();
        const r = e.currentTarget.getBoundingClientRect();
        onDragOver(index, e.clientY > r.top + r.height / 2);
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.types.includes('application/x-instance')) return;
        e.preventDefault();
        onDrop();
      }}
      onClick={(e) => {
        const additive = e.shiftKey || e.ctrlKey || e.metaKey;
        st().select([inst.id], additive ? 'toggle' : 'replace');
      }}
      onDoubleClick={() => {
        setDraft(inst.name);
        setRenaming(true);
      }}
      onMouseEnter={() => st().setHovered(inst.id)}
      onMouseLeave={() => st().hovered === inst.id && st().setHovered(null)}
      onContextMenu={(e) => {
        e.preventDefault();
        if (!selected) st().select([inst.id]);
        onMenu(e.clientX, e.clientY, inst);
      }}
    >
      <Box className="tree-icon" />
      {renaming ? (
        <input
          className="input tree-rename"
          autoFocus
          value={draft}
          maxLength={80}
          onClick={(e) => e.stopPropagation()}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') setRenaming(false);
          }}
        />
      ) : (
        <span className="tree-name" title={inst.name}>{inst.name}</span>
      )}
      {load?.status === 'loading' && (
        <span className="tree-status" title="Loading…">
          <span className={`progress tree-progress ${load.progress === null ? 'indeterminate' : ''}`}>
            <div style={{ width: `${Math.round((load.progress ?? 0.3) * 100)}%` }} />
          </span>
        </span>
      )}
      {load?.status === 'error' && <AlertCircle className="tree-err" aria-label={load.error} />}
      <div className="tree-actions" onClick={(e) => e.stopPropagation()}>
        <IconButton size="sm" label={inst.locked ? 'Unlock' : 'Lock'} className={inst.locked ? 'pinned always' : ''} onClick={() => st().toggleLocked(inst.id)} data-testid="lock">
          {inst.locked ? <Lock /> : <Unlock />}
        </IconButton>
        <IconButton size="sm" label={inst.visible ? 'Hide' : 'Show'} className={!inst.visible ? 'pinned always' : ''} onClick={() => st().toggleVisible(inst.id)} data-testid="visibility">
          {inst.visible ? <Eye /> : <EyeOff />}
        </IconButton>
        <IconButton size="sm" label="Delete" onClick={() => st().removeInstances([inst.id])} data-testid="delete">
          <Trash2 />
        </IconButton>
      </div>
    </div>
  );
});

function Hierarchy() {
  const instances = useEditor((s) => s.instances);
  const selection = useEditor((s) => s.selection);
  const primary = useEditor(selectPrimary);
  const hovered = useEditor((s) => s.hovered);
  const [filter, setFilter] = useState('');
  const [open, setOpen] = useState(true);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<{ index: number; after: boolean } | null>(null);
  const menu = useMenu();
  const q = filter.trim().toLowerCase();
  const list = q ? instances.filter((i) => i.name.toLowerCase().includes(q)) : instances;

  const arrangeMenu = (x: number, y: number) =>
    menu.open(x, y, [
      { label: 'Place side by side', icon: <Columns3 />, onSelect: () => placeSideBySide('x') },
      { label: 'Arrange in grid', icon: <LayoutGrid />, onSelect: arrangeGrid },
      { label: 'Distribute evenly (X)', icon: <AlignHorizontalSpaceAround />, onSelect: () => distribute('x') },
      { label: 'Align centres (Z)', icon: <AlignCenterHorizontal />, onSelect: () => align('z', 'center') },
      { label: 'Center on origin', icon: <Crosshair />, onSelect: centerOnOrigin },
    ]);

  return (
    <>
      <div className="panel-head">
        <h3>Scene</h3>
        <IconButton size="sm" label="Arrange models" onClick={(e) => {
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          arrangeMenu(r.left, r.bottom + 4);
        }} data-testid="arrange-menu">
          <LayoutGrid />
        </IconButton>
        <IconButton size="sm" label="Frame all" shortcut="A" onClick={() => cameraApi.fitScene()}>
          <Focus />
        </IconButton>
      </div>
      {instances.length > 6 && (
        <div className="mini-search">
          <Search />
          <input className="input" placeholder="Filter models" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
      )}
      <div className="panel-scroll" onDragEnd={() => { setDragId(null); setDropAt(null); }}>
        <div className={`tree-group ${open ? '' : 'closed'}`} onClick={() => setOpen(!open)}>
          <ChevronDown /> Models <span className="n">{instances.length}</span>
        </div>
        {open && list.map((inst, i) => (
          <TreeRow
            key={inst.id}
            inst={inst}
            index={i}
            selected={selection.includes(inst.id)}
            primary={primary === inst.id}
            hovered={hovered === inst.id}
            onMenu={(x, y, it) => menu.open(x, y, instanceMenu(it))}
            dropMark={dragId && dropAt && dropAt.index === i && dragId !== inst.id ? (dropAt.after ? 'after' : 'before') : null}
            onDragStart={setDragId}
            onDragOver={(index, after) => setDropAt({ index, after })}
            onDrop={() => {
              if (dragId && dropAt && !q) {
                const target = list[dropAt.index];
                const from = instances.findIndex((x) => x.id === dragId);
                let to = instances.findIndex((x) => x.id === target.id) + (dropAt.after ? 1 : 0);
                if (from < to) to--;
                if (from !== to) useEditor.getState().reorderInstance(dragId, to);
              }
              setDragId(null);
              setDropAt(null);
            }}
          />
        ))}
        {open && instances.length === 0 && (
          <div className="tree-empty">
            No models yet.<br />Drag files into the viewport, or add a sample from <b>Assets</b>.
          </div>
        )}
      </div>
      {menu.element}
    </>
  );
}

function AssetTile({ id, name, icon: Icon, badge, title, onAdd }: { id: string; name: string; icon: typeof Box; badge?: string; title?: string; onAdd: (id: string, name: string) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      className="asset-tile"
      title={title ?? `Add ${name} to the scene`}
      data-testid="asset-tile"
      data-asset={id}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await onAdd(id, name);
        } finally {
          setBusy(false);
        }
      }}
    >
      <Icon />
      <span className="name">{name}</span>
      {badge && <span className="badge">{badge}</span>}
      {busy && <span className="busy"><span className="spinner" /></span>}
    </button>
  );
}

function AssetLibrary({ onImport }: { onImport: () => void }) {
  const [stored, setStored] = useState<AssetInfo[] | null>(null);
  const revision = useEditor((s) => s.revision);
  useEffect(() => {
    listAssetInfos().then(setStored).catch(() => setStored([]));
  }, [revision]);
  const add = async (id: string, name: string) => {
    const ids = await addAssetInstance(id, name);
    if (ids.length) {
      toast('success', `Added ${name}`);
      setTimeout(() => cameraApi.fitScene(), 60);
    }
  };
  return (
    <div className="panel-scroll">
      <div className="asset-section">
        <h4>Samples</h4>
        <div className="asset-grid">
          {BUILTINS.map((b) => (
            <AssetTile key={b.id} id={b.id} name={b.name} icon={BUILTIN_ICONS[b.id] ?? Box} onAdd={add} />
          ))}
        </div>
      </div>
      <div className="asset-section">
        <h4>
          <span>Imported</span>
          <span style={{ letterSpacing: 0, fontWeight: 500, color: 'var(--text-4)' }}>{stored?.length ?? ''}</span>
        </h4>
        <div className="asset-grid">
          {stored?.map((a) => (
            <AssetTile
              key={a.id}
              id={a.id}
              name={a.name}
              icon={Package}
              badge={FORMAT_LABEL[a.format]}
              title={`Add another ${a.name} · ${FORMAT_LABEL[a.format]} · ${formatBytes(a.size)}`}
              onAdd={add}
            />
          ))}
          <button className="asset-tile import" onClick={onImport}>
            <Upload />
            <span className="name">Import…</span>
          </button>
        </div>
      </div>
    </div>
  );
}

export function ScenePanel({ onImport }: { onImport: () => void }) {
  const [tab, setTab] = useState<'scene' | 'assets'>('scene');
  const count = useEditor((s) => s.instances.length);
  return (
    <aside className="panel left" aria-label="Scene">
      <div className="panel-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'scene'} className={`panel-tab ${tab === 'scene' ? 'on' : ''}`} onClick={() => setTab('scene')}>
          Scene<span className="count">{count}</span>
        </button>
        <button role="tab" aria-selected={tab === 'assets'} className={`panel-tab ${tab === 'assets' ? 'on' : ''}`} onClick={() => setTab('assets')} data-testid="assets-tab">
          Assets
        </button>
      </div>
      {tab === 'scene' ? <Hierarchy /> : <AssetLibrary onImport={onImport} />}
    </aside>
  );
}
