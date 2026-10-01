import * as THREE from 'three';
import { useEditor } from '../state/editorStore';
import type { InstanceState, Vec3 } from '../project/types';
import { instanceBox, unionBox } from './bounds';
import { toast } from '../state/uiStore';

type Axis = 'x' | 'z';
const AX = { x: 0, z: 2 } as const;

/** Selected unlocked models when 2+ are selected, otherwise every visible unlocked model. */
export function arrangeTargets(): InstanceState[] {
  const s = useEditor.getState();
  const movable = s.instances.filter((i) => !i.locked);
  const sel = movable.filter((i) => s.selection.includes(i.id));
  return sel.length >= 2 ? sel : movable.filter((i) => i.visible);
}

function gapFor(boxes: THREE.Box3[]): number {
  const sizes = boxes.map((b) => b.getSize(new THREE.Vector3()));
  const avg = sizes.reduce((n, s) => n + Math.max(s.x, s.z), 0) / Math.max(1, sizes.length);
  return Math.max(0.2, avg * 0.18);
}

function apply(label: string, moves: Map<string, Vec3>) {
  if (!moves.size) return;
  useEditor.getState().commit(label, (d) => {
    for (const inst of d.instances) {
      const p = moves.get(inst.id);
      if (p) inst.position = p;
    }
  });
}

/** Moves an instance so its world box min.y sits on y=0. */
function grounded(inst: InstanceState, pos: Vec3 = inst.position): Vec3 {
  const b = instanceBox({ ...inst, position: pos });
  return [pos[0], pos[1] - b.min.y, pos[2]];
}

function need(n: number, targets: InstanceState[], what: string): boolean {
  if (targets.length >= n) return true;
  toast('info', `${what} needs at least ${n} unlocked models`);
  return false;
}

export function placeSideBySide(axis: Axis = 'x') {
  const t = arrangeTargets();
  if (!need(2, t, 'Place side by side')) return;
  const a = AX[axis];
  const other = axis === 'x' ? 2 : 0;
  const boxes = new Map(t.map((i) => [i.id, instanceBox(i)]));
  const sorted = [...t].sort((p, q) => boxes.get(p.id)!.getCenter(new THREE.Vector3()).getComponent(a) - boxes.get(q.id)!.getCenter(new THREE.Vector3()).getComponent(a));
  const all = unionBox(t);
  const center = all.getCenter(new THREE.Vector3());
  const gap = gapFor([...boxes.values()]);
  const total = sorted.reduce((n, i) => n + boxes.get(i.id)!.getSize(new THREE.Vector3()).getComponent(a), 0) + gap * (sorted.length - 1);
  let cursor = center.getComponent(a) - total / 2;
  const moves = new Map<string, Vec3>();
  for (const inst of sorted) {
    const b = boxes.get(inst.id)!;
    const size = b.getSize(new THREE.Vector3());
    const c = b.getCenter(new THREE.Vector3());
    const p = [...inst.position] as Vec3;
    p[a] += cursor + size.getComponent(a) / 2 - c.getComponent(a);
    p[other] += center.getComponent(other) - c.getComponent(other);
    moves.set(inst.id, grounded(inst, p));
    cursor += size.getComponent(a) + gap;
  }
  apply('Place side by side', moves);
}

export function arrangeGrid() {
  const t = arrangeTargets();
  if (!need(2, t, 'Arrange in grid')) return;
  const boxes = t.map((i) => instanceBox(i));
  const sizes = boxes.map((b) => b.getSize(new THREE.Vector3()));
  const gap = gapFor(boxes);
  const cell = { x: Math.max(...sizes.map((s) => s.x)) + gap, z: Math.max(...sizes.map((s) => s.z)) + gap };
  const cols = Math.ceil(Math.sqrt(t.length));
  const rows = Math.ceil(t.length / cols);
  const center = unionBox(t).getCenter(new THREE.Vector3());
  const moves = new Map<string, Vec3>();
  t.forEach((inst, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const tx = center.x + (col - (cols - 1) / 2) * cell.x;
    const tz = center.z + (row - (rows - 1) / 2) * cell.z;
    const c = boxes[i].getCenter(new THREE.Vector3());
    moves.set(inst.id, grounded(inst, [inst.position[0] + tx - c.x, inst.position[1], inst.position[2] + tz - c.z]));
  });
  apply('Arrange in grid', moves);
}

