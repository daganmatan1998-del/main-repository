import { useState } from 'react';
import { ChevronLeft, Upload, Undo2, Redo2, Settings, Keyboard } from 'lucide-react';
import { useEditor } from '../../state/editorStore';
import { IconButton, Tooltip } from '../common/Tooltip';
import { Logo } from '../common/Logo';
import { timeAgo } from '../../core/format';

function SaveIndicator() {
  const status = useEditor((s) => s.saveStatus);
  const error = useEditor((s) => s.saveError);
  const lastSaved = useEditor((s) => s.lastSavedAt);
  const label =
    status === 'saving' ? 'Saving…'
      : status === 'pending' ? 'Unsaved changes'
        : status === 'error' ? 'Not saved'
          : 'Saved ✓';
  const tip =
    status === 'error' ? error ?? 'Save failed'
      : status === 'saved' && lastSaved ? `All changes saved locally · ${timeAgo(lastSaved)}`
        : 'Changes are saved automatically';
  return (
    <Tooltip label={tip}>
      <div className={`save-status ${status}`} role="status" aria-live="polite" data-testid="save-status" data-status={status}>
        <span className="dot" />
        <span className="label" key={label}>{label}</span>
      </div>
    </Tooltip>
  );
}

export function TopBar({ onHome, onImport, onSettings, onShortcuts }: { onHome: () => void; onImport: () => void; onSettings: () => void; onShortcuts: () => void }) {
  const name = useEditor((s) => s.project?.name ?? '');
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const undoLabel = useEditor((s) => s.past[s.past.length - 1]?.label);
  const redoLabel = useEditor((s) => s.future[0]?.label);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const isMac = navigator.platform.toLowerCase().includes('mac');
  const mod = isMac ? '⌘' : 'Ctrl';

  const commit = () => {
    setEditing(false);
    const n = draft.trim();
    if (n && n !== name) useEditor.getState().setProjectMeta({ name: n });
  };

  return (
    <header className="topbar">
      <Tooltip label="Back to projects">
        <button className="topbar-home" onClick={onHome} data-testid="home">
          <ChevronLeft size={15} />
          <Logo size={18} />
          <span>Projects</span>
        </button>
      </Tooltip>
      <span className="crumb-sep">/</span>
      {editing ? (
        <input
          className="input project-title-input"
          autoFocus
          value={draft}
          maxLength={80}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') setEditing(false);
          }}
        />
      ) : (
        <Tooltip label="Rename project">
          <button
            className="project-title"
            data-testid="project-title"
            onClick={() => {
              setDraft(name);
              setEditing(true);
            }}
          >
            {name}
          </button>
        </Tooltip>
      )}

      <div className="topbar-center">
        <SaveIndicator />
      </div>

      <div className="topbar-right">
        <button className="btn btn-sm" onClick={onImport} data-testid="import">
          <Upload /> Import
        </button>
        <div className="vsep" />
        <IconButton label={canUndo ? `Undo ${undoLabel}` : 'Undo'} shortcut={`${mod} Z`} disabled={!canUndo} onClick={() => useEditor.getState().undo()} data-testid="undo">
          <Undo2 />
        </IconButton>
        <IconButton label={canRedo ? `Redo ${redoLabel}` : 'Redo'} shortcut={`${mod} ⇧ Z`} disabled={!canRedo} onClick={() => useEditor.getState().redo()} data-testid="redo">
          <Redo2 />
        </IconButton>
        <div className="vsep" />
        <IconButton label="Keyboard shortcuts" shortcut="?" onClick={onShortcuts}>
          <Keyboard />
        </IconButton>
        <IconButton label="Project settings" onClick={onSettings} data-testid="settings">
          <Settings />
        </IconButton>
      </div>
    </header>
  );
}
