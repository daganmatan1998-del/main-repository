import { useEffect, useState, type ReactNode } from 'react';
import * as THREE from 'three';
import {
  ChevronDown, Focus, Copy, Trash2, Eye, EyeOff, Lock, Unlock, ArrowDownToLine, RotateCcw, Crosshair, Columns3, LayoutGrid,
  AlignHorizontalSpaceAround, AlignVerticalSpaceAround, AlignStartVertical, AlignCenterVertical, AlignEndVertical, Play, Pause, Link2, Link2Off,
  Download, ScanSearch,
} from 'lucide-react';
import { exportGLB } from '../../editor/exporters';
import { toast } from '../../state/uiStore';
import { useTools } from '../../state/toolsStore';
import { getLoadedAsset as loadedAsset } from '../../loading/assetCache';
import { useShallow } from 'zustand/react/shallow';
import { selectPrimary, useEditor } from '../../state/editorStore';
import { getLoadedAsset, type LoadedAsset } from '../../loading/assetCache';
import { cachedAssetInfo } from '../../persistence/assetRepo';
import { getBuiltin } from '../../assets/builtins';
import { NumberField, Segmented, Slider, Toggle } from '../common/fields';
import { IconButton } from '../common/Tooltip';
import { formatBytes, formatCount, formatLength } from '../../core/format';
import { FORMAT_LABEL } from '../../loading/formats';
import { cameraApi } from '../../scene/cameraApi';
import { registry } from '../../scene/registry';
import { gizmoState } from '../../scene/gizmoState';
import type { InstanceState, QualityMode, SceneSettings, Vec3 } from '../../project/types';
import { QUALITY } from '../../scene/quality';
import { align, arrangeGrid, centerOnOrigin, distribute, dropToFloor, placeSideBySide, resetPosition, resetTransform } from '../../editor/arrange';

function Section({ title, children, defaultOpen = true, id }: { title: string; children: ReactNode; defaultOpen?: boolean; id?: string }) {
  const key = `workspace.section.${id ?? title}`;
  const [open, setOpen] = useState(() => {
    try {
      const v = localStorage.getItem(key);
      return v === null ? defaultOpen : v === '1';
    } catch {
      return defaultOpen;
    }
  });
  return (
    <section className={`section ${open ? '' : 'closed'}`}>
      <div
        className="section-head"
        onClick={() => {
          setOpen(!open);
          try {
            localStorage.setItem(key, open ? '0' : '1');
          } catch {
            /* ignore */
          }
        }}
      >
        {title}
        <ChevronDown className="chev" />
      </div>
      {open && <div className="section-body">{children}</div>}
    </section>
  );
}

const R2D = 180 / Math.PI;

/** Transform values; while the gizmo drags, read live from the object. */
function useLiveTransform(inst: InstanceState) {
  useEditor((s) => (gizmoState.draggingId === inst.id ? s.liveTick : 0));
  const obj = gizmoState.draggingId === inst.id ? registry.get(inst.id) : undefined;
  if (obj) {
    return {
      position: obj.position.toArray() as Vec3,
      rotation: [obj.rotation.x, obj.rotation.y, obj.rotation.z] as Vec3,
      scale: obj.scale.toArray() as Vec3,
    };
  }
  return inst;
}

