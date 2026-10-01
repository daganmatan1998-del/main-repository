/**
 * End-to-end workflow test (README "Testing"). Drives the real app in Chromium:
 * home → new project → import many formats → select / move / rotate / scale →
 * undo/redo → duplicate / rename / hide / lock / delete → camera views →
 * autosave → close the browser → reopen → project + thumbnail on home →
 * open by save code → scene restored exactly.
 *
 *   npm run dev -- --port 5199 &   (or: npx vite preview --port 5199 after a build)
 *   bash tests/fetch-fixtures.sh
 *   node tests/e2e.mjs
 */
import { chromium } from 'playwright';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const URL_ = process.env.APP_URL ?? 'http://localhost:5199/';
const FIX = resolve(process.env.FIXTURES ?? 'tests/fixtures');
const SHOTS = resolve(process.env.SHOTS ?? 'test-results');
mkdirSync(SHOTS, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), 'ws-e2e-'));
const ARGS = ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];

let failures = 0;
const check = (cond, msg) => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${msg}`);
  if (!cond) failures++;
};
const step = (s) => console.log(`\n▶ ${s}`);

async function launch() {
  const ctx = await chromium.launchPersistentContext(profile, {
    args: ARGS,
    viewport: { width: 1600, height: 960 },
    executablePath: process.env.CHROMIUM_PATH || undefined,
  });
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  return { ctx, page, errors };
}

const state = (page) =>
  page.evaluate(() => {
    const s = window.__workspace.editor.getState();
    return {
      instances: s.instances,
      selection: s.selection,
      saveStatus: s.saveStatus,
      past: s.past.length,
      future: s.future.length,
      project: s.project && { id: s.project.id, saveCode: s.project.saveCode, name: s.project.name },
      loading: Object.values(s.assetLoad).filter((l) => l.status === 'loading').length,
      errors: Object.values(s.assetLoad).filter((l) => l.status === 'error').map((l) => l.error),
      camera: s.camera,
    };
  });

async function waitLoaded(page, count, timeout = 120000) {
  await page.waitForFunction(
    (n) => {
      const s = window.__workspace.editor.getState();
      const reg = window.__workspace.registry;
      return s.instances.length === n && !Object.values(s.assetLoad).some((l) => l.status === 'loading') &&
        s.instances.every((i) => reg.get(i.id)?.children[0]?.type !== 'Mesh' || reg.get(i.id).children[0].geometry.type !== 'BoxGeometry');
    },
    count,
    { timeout },
  );
}

async function waitSaved(page) {
  await page.waitForFunction(() => window.__workspace.editor.getState().saveStatus === 'saved', null, { timeout: 20000 });
}

/** Screen position of an instance's origin. */
const screenOf = (page, id) =>
  page.evaluate((id) => {
    const { viewport, registry } = window.__workspace;
    const o = registry.get(id);
    const v = o.getWorldPosition(o.position.clone()).project(viewport.camera);
    const r = viewport.gl.domElement.getBoundingClientRect();
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
  }, id);

const boxesOverlap = (page) =>
  page.evaluate(() => {
    const { registry } = window.__workspace;
    const ids = window.__workspace.editor.getState().instances.map((i) => i.id);
    const boxes = ids.map((id) => {
      const o = registry.get(id);
      o.updateWorldMatrix(true, true);
      const b = new o.position.constructor();
      const Box3 = Object.getPrototypeOf(o).constructor; // unused; keep evaluate self-contained
      void b; void Box3;
      const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
      o.traverse((c) => {
        if (!c.geometry?.attributes?.position) return;
        c.geometry.computeBoundingBox?.();
        const bb = c.geometry.boundingBox;
        if (!bb) return;
        for (const x of [bb.min.x, bb.max.x]) for (const y of [bb.min.y, bb.max.y]) for (const z of [bb.min.z, bb.max.z]) {
          const p = c.localToWorld(new o.position.constructor(x, y, z));
          [p.x, p.y, p.z].forEach((v, i) => { min[i] = Math.min(min[i], v); max[i] = Math.max(max[i], v); });
        }
      });
      return { min, max };
    });
    let overlaps = 0;
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      if (a.min[0] < b.max[0] - 1e-3 && a.max[0] > b.min[0] + 1e-3 && a.min[2] < b.max[2] - 1e-3 && a.max[2] > b.min[2] + 1e-3) overlaps++;
    }
    const onFloor = boxes.map((b) => Math.abs(b.min[1]) < 0.02);
    return { overlaps, onFloor };
  });

// ---------------------------------------------------------------------------
let { ctx, page, errors } = await launch();

step('Home screen');
await page.goto(URL_);
await page.waitForSelector('.hero-title');
check(await page.isVisible('[data-testid=new-project]'), 'New Project button visible');
check(await page.isVisible('[data-testid=open-by-code]'), 'Open with Save Code button visible');

step('Create project');
await page.click('[data-testid=new-project]');
await page.fill('.modal input', 'Luxury Cars');
await page.keyboard.press('Enter');
await page.waitForSelector('.viewport-canvas canvas', { timeout: 30000 });
await page.waitForFunction(() => !!window.__workspace.viewport.controls);
let s = await state(page);
check(s.project?.name === 'Luxury Cars', 'editor opened on the new project');
check(/^3D-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/.test(s.project?.saveCode ?? ''), `save code generated: ${s.project?.saveCode}`);
const saveCode = s.project.saveCode;
await page.waitForTimeout(800);
await page.screenshot({ path: join(SHOTS, '01-empty-editor.png') });

step('Import multiple formats at once (GLB ×4, glTF+bin+png, FBX, OBJ+MTL, STL, PLY)');
const files = ['DamagedHelmet.glb', 'Fox.glb', 'ToyCar.glb', 'SheenChair.glb', 'duck/Duck.gltf', 'duck/Duck0.bin', 'duck/DuckCM.png',
  'SambaDancing.fbx', 'WaltHead.obj', 'WaltHead.mtl', 'pr2_head_pan.stl', 'dolphins.ply'].map((f) => join(FIX, f));
await page.setInputFiles('[data-testid=file-input]', files);
// Progress UI should appear while the big files load.
const sawLoading = await page.waitForSelector('[data-testid=loading-panel]', { timeout: 60000 }).then(() => true, () => false);
check(sawLoading, 'loading progress panel shown during import');
await waitLoaded(page, 9, 180000);
s = await state(page);
check(s.instances.length === 9, `9 models in the scene (got ${s.instances.length})`);
check(s.errors.length === 0, `no load errors ${s.errors.join('; ')}`);
const positions = s.instances.map((i) => i.position.map((v) => v.toFixed(3)).join(','));
check(new Set(positions).size === positions.length, 'every model got its own position');
let geo = await boxesOverlap(page);
check(geo.overlaps === 0, `no overlapping models after auto-placement (overlaps: ${geo.overlaps})`);
check(geo.onFloor.every(Boolean), 'all models stand on the floor');

const mats = await page.evaluate(() => {
  const { registry } = window.__workspace;
  const out = {};
  for (const i of window.__workspace.editor.getState().instances) {
    let textured = 0, pbr = 0;
    registry.get(i.id).traverse((c) => {
      const ms = c.material ? (Array.isArray(c.material) ? c.material : [c.material]) : [];
      for (const m of ms) {
        if (m.map || m.normalMap || m.roughnessMap) textured++;
        if (m.isMeshStandardMaterial) pbr++;
      }
    });
    out[i.name] = { textured, pbr };
  }
  return out;
});
check(mats.DamagedHelmet?.textured > 0 && mats.DamagedHelmet?.pbr > 0, 'DamagedHelmet keeps PBR textures');
check(mats.Duck?.textured > 0, 'multi-file glTF (Duck) resolved its external texture');
check(mats.SambaDancing?.textured >= 0, 'FBX loaded');
await page.click('[data-testid=fit-scene]');
await page.waitForTimeout(1500);
await page.screenshot({ path: join(SHOTS, '02-nine-models.png') });

step('Select independently (hierarchy ↔ viewport)');
const ids = s.instances.map((i) => i.id);
await page.click(`[data-testid=tree-row][data-id="${ids[0]}"]`);
s = await state(page);
check(s.selection.length === 1 && s.selection[0] === ids[0], 'clicking a hierarchy row selects that model');
check(await page.isVisible('[data-testid=instance-props]'), 'properties panel shows the model');
const tris = await page.textContent('[data-testid=triangles]');
check(/\d/.test(tris ?? ''), `triangle count shown: ${tris}`);
// Click in the viewport on another model.
await page.evaluate(() => window.__workspace.viewport.controls.setLookAt(0, 6, 22, 0, 0.5, 0, false));
await page.click('[data-testid=fit-scene]');
await page.waitForTimeout(1200);
const target = ids[2];
const pt = await screenOf(page, target);
await page.mouse.click(pt.x, pt.y - 4);
await page.waitForTimeout(300);
s = await state(page);
check(s.selection.length === 1, `clicking in the viewport selected a model (${s.selection[0]})`);
const rowSelected = await page.$eval(`[data-testid=tree-row][data-id="${s.selection[0]}"]`, (el) => el.classList.contains('selected')).catch(() => false);
check(rowSelected, 'viewport selection highlights the hierarchy row');

step('Move / rotate / scale via the properties panel');
await page.click(`[data-testid=tree-row][data-id="${ids[1]}"]`);
const before = (await state(page)).instances.find((i) => i.id === ids[1]);
const othersBefore = (await state(page)).instances.filter((i) => i.id !== ids[1]);
const posX = page.locator('[data-testid=instance-props] .num-field.x input').nth(0);
await posX.fill(String((before.position[0] + 1.5).toFixed(3)));
await posX.press('Enter');
const rotY = page.locator('[data-testid=instance-props] .num-field.y input').nth(1);
await rotY.fill('45');
await rotY.press('Enter');
const scaleX = page.locator('[data-testid=instance-props] .num-field.x input').nth(2);
await scaleX.fill('2');
await scaleX.press('Enter');
s = await state(page);
const after = s.instances.find((i) => i.id === ids[1]);
check(Math.abs(after.position[0] - (before.position[0] + 1.5)) < 1e-3, 'moved +1.5 on X');
check(Math.abs(after.rotation[1] - Math.PI / 4) < 1e-4, 'rotated 45° on Y');
check(after.scale.every((v) => Math.abs(v - 2) < 1e-6), 'scaled uniformly to 2×');
check(JSON.stringify(s.instances.filter((i) => i.id !== ids[1])) === JSON.stringify(othersBefore), 'other models untouched');
const obj = await page.evaluate((id) => {
  const o = window.__workspace.registry.get(id);
  return { p: o.position.toArray(), r: o.rotation.y, s: o.scale.toArray() };
}, ids[1]);
check(Math.abs(obj.r - Math.PI / 4) < 1e-4 && Math.abs(obj.s[0] - 2) < 1e-6, 'rendered object matches the edited transform');

step('Move with the gizmo (mouse drag on the free-move handle)');
await page.click(`[data-testid=tree-row][data-id="${ids[3]}"]`);
await page.keyboard.press('w');
await page.keyboard.press('f');
await page.waitForTimeout(1200);
const g0 = (await state(page)).instances.find((i) => i.id === ids[3]).position;
const c = await screenOf(page, ids[3]);
await page.mouse.move(c.x, c.y);
await page.waitForTimeout(100);
await page.mouse.down();
for (let k = 1; k <= 10; k++) await page.mouse.move(c.x + k * 12, c.y + k * 3);
await page.mouse.up();
await page.waitForTimeout(300);
const g1 = (await state(page)).instances.find((i) => i.id === ids[3]).position;
const moved = Math.hypot(g1[0] - g0[0], g1[1] - g0[1], g1[2] - g0[2]);
check(moved > 0.01, `gizmo drag moved the model (${moved.toFixed(3)} units)`);
check((await state(page)).past > 0, 'gizmo drag recorded an undo step');

step('Rotate & scale with gizmo modes (E / R)');
await page.keyboard.press('e');
check((await page.evaluate(() => window.__workspace.editor.getState().gizmoMode)) === 'rotate', 'E switches to rotate');
await page.keyboard.press('r');
check((await page.evaluate(() => window.__workspace.editor.getState().gizmoMode)) === 'scale', 'R switches to scale');
await page.keyboard.press('w');

step('Undo / redo');
s = await state(page);
const snap = JSON.stringify(s.instances);
await page.keyboard.press('Control+z');
const undone = await state(page);
check(JSON.stringify(undone.instances) !== snap, 'Ctrl+Z reverted the last change');
await page.keyboard.press('Control+Shift+z');
check(JSON.stringify((await state(page)).instances) === snap, 'Ctrl+Shift+Z re-applied it');

step('Duplicate / rename / hide / lock / delete');
await page.click(`[data-testid=tree-row][data-id="${ids[0]}"]`);
await page.keyboard.press('Control+d');
s = await state(page);
check(s.instances.length === 10, 'Ctrl+D duplicated the model');
const dupId = s.selection[0];
await page.fill('[data-testid=props-name]', 'Helmet Copy');
await page.keyboard.press('Enter');
s = await state(page);
check(s.instances.find((i) => i.id === dupId)?.name === 'Helmet Copy', 'renamed via properties');
await page.hover(`[data-testid=tree-row][data-id="${dupId}"]`);
await page.click(`[data-testid=tree-row][data-id="${dupId}"] [data-testid=visibility]`);
s = await state(page);
check(s.instances.find((i) => i.id === dupId)?.visible === false, 'hidden from the hierarchy eye toggle');
check(await page.evaluate((id) => window.__workspace.registry.get(id).visible === false, dupId), 'hidden model not rendered');
await page.click(`[data-testid=tree-row][data-id="${dupId}"] [data-testid=visibility]`);
await page.click(`[data-testid=tree-row][data-id="${ids[4]}"] [data-testid=lock]`);
s = await state(page);
check(s.instances.find((i) => i.id === ids[4])?.locked === true, 'locked from the hierarchy');
const keep = JSON.stringify(s.instances.filter((i) => i.id !== ids[5]));
await page.click(`[data-testid=tree-row][data-id="${ids[5]}"]`);
await page.keyboard.press('Delete');
s = await state(page);
check(s.instances.length === 9 && !s.instances.some((i) => i.id === ids[5]), 'Delete removed the selected model');
check(JSON.stringify(s.instances) === keep, 'deleting one model left all others untouched');
await page.keyboard.press('Control+z');
check((await state(page)).instances.length === 10, 'undo restored the deleted model');
await page.keyboard.press('Control+Shift+z');
await waitLoaded(page, 9);

step('Arrange: place side by side');
await page.keyboard.press('Control+a');
s = await state(page);
check(s.selection.length >= 2, `Ctrl+A selected ${s.selection.length} models`);
await page.click('[data-testid=side-by-side]');
geo = await boxesOverlap(page);
check(geo.overlaps === 0, `side by side: no overlaps (${geo.overlaps})`);
await page.keyboard.press('Escape');

step('Camera views / focus / orbit');
const camPos = () => page.evaluate(() => window.__workspace.viewport.camera.position.toArray());
const views = {};
for (const v of ['front', 'back', 'left', 'right', 'top', 'bottom']) {
  await page.click(`[data-testid=view-${v}]`);
  await page.waitForTimeout(900);
  views[v] = await camPos();
  await page.screenshot({ path: join(SHOTS, `03-view-${v}.png`) });
}
const tgt = await page.evaluate(() => window.__workspace.viewport.controls.getTarget(window.__workspace.viewport.camera.position.clone()).toArray());
const rel = (p) => p.map((v, i) => v - tgt[i]);
check(rel(views.front)[2] > 0 && Math.abs(rel(views.front)[0]) < 1e-2, 'front view looks from +Z');
check(rel(views.back)[2] < 0, 'back view looks from −Z');
check(rel(views.left)[0] < 0 && rel(views.right)[0] > 0, 'left/right views from −X/+X');
check(rel(views.top)[1] > 0 && rel(views.bottom)[1] < 0, 'top/bottom views from +Y/−Y');
await page.click(`[data-testid=tree-row][data-id="${ids[0]}"]`);
await page.click('[data-testid=fit-selected]');
await page.waitForTimeout(1000);
const fitDist = await page.evaluate(() => window.__workspace.viewport.controls.distance);
await page.click('[data-testid=fit-scene]');
await page.waitForTimeout(1000);
const sceneDist = await page.evaluate(() => window.__workspace.viewport.controls.distance);
check(fitDist < sceneDist, `focus on one model is closer than fitting the scene (${fitDist.toFixed(2)} < ${sceneDist.toFixed(2)})`);
// Orbit by dragging in empty space.
const vp = await page.$eval('.viewport-canvas', (e) => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
const az0 = await page.evaluate(() => window.__workspace.viewport.controls.azimuthAngle);
await page.mouse.move(vp.x + vp.w * 0.5, vp.y + vp.h * 0.15);
await page.mouse.down();
await page.mouse.move(vp.x + vp.w * 0.7, vp.y + vp.h * 0.15, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(800);
const az1 = await page.evaluate(() => window.__workspace.viewport.controls.azimuthAngle);
check(Math.abs(az1 - az0) > 0.1, 'mouse drag orbits the camera');
await page.evaluate(() => window.__workspace.viewport.controls.setLookAt(3, 5, 16, 0, 0.6, 0, false));
await page.click('[data-testid=fit-scene]');
await page.waitForTimeout(1200);
await page.keyboard.press('Escape');
await page.screenshot({ path: join(SHOTS, '04-arranged.png') });

step('Floor & grid present');
const floor = await page.evaluate(() => {
  let found = null;
  window.__workspace.viewport.scene.traverse((o) => { if (o.material?.name === 'StudioFloor') found = { visible: o.visible, color: '#' + o.material.color.getHexString(), grid: o.material.userData.uniforms.uGridOpacity.value }; });
  return found;
});
check(!!floor && floor.visible, `brown floor visible (${floor?.color})`);
check(floor?.grid > 0, 'white diagonal grid enabled');

step('Auto-save + save code in Project Settings');
await waitSaved(page);
check(true, 'status reached “Saved ✓”');
await page.click('[data-testid=settings]');
const shownCode = await page.textContent('[data-testid=save-code]');
check(shownCode === saveCode, `settings show save code ${shownCode}`);
await page.keyboard.press('Escape');
const savedState = await state(page);
const savedCamera = await page.evaluate(() => {
  const c = window.__workspace.viewport.controls;
  return { pos: c.getPosition(window.__workspace.viewport.camera.position.clone()).toArray(), tgt: c.getTarget(window.__workspace.viewport.camera.position.clone()).toArray() };
});

step('Close the app and reopen');
check(errors.length === 0, `no uncaught errors so far ${errors.slice(0, 3).join(' | ')}`);
await ctx.close();
({ ctx, page, errors } = await launch());
await page.goto(URL_);
await page.waitForSelector('.project-card:not(.skeleton)');
const card = page.locator('.project-card', { hasText: 'Luxury Cars' });
check(await card.count() === 1, 'project listed on the home screen');
check(/9 models/.test(await card.textContent()), 'card shows the model count');
const thumb = await card.locator('img').getAttribute('src').catch(() => null);
check(!!thumb && thumb.startsWith('data:image/jpeg'), 'card has a captured thumbnail');
check((await card.textContent()).includes(saveCode), 'card shows the save code');
await page.screenshot({ path: join(SHOTS, '05-home-with-project.png') });

step('Search & sort on home');
await page.fill('input[aria-label="Search projects"]', 'nothing-like-this');
check(await page.isVisible('text=No matches'), 'search filters out non-matching projects');
await page.fill('input[aria-label="Search projects"]', 'luxury');
check(await page.locator('.project-card').count() === 1, 'search finds the project by name');
await page.fill('input[aria-label="Search projects"]', '');

step('Open by save code (bad code, then the real one)');
await page.click('[data-testid=open-by-code]');
await page.fill('.modal input', '3D-ZZZZ-ZZZZ');
await page.keyboard.press('Enter');
await page.waitForSelector('.field-error');
check((await page.textContent('.field-error')).includes('Project not found.'), 'unknown code → “Project not found.”');
await page.fill('.modal input', saveCode.toLowerCase().replace(/-/g, ' '));
await page.keyboard.press('Enter');
await page.waitForSelector('.viewport-canvas canvas', { timeout: 30000 });
await waitLoaded(page, 9, 180000);
const restored = await state(page);
const strip = (arr) => JSON.stringify(arr.map(({ id, assetId, name, position, rotation, scale, visible, locked }) => ({ id, assetId, name, position, rotation, scale, visible, locked })));
check(strip(restored.instances) === strip(savedState.instances), 'all instances restored exactly (ids, names, transforms, visibility, lock)');
const restoredCam = await page.evaluate(() => {
  const c = window.__workspace.viewport.controls;
  return { pos: c.getPosition(window.__workspace.viewport.camera.position.clone()).toArray(), tgt: c.getTarget(window.__workspace.viewport.camera.position.clone()).toArray() };
});
const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-3);
check(near(restoredCam.pos, savedCamera.pos) && near(restoredCam.tgt, savedCamera.tgt), 'camera restored');
await page.waitForTimeout(800);
await page.screenshot({ path: join(SHOTS, '06-restored.png') });

step('Corrupted project is reported, not crashed');
await page.click('[data-testid=home]');
await page.waitForSelector('.hero-title');
await page.evaluate(() => new Promise((res) => {
  const req = indexedDB.open('model-workspace');
  req.onsuccess = () => {
    const tx = req.result.transaction('projects', 'readwrite');
    tx.objectStore('projects').put({ id: 'prj_broken', saveCode: '3D-BROK-EN22', name: 'Broken', instances: 'garbage' });
    tx.oncomplete = () => res();
  };
}));
await page.reload();
await page.waitForSelector('.project-card.corrupted');
check(true, 'damaged record shows as a warning card');
await page.click('[data-testid=open-by-code]');
await page.fill('.modal input', '3D-BROK-EN22');
await page.keyboard.press('Enter');
await page.waitForSelector('.field-error');
check((await page.textContent('.field-error')).includes('Unable to load project'), 'damaged project → “Unable to load project.”');
await page.keyboard.press('Escape');

check(errors.length === 0, `no uncaught errors after reopen ${errors.slice(0, 3).join(' | ')}`);
await ctx.close();
console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
