import { create } from 'zustand';
import type { Vec3 } from '../project/types';

export type ViewMode = 'shaded' | 'clay' | 'wireframe' | 'xray' | 'normals';

export interface Measurement {
  id: string;
  a: Vec3;
  b: Vec3;
}

export interface SectionState {
  enabled: boolean;
  axis: 'x' | 'y' | 'z';
  /** 0..1 across the scene bounds on that axis. */
  position: number;
  flip: boolean;
}

/**
 * Inspection tools. Session-only by design: they change how you look at the
 * scene, not the scene itself, so they are not saved and not undo steps.
 */
interface ToolsState {
  viewMode: ViewMode;
  section: SectionState;
  measuring: boolean;
  pending: Vec3 | null;
  measurements: Measurement[];
  turntable: boolean;
  isolated: string[] | null;
  uiHidden: boolean;
  paletteOpen: boolean;
  setViewMode: (m: ViewMode) => void;
  setSection: (p: Partial<SectionState>) => void;
  setMeasuring: (on: boolean) => void;
  addMeasurePoint: (p: Vec3) => void;
  clearMeasurements: () => void;
  removeMeasurement: (id: string) => void;
  setTurntable: (on: boolean) => void;
  setIsolated: (ids: string[] | null) => void;
  setUiHidden: (v: boolean) => void;
  setPaletteOpen: (v: boolean) => void;
  reset: () => void;
}

const initial = {
  viewMode: 'shaded' as ViewMode,
  section: { enabled: false, axis: 'x' as const, position: 0.5, flip: false },
  measuring: false,
  pending: null as Vec3 | null,
  measurements: [] as Measurement[],
  turntable: false,
  isolated: null as string[] | null,
  uiHidden: false,
  paletteOpen: false,
};

let n = 0;

export const useTools = create<ToolsState>()((set, get) => ({
  ...initial,
  setViewMode: (viewMode) => set({ viewMode }),
  setSection: (p) => set({ section: { ...get().section, ...p } }),
  setMeasuring: (measuring) => set({ measuring, pending: null }),
  addMeasurePoint: (p) => {
    const { pending, measurements } = get();
    if (!pending) set({ pending: p });
    else set({ pending: null, measurements: [...measurements, { id: `m${++n}`, a: pending, b: p }] });
  },
  clearMeasurements: () => set({ measurements: [], pending: null }),
  removeMeasurement: (id) => set({ measurements: get().measurements.filter((m) => m.id !== id) }),
  setTurntable: (turntable) => set({ turntable }),
  setIsolated: (isolated) => set({ isolated: isolated && isolated.length ? isolated : null }),
  setUiHidden: (uiHidden) => set({ uiHidden }),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  reset: () => set({ ...initial }),
}));
