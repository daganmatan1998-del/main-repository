import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Upload, AlertTriangle } from 'lucide-react';
import { useEditor } from '../../state/editorStore';
import { useUI, toast } from '../../state/uiStore';
import { loadProject, duplicateProject, deleteProject } from '../../project/projectService';
import { ProjectLoadError } from '../../project/validate';
import { listAssetInfos } from '../../persistence/assetRepo';
import { disposeAllAssets } from '../../loading/assetCache';
import { flushSave, useAutosave } from '../../editor/autosave';
import { filesFromDataTransfer, importFiles } from '../../editor/importFlow';
import { useEditorShortcuts } from '../../editor/shortcuts';
import { ACCEPT_ATTR } from '../../loading/formats';
import { TopBar } from './TopBar';
import { ScenePanel } from './ScenePanel';
import { PropertiesPanel } from './PropertiesPanel';
import { BottomBar } from './BottomBar';
import { AxisWidget, EmptyState, GizmoToolbar, LoadingPanel, PanelToggles, SelectionChip } from './ViewportOverlay';
import { ProjectSettingsDialog } from './ProjectSettingsDialog';
import { ShortcutsDialog } from './ShortcutsDialog';
import { ErrorBoundary } from '../common/ErrorBoundary';
import { Logo } from '../common/Logo';
import { ViewportBar, MeasurePanel, IsolationBanner } from './ViewportBar';
import { CaptureDialog } from './CaptureDialog';
import { CommandPalette, type PaletteActions } from './CommandPalette';
import { useTools } from '../../state/toolsStore';
import { exportCurrentProject } from '../../editor/projectExport';


const Viewport = lazy(() => import('../../scene/Viewport'));

