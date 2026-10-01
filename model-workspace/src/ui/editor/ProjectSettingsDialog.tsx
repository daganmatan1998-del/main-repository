import { useEffect, useState } from 'react';
import { Settings, Copy, Trash2, CopyPlus, Check } from 'lucide-react';
import { Modal } from '../common/Modal';
import { ConfirmDialog } from '../common/dialogs';
import { useEditor } from '../../state/editorStore';
import { formatBytes, formatDate } from '../../core/format';
import { getAsset } from '../../persistence/assetRepo';
import { isBuiltinAsset } from '../../assets/builtins';
import { buildDoc } from '../../editor/autosave';

async function storageUsed(): Promise<number> {
  const s = useEditor.getState();
  const ids = [...new Set(s.instances.map((i) => i.assetId))].filter((id) => !isBuiltinAsset(id));
  let total = 0;
  for (const id of ids) total += (await getAsset(id))?.size ?? 0;
  const doc = buildDoc(false);
  if (doc) total += new Blob([JSON.stringify(doc)]).size;
  return total;
}

export function ProjectSettingsDialog({
  onClose, onDuplicate, onDelete,
}: { onClose: () => void; onDuplicate: () => Promise<void>; onDelete: () => Promise<void> }) {
  const project = useEditor((s) => s.project!);
  const count = useEditor((s) => s.instances.length);
  const [name, setName] = useState(project.name);
  const [bytes, setBytes] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    storageUsed().then(setBytes).catch(() => setBytes(null));
  }, [count]);

  const commitName = () => {
    const n = name.trim();
    if (n && n !== project.name) useEditor.getState().setProjectMeta({ name: n });
    else setName(project.name);
  };

  if (confirmDelete) {
    return (
      <ConfirmDialog
        tone="danger"
        icon={<Trash2 />}
        title={`Delete “${project.name}”?`}
        message="The project and any models only it uses will be permanently removed from this device. This can’t be undone."
        confirmLabel="Delete project"
        onClose={() => setConfirmDelete(false)}
        onConfirm={onDelete}
      />
    );
  }

  return (
    <Modal title="Project settings" subtitle="Everything is stored locally on this device." icon={<Settings />} onClose={onClose} wide
      footer={<button className="btn btn-primary" onClick={onClose}>Done</button>}>
      <div className="kv" data-testid="project-settings">
        <span className="k">Project</span>
        <span className="v">
          <input className="input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} onBlur={commitName} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} aria-label="Project name" />
        </span>
        <span className="k">Save code</span>
        <span className="v" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="code-big" data-testid="save-code">{project.saveCode}</span>
          <button
            className="btn btn-sm"
            onClick={() => {
              navigator.clipboard?.writeText(project.saveCode).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1600);
              }).catch(() => {});
            }}
          >
            {copied ? <Check /> : <Copy />} {copied ? 'Copied' : 'Copy'}
          </button>
        </span>
        <span className="k" />
        <span className="v hint">The save code identifies this project — use “Open with Save Code” on the home screen to find it. It is not a password.</span>
        <span className="k">Created</span>
        <span className="v">{formatDate(project.createdAt)}</span>
        <span className="k">Last modified</span>
        <span className="v">{formatDate(project.updatedAt)}</span>
        <span className="k">Models</span>
        <span className="v">{count}</span>
        <span className="k">Storage used</span>
        <span className="v">{bytes === null ? '…' : formatBytes(bytes)}</span>
      </div>
      <div className="settings-actions">
        <button className="btn" disabled={busy} onClick={async () => { setBusy(true); try { await onDuplicate(); } finally { setBusy(false); } }}>
          <CopyPlus /> Duplicate project
        </button>
        <div style={{ flex: 1 }} />
        <button className="btn btn-danger" onClick={() => setConfirmDelete(true)}>
          <Trash2 /> Delete project
        </button>
      </div>
    </Modal>
  );
}
