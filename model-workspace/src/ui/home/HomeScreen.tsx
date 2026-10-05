import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, KeyRound, Search, FolderOpen, Pencil, Copy, Trash2, Hash, HardDrive, X, FileUp, Package } from 'lucide-react';
import { buildProjectFile, importProjectFile, PROJECT_FILE_EXT } from '../../project/projectFile';
import { downloadBlob, safeFilename } from '../../editor/exporters';
import {
  createProject, deleteProject, duplicateProject, listProjects, loadProject, renameProject, type ProjectSummary,
} from '../../project/projectService';
import { useUI, toast } from '../../state/uiStore';
import { ProjectCard } from './ProjectCard';
import { OpenByCodeDialog } from './OpenByCodeDialog';
import { ConfirmDialog, PromptDialog } from '../common/dialogs';
import { useMenu } from '../common/Menu';
import { Logo } from '../common/Logo';
import { formatBytes } from '../../core/format';

type SortKey = 'recent' | 'name' | 'models';
type Dialog =
  | { kind: 'new' }
  | { kind: 'code' }
  | { kind: 'rename'; p: ProjectSummary }
  | { kind: 'delete'; p: ProjectSummary }
  | null;

const SORT_KEY = 'workspace.sort';

export function HomeScreen() {
  const navigate = useUI((s) => s.navigate);
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>(() => {
    try {
      return (localStorage.getItem(SORT_KEY) as SortKey) || 'recent';
    } catch {
      return 'recent';
    }
  });
  const [dialog, setDialog] = useState<Dialog>(null);
  const [usage, setUsage] = useState<number | null>(null);
  const menu = useMenu();
  const importInput = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setProjects(await listProjects());
      setLoadError(null);
    } catch (e) {
      setLoadError((e as Error).message);
      setProjects([]);
    }
    navigator.storage?.estimate?.().then((est) => setUsage(est.usage ?? null)).catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    try {
      localStorage.setItem(SORT_KEY, sort);
    } catch {
      /* private mode */
    }
  }, [sort]);

  const visible = useMemo(() => {
    if (!projects) return [];
    const q = query.trim().toLowerCase();
    const list = q
      ? projects.filter((p) => p.name.toLowerCase().includes(q) || p.saveCode.toLowerCase().includes(q))
      : [...projects];
    list.sort((a, b) =>
      sort === 'name' ? a.name.localeCompare(b.name, undefined, { numeric: true })
        : sort === 'models' ? b.modelCount - a.modelCount || b.updatedAt - a.updatedAt
          : b.updatedAt - a.updatedAt,
    );
    return list;
  }, [projects, query, sort]);

  const open = (id: string) => navigate({ name: 'editor', projectId: id });

  const cardMenu = (p: ProjectSummary, x: number, y: number) =>
    menu.open(x, y, [
      { label: 'Open', icon: <FolderOpen />, onSelect: () => open(p.id), disabled: p.corrupted },
      { label: 'Rename', icon: <Pencil />, onSelect: () => setDialog({ kind: 'rename', p }), disabled: p.corrupted },
      {
        label: 'Duplicate',
        icon: <Copy />,
        disabled: p.corrupted,
        onSelect: async () => {
          try {
            const d = await duplicateProject(p.id);
            toast('success', 'Project duplicated', `${d.name} · ${d.saveCode}`);
            refresh();
          } catch (e) {
            toast('error', 'Couldn’t duplicate project', (e as Error).message);
          }
        },
      },
      {
        label: 'Copy save code',
        icon: <Hash />,
        onSelect: () => {
          navigator.clipboard?.writeText(p.saveCode).then(
            () => toast('success', 'Save code copied', p.saveCode),
            () => toast('info', 'Save code', p.saveCode),
          );
        },
      },
      {
        label: 'Export project file',
        icon: <Package />,
        disabled: p.corrupted,
        onSelect: async () => {
          try {
            const doc = await loadProject(p.id);
            downloadBlob(await buildProjectFile(doc), `${safeFilename(doc.name)}${PROJECT_FILE_EXT}`);
            toast('success', 'Project exported', `${safeFilename(doc.name)}${PROJECT_FILE_EXT}`);
          } catch (e) {
            toast('error', 'Export failed', (e as Error).message);
          }
        },
      },
      'separator',
      { label: 'Delete…', icon: <Trash2 />, danger: true, onSelect: () => setDialog({ kind: 'delete', p }) },
    ]);

  return (
    <div className="home">
      <header className="home-bar">
        <div className="brand">
          <Logo size={22} />
          <span className="brand-name">Workspace</span>
          <span className="brand-sub">3D</span>
        </div>
        <div className="home-bar-right">
          {usage !== null && (
            <span className="storage-pill" title="Local storage used by your projects">
              <HardDrive size={13} /> {formatBytes(usage)} stored locally
            </span>
          )}
        </div>
      </header>

      <section className="hero">
        <div className="hero-floor" aria-hidden="true">
          <div className="hero-floor-plane diamond-pattern" />
        </div>
        <div className="hero-content">
          <div className="hero-kicker">Personal 3D studio</div>
          <h1 className="hero-title">3D Workspace</h1>
          <p className="hero-sub">Create and manage your projects. Import models, arrange them side by side, and inspect every angle.</p>
          <div className="hero-actions">
            <button className="btn btn-primary btn-lg" onClick={() => setDialog({ kind: 'new' })} data-testid="new-project">
              <Plus /> New Project
            </button>
            <button className="btn btn-lg" onClick={() => setDialog({ kind: 'code' })} data-testid="open-by-code">
              <KeyRound /> Open with Save Code
            </button>
            <button className="btn btn-lg" disabled={importing} onClick={() => importInput.current?.click()} data-testid="import-project">
              {importing ? <span className="spinner" /> : <FileUp />} Import project
            </button>
            <input
              ref={importInput}
              type="file"
              accept={PROJECT_FILE_EXT}
              style={{ display: 'none' }}
              data-testid="import-project-input"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (!f) return;
                setImporting(true);
                try {
                  const doc = await importProjectFile(f);
                  toast('success', 'Project imported', `${doc.name} · ${doc.saveCode}`);
                  await refresh();
                } catch (err) {
                  toast('error', 'Couldn’t import project', (err as Error).message);
                } finally {
                  setImporting(false);
                }
              }}
            />
          </div>
        </div>
      </section>

      <section className="projects">
        <div className="projects-head">
          <div>
            <h2>Recent projects</h2>
            <span className="projects-count">{projects ? `${projects.length} ${projects.length === 1 ? 'project' : 'projects'}` : 'Loading…'}</span>
          </div>
          <div className="projects-tools">
            <div className="search">
              <Search size={14} />
              <input
                className="input"
                placeholder="Search projects or codes"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search projects"
              />
              {query && (
                <button className="icon-btn sm" aria-label="Clear search" onClick={() => setQuery('')}>
                  <X />
                </button>
              )}
            </div>
            <select className="select" value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="Sort projects">
              <option value="recent">Recently modified</option>
              <option value="name">Name</option>
              <option value="models">Number of models</option>
            </select>
          </div>
        </div>

        {loadError && <div className="home-error">Couldn’t read local projects: {loadError}</div>}

        {projects === null ? (
          <div className="project-grid">
            {[0, 1, 2].map((i) => (
              <div key={i} className="project-card skeleton" />
            ))}
          </div>
        ) : projects.length === 0 ? (
          <div className="empty">
            <div className="empty-art diamond-pattern" />
            <h3>No projects yet</h3>
            <p>Start a project, then drag GLB, glTF, OBJ, FBX, STL or PLY files into it.</p>
            <button className="btn btn-primary" onClick={() => setDialog({ kind: 'new' })}>
              <Plus /> New Project
            </button>
          </div>
        ) : visible.length === 0 ? (
          <div className="empty small">
            <h3>No matches</h3>
            <p>Nothing matches “{query}”.</p>
          </div>
        ) : (
          <div className="project-grid">
            {visible.map((p, i) => (
              <ProjectCard
                key={p.id}
                p={p}
                index={i}
                onOpen={() => (p.corrupted ? toast('error', 'Unable to load project.', 'Its saved data is damaged. You can delete it.') : open(p.id))}
                onMenu={(x, y) => cardMenu(p, x, y)}
              />
            ))}
          </div>
        )}
      </section>

      {menu.element}

      {dialog?.kind === 'new' && (
        <PromptDialog
          title="New project"
          subtitle="Give it a name — you can change it later."
          label="Project name"
          placeholder="My Car Models"
          confirmLabel="Create project"
          icon={<Plus />}
          onClose={() => setDialog(null)}
          onSubmit={async (name) => {
            const doc = await createProject(name);
            setDialog(null);
            open(doc.id);
          }}
        />
      )}
      {dialog?.kind === 'code' && <OpenByCodeDialog onClose={() => setDialog(null)} onOpen={(id) => open(id)} />}
      {dialog?.kind === 'rename' && (
        <PromptDialog
          title="Rename project"
          label="Project name"
          initial={dialog.p.name}
          confirmLabel="Rename"
          icon={<Pencil />}
          onClose={() => setDialog(null)}
          onSubmit={async (name) => {
            await renameProject(dialog.p.id, name);
            setDialog(null);
            refresh();
          }}
        />
      )}
      {dialog?.kind === 'delete' && (
        <ConfirmDialog
          tone="danger"
          icon={<Trash2 />}
          title={`Delete “${dialog.p.name}”?`}
          message="The project and any models only it uses will be permanently removed from this device. This can’t be undone."
          confirmLabel="Delete project"
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            try {
              await deleteProject(dialog.p.id);
              toast('success', 'Project deleted');
            } catch (e) {
              toast('error', 'Couldn’t delete project', (e as Error).message);
            }
            setDialog(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}
