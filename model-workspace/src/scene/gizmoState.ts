/** Shared, non-reactive gizmo state (read inside pointer handlers and frame loops). */
export const gizmoState = {
  /** Pointer is over or dragging a gizmo handle. */
  active: false,
  draggingId: null as string | null,
  lastReleasedAt: 0,
  recentlyUsed() {
    return this.active || performance.now() - this.lastReleasedAt < 250;
  },
};
