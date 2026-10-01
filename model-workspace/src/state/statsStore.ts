import { create } from 'zustand';

interface StatsState {
  fps: number;
  frameMs: number;
  drawCalls: number;
  triangles: number;
  textures: number;
  geometries: number;
  set: (s: Partial<Omit<StatsState, 'set'>>) => void;
}

export const useStats = create<StatsState>()((set) => ({
  fps: 0,
  frameMs: 0,
  drawCalls: 0,
  triangles: 0,
  textures: 0,
  geometries: 0,
  set: (s) => set(s),
}));
