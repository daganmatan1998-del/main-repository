import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';
import { useEditor } from '../state/editorStore';
import { registry } from './registry';
import { QUALITY } from './quality';
import { viewport } from './viewportServices';
import { useStats } from '../state/statsStore';
import { HOVER_LAYER, SELECTED_LAYER, SelectionPass, setLayer } from './SelectionPass';

/**
 * Render pipeline: scene → (GTAO on Ultra) → selection/hover outline (one pass)
 * → tone-mapping/sRGB output → (FXAA on Performance).
 * MSAA is done on the composer's HDR target, so outlines and AO stay anti-aliased.
 */
function gtaoResize(gtao: GTAOPass | null, w: number, h: number) {
  gtao?.setSize(w, h);
}

export function PostFX() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const dpr = useThree((s) => s.viewport.dpr);
  const quality = useEditor((s) => s.settings!.quality);
  const profile = QUALITY[quality];

  const pipeline = useMemo(() => {
    const target = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      samples: profile.msaaSamples,
    });
    const composer = new EffectComposer(gl, target);
    const renderPass = new RenderPass(scene, camera);
    composer.addPass(renderPass);

    let gtao: GTAOPass | null = null;
    if (profile.ambientOcclusion) {
      gtao = new GTAOPass(scene, camera, 1, 1);
      gtao.output = GTAOPass.OUTPUT.Default;
      gtao.blendIntensity = 0.85;
      gtao.updateGtaoMaterial({ radius: 0.35, distanceExponent: 1.6, thickness: 1, scale: 1, samples: 16 });
      gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
      composer.addPass(gtao);
    }

    const selection = new SelectionPass(scene, camera);
    selection.enabled = false;
    composer.addPass(selection);

    composer.addPass(new OutputPass());

    let fxaa: ShaderPass | null = null;
    if (profile.fxaa) {
      fxaa = new ShaderPass(FXAAShader);
      composer.addPass(fxaa);
    }
    return { composer, renderPass, gtao, selection, fxaa };
  }, [gl, scene, camera, profile]);

  useEffect(() => () => pipeline.composer.dispose(), [pipeline]);

  useEffect(() => {
    const { composer, fxaa, gtao } = pipeline;
    composer.setPixelRatio(dpr);
    composer.setSize(size.width, size.height);
    pipeline.selection.setPixelRatio(dpr);
    gtao?.setSize(size.width * dpr, size.height * dpr);
    if (fxaa) {
      fxaa.material.uniforms.resolution.value.set(1 / (size.width * dpr), 1 / (size.height * dpr));
    }
  }, [pipeline, size, dpr]);

  // Feed the outline pass: selected / hovered objects go on their own layers.
  useEffect(() => {
    let selObjs: THREE.Object3D[] = [];
    let hovObj: THREE.Object3D | null = null;
    const sync = () => {
      const s = useEditor.getState();
      for (const o of selObjs) setLayer(o, SELECTED_LAYER, false);
      if (hovObj) setLayer(hovObj, HOVER_LAYER, false);
      selObjs = s.selection.map((id) => registry.get(id)).filter((o): o is THREE.Object3D => !!o && o.visible);
      const h = s.hovered && !s.selection.includes(s.hovered) ? registry.get(s.hovered) : undefined;
      hovObj = h && h.visible ? h : null;
      for (const o of selObjs) setLayer(o, SELECTED_LAYER, true);
      if (hovObj) setLayer(hovObj, HOVER_LAYER, true);
      const pass = pipeline.selection;
      pass.hasSelection = selObjs.length > 0;
      pass.hasHover = !!hovObj;
      pass.enabled = pass.hasSelection || pass.hasHover;
      viewport.invalidate();
    };
    sync();
    const unsubStore = useEditor.subscribe((s, p) => {
      if (s.selection !== p.selection || s.hovered !== p.hovered || s.instances !== p.instances) sync();
    });
    const unsubReg = registry.subscribe(sync);
    return () => {
      unsubStore();
      unsubReg();
      for (const o of selObjs) setLayer(o, SELECTED_LAYER, false);
      if (hovObj) setLayer(hovObj, HOVER_LAYER, false);
    };
  }, [pipeline]);

  // Thumbnail capture: render a clean frame (no outlines, no gizmo) and downscale it.
  useEffect(() => {
    viewport.capture = (maxWidth = 640) => {
      const { composer, selection } = pipeline;
      const sv = selection.enabled;
      const gizmo = viewport.gizmoHelper;
      const gv = gizmo?.visible ?? false;
      selection.enabled = false;
      if (gizmo) gizmo.visible = false;
      composer.render(0);
      const src = gl.domElement;
      const w = Math.min(maxWidth, src.width);
      const h = Math.round((w / src.width) * src.height);
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d');
      let url: string | null = null;
      if (ctx && w > 0 && h > 0) {
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(src, 0, 0, w, h);
        url = c.toDataURL('image/jpeg', 0.86);
      }
      selection.enabled = sv;
      if (gizmo) gizmo.visible = gv;
      return url;
    };
    viewport.renderImage = (width, height, opts) => {
      const { composer, selection } = pipeline;
      const cam = viewport.camera as THREE.PerspectiveCamera | THREE.OrthographicCamera;
      const prevSize = gl.getSize(new THREE.Vector2());
      const prevDpr = gl.getPixelRatio();
      const sv = selection.enabled;
      const gizmo = viewport.gizmoHelper;
      const gv = gizmo?.visible ?? false;
      const hidden: THREE.Object3D[] = [];
      if (opts.hideFloor) {
        scene.traverse((o) => {
          const m = (o as THREE.Mesh).material as THREE.Material | undefined;
          if (o.visible && (m?.name === 'StudioFloor')) hidden.push(o);
        });
        hidden.forEach((o) => (o.visible = false));
      }
      const persp = cam as THREE.PerspectiveCamera;
      const ortho = cam as THREE.OrthographicCamera;
      const prevCam = persp.isPerspectiveCamera
        ? { aspect: persp.aspect }
        : { l: ortho.left, r: ortho.right, t: ortho.top, b: ortho.bottom, zoom: ortho.zoom };
      try {
        selection.enabled = false;
        if (gizmo) gizmo.visible = false;
        gl.setPixelRatio(1);
        gl.setSize(width, height, false);
        composer.setPixelRatio(1);
        composer.setSize(width, height);
        gtaoResize(pipeline.gtao, width, height);
        if (persp.isPerspectiveCamera) {
          persp.aspect = width / height;
        } else {
          // Frustum is in pixels: keep the same visible height at the new size and aspect.
          const k = height / (ortho.top - ortho.bottom);
          ortho.left = -width / 2;
          ortho.right = width / 2;
          ortho.top = height / 2;
          ortho.bottom = -height / 2;
          ortho.zoom *= k;
        }
        cam.updateProjectionMatrix();
        gl.shadowMap.needsUpdate = true;
        composer.render(0);
        const out = document.createElement('canvas');
        out.width = width;
        out.height = height;
        out.getContext('2d')!.drawImage(gl.domElement, 0, 0, width, height);
        return new Promise<Blob>((resolve, reject) =>
          out.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode the image.'))), 'image/png'),
        );
      } finally {
        hidden.forEach((o) => (o.visible = true));
        selection.enabled = sv;
        if (gizmo) gizmo.visible = gv;
        if (persp.isPerspectiveCamera) persp.aspect = (prevCam as { aspect: number }).aspect;
        else Object.assign(ortho, { left: prevCam.l, right: prevCam.r, top: prevCam.t, bottom: prevCam.b, zoom: prevCam.zoom });
        cam.updateProjectionMatrix();
        gl.setPixelRatio(prevDpr);
        gl.setSize(prevSize.x, prevSize.y, false);
        composer.setPixelRatio(prevDpr);
        composer.setSize(prevSize.x, prevSize.y);
        gtaoResize(pipeline.gtao, prevSize.x * prevDpr, prevSize.y * prevDpr);
        viewport.invalidate();
      }
    };
    return () => {
      viewport.capture = null;
      viewport.renderImage = null;
    };
  }, [pipeline, gl, scene]);

  // Scene-only numbers: snapshot renderer info right after the main render pass.
  useEffect(() => {
    gl.info.autoReset = false;
    const pass = pipeline.renderPass;
    const original = pass.render.bind(pass);
    pass.render = (...args: Parameters<RenderPass['render']>) => {
      original(...args);
      sceneInfo.current = { calls: gl.info.render.calls, triangles: gl.info.render.triangles };
    };
    return () => {
      gl.info.autoReset = true;
    };
  }, [pipeline, gl]);

  // Take over rendering (priority 1). With on-demand rendering, FPS is the rate
  // frames are actually drawn (0 when idle); frame time is what one frame costs.
  const sceneInfo = useRef({ calls: 0, triangles: 0 });
  const tally = useRef({ start: performance.now(), frames: 0, cost: 0, last: 0 });
  useFrame(() => {
    const t0 = performance.now();
    gl.info.reset();
    pipeline.composer.render();
    const t = tally.current;
    const now = performance.now();
    t.cost += now - t0;
    t.frames++;
    t.last = now;
    if (now - t.start >= 500) publish(now);
  }, 1);
  const publish = (now: number) => {
    const t = tally.current;
    const span = Math.max(1, now - t.start);
    useStats.getState().set({
      fps: Math.round((t.frames * 1000) / span),
      frameMs: t.frames ? t.cost / t.frames : useStats.getState().frameMs,
      drawCalls: sceneInfo.current.calls,
      triangles: sceneInfo.current.triangles,
      textures: gl.info.memory.textures,
      geometries: gl.info.memory.geometries,
    });
    t.start = now;
    t.frames = 0;
    t.cost = 0;
  };
  useEffect(() => {
    const id = setInterval(() => {
      const now = performance.now();
      if (now - tally.current.start >= 1000) publish(now);
    }, 1000);
    return () => clearInterval(id);
  });

  return null;
}