function Workspace() {
  const navigate = useUI((s) => s.navigate);
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const dragDepth = useRef(0);
  const [dialog, setDialog] = useState<'settings' | 'shortcuts' | 'capture' | null>(null);
  const uiHidden = useTools((s) => s.uiHidden);
  const measuring = useTools((s) => s.measuring);
  const [collapsed, setCollapsed] = useState({ left: false, right: false });
  const [leftKey, setLeftKey] = useState(0);

  useAutosave();
  const openShortcuts = useCallback(() => setDialog('shortcuts'), []);
  const openCapture = useCallback(() => setDialog('capture'), []);
  useEditorShortcuts({ onShortcuts: openShortcuts, onCapture: openCapture, enabled: true });
  // Inspection tools are per-session: start clean, leave clean.
  useEffect(() => {
    useTools.getState().reset();
    return () => useTools.getState().reset();
  }, []);

  const goHome = useCallback(async () => {
    try {
      await flushSave(true);
    } catch {
      toast('error', 'Your latest changes could not be saved.');
      return;
    }
    navigate({ name: 'home' });
  }, [navigate]);

  const openImport = () => fileInput.current?.click();
  const paletteActions = useMemo<PaletteActions>(() => ({
    importModels: () => fileInput.current?.click(),
    capture: () => setDialog('capture'),
    settings: () => setDialog('settings'),
    shortcuts: () => setDialog('shortcuts'),
    home: () => goHome(),
    exportProject: () => exportCurrentProject(),
  }), [goHome]);

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    dragDepth.current = 0;
    setDragOver(false);
    if (!e.dataTransfer.types.includes('Files')) return;
    const files = await filesFromDataTransfer(e.dataTransfer);
    importFiles(files);
  };

  return (
    <div className={`editor ${collapsed.left ? 'left-collapsed' : ''} ${collapsed.right ? 'right-collapsed' : ''} ${uiHidden ? 'ui-hidden' : ''}`}>
      <TopBar onHome={goHome} onImport={openImport} onSettings={() => setDialog('settings')} onShortcuts={openShortcuts} />
      {!collapsed.left && !uiHidden && <ScenePanel key={leftKey} onImport={openImport} />}
      <main
        className={`viewport ${measuring ? 'measuring' : ''}`}
        onDragEnter={(e) => {
          if (!e.dataTransfer.types.includes('Files')) return;
          dragDepth.current++;
          setDragOver(true);
        }}
        onDragLeave={() => {
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (!dragDepth.current) setDragOver(false);
        }}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('Files')) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
          }
        }}
        onDrop={onDrop}
        onContextMenu={(e) => e.preventDefault()}
        data-testid="viewport"
      >
        <ErrorBoundary title="The 3D view stopped working" resetLabel="Restart viewport">
          <Suspense fallback={<div className="loading-screen"><div className="inner"><span className="spinner lg" /> Starting renderer…</div></div>}>
            <Viewport />
          </Suspense>
        </ErrorBoundary>
        <GizmoToolbar />
        <ViewportBar onCapture={openCapture} />
        <IsolationBanner />
        <MeasurePanel />
        <PanelToggles
          left={collapsed.left}
          right={collapsed.right}
          onLeft={() => setCollapsed((c) => ({ ...c, left: !c.left }))}
          onRight={() => setCollapsed((c) => ({ ...c, right: !c.right }))}
        />
        <SelectionChip />
        <AxisWidget />
        <EmptyState
          onImport={openImport}
          onAssets={() => {
            setCollapsed((c) => ({ ...c, left: false }));
            setLeftKey((k) => k + 1);
            setTimeout(() => document.querySelector<HTMLButtonElement>('[data-testid="assets-tab"]')?.click(), 30);
          }}
        />
        <LoadingPanel />
        {dragOver && (
          <div className="drop-overlay">
            <div className="inner">
              <Upload />
              <div>Drop to import</div>
              <span>Models are placed side by side · textures and .bin files can come along</span>
            </div>
          </div>
        )}
      </main>
      {!collapsed.right && !uiHidden && <PropertiesPanel />}
      <BottomBar />

      <input
        ref={fileInput}
        type="file"
        multiple
        accept={ACCEPT_ATTR}
        style={{ display: 'none' }}
        data-testid="file-input"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []).map((f) => ({ file: f, path: f.name }));
          e.target.value = '';
          importFiles(files);
        }}
      />

      {dialog === 'settings' && (
        <ProjectSettingsDialog
          onClose={() => setDialog(null)}
          onDuplicate={async () => {
            await flushSave(true);
            const id = useEditor.getState().project!.id;
            const copy = await duplicateProject(id);
            setDialog(null);
            toast('success', 'Project duplicated', `Opened “${copy.name}” · ${copy.saveCode}`);
            navigate({ name: 'editor', projectId: copy.id });
          }}
          onDelete={async () => {
            const id = useEditor.getState().project!.id;
            useEditor.getState().closeDoc();
            await deleteProject(id);
            toast('success', 'Project deleted');
            navigate({ name: 'home' });
          }}
        />
      )}
      {dialog === 'shortcuts' && <ShortcutsDialog onClose={() => setDialog(null)} />}
      {dialog === 'capture' && <CaptureDialog onClose={() => setDialog(null)} />}
      <CommandPalette actions={paletteActions} />
    </div>
  );
}

export function EditorScreen({ projectId }: { projectId: string }) {
  const navigate = useUI((s) => s.navigate);
  const loadedId = useEditor((s) => s.project?.id);
  const [error, setError] = useState<{ title: string; message: string } | null>(null);

  useEffect(() => {
    let alive = true;
    setError(null);
    (async () => {
      try {
        // Warm the asset-info cache so placeholders know each model's size before it loads.
        await listAssetInfos().catch(() => []);
        const doc = await loadProject(projectId);
        if (alive) useEditor.getState().openDoc(doc);
      } catch (e) {
        if (!alive) return;
        const err = e as Error;
        setError({
          title: err instanceof ProjectLoadError && err.kind === 'not-found' ? 'Project not found.' : 'Unable to load project.',
          message: err.message,
        });
      }
    })();
    return () => {
      alive = false;
      useEditor.getState().closeDoc();
      disposeAllAssets();
    };
  }, [projectId]);

  if (error) {
    return (
      <div className="error-screen">
        <div className="card">
          <div className="modal-icon danger" style={{ margin: '0 auto' }}><AlertTriangle /></div>
          <h2>{error.title}</h2>
          <p>{error.message !== error.title ? error.message : 'It may have been deleted on this device.'}</p>
          <button className="btn btn-primary" onClick={() => navigate({ name: 'home' })}>Back to projects</button>
        </div>
      </div>
    );
  }
  if (loadedId !== projectId) {
    return (
      <div className="loading-screen">
        <div className="inner">
          <Logo size={34} />
          <span className="spinner" />
          Opening project…
        </div>
      </div>
    );
  }
  return <Workspace key={projectId} />;
}
