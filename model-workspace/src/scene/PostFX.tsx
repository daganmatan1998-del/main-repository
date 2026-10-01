import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { OutlinePass } from 'three/examples/jsm/postprocessing/OutlinePass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';
import { useEditor } from '../state/editorStore';
import { registry } from './registry';
import { QUALITY } from './quality';
import { viewport } from './viewportServices';
import { useStats } from '../state/statsStore';

/**
 * Render pipeline: scene → (GTAO on Ultra) → hover outline → selection outline
 * → tone-mapping/sRGB output → (FXAA on Performance).
 * MSAA is done on the composer's HDR target, so outlines and AO stay anti-aliased.
 */
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

    const hover = new OutlinePass(new THREE.Vector2(1, 1), scene, camera);
    hover.edgeStrength = 2.2;
    hover.edgeThickness = 1;
    hover.edgeGlow = 0;
    hover.visibleEdgeColor.set('#b98a5e');
    hover.hiddenEdgeColor.set('#000000');
    composer.addPass(hover);

    const selected = new OutlinePass(new THREE.Vector2(1, 1), scene, camera);
    selected.edgeStrength = 4.5;
    selected.edgeThickness = 1.1;
    selected.edgeGlow = 0;
    selected.visibleEdgeColor.set('#f3e7d8');
    selected.hiddenEdgeColor.set('#7a5f49');
    composer.addPass(selected);

    composer.addPass(new OutputPass());

    let fxaa: ShaderPass | null = null;
    if (profile.fxaa) {
      fxaa = new ShaderPass(FXAAShader);
      composer.addPass(fxaa);
    }
    return { composer, renderPass, gtao, hover, selected, fxaa };
  }, [gl, scene, camera, profile]);

  useEffect(() => () => pipeline.composer.dispose(), [pipeline]);

  useEffect(() => {
    const { composer, fxaa, gtao } = pipeline;
    composer.setPixelRatio(dpr);
    composer.setSize(size.width, size.height);
    gtao?.setSize(size.width * dpr, size.height * dpr);
    if (fxaa) {
      fxaa.material.uniforms.resolution.value.set(1 / (size.width * dpr), 1 / (size.height * dpr));
    }
  }, [pipeline, size, dpr]);

  // Feed outline passes from the selection / hover state.
  useEffect(() => {
    const sync = () => {
      const s = useEditor.getState();
      const sel = s.selection.map((id) => registry.get(id)).filter((o): o is THREE.Object3D => !!o && o.visible);
      pipeline.selected.selectedObjects = sel;
      pipeline.selected.enabled = sel.length > 0;
      const h = s.hovered && !s.selection.includes(s.hovered) ? registry.get(s.hovered) : undefined;
      pipeline.hover.selectedObjects = h && h.visible ? [h] : [];
      pipeline.hover.enabled = !!h && h.visible;
    };
    sync();
    const unsubStore = useEditor.subscribe((s, p) => {
      if (s.selection !== p.selection || s.hovered !== p.hovered || s.instances !== p.instances) sync();
    });
    const unsubReg = registry.subscribe(sync);
    return () => {
      unsubStore();
      unsubReg();
    };
  }, [pipeline]);

  // Thumbnail capture: render a clean frame (no outlines, no gizmo) and downscale it.
  useEffect(() => {
    viewport.capture = (maxWidth = 640) => {
      const { composer, hover, selected } = pipeline;
      const hv = hover.enabled;
      const sv = selected.enabled;
      const gizmo = viewport.gizmoHelper;
      const gv = gizmo?.visible ?? false;
      hover.enabled = false;
      selected.enabled = false;
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
      hover.enabled = hv;
      selected.enabled = sv;
      if (gizmo) gizmo.visible = gv;
      return url;
    };
    return () => {
      viewport.capture = null;
    };
  }, [pipeline, gl]);

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
