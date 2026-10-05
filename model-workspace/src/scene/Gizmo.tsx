import { useEffect, useMemo, useState } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { selectPrimary, useEditor } from '../state/editorStore';
import { registry } from './registry';
import { gizmoState } from './gizmoState';
import { viewport } from './viewportServices';
import type { Vec3 } from '../project/types';
import { useTools } from '../state/toolsStore';

const MIN_SCALE = 1e-4;

/**
 * The transform gizmo (W move / E rotate / R scale) on the primary selection.
 * Axis handles constrain; the centre handle moves freely in the view plane or
 * scales uniformly; the outer ring rotates around the view axis.
 * The drag mutates the object live and commits one undo step on release.
 */
export function Gizmo() {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const primary = useEditor(selectPrimary);
  const inst = useEditor((s) => s.instances.find((i) => i.id === primary));
  const mode = useEditor((s) => s.gizmoMode);
  const space = useEditor((s) => s.gizmoSpace);
  const snap = useEditor((s) => s.settings!.snapping);
  const [obj, setObj] = useState<THREE.Object3D | undefined>(undefined);

  const controls = useMemo(() => new TransformControls(camera, gl.domElement), [camera, gl]);

  useEffect(() => {
    const helper = controls.getHelper();
    scene.add(helper);
    viewport.gizmoHelper = helper;
    return () => {
      scene.remove(helper);
      controls.detach();
      controls.dispose();
      if (viewport.gizmoHelper === helper) viewport.gizmoHelper = null;
    };
  }, [controls, scene]);

  // Track the registered object for the primary selection (it may mount after selection).
  useEffect(() => {
    const update = () => setObj(primary ? registry.get(primary) : undefined);
    update();
    return registry.subscribe(update);
  }, [primary]);

  // The gizmo steps aside while measuring, so clicks land on the model, not on a handle.
  const measuring = useTools((s) => s.measuring);
  const isolatedOut = useTools((s) => !!s.isolated && !!primary && !s.isolated.includes(primary));
  const enabled = !!obj && !!inst && inst.visible && !inst.locked && !measuring && !isolatedOut;

  useEffect(() => {
    if (enabled && obj) controls.attach(obj);
    else controls.detach();
  }, [controls, obj, enabled]);

  useEffect(() => {
    controls.setMode(mode);
    controls.setSpace(mode === 'scale' ? 'local' : space);
    controls.setSize(0.9);
  }, [controls, mode, space]);

  useEffect(() => {
    controls.setTranslationSnap(snap.enabled ? snap.translate : null);
    controls.setRotationSnap(snap.enabled ? THREE.MathUtils.degToRad(snap.rotate) : null);
    controls.setScaleSnap(snap.enabled ? snap.scale : null);
  }, [controls, snap]);

  useEffect(() => {
    const onDragging = (e: { value: unknown }) => {
      const dragging = !!e.value;
      if (viewport.controls) viewport.controls.enabled = !dragging;
      gizmoState.active = dragging;
      const id = (controls.object?.userData.instanceId as string | undefined) ?? null;
      gizmoState.draggingId = dragging ? id : null;
      useEditor.getState().setDragging(dragging);
      if (dragging) return;
      gizmoState.lastReleasedAt = performance.now();
      const o = controls.object;
      if (!o || !id) return;
      const cur = useEditor.getState().instances.find((i) => i.id === id);
      if (!cur) return;
      const scale = o.scale.toArray().map((v) => (Math.abs(v) < MIN_SCALE ? MIN_SCALE * Math.sign(v || 1) : v)) as Vec3;
      o.scale.fromArray(scale);
      const next = {
        position: o.position.toArray() as Vec3,
        rotation: [o.rotation.x, o.rotation.y, o.rotation.z] as Vec3,
        scale,
      };
      const same = (a: Vec3, b: Vec3) => a.every((v, i) => Math.abs(v - b[i]) < 1e-7);
      if (same(next.position, cur.position) && same(next.rotation, cur.rotation) && same(next.scale, cur.scale)) return;
      const label = mode === 'translate' ? 'Move' : mode === 'rotate' ? 'Rotate' : 'Scale';
      useEditor.getState().setTransform(id, next, label);
    };
    const onHover = () => {
      // `axis` is set while the pointer is over a handle; suppress model hover/click then.
      if (!controls.dragging) gizmoState.active = controls.axis !== null;
    };
    controls.addEventListener('dragging-changed', onDragging);
    controls.addEventListener('axis-changed', onHover);
    const onChange = () => useEditor.getState().bumpLive();
    const redraw = () => viewport.requestShadowUpdate();
    controls.addEventListener('change', redraw);
    controls.addEventListener('objectChange', onChange);
    return () => {
      controls.removeEventListener('objectChange', onChange);
      controls.removeEventListener('change', redraw);
      controls.removeEventListener('dragging-changed', onDragging);
      controls.removeEventListener('axis-changed', onHover);
    };
  }, [controls, mode]);

  return null;
}
