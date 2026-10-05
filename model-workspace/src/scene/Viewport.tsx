import { Suspense, useEffect } from 'react';
import * as THREE from 'three';
import { Canvas, useThree } from '@react-three/fiber';
import { useEditor } from '../state/editorStore';
import { Backdrop, Floor, Lights, RendererSetup } from './SceneEnvironment';
import { Instances } from './ModelInstance';
import { Gizmo } from './Gizmo';
import { CameraRig } from './CameraRig';
import { PostFX } from './PostFX';
import { QUALITY } from './quality';
import { viewport } from './viewportServices';
import { setLoaderRenderer } from '../loading/loaders';
import { setTextureAnisotropy } from '../loading/assetCache';
import { gizmoState } from './gizmoState';
import { cameraApi } from './cameraApi';
import { registry } from './registry';
import { AdaptiveResolution } from './AdaptiveResolution';
import { floorPointAt, Measurements, SectionPlane, Turntable, ViewModes } from './Inspection';
import { useTools } from '../state/toolsStore';

function Services() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const invalidate = useThree((s) => s.invalidate);
  const quality = useEditor((s) => s.settings!.quality);
  useEffect(() => {
    viewport.gl = gl;
    viewport.scene = scene;
    viewport.invalidate = invalidate;
    gl.shadowMap.autoUpdate = false;
    gl.shadowMap.needsUpdate = true;
    viewport.requestShadowUpdate = () => {
      gl.shadowMap.needsUpdate = true;
      invalidate();
    };
    setLoaderRenderer(gl);
    return () => {
      viewport.gl = null;
      viewport.scene = null;
    };
  }, [gl, scene, invalidate]);
  useEffect(() => {
    setTextureAnisotropy(Math.min(QUALITY[quality].anisotropy, gl.capabilities.getMaxAnisotropy()));
  }, [gl, quality]);
  // On-demand rendering: draw only when something changed, so an idle scene costs nothing.
  useEffect(() => {
    const unsubStore = useEditor.subscribe((s, p) => {
      if (s.instances !== p.instances || s.settings !== p.settings || s.liveTick !== p.liveTick) viewport.requestShadowUpdate();
      else invalidate();
    });
    const unsubReg = registry.subscribe(() => viewport.requestShadowUpdate());
    return () => {
      unsubStore();
      unsubReg();
    };
  }, [invalidate]);
  useEffect(() => {
    const onFocus = (e: Event) => cameraApi.focus((e as CustomEvent<string>).detail);
    window.addEventListener('workspace:focus', onFocus);
    return () => window.removeEventListener('workspace:focus', onFocus);
  }, []);
  return null;
}

export default function Viewport() {
  const quality = useEditor((s) => s.settings!.quality);
  const profile = QUALITY[quality];
  const maxDpr = Math.min(profile.maxDpr, window.devicePixelRatio || 1);

  return (
    <Canvas
      className="viewport-canvas"
      frameloop="demand"
      shadows={{ type: THREE.PCFShadowMap }}
      dpr={[1, maxDpr]}
      gl={{ antialias: false, powerPreference: 'high-performance', alpha: false, stencil: false }}
      onPointerMissed={(e) => {
        if (gizmoState.recentlyUsed() || e.button !== 0) return;
        if (useTools.getState().measuring) {
          const p = floorPointAt(e.clientX, e.clientY);
          if (p) useTools.getState().addMeasurePoint(p);
          return;
        }
        if (!(e.shiftKey || e.ctrlKey || e.metaKey)) useEditor.getState().select([]);
      }}
      raycaster={{ params: { Points: { threshold: 0.02 }, Line: { threshold: 0.02 } } as never }}
    >
      <Services />
      <AdaptiveResolution maxDpr={maxDpr} />
      <RendererSetup />
      <CameraRig />
      <Backdrop />
      <Lights />
      <Floor />
      <Suspense fallback={null}>
        <Instances />
      </Suspense>
      <Gizmo />
      <ViewModes />
      <SectionPlane />
      <Measurements />
      <Turntable />
      <PostFX />
    </Canvas>
  );
}