function TransformSection({ inst }: { inst: InstanceState }) {
  const t = useLiveTransform(inst);
  const [uniform, setUniform] = useState(true);
  const st = useEditor.getState;
  const dis = inst.locked;
  const setAxis = (key: 'position' | 'rotation' | 'scale', i: number, v: number) => {
    const cur = [...t[key]] as Vec3;
    if (key === 'scale' && uniform) {
      const ratio = v / (cur[i] || 1);
      st().setTransform(inst.id, { scale: cur.map((c) => c * ratio) as Vec3 }, 'Scale');
      return;
    }
    cur[i] = key === 'rotation' ? v / R2D : key === 'scale' && Math.abs(v) < 1e-4 ? 1e-4 : v;
    st().setTransform(inst.id, { [key]: cur }, key === 'position' ? 'Move' : key === 'rotation' ? 'Rotate' : 'Scale');
  };
  const live = (key: 'position' | 'rotation' | 'scale', i: number, v: number) => {
    const o = registry.get(inst.id);
    if (!o) return;
    if (key === 'position') o.position.setComponent(i, v);
    else if (key === 'rotation') o.rotation[(['x', 'y', 'z'] as const)[i]] = v / R2D;
    else if (uniform) {
      const ratio = v / (inst.scale[i] || 1);
      o.scale.fromArray(inst.scale.map((c) => c * ratio));
    } else o.scale.setComponent(i, v);
  };
  const axes = ['x', 'y', 'z'] as const;
  return (
    <Section title="Transform">
      <div className="prop-row">
        <span className="k">Position</span>
        <div className="vec3">
          {axes.map((a, i) => (
            <NumberField key={a} label={a.toUpperCase()} axis={a} value={t.position[i]} step={0.01} precision={2} disabled={dis} onChange={(v) => live('position', i, v)} onCommit={(v) => setAxis('position', i, v)} />
          ))}
        </div>
      </div>
      <div className="prop-row">
        <span className="k">Rotation °</span>
        <div className="vec3">
          {axes.map((a, i) => (
            <NumberField key={a} label={a.toUpperCase()} axis={a} value={t.rotation[i] * R2D} step={0.5} precision={2} disabled={dis} onChange={(v) => live('rotation', i, v)} onCommit={(v) => setAxis('rotation', i, v)} />
          ))}
        </div>
      </div>
      <div className="prop-row">
        <span className="k" style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          Scale
          <IconButton size="sm" label={uniform ? 'Uniform scale (linked)' : 'Non-uniform scale'} active={uniform} onClick={() => setUniform(!uniform)}>
            {uniform ? <Link2 /> : <Link2Off />}
          </IconButton>
        </span>
        <div className="vec3">
          {axes.map((a, i) => (
            <NumberField key={a} label={a.toUpperCase()} axis={a} value={t.scale[i]} step={0.005} disabled={dis} onChange={(v) => live('scale', i, v)} onCommit={(v) => setAxis('scale', i, v)} />
          ))}
        </div>
      </div>
      {inst.locked && <div className="hint">This model is locked. Unlock it to transform.</div>}
    </Section>
  );
}

function useAsset(assetId: string): LoadedAsset | undefined {
  const loading = useEditor((s) => s.assetLoad[assetId]?.status);
  const [, force] = useState(0);
  useEffect(() => {
    if (!getLoadedAsset(assetId)) {
      const t = setInterval(() => getLoadedAsset(assetId) && force((n) => n + 1), 300);
      return () => clearInterval(t);
    }
  }, [assetId, loading]);
  return getLoadedAsset(assetId);
}

