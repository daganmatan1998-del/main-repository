import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useStats } from '../state/statsStore';

const MIN_SCALE = 0.5;
const SLOW_MS = 1000 / 45; // below ~45 fps while interacting: render fewer pixels
const FAST_MS = 1000 / 58; // holding refresh rate: try more pixels again
const WINDOW = 30;

/**
 * Keeps interaction smooth on any GPU: while frames are being drawn
 * continuously (orbiting, dragging, animation), it measures real frame times
 * and scales the render resolution between 50% and the quality mode's
 * maximum. Idle time is ignored, so a still scene never "downgrades".
 */
export function AdaptiveResolution({ maxDpr }: { maxDpr: number }) {
  const setDpr = useThree((s) => s.setDpr);
  const dpr = useThree((s) => s.viewport.dpr);
  const st = useRef({ last: 0, samples: [] as number[], changedAt: 0, dpr: maxDpr });

  useEffect(() => {
    st.current.dpr = dpr;
    useStats.getState().set({ resolutionScale: Math.round((dpr / maxDpr) * 100) });
  }, [dpr, maxDpr]);

  useFrame(() => {
    const s = st.current;
    const now = performance.now();
    const gap = now - s.last;
    s.last = now;
    if (gap > 250) {
      // Idle → resumed: not a meaningful sample.
      s.samples.length = 0;
      return;
    }
    s.samples.push(gap);
    if (s.samples.length < WINDOW) return;
    const sorted = [...s.samples].sort((a, b) => a - b);
    const median = sorted[sorted.length >> 1];
    s.samples.length = 0;
    if (now - s.changedAt < 1200) return;
    const minDpr = Math.min(maxDpr, MIN_SCALE * maxDpr);
    let next = s.dpr;
    if (median > SLOW_MS && s.dpr > minDpr + 0.01) next = Math.max(minDpr, s.dpr * 0.8);
    else if (median < FAST_MS && s.dpr < maxDpr - 0.01 && now - s.changedAt > 4000) next = Math.min(maxDpr, s.dpr * 1.12);
    if (next !== s.dpr) {
      s.changedAt = now;
      s.dpr = next;
      setDpr(next);
    }
  });
  return null;
}
