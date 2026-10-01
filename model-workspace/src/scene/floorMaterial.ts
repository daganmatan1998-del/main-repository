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
}

export function createFloorMaterial(): THREE.MeshStandardMaterial & { userData: { uniforms: FloorUniforms } } {
  const uniforms: FloorUniforms = {
    uSpacing: { value: 1 },
    uGridOpacity: { value: 0.55 },
    uLineWidth: { value: 0.011 },
    uFadeColor: { value: new THREE.Color('#2a211a') },
    uFadeNear: { value: 40 },
    uFadeFar: { value: 180 },
  };
  const mat = new THREE.MeshStandardMaterial({
    color: '#4b3326',
    roughness: 0.92,
    metalness: 0,
    envMapIntensity: 0.6,
  });
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

float floorHash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float floorNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(floorHash(i), floorHash(i + vec2(1.0, 0.0)), u.x),
             mix(floorHash(i + vec2(0.0, 1.0)), floorHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
// Coverage of one family of parallel lines, crisp at any distance.
float gridLine(float coord, float width) {
  float fw = max(fwidth(coord), 1e-5);
  float d = abs(fract(coord - 0.5) - 0.5);
  float halfW = max(width * 0.5, fw * 0.5);
  float line = 1.0 - smoothstep(halfW - fw * 0.75, halfW + fw * 0.75, d);
  // Thin lines narrower than a pixel get dimmer instead of thicker (no blooming).
  line *= clamp(width / max(fw, 1e-5), 0.0, 1.0) * 0.6 + 0.4;
  // When lines are denser than pixels they would shimmer — fade them out.
  line *= 1.0 - smoothstep(0.18, 0.45, fw);
  return line;
}
float gridGlow(float coord, float width) {
  float fw = max(fwidth(coord), 1e-5);
  float d = abs(fract(coord - 0.5) - 0.5);
  return exp(-d / (width * 2.5 + fw)) * (1.0 - smoothstep(0.08, 0.3, fw));
}`,
      )
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
{
  vec2 fp = vFloorWorld.xz;
  float grain = floorNoise(fp * 9.0) * 0.5 + floorNoise(fp * 37.0) * 0.3 + floorNoise(fp * 1.3) * 0.2;
  diffuseColor.rgb *= 0.86 + 0.24 * grain;
}`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        /* glsl */ `#include <roughnessmap_fragment>
roughnessFactor = clamp(roughnessFactor + (floorNoise(vFloorWorld.xz * 23.0) - 0.5) * 0.1, 0.0, 1.0);`,
      )
      .replace(
        '#include <opaque_fragment>',
        /* glsl */ `{
  vec2 p = vFloorWorld.xz / uSpacing;
  float a = (p.x + p.y) * 0.70710678;
  float b = (p.x - p.y) * 0.70710678;
  float w = uLineWidth;
  float la = gridLine(a, w);
  float lb = gridLine(b, w);
  float lines = max(la, lb);
  float glow = max(gridGlow(a, w), gridGlow(b, w)) * 0.12;
  float camDist = length(vFloorWorld - cameraPosition);
  float distFade = 1.0 - smoothstep(uFadeNear * 0.6, uFadeFar, camDist);
  float g = clamp((lines + glow + la * lb * 0.35) * uGridOpacity * distFade, 0.0, 1.0);
  vec3 lineColor = vec3(0.93, 0.91, 0.88) * 0.85 + outgoingLight * 0.25;
  outgoingLight = mix(outgoingLight, lineColor, g);
  float horizon = smoothstep(uFadeNear, uFadeFar, camDist);
  outgoingLight = mix(outgoingLight, uFadeColor, horizon);
}
#include <opaque_fragment>`,
      );
  };
  // Distinct program cache key so other standard materials don't reuse this shader.
  mat.customProgramCacheKey = () => 'studio-floor-v1';
  return mat as THREE.MeshStandardMaterial & { userData: { uniforms: FloorUniforms } };
}

/**
 * Full-screen backdrop: reconstructs each pixel's view ray and shades a warm
 * horizon glow fading to near-black overhead. Works for both projections.
 */
export function createBackdropMaterial() {
  return new THREE.ShaderMaterial({
    name: 'Backdrop',
    depthWrite: false,
    depthTest: false,
    fog: false,
    uniforms: {
      uHorizon: { value: new THREE.Color('#2a211a') },
      uSky: { value: new THREE.Color('#0d0b09') },
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
