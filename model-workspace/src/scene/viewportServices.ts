import type * as THREE from 'three';
import type CameraControlsImpl from 'camera-controls';

/** Handles the viewport registers on mount, for code outside the React tree. */
export const viewport: {
  gl: THREE.WebGLRenderer | null;
  scene: THREE.Scene | null;
  camera: THREE.Camera | null;
  controls: CameraControlsImpl | null;
  gizmoHelper: THREE.Object3D | null;
  /** Renders a frame and returns a JPEG data URL of it (or null when not mounted). */
  capture: ((maxWidth?: number) => string | null) | null;
  /** Renders the current view at an exact pixel size (e.g. 3840×2160) into a PNG. */
  renderImage: ((width: number, height: number, opts: { hideFloor: boolean }) => Promise<Blob>) | null;
  invalidate: () => void;
  /** Shadows are re-rendered only when the scene changes, not on camera moves. */
  requestShadowUpdate: () => void;
} = {
  gl: null,
  scene: null,
  camera: null,
  controls: null,
  gizmoHelper: null,
  capture: null,
  renderImage: null,
  invalidate: () => {},
  requestShadowUpdate: () => {},
};
