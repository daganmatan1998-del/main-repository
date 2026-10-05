import { Maximize, Focus, RotateCcw, Box, Square } from 'lucide-react';
import { useEditor } from '../../state/editorStore';
import { cameraApi, type ViewName } from '../../scene/cameraApi';
import { setProjection } from '../../scene/CameraRig';
import { useStats } from '../../state/statsStore';
import { Segmented } from '../common/fields';
import { Tooltip } from '../common/Tooltip';
import { formatCount } from '../../core/format';
import type { QualityMode } from '../../project/types';
import { QUALITY } from '../../scene/quality';
import { ViewsMenu } from './ViewsMenu';

const VIEWS: { v: ViewName; label: string; key: string }[] = [
  { v: 'front', label: 'Front', key: '1' },
  { v: 'back', label: 'Back', key: 'Ctrl 1' },
  { v: 'left', label: 'Left', key: 'Ctrl 3' },
  { v: 'right', label: 'Right', key: '3' },
  { v: 'top', label: 'Top', key: '7' },
  { v: 'bottom', label: 'Bottom', key: 'Ctrl 7' },
];

function Perf() {
  const fps = useStats((s) => s.fps);
  const ms = useStats((s) => s.frameMs);
  const res = useStats((s) => s.resolutionScale);
  const tris = useStats((s) => s.triangles);
  const calls = useStats((s) => s.drawCalls);
  const tex = useStats((s) => s.textures);
  return (
    <div className="perf" data-testid="perf">
      <span title="Frames drawn per second — the view only redraws when something changes">{fps === 0 ? <>Idle</> : <>FPS <b className={fps >= 50 ? 'good' : fps >= 25 ? '' : 'warn'}>{fps}</b></>}</span>
      <span title="Adaptive resolution: drops while the GPU can't keep up, recovers when it can">Res <b className={res >= 90 ? 'good' : res >= 65 ? '' : 'warn'}>{res}%</b></span>
      <span title="CPU time to submit one frame">Frame <b className={ms < 12 ? 'good' : ms < 30 ? '' : 'warn'}>{ms.toFixed(1)}ms</b></span>
      <span>Tris <b>{formatCount(tris)}</b></span>
      <span className="opt">Draws <b>{calls}</b></span>
      <span className="opt">Tex <b>{tex}</b></span>
    </div>
  );
}

export function BottomBar() {
  const projection = useEditor((s) => s.camera?.projection ?? 'perspective');
  const quality = useEditor((s) => s.settings!.quality);
  return (
    <footer className="bottombar">
      <span className="label">Camera</span>
      <div className="group">
        {VIEWS.map((v) => (
          <Tooltip key={v.v} label={`${v.label} view`} shortcut={v.key} side="top">
            <button className="vbtn" onClick={() => cameraApi.setView(v.v)} data-testid={`view-${v.v}`}>{v.label}</button>
          </Tooltip>
        ))}
      </div>
      <div className="vsep" />
      <div className="group">
        <Tooltip label="Fit selected (or everything)" shortcut="F" side="top">
          <button className="vbtn" onClick={() => cameraApi.fitSelected()} data-testid="fit-selected"><Focus /> Fit selected</button>
        </Tooltip>
        <Tooltip label="Fit the whole scene" shortcut="A" side="top">
          <button className="vbtn" onClick={() => cameraApi.fitScene()} data-testid="fit-scene"><Maximize /> Fit scene</button>
        </Tooltip>
        <Tooltip label="Reset camera" shortcut="Home" side="top">
          <button className="vbtn" onClick={() => cameraApi.reset()}><RotateCcw /> Reset</button>
        </Tooltip>
      </div>
      <div className="vsep" />
      <ViewsMenu />
      <div className="vsep" />
      <Segmented
        value={projection}
        onChange={(v) => setProjection(v)}
        options={[
          { value: 'perspective', label: <><Box /> Persp</>, title: 'Perspective camera (5)' },
          { value: 'orthographic', label: <><Square /> Ortho</>, title: 'Orthographic camera (5)' },
        ]}
      />
      <div className="spacer" />
      <Perf />
      <div className="vsep" />
      <Segmented<QualityMode>
        value={quality}
        onChange={(v) => useEditor.getState().updateSettings((d) => void (d.quality = v), 'Quality')}
        options={(['performance', 'balanced', 'ultra'] as const).map((q) => ({ value: q, label: QUALITY[q].label, title: QUALITY[q].description }))}
      />
    </footer>
  );
}
