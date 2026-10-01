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
  invalidate: () => void;
} = {
  gl: null,
  scene: null,
  camera: null,
  controls: null,
  gizmoHelper: null,
  capture: null,
  invalidate: () => {},
};