function InstanceProps({ inst }: { inst: InstanceState }) {
  const asset = useAsset(inst.assetId);
  const st = useEditor.getState;
  const [name, setName] = useState(inst.name);
  useEffect(() => setName(inst.name), [inst.name]);
  // The model's own size × its scale — from the bounds measured once at load, so it
  // costs nothing even on multi-million-triangle models (no per-vertex pass per frame).
  const t = useLiveTransform(inst);
  const dims = asset
    ? new THREE.Vector3(
        (asset.bounds.max[0] - asset.bounds.min[0]) * Math.abs(t.scale[0]),
        (asset.bounds.max[1] - asset.bounds.min[1]) * Math.abs(t.scale[1]),
        (asset.bounds.max[2] - asset.bounds.min[2]) * Math.abs(t.scale[2]),
      )
    : null;

  const format = asset?.format ?? cachedAssetInfo(inst.assetId)?.format ?? (getBuiltin(inst.assetId) ? 'builtin' : undefined);
  const stats = asset?.stats;
  const commitName = () => {
    if (name.trim() && name.trim() !== inst.name) st().renameInstance(inst.id, name);
    else setName(inst.name);
  };

  return (
    <div className="panel-scroll" data-testid="instance-props">
      <div className="props-header">
        <div className="props-name-row">
          <input
            className="input props-name"
            value={name}
            maxLength={80}
            aria-label="Model name"
            data-testid="props-name"
            onChange={(e) => setName(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') {
                setName(inst.name);
                (e.target as HTMLInputElement).blur();
              }
            }}
          />
        </div>
        <div className="props-sub">
          {format && <span className="badge accent">{FORMAT_LABEL[format]}</span>}
          {asset && asset.fileSize > 0 && <span>{formatBytes(asset.fileSize)}</span>}
          {stats?.pbr && <span className="badge">PBR</span>}
          {inst.locked && <span className="badge">Locked</span>}
          {!inst.visible && <span className="badge">Hidden</span>}
        </div>
        <div className="props-actions">
          <IconButton label="Focus" shortcut="F" onClick={() => cameraApi.focus(inst.id)}><Focus /></IconButton>
          <IconButton label="Duplicate" shortcut="Ctrl D" onClick={() => st().duplicateInstances([inst.id])} data-testid="props-duplicate"><Copy /></IconButton>
          <IconButton label={inst.visible ? 'Hide' : 'Show'} shortcut="H" onClick={() => st().toggleVisible(inst.id)}>{inst.visible ? <Eye /> : <EyeOff />}</IconButton>
          <IconButton label={inst.locked ? 'Unlock' : 'Lock'} shortcut="L" active={inst.locked} onClick={() => st().toggleLocked(inst.id)}>{inst.locked ? <Lock /> : <Unlock />}</IconButton>
          <IconButton label="Isolate — hide everything else" shortcut="I" onClick={() => useTools.getState().setIsolated([inst.id])}><ScanSearch /></IconButton>
          <IconButton label="Export as GLB" onClick={() => runExport([inst.id])} data-testid="props-export"><Download /></IconButton>
          <div style={{ flex: 1 }} />
          <IconButton label="Delete" shortcut="Del" onClick={() => st().removeInstances([inst.id])}><Trash2 /></IconButton>
        </div>
      </div>

      <TransformSection inst={inst} />

      <Section title="Placement" defaultOpen={false}>
        <div className="btn-grid">
          <button className="btn" disabled={inst.locked} onClick={dropToFloor}><ArrowDownToLine /> Drop to floor</button>
          <button className="btn" disabled={inst.locked} onClick={resetPosition}><Crosshair /> Reset position</button>
          <button className="btn" disabled={inst.locked} onClick={resetTransform}><RotateCcw /> Reset transform</button>
          <button className="btn" onClick={() => cameraApi.focus(inst.id)}><Focus /> Fit selected</button>
        </div>
      </Section>

      <Section title="Geometry">
        {stats ? (
          <>
            <div className="prop-row">
              <span className="k">Dimensions</span>
              <span className="value" data-testid="dimensions">
                {dims ? `${formatLength(dims.x)} × ${formatLength(dims.y)} × ${formatLength(dims.z)}` : '—'}
              </span>
            </div>
            <div className="stat-grid">
              <div className="stat"><div className="k">Triangles</div><div className="v" data-testid="triangles">{formatCount(stats.triangles)}</div></div>
              <div className="stat"><div className="k">Vertices</div><div className="v">{formatCount(stats.vertices)}</div></div>
              <div className="stat"><div className="k">Meshes</div><div className="v">{stats.meshes}</div></div>
              <div className="stat"><div className="k">Materials</div><div className="v">{stats.materials}</div></div>
            </div>
          </>
        ) : (
          <div className="hint">{useEditor.getState().assetLoad[inst.assetId]?.error ?? 'Loading model…'}</div>
        )}
      </Section>

      {stats && (
        <Section title={`Textures · ${stats.textures.length}`} id="textures" defaultOpen={stats.textures.length > 0 && stats.textures.length < 8}>
          {stats.textures.length === 0 ? (
            <div className="hint">No textures — colours come from material values.</div>
          ) : (
            <div className="tex-list">
              {stats.textures.map((t, i) => (
                <div className="tex-item" key={i} title={t.name}>
                  <span className="l">{t.slot.replace(/Map$/, '') || 'map'} · {t.name}</span>
                  <span className="r">{t.width && t.height ? `${t.width}×${t.height}` : '—'}</span>
                </div>
              ))}
            </div>
          )}
        </Section>
      )}

      {stats && (
        <Section title="Materials" defaultOpen={false}>
          <div className="tex-list">
            {stats.materialNames.map((m, i) => (
              <div className="tex-item" key={i}><span className="l">{m}</span></div>
            ))}
          </div>
        </Section>
      )}

      {stats && (
        <Section title={`Animations · ${stats.animations.length}`} id="animations" defaultOpen={stats.animations.length > 0}>
          {stats.animations.length === 0 ? (
            <div className="hint">This model has no animations.</div>
          ) : (
            <>
              <div className="prop-row">
                <span className="k">Clip</span>
                <div className="v">
                  <select
                    className="select"
                    style={{ flex: 1, minWidth: 0 }}
                    value={inst.animation?.clip ?? stats.animations[0]}
                    onChange={(e) => st().updateInstance(inst.id, { animation: { clip: e.target.value, playing: inst.animation?.playing ?? false } }, 'Change clip')}
                  >
                    {stats.animations.map((a) => <option key={a} value={a}>{a}</option>)}
                  </select>
                  <IconButton
                    label={inst.animation?.playing ? 'Pause' : 'Play'}
                    active={inst.animation?.playing}
                    onClick={() => st().updateInstance(inst.id, { animation: { clip: inst.animation?.clip ?? stats.animations[0], playing: !inst.animation?.playing } }, inst.animation?.playing ? 'Pause animation' : 'Play animation')}
                  >
                    {inst.animation?.playing ? <Pause /> : <Play />}
                  </IconButton>
                </div>
              </div>
            </>
          )}
        </Section>
      )}

      <NotesSection inst={inst} />
    </div>
  );
}

