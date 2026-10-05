import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import type { InstanceState } from '../project/types';
import { acquireAsset, cloneAssetScene, getLoadedAsset, releaseAsset, type LoadedAsset } from '../loading/assetCache';
import { useEditor } from '../state/editorStore';
import { registry } from './registry';
import { assetBounds } from '../editor/bounds';
import { toast } from '../state/uiStore';
import { gizmoState } from './gizmoState';
import { useTools } from '../state/toolsStore';

const reportedErrors = new Set<string>();

function Placeholder({ assetId, error }: { assetId: string; error: boolean }) {
  const b = assetBounds(assetId);
  const size: [number, number, number] = [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]];
  const center: [number, number, number] = [(b.max[0] + b.min[0]) / 2, (b.max[1] + b.min[1]) / 2, (b.max[2] + b.min[2]) / 2];
  const ref = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(({ clock, invalidate }) => {
    if (ref.current && !error) {
      ref.current.opacity = 0.25 + Math.sin(clock.elapsedTime * 3) * 0.12;
      invalidate();
    }
  });
  return (
    <mesh position={center}>
      <boxGeometry args={size} />
      <meshBasicMaterial ref={ref} color={error ? '#ff5a6a' : '#38b6ff'} wireframe transparent opacity={0.4} />
    </mesh>
  );
}

function ModelInstanceImpl({ inst }: { inst: InstanceState }) {
  const group = useRef<THREE.Group>(null);
  const [asset, setAsset] = useState<LoadedAsset | null>(() => getLoadedAsset(inst.assetId) ?? null);
  const [error, setError] = useState<string | null>(null);

  // Load (or share) the asset for as long as this instance exists.
  useEffect(() => {
    let alive = true;
    const { setAssetLoad } = useEditor.getState();
    if (!getLoadedAsset(inst.assetId)) {
      setAssetLoad(inst.assetId, { status: 'loading', progress: null, name: inst.name });
    }
    acquireAsset(inst.assetId)
      .then((a) => {
        if (!alive) return;
        setAsset(a);
        setError(null);
        useEditor.getState().setAssetLoad(inst.assetId, null);
      })
      .catch((e: Error) => {
        if (!alive) return;
        setError(e.message);
        useEditor.getState().setAssetLoad(inst.assetId, { status: 'error', progress: null, error: e.message, name: inst.name });
        if (!reportedErrors.has(inst.assetId)) {
          reportedErrors.add(inst.assetId);
          toast('error', `Couldn’t load “${inst.name}”`, e.message);
        }
      });
    return () => {
      alive = false;
      releaseAsset(inst.assetId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inst.assetId]);

  const content = useMemo(() => (asset ? cloneAssetScene(asset) : null), [asset]);

  // Register the live object for framing, outlines and the gizmo.
  useLayoutEffect(() => {
    const g = group.current!;
    g.userData.instanceId = inst.id;
    registry.set(inst.id, g);
    return () => registry.delete(inst.id, g);
  }, [inst.id, content]);

  // Apply persisted transform. Skipped for the object being dragged so the gizmo isn't fought.
  useLayoutEffect(() => {
    const g = group.current!;
    if (gizmoState.draggingId === inst.id) return;
    g.position.fromArray(inst.position);
    g.rotation.set(...inst.rotation);
    g.scale.fromArray(inst.scale);
    g.updateMatrixWorld(true);
  }, [inst.id, inst.position, inst.rotation, inst.scale]);

  // Animation playback.
  const mixer = useMemo(() => (content && asset?.animations.length ? new THREE.AnimationMixer(content) : null), [content, asset]);
  const clipName = inst.animation?.clip ?? null;
  const playing = inst.animation?.playing ?? false;
  useEffect(() => {
    if (!mixer || !asset) return;
    mixer.stopAllAction();
    if (!playing) return;
    const clip = asset.animations.find((c) => c.name === clipName) ?? asset.animations[0];
    if (clip) mixer.clipAction(clip).reset().play();
  }, [mixer, asset, clipName, playing]);
  useEffect(() => () => {
    mixer?.stopAllAction();
    if (content) mixer?.uncacheRoot(content);
  }, [mixer, content]);
  useFrame((state, dt) => {
    if (mixer && playing) {
      mixer.update(Math.min(dt, 0.1));
      state.gl.shadowMap.needsUpdate = true;
      state.invalidate();
    }
  });

  // Isolation hides everything but the isolated models, without touching saved visibility.
  const isolatedOut = useTools((s) => !!s.isolated && !s.isolated.includes(inst.id));
  const shown = inst.visible && !isolatedOut;
  const interactive = shown;
  const handlers = interactive
    ? {
        onPointerOver: (e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation();
          if (!gizmoState.active) useEditor.getState().setHovered(inst.id);
        },
        onPointerOut: () => {
          if (useEditor.getState().hovered === inst.id) useEditor.getState().setHovered(null);
        },
        onClick: (e: ThreeEvent<MouseEvent>) => {
          e.stopPropagation();
          if (e.delta > 4 || gizmoState.recentlyUsed()) return;
          if (useTools.getState().measuring) {
            useTools.getState().addMeasurePoint(e.point.toArray());
            return;
          }
          const additive = e.nativeEvent.shiftKey || e.nativeEvent.ctrlKey || e.nativeEvent.metaKey;
          useEditor.getState().select([inst.id], additive ? 'toggle' : 'replace');
        },
        onDoubleClick: (e: ThreeEvent<MouseEvent>) => {
          e.stopPropagation();
          window.dispatchEvent(new CustomEvent('workspace:focus', { detail: inst.id }));
        },
      }
    : {};

  return (
    <group ref={group} name={inst.name} visible={shown} {...handlers}>
      {content ? <primitive object={content} /> : <Placeholder assetId={inst.assetId} error={!!error} />}
    </group>
  );
}

export const ModelInstance = memo(ModelInstanceImpl);

export function Instances() {
  const instances = useEditor((s) => s.instances);
  return (
    <>
      {instances.map((i) => (
        <ModelInstance key={i.id} inst={i} />
      ))}
    </>
  );
}
