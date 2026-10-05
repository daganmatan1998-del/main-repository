import * as THREE from 'three';

/**
 * The studio floor: a matte brown PBR surface (lit, shadow-receiving) with a
 * procedural grain and a white diagonal grid drawn analytically in the shader.
 * Two families of lines at +45° and -45° cross to form the X / diamond pattern.
 * Lines are anti-aliased with screen-space derivatives and fade out where they
 * would alias (grazing angles, far distance) and into the horizon colour.
 */
export interface FloorUniforms {
  uSpacing: { value: number };
  uGridOpacity: { value: number };
  uLineWidth: { value: number };
  uFadeColor: { value: THREE.Color };
  uFadeNear: { value: number };
  uFadeFar: { value: number };
  uGrain: { value: THREE.Texture };
}

/** Tileable value-noise grain, computed once on the CPU (the shader just samples it). */
function createGrainTexture(): THREE.DataTexture {
  const N = 256;
  const data = new Uint8Array(N * N * 4);
  const lattice = (size: number) => {
    const g = new Float32Array(size * size);
    for (let i = 0; i < g.length; i++) g[i] = Math.random();
    return (x: number, y: number) => {
      const fx = (x / N) * size;
      const fy = (y / N) * size;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const tx = fx - x0;
      const ty = fy - y0;
      const sx = tx * tx * (3 - 2 * tx);
      const sy = ty * ty * (3 - 2 * ty);
      const at = (i: number, j: number) => g[((j + size) % size) * size + ((i + size) % size)];
      const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx;
      const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx;
      return a + (b - a) * sy;
    };
  };
  const coarse = lattice(8);
  const mid = lattice(32);
  const fine = lattice(128);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const v = coarse(x, y) * 0.25 + mid(x, y) * 0.4 + fine(x, y) * 0.35;
      const i = (y * N + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = Math.round(v * 255);
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, N, N);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

/**
 * The studio floor: a matte (Lambert) surface — shadow-receiving, but far
 * cheaper per pixel than full PBR, which matters because it covers most of the
 * screen. A pre-baked grain texture adds the subtle texture, and the white
 * diagonal grid is drawn analytically: two families of lines at +45° and -45°
 * cross to form the X / diamond pattern. Lines are anti-aliased with
 * screen-space derivatives and fade where they would alias (grazing angles,
 * far distance) and into the horizon colour.
 */
export function createFloorMaterial(): THREE.MeshLambertMaterial & { userData: { uniforms: FloorUniforms } } {
  const uniforms: FloorUniforms = {
    uSpacing: { value: 1 },
    uGridOpacity: { value: 0.55 },
    uLineWidth: { value: 0.011 },
    uFadeColor: { value: new THREE.Color('#0c1824') },
    uFadeNear: { value: 40 },
    uFadeFar: { value: 180 },
    uGrain: { value: createGrainTexture() },
  };
  const mat = new THREE.MeshLambertMaterial({ color: '#0b1622' });
  mat.name = 'StudioFloor';
  mat.userData.uniforms = uniforms;

  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFloorWorld;')
      .replace(
        '#include <project_vertex>',
        '#include <project_vertex>\nvFloorWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;',
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
varying vec3 vFloorWorld;
uniform float uSpacing;
uniform float uGridOpacity;
uniform float uLineWidth;
uniform vec3 uFadeColor;
uniform float uFadeNear;
uniform float uFadeFar;
uniform sampler2D uGrain;

// Coverage of one family of parallel lines, crisp at any distance.
float gridLine(float coord, float width, float fw) {
  float d = abs(fract(coord - 0.5) - 0.5);
  float halfW = max(width * 0.5, fw * 0.5);
  float line = 1.0 - smoothstep(halfW - fw * 0.75, halfW + fw * 0.75, d);
  line *= clamp(width / fw, 0.0, 1.0) * 0.6 + 0.4;
  return line * (1.0 - smoothstep(0.18, 0.45, fw));
}`,
      )
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
diffuseColor.rgb *= 0.82 + 0.36 * texture2D(uGrain, vFloorWorld.xz * 0.11).r;`,
      )
      .replace(
        '#include <opaque_fragment>',
        /* glsl */ `{
  vec2 p = vFloorWorld.xz / uSpacing;
  float a = (p.x + p.y) * 0.70710678;
  float b = (p.x - p.y) * 0.70710678;
  float fa = max(fwidth(a), 1e-5);
  float fb = max(fwidth(b), 1e-5);
  float la = gridLine(a, uLineWidth, fa);
  float lb = gridLine(b, uLineWidth, fb);
  float lines = max(la, lb) + la * lb * 0.35;
  float camDist = length(vFloorWorld - cameraPosition);
  float distFade = 1.0 - smoothstep(uFadeNear * 0.6, uFadeFar, camDist);
  float g = clamp(lines * uGridOpacity * distFade, 0.0, 1.0);
  vec3 lineColor = vec3(0.86, 0.93, 1.0) * 0.9 + outgoingLight * 0.2;
  outgoingLight = mix(outgoingLight, lineColor, g);
  outgoingLight = mix(outgoingLight, uFadeColor, smoothstep(uFadeNear, uFadeFar, camDist));
}
#include <opaque_fragment>`,
      );
  };
  mat.customProgramCacheKey = () => 'studio-floor-v2';
  return mat as THREE.MeshLambertMaterial & { userData: { uniforms: FloorUniforms } };
}

/**
 * Full-screen backdrop: reconstructs each pixel's view ray and shades a soft
 * horizon glow fading to near-black overhead. Works for both projections.
 */
export function createBackdropMaterial() {
  return new THREE.ShaderMaterial({
    name: 'Backdrop',
    depthWrite: false,
    depthTest: false,
    fog: false,
    uniforms: {
      uHorizon: { value: new THREE.Color('#0c1824') },
      uSky: { value: new THREE.Color('#020407') },
      uInvProj: { value: new THREE.Matrix4() },
      uCamWorld: { value: new THREE.Matrix4() },
      uOrtho: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vNdc;
      void main() {
        vNdc = position.xy;
        gl_Position = vec4(position.xy, 1.0, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uHorizon;
      uniform vec3 uSky;
      uniform mat4 uInvProj;
      uniform mat4 uCamWorld;
      uniform float uOrtho;
      varying vec2 vNdc;
      void main() {
        vec4 v = uInvProj * vec4(vNdc, 1.0, 1.0);
        vec3 viewDir = uOrtho > 0.5 ? vec3(0.0, vNdc.y * 0.35, -1.0) : v.xyz / v.w;
        vec3 dir = normalize(mat3(uCamWorld) * viewDir);
        float y = dir.y;
        vec3 c = y >= 0.0
          ? mix(uHorizon, uSky, pow(smoothstep(0.0, 0.65, y), 0.7))
          : mix(uHorizon, uSky * 0.6, smoothstep(0.0, 0.4, -y));
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  });
}

export function createFullscreenTriangle() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  return g;
}