export function align(axis: 'x' | 'y' | 'z', mode: 'min' | 'center' | 'max') {
  const t = arrangeTargets();
  if (!need(2, t, 'Align')) return;
  const i = { x: 0, y: 1, z: 2 }[axis];
  const all = unionBox(t);
  const ref = mode === 'min' ? all.min.getComponent(i) : mode === 'max' ? all.max.getComponent(i) : all.getCenter(new THREE.Vector3()).getComponent(i);
  const moves = new Map<string, Vec3>();
  for (const inst of t) {
    const b = instanceBox(inst);
    const cur = mode === 'min' ? b.min.getComponent(i) : mode === 'max' ? b.max.getComponent(i) : b.getCenter(new THREE.Vector3()).getComponent(i);
    const p = [...inst.position] as Vec3;
    p[i] += ref - cur;
    moves.set(inst.id, p);
  }
  apply(`Align ${axis.toUpperCase()} ${mode}`, moves);
}

/** Equal gaps between neighbours along an axis; the two outermost models stay put. */
export function distribute(axis: Axis) {
  const t = arrangeTargets();
  if (!need(3, t, 'Distribute')) return;
  const a = AX[axis];
  const items = t.map((inst) => ({ inst, box: instanceBox(inst) }))
    .sort((p, q) => p.box.min.getComponent(a) - q.box.min.getComponent(a));
  const first = items[0].box.min.getComponent(a);
  const last = Math.max(...items.map((x) => x.box.max.getComponent(a)));
  const widths = items.reduce((n, x) => n + (x.box.max.getComponent(a) - x.box.min.getComponent(a)), 0);
  const gap = (last - first - widths) / (items.length - 1);
  let cursor = first;
  const moves = new Map<string, Vec3>();
  for (const { inst, box } of items) {
    const p = [...inst.position] as Vec3;
    p[a] += cursor - box.min.getComponent(a);
    moves.set(inst.id, p);
    cursor += box.max.getComponent(a) - box.min.getComponent(a) + gap;
  }
  apply(`Distribute ${axis.toUpperCase()}`, moves);
}

/** Moves the group so its footprint is centred on the world origin. */
export function centerOnOrigin() {
  const t = arrangeTargets();
  if (!t.length) return;
  const c = unionBox(t).getCenter(new THREE.Vector3());
  const moves = new Map<string, Vec3>();
  for (const inst of t) moves.set(inst.id, [inst.position[0] - c.x, inst.position[1], inst.position[2] - c.z]);
  apply('Center', moves);
}

function selectedUnlocked(): InstanceState[] {
  const s = useEditor.getState();
  return s.instances.filter((i) => s.selection.includes(i.id) && !i.locked);
}

export function dropToFloor() {
  const t = selectedUnlocked();
  const moves = new Map<string, Vec3>();
  for (const inst of t) moves.set(inst.id, grounded(inst));
  apply('Drop to floor', moves);
}

/** Back to the origin, standing on the floor. */
export function resetPosition() {
  const t = selectedUnlocked();
  const moves = new Map<string, Vec3>();
  for (const inst of t) {
    const b = instanceBox({ ...inst, position: [0, 0, 0] });
    const c = b.getCenter(new THREE.Vector3());
    moves.set(inst.id, [-c.x, -b.min.y, -c.z]);
  }
  apply('Reset position', moves);
}

export function resetTransform() {
  const t = selectedUnlocked();
  if (!t.length) return;
  useEditor.getState().commit('Reset transform', (d) => {
    for (const inst of d.instances) {
      if (!t.some((x) => x.id === inst.id)) continue;
      inst.rotation = [0, 0, 0];
      inst.scale = [1, 1, 1];
      inst.position = grounded({ ...inst, rotation: [0, 0, 0], scale: [1, 1, 1] });
    }
  });
}
