import { memo } from 'react';
import { MoreHorizontal, Box, AlertTriangle, ArrowUpRight } from 'lucide-react';
import type { ProjectSummary } from '../../project/projectService';
import { timeAgo } from '../../core/format';

export const ProjectCard = memo(function ProjectCard({
  p,
  index,
  onOpen,
  onMenu,
}: {
  p: ProjectSummary;
  index: number;
  onOpen: () => void;
  onMenu: (x: number, y: number) => void;
}) {
  return (
    <article
      className={`project-card ${p.corrupted ? 'corrupted' : ''}`}
      style={{ animationDelay: `${Math.min(index, 12) * 40}ms` }}
      onClick={onOpen}
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu(e.clientX, e.clientY);
      }}
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onOpen()}
      aria-label={`Open ${p.name}`}
      data-project-id={p.id}
    >
      <div className="pc-thumb">
        {p.thumbnail ? (
          <img src={p.thumbnail} alt="" draggable={false} />
        ) : (
          <div className="pc-thumb-empty">
            <div className="pc-floor diamond-pattern" />
            {p.corrupted ? <AlertTriangle /> : <Box />}
          </div>
        )}
        <div className="pc-open">
          <span>Open</span>
          <ArrowUpRight size={14} />
        </div>
      </div>
      <div className="pc-body">
        <div className="pc-row">
          <h3 className="pc-name" title={p.name}>{p.name}</h3>
          <button
            className="icon-btn sm pc-menu"
            aria-label="Project actions"
            onClick={(e) => {
              e.stopPropagation();
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
              onMenu(r.right - 190, r.bottom + 4);
            }}
          >
            <MoreHorizontal />
          </button>
        </div>
        <div className="pc-meta">
          {p.corrupted ? (
            <span className="pc-warn">Unable to load project</span>
          ) : (
            <>
              <span>Saved {timeAgo(p.updatedAt)}</span>
              <span className="dot" />
              <span>
                {p.modelCount} {p.modelCount === 1 ? 'model' : 'models'}
              </span>
            </>
          )}
          <span className="code-chip pc-code">{p.saveCode}</span>
        </div>
      </div>
    </article>
  );
});