export async function runExport(ids: string[]) {
  try {
    const name = await exportGLB(ids);
    toast('success', 'Exported', name);
  } catch (e) {
    toast('error', 'Export failed', (e as Error).message);
  }
}

function NotesSection({ inst }: { inst: InstanceState }) {
  const [text, setText] = useState(inst.notes ?? '');
  useEffect(() => setText(inst.notes ?? ''), [inst.notes]);
  const commit = () => {
    const v = text.trim() ? text : undefined;
    if ((v ?? '') !== (inst.notes ?? '')) useEditor.getState().updateInstance(inst.id, { notes: v }, 'Edit notes');
  };
  return (
    <Section title="Notes" defaultOpen={!!inst.notes}>
      <textarea
        className="notes"
        placeholder="Source, licence, materials to fix, ideas…"
        value={text}
        maxLength={20000}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.stopPropagation()}
        data-testid="notes"
      />
    </Section>
  );
}

function MultiProps({ ids }: { ids: string[] }) {
  const st = useEditor.getState;
  const insts = useEditor(useShallow((s) => s.instances.filter((i) => ids.includes(i.id))));
  const allHidden = insts.every((i) => !i.visible);
  const allLocked = insts.every((i) => i.locked);
  return (
    <div className="panel-scroll" data-testid="multi-props">
      <div className="multi-head">
        <div className="big">{ids.length} models selected</div>
        <div className="hint">Arrange tools act on the selection. Shift-click to add or remove.</div>
      </div>
      <Section title="Arrange">
        <div className="btn-grid">
          <button className="btn" onClick={() => placeSideBySide('x')} data-testid="side-by-side"><Columns3 /> Side by side</button>
          <button className="btn" onClick={arrangeGrid}><LayoutGrid /> Grid</button>
          <button className="btn" onClick={() => distribute('x')}><AlignHorizontalSpaceAround /> Distribute X</button>
          <button className="btn" onClick={() => distribute('z')}><AlignVerticalSpaceAround /> Distribute Z</button>
          <button className="btn" onClick={centerOnOrigin}><Crosshair /> Center</button>
          <button className="btn" onClick={dropToFloor}><ArrowDownToLine /> Drop to floor</button>
        </div>
      </Section>
      <Section title="Align">
        {(['x', 'z'] as const).map((ax) => (
          <div className="prop-row" key={ax}>
            <span className="k">{ax.toUpperCase()} axis</span>
            <div className="v">
              <IconButton label={`Align ${ax.toUpperCase()} min`} onClick={() => align(ax, 'min')}><AlignStartVertical /></IconButton>
              <IconButton label={`Align ${ax.toUpperCase()} center`} onClick={() => align(ax, 'center')}><AlignCenterVertical /></IconButton>
              <IconButton label={`Align ${ax.toUpperCase()} max`} onClick={() => align(ax, 'max')}><AlignEndVertical /></IconButton>
            </div>
          </div>
        ))}
      </Section>
      <Section title="Selection">
        <div className="btn-grid">
          <button className="btn" onClick={() => cameraApi.fitSelected()}><Focus /> Fit selected</button>
          <button className="btn" onClick={() => st().duplicateInstances(ids)}><Copy /> Duplicate</button>
          <button className="btn" onClick={() => st().commit(allHidden ? 'Show' : 'Hide', (d) => d.instances.forEach((i) => ids.includes(i.id) && (i.visible = allHidden)))}>
            {allHidden ? <Eye /> : <EyeOff />} {allHidden ? 'Show' : 'Hide'}
          </button>
          <button className="btn" onClick={() => st().commit(allLocked ? 'Unlock' : 'Lock', (d) => d.instances.forEach((i) => ids.includes(i.id) && (i.locked = !allLocked)))}>
            {allLocked ? <Unlock /> : <Lock />} {allLocked ? 'Unlock' : 'Lock'}
          </button>
          <button className="btn" onClick={() => useTools.getState().setIsolated(ids)}><ScanSearch /> Isolate</button>
          <button className="btn" onClick={() => runExport(ids)}><Download /> Export GLB</button>
          <button className="btn btn-danger" onClick={() => st().removeInstances(ids)}><Trash2 /> Delete</button>
        </div>
      </Section>
    </div>
  );
}

