import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useEditor } from '../state/editorStore';
import { createBackdropMaterial, createFloorMaterial, createFullscreenTriangle } from './floorMaterial';
import { getEnvironmentMap } from './environments';
import { boundsOf, registry } from './registry';
import { QUALITY } from './quality';
import { viewport } from './viewportServices';

/** Renderer colour pipeline, image-based lighting and exposure. */
export function RendererSetup() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const settings = useEditor((s) => s.settings!);
  const { preset } = settings.environment;
  const { exposure, envIntensity } = settings.lighting;

  useEffect(() => {
    gl.toneMapping = THREE.NeutralToneMapping;
    gl.outputColorSpace = THREE.SRGBColorSpace;
    gl.shadowMap.type = THREE.PCFShadowMap;
  }, [gl]);

  useEffect(() => {
    gl.toneMappingExposure = exposure;
  }, [gl, exposure]);

  useEffect(() => {
    scene.environment = getEnvironmentMap(gl, preset);
  }, [gl, scene, preset]);

  useEffect(() => {
    scene.environmentIntensity = envIntensity;
  }, [scene, envIntensity]);

  return null;
}

/** Full-screen sky gradient behind everything, so the world has no visible edge. */
export function Backdrop() {
  const mat = useMemo(createBackdropMaterial, []);
  const geo = useMemo(createFullscreenTriangle, []);
  const env = useEditor((s) => s.settings!.environment);
  useEffect(() => {
    mat.uniforms.uHorizon.value.set(env.horizonColor);
    mat.uniforms.uSky.value.set(env.skyColor);
  }, [mat, env.horizonColor, env.skyColor]);
  useFrame(({ camera }) => {
    mat.uniforms.uInvProj.value.copy(camera.projectionMatrixInverse);
    mat.uniforms.uCamWorld.value.copy(camera.matrixWorld);
    mat.uniforms.uOrtho.value = (camera as THREE.OrthographicCamera).isOrthographicCamera ? 1 : 0;
  });
  return <mesh geometry={geo} material={mat} renderOrder={-1000} frustumCulled={false} raycast={() => null} />;
}

/** The brown studio floor with the white diagonal X grid. */
export function Floor() {
  const mat = useMemo(createFloorMaterial, []);
  const ref = useRef<THREE.Mesh>(null);
  const grid = useEditor((s) => s.settings!.grid);
  const horizon = useEditor((s) => s.settings!.environment.horizonColor);
  const controlsTarget = useMemo(() => new THREE.Vector3(), []);

  useEffect(() => {
    const u = mat.userData.uniforms;
    u.uSpacing.value = Math.max(0.01, grid.spacing);
    u.uGridOpacity.value = grid.visible ? grid.opacity : 0;
    u.uFadeColor.value.set(horizon);
    mat.color.set(grid.floorColor);
  }, [mat, grid, horizon]);

  useFrame(({ camera }) => {
    const mesh = ref.current;
    if (!mesh) return;
    // The plane follows the camera; the grid is computed in world space, so it never "slides".
    mesh.position.set(camera.position.x, 0, camera.position.z);
    const u = mat.userData.uniforms;
    const c = viewport.controls;
    let dist = 10;
    if (c) {
      c.getTarget(controlsTarget);
      dist = camera.position.distanceTo(controlsTarget);
      if ((camera as THREE.OrthographicCamera).isOrthographicCamera) {
        const o = camera as THREE.OrthographicCamera;
        dist = (o.top - o.bottom) / o.zoom;
      }
    }
    u.uFadeNear.value = Math.max(35, dist * 3.5);
    u.uFadeFar.value = u.uFadeNear.value * 5;
  });

  return (
    <mesh
      ref={ref}
      rotation-x={-Math.PI / 2}
      receiveShadow
      material={mat}
      visible={grid.floorVisible}
      renderOrder={-10}
      raycast={() => null}
      frustumCulled={false}
    >
      <planeGeometry args={[6000, 6000, 1, 1]} />
    </mesh>
  );
}

/** Key light with shadows fitted to the scene, plus a soft hemispheric fill. */
export function Lights() {
  const lighting = useEditor((s) => s.settings!.lighting);
  const quality = useEditor((s) => s.settings!.quality);
  const revision = useEditor((s) => s.revision);
  const sun = useRef<THREE.DirectionalLight>(null);
  const scene = useThree((s) => s.scene);
  const fitNeeded = useRef(true);

  useEffect(() => {
    fitNeeded.current = true;
  }, [revision, lighting.sunAzimuth, lighting.sunElevation]);
  useEffect(() => registry.subscribe(() => (fitNeeded.current = true)), []);

  useEffect(() => {
    const l = sun.current;
    if (!l) return;
    scene.add(l.target);
    return () => {
      scene.remove(l.target);
    };
  }, [scene]);

  useEffect(() => {
    const l = sun.current;
    if (!l) return;
    const size = QUALITY[quality].shadowMapSize;
    if (l.shadow.mapSize.x !== size) {
      l.shadow.mapSize.set(size, size);
      l.shadow.map?.dispose();
      l.shadow.map = null;
    }
  }, [quality]);

  let frame = 0;
  useFrame(() => {
    const l = sun.current;
    if (!l) return;
    // Refit when the scene changed, and continuously while something is being dragged or animated.
    frame++;
    const dragging = useEditor.getState().dragging;
    if (!fitNeeded.current && !dragging && frame % 30 !== 0) return;
    fitNeeded.current = false;
    const box = boundsOf();
    const sphere = box.isEmpty()
      ? new THREE.Sphere(new THREE.Vector3(0, 0.5, 0), 3)
      : box.getBoundingSphere(new THREE.Sphere());
    const r = Math.max(sphere.radius * 1.15, 2);
    const az = THREE.MathUtils.degToRad(lighting.sunAzimuth);
    const el = THREE.MathUtils.degToRad(Math.max(3, Math.min(89, lighting.sunElevation)));
    const dir = new THREE.Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
    l.position.copy(sphere.center).addScaledVector(dir, r * 3);
    l.target.position.copy(sphere.center);
    l.target.updateMatrixWorld();
    const cam = l.shadow.camera;
    cam.left = -r;
    cam.right = r;
    cam.top = r;
    cam.bottom = -r;
    cam.near = r * 0.5;
    cam.far = r * 5.5;
    cam.updateProjectionMatrix();
    l.shadow.bias = -0.0002;
    l.shadow.normalBias = r * 0.0025;
    l.shadow.radius = 4;
  });

  return (
    <>
      <directionalLight
        ref={sun}
        intensity={lighting.sunIntensity}
        color="#fff4e6"
        castShadow={lighting.shadows}
      />
      <hemisphereLight args={['#f1e6da', '#3b2a1f', lighting.fillIntensity]} />
    </>
  );
}
