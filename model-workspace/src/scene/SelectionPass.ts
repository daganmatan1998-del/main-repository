import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

export const SELECTED_LAYER = 10;
export const HOVER_LAYER = 11;

/**
 * Selection + hover outlines in one cheap pass.
 *
 * three's OutlinePass re-renders the whole scene for depth and runs ~8
 * full-screen blur passes — per outline. Here only the selected / hovered
 * objects are drawn (via layers) into a small mask target, red = selected,
 * green = hovered, then a single full-screen pass draws the silhouette edge
 * and a faint fill. Total: two tiny renders + one full-screen pass.
 */
export class SelectionPass extends Pass {
  private mask: THREE.WebGLRenderTarget;
  private quad: FullScreenQuad;
  private selMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
  private hovMat = new THREE.MeshBasicMaterial({ color: 0x00ff00, blending: THREE.AdditiveBlending, depthTest: false });
  private material: THREE.ShaderMaterial;
  private clearColor = new THREE.Color();
  hasSelection = false;
  hasHover = false;

  constructor(private scene: THREE.Scene, public camera: THREE.Camera) {
    super();
    this.mask = new THREE.WebGLRenderTarget(1, 1, { type: THREE.UnsignedByteType, depthBuffer: true });
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        tMask: { value: this.mask.texture },
        uTexel: { value: new THREE.Vector2(1, 1) },
        uSelColor: { value: new THREE.Color('#e9f6ff') },
        uHovColor: { value: new THREE.Color('#3db4ff') },
        uThickness: { value: 1.5 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse;
        uniform sampler2D tMask;
        uniform vec2 uTexel;
        uniform vec3 uSelColor;
        uniform vec3 uHovColor;
        uniform float uThickness;
        varying vec2 vUv;
        void main() {
          vec4 base = texture2D(tDiffuse, vUv);
          vec2 c = texture2D(tMask, vUv).rg;
          vec2 o = uTexel * uThickness;
          vec2 mx = c;
          vec2 mn = c;
          for (int i = 0; i < 8; i++) {
            float a = float(i) * 0.78539816;
            vec2 s = texture2D(tMask, vUv + vec2(cos(a), sin(a)) * o).rg;
            mx = max(mx, s);
            mn = min(mn, s);
          }
          vec2 edge = mx - mn;
          vec3 col = base.rgb;
          col = mix(col, uSelColor, c.r * 0.06);
          col = mix(col, uHovColor, edge.g * (1.0 - edge.r) * 0.8);
          col = mix(col, uSelColor, edge.r);
          gl_FragColor = vec4(col, base.a);
        }`,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.material);
  }

  setSize(width: number, height: number) {
    this.mask.setSize(width, height);
    this.material.uniforms.uTexel.value.set(1 / width, 1 / height);
  }

  setPixelRatio(dpr: number) {
    this.material.uniforms.uThickness.value = Math.max(1, 1.25 * dpr);
  }

  render(
    renderer: THREE.WebGLRenderer,
    writeBuffer: THREE.WebGLRenderTarget,
    readBuffer: THREE.WebGLRenderTarget,
  ) {
    const scene = this.scene;
    const cam = this.camera;
    const prevMask = cam.layers.mask;
    const prevBg = scene.background;
    const prevOverride = scene.overrideMaterial;
    const prevAuto = renderer.autoClear;
    const prevShadow = renderer.shadowMap.autoUpdate;
    const prevNeeds = renderer.shadowMap.needsUpdate;
    renderer.getClearColor(this.clearColor);
    const prevAlpha = renderer.getClearAlpha();

    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = false;
    scene.background = null;
    renderer.setRenderTarget(this.mask);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.autoClear = false;
    if (this.hasSelection) {
      cam.layers.set(SELECTED_LAYER);
      scene.overrideMaterial = this.selMat;
      renderer.render(scene, cam);
    }
    if (this.hasHover) {
      cam.layers.set(HOVER_LAYER);
      scene.overrideMaterial = this.hovMat;
      renderer.render(scene, cam);
    }
    cam.layers.mask = prevMask;
    scene.overrideMaterial = prevOverride;
    scene.background = prevBg;
    renderer.autoClear = prevAuto;
    renderer.setClearColor(this.clearColor, prevAlpha);
    renderer.shadowMap.autoUpdate = prevShadow;
    renderer.shadowMap.needsUpdate = prevNeeds;

    this.material.uniforms.tDiffuse.value = readBuffer.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }

  dispose() {
    this.mask.dispose();
    this.material.dispose();
    this.selMat.dispose();
    this.hovMat.dispose();
    this.quad.dispose();
  }
}

/** Puts every mesh under `root` on (or off) a layer, keeping the default layer. */
export function setLayer(root: THREE.Object3D, layer: number, on: boolean) {
  root.traverse((o) => {
    if (on) o.layers.enable(layer);
    else o.layers.disable(layer);
  });
}