function SliderRow({ label, value, min, max, step, onChange, fmt }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; fmt?: (v: number) => string }) {
  return (
    <div className="slider-row">
      <span className="k">{label}</span>
      <Slider value={value} min={min} max={max} step={step} onChange={onChange} />
      <span className="val">{fmt ? fmt(value) : value.toFixed(2)}</span>
    </div>
  );
}

function SceneProps() {
  const s = useEditor((st) => st.settings!);
  const count = useEditor((st) => st.instances.length);
  const instances = useEditor((st) => st.instances);
  const loads = useEditor((st) => st.assetLoad);
  const totals = instances.reduce(
    (t, i) => {
      const a = loadedAsset(i.assetId);
      if (a) { t.tris += a.stats.triangles; t.meshes += a.stats.meshes; t.tex += a.stats.textures.length; }
      return t;
    },
    { tris: 0, meshes: 0, tex: 0 },
  );
  void loads;
  const update = (label: string, fn: (d: SceneSettings) => void) => useEditor.getState().updateSettings(fn, label);
  return (
    <div className="panel-scroll" data-testid="scene-props">
      <div className="multi-head">
        <div className="big">Scene</div>
        <div className="hint">{count} {count === 1 ? 'model' : 'models'} · select a model to inspect it</div>
        {count > 0 && (
          <div className="stat-grid" style={{ marginTop: 10 }}>
            <div className="stat"><div className="k">Triangles</div><div className="v">{formatCount(totals.tris)}</div></div>
            <div className="stat"><div className="k">Meshes</div><div className="v">{formatCount(totals.meshes)}</div></div>
          </div>
        )}
      </div>
      <Section title="Render quality">
        <Segmented<QualityMode>
          full
          value={s.quality}
          onChange={(v) => update('Quality', (d) => void (d.quality = v))}
          options={(['performance', 'balanced', 'ultra'] as const).map((q) => ({ value: q, label: QUALITY[q].label, title: QUALITY[q].description }))}
        />
        <div className="hint">{QUALITY[s.quality].description}</div>
      </Section>
      <Section title="Lighting">
        <SliderRow label="Exposure" value={s.lighting.exposure} min={0.2} max={2.5} step={0.01} onChange={(v) => update('Exposure', (d) => void (d.lighting.exposure = v))} />
        <SliderRow label="Environment" value={s.lighting.envIntensity} min={0} max={3} step={0.01} onChange={(v) => update('Environment light', (d) => void (d.lighting.envIntensity = v))} />
        <SliderRow label="Key light" value={s.lighting.sunIntensity} min={0} max={8} step={0.05} onChange={(v) => update('Key light', (d) => void (d.lighting.sunIntensity = v))} />
        <SliderRow label="Key angle" value={s.lighting.sunAzimuth} min={-180} max={180} step={1} fmt={(v) => `${v.toFixed(0)}°`} onChange={(v) => update('Key angle', (d) => void (d.lighting.sunAzimuth = v))} />
        <SliderRow label="Key height" value={s.lighting.sunElevation} min={5} max={89} step={1} fmt={(v) => `${v.toFixed(0)}°`} onChange={(v) => update('Key height', (d) => void (d.lighting.sunElevation = v))} />
        <SliderRow label="Fill" value={s.lighting.fillIntensity} min={0} max={2} step={0.01} onChange={(v) => update('Fill light', (d) => void (d.lighting.fillIntensity = v))} />
        <div className="prop-row">
          <span className="k">Shadows</span>
          <div className="v"><Toggle on={s.lighting.shadows} label="Shadows" onChange={(v) => update('Shadows', (d) => void (d.lighting.shadows = v))} /></div>
        </div>
      </Section>
      <Section title="Environment">
        <Segmented
          full
          value={s.environment.preset}
          onChange={(v) => update('Environment', (d) => void (d.environment.preset = v))}
          options={[
            { value: 'studio', label: 'Studio', title: 'Neutral studio room' },
            { value: 'cool', label: 'Cool', title: 'Cool studio with blue rim light' },
            { value: 'soft', label: 'Overcast', title: 'Soft, even dome light' },
          ]}
        />
        <div className="prop-row">
          <span className="k">Horizon</span>
          <div className="v"><input type="color" className="color-input" value={s.environment.horizonColor} onChange={(e) => update('Horizon colour', (d) => void (d.environment.horizonColor = e.target.value))} /></div>
        </div>
        <div className="prop-row">
          <span className="k">Sky</span>
          <div className="v"><input type="color" className="color-input" value={s.environment.skyColor} onChange={(e) => update('Sky colour', (d) => void (d.environment.skyColor = e.target.value))} /></div>
        </div>
      </Section>
      <Section title="Floor & grid">
        <div className="prop-row">
          <span className="k">Floor</span>
          <div className="v end">
            <input type="color" className="color-input" value={s.grid.floorColor} onChange={(e) => update('Floor colour', (d) => void (d.grid.floorColor = e.target.value))} />
            <Toggle on={s.grid.floorVisible} label="Show floor" onChange={(v) => update('Floor', (d) => void (d.grid.floorVisible = v))} />
          </div>
        </div>
        <div className="prop-row">
          <span className="k">Grid</span>
          <div className="v end"><span className="hint">Diagonal X pattern</span><Toggle on={s.grid.visible} label="Show grid" onChange={(v) => update('Grid', (d) => void (d.grid.visible = v))} /></div>
        </div>
        <SliderRow label="Spacing" value={s.grid.spacing} min={0.1} max={10} step={0.05} fmt={(v) => v.toFixed(2)} onChange={(v) => update('Grid spacing', (d) => void (d.grid.spacing = v))} />
        <SliderRow label="Opacity" value={s.grid.opacity} min={0} max={1} step={0.01} onChange={(v) => update('Grid opacity', (d) => void (d.grid.opacity = v))} />
      </Section>
      <Section title="Snapping">
        <div className="prop-row">
          <span className="k">Enabled</span>
          <div className="v"><Toggle on={s.snapping.enabled} label="Snapping" onChange={(v) => update('Snapping', (d) => void (d.snapping.enabled = v))} /></div>
        </div>
        <div className="prop-row"><span className="k">Move</span><NumberField label="↔" value={s.snapping.translate} min={0.001} onCommit={(v) => update('Move snap', (d) => void (d.snapping.translate = v))} /></div>
        <div className="prop-row"><span className="k">Rotate</span><NumberField label="°" value={s.snapping.rotate} min={0.1} step={1} onCommit={(v) => update('Rotate snap', (d) => void (d.snapping.rotate = v))} /></div>
        <div className="prop-row"><span className="k">Scale</span><NumberField label="×" value={s.snapping.scale} min={0.001} onCommit={(v) => update('Scale snap', (d) => void (d.snapping.scale = v))} /></div>
      </Section>
    </div>
  );
}

export function PropertiesPanel() {
  const selection = useEditor((s) => s.selection);
  const primary = useEditor(selectPrimary);
  const inst = useEditor((s) => s.instances.find((i) => i.id === primary));
  return (
    <aside className="panel right" aria-label="Properties">
      <div className="panel-tabs">
        <button className="panel-tab on">Properties</button>
      </div>
      {selection.length > 1 ? <MultiProps ids={selection} /> : inst ? <InstanceProps key={inst.id} inst={inst} /> : <SceneProps />}
    </aside>
  );
}
