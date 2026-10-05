/**
 * Inspection & productivity tools: view modes, section plane, measuring,
 * isolation, turntable, saved views, notes, command palette, hide-UI,
 * image capture, GLB export, project file export → import, and the
 * performance budget (render passes per frame, on-demand shadows).
 */
import { chromium } from 'playwright';
import { mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
const URL_ = process.env.APP_URL ?? 'http://localhost:5199/';
const SHOTS = resolve(process.env.SHOTS ?? 'test-results');
const FIX = resolve(process.env.FIXTURES ?? 'tests/fixtures');
mkdirSync(SHOTS, { recursive: true });
let failures = 0;
const check = (c, m) => { console.log(`${c ? '  ✓' : '  ✗'} ${m}`); if (!c) failures++; };
const step = (s) => console.log(`\n▶ ${s}`);
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 960 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const S = () => page.evaluate(() => window.__workspace.editor.getState());
const T = () => page.evaluate(() => window.__workspace.tools.getState());
const screenOf = (id, dy = 0) => page.evaluate(([id, dy]) => {
  const { viewport, registry } = window.__workspace;
  const o = registry.get(id);
  const box = new o.position.constructor(); // Vector3
  const b = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  o.updateWorldMatrix(true, true);
  o.traverse((c) => { if (c.isMesh) { c.geometry.computeBoundingBox(); const bb = c.geometry.boundingBox.clone().applyMatrix4(c.matrixWorld); ['x', 'y', 'z'].forEach((k, i) => { b.min[i] = Math.min(b.min[i], bb.min[k]); b.max[i] = Math.max(b.max[i], bb.max[k]); }); } });
  box.set((b.min[0] + b.max[0]) / 2, b.min[1] + (b.max[1] - b.min[1]) * (0.5 + dy), (b.min[2] + b.max[2]) / 2);
  const v = box.project(viewport.camera);
  const r = viewport.gl.domElement.getBoundingClientRect();
  return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
}, [id, dy]);
const firstMeshMat = (id) => page.evaluate((id) => { let m = null; window.__workspace.registry.get(id).traverse((o) => { if (!m && o.isMesh) m = { name: o.material.name, clip: o.material.clippingPlanes?.length ?? 0 }; }); return m; }, id);

await page.goto(URL_);
await page.click('[data-testid=new-project]');
await page.fill('.modal input', 'Tools Lab');
await page.keyboard.press('Enter');
await page.waitForSelector('.viewport-canvas canvas');
await page.waitForFunction(() => !!window.__workspace.viewport.controls);
await page.click('[data-testid=assets-tab]');
for (const a of ['car', 'chair', 'robot']) { await page.click(`[data-asset="builtin:${a}"]`); await page.waitForTimeout(300); }
await page.setInputFiles('[data-testid=file-input]', [join(FIX, 'DamagedHelmet.glb')]);
await page.waitForFunction(() => window.__workspace.editor.getState().instances.length === 4 && !Object.keys(window.__workspace.editor.getState().assetLoad).length, null, { timeout: 90000 });
await page.click('.panel-tab >> text=Scene');
await page.click('[data-testid=fit-scene]');
await page.waitForTimeout(1200);
const ids = (await S()).instances.map((i) => i.id);

step('Performance budget');
await page.evaluate(([a, h]) => { const s = window.__workspace.editor.getState(); s.select([a]); s.setHovered(h); }, [ids[3], ids[0]]);
await page.waitForTimeout(500);
const perf = await page.evaluate(() => new Promise((res) => {
  const { viewport } = window.__workspace; const gl = viewport.gl; const orig = gl.render.bind(gl);
  let scenes = 0, all = 0, shadowRenders = 0;
  gl.render = (sc, cam) => { all++; if (sc === viewport.scene && !sc.overrideMaterial) scenes++; return orig(sc, cam); };
  const sm = gl.shadowMap; const origSm = sm.render.bind(sm); sm.render = (...a) => { if (sm.needsUpdate || sm.autoUpdate) shadowRenders++; return origSm(...a); };
  let n = 0;
  (function tick() { viewport.controls.rotate(0.01, 0, false); viewport.invalidate(); if (++n < 12) requestAnimationFrame(tick); else setTimeout(() => { gl.render = orig; sm.render = origSm; res({ perFrame: all / Math.max(1, scenes), scenes, shadowRenders, auto: sm.autoUpdate }); }, 400); })();
}));
check(perf.perFrame <= 6, `render passes per frame with selection + hover: ${perf.perFrame.toFixed(1)} (was 20)`);
check(perf.auto === false && perf.shadowRenders <= 2, `shadows not re-rendered while only the camera moves (${perf.shadowRenders} shadow renders over ${perf.scenes} frames)`);
await page.evaluate(() => window.__workspace.editor.getState().setHovered(null));

step('View modes');
for (const [btn, name] of [['Clay', 'Clay'], ['Wire', 'Wireframe'], ['X-Ray', 'X-Ray'], ['Normals', 'Normals']]) {
  await page.click(`.vp-bar .segmented button:has-text("${btn}")`);
  await page.waitForTimeout(150);
  check((await firstMeshMat(ids[3])).name === name, `${btn} mode swaps model materials`);
}
await page.screenshot({ path: join(SHOTS, '20-view-normals.png') });
await page.click('.vp-bar .segmented button:has-text("Shaded")');
await page.waitForTimeout(150);
check((await firstMeshMat(ids[3])).name !== 'Normals' && (await firstMeshMat(ids[3])).name !== 'Clay', 'Shaded restores the original materials');
await page.keyboard.press('v');
check((await T()).viewMode === 'clay', 'V cycles view modes');
await page.keyboard.press('Shift+V');

step('Section plane');
await page.click('[data-testid=tool-section]');
await page.waitForSelector('[data-testid=section-panel]');
await page.waitForTimeout(200);
check((await firstMeshMat(ids[3])).clip === 1, 'section clips model materials');
await page.click('[data-testid=section-panel] .segmented button:has-text("Y")');
await page.waitForTimeout(500);
await page.screenshot({ path: join(SHOTS, '21-section.png') });
const floorClip = await page.evaluate(() => { let c = 0; window.__workspace.viewport.scene.traverse((o) => { if (o.material?.name === 'StudioFloor') c = o.material.clippingPlanes?.length ?? 0; }); return c; });
check(floorClip === 0, 'the floor is never clipped');
await page.keyboard.press('c');
await page.waitForTimeout(150);
check((await firstMeshMat(ids[3])).clip === 0, 'C turns the section off and restores materials');

step('Measure');
const selBefore = (await S()).selection;
await page.keyboard.press('m');
check((await T()).measuring, 'M enters measuring');
const p1 = await screenOf(ids[0]);
const p2 = await screenOf(ids[3]);
await page.mouse.click(p1.x, p1.y);
await page.waitForTimeout(250);
await page.mouse.click(p2.x, p2.y);
await page.waitForTimeout(400);
let t = await T();
check(t.measurements.length === 1, 'two clicks make a measurement');
const sel = (await S()).selection;
check(JSON.stringify(sel) === JSON.stringify(selBefore), 'clicking models while measuring does not change the selection');
const d = Math.hypot(...[0, 1, 2].map((k) => t.measurements[0].a[k] - t.measurements[0].b[k]));
check(d > 0.5, `distance is measured (${d.toFixed(2)} m)`);
check(await page.isVisible('[data-testid=measure-label]'), 'distance label shown in the 3D view');
check(await page.isVisible('[data-testid=measure-panel]'), 'measurements panel lists it');
await page.screenshot({ path: join(SHOTS, '22-measure.png') });
// a point on the floor
const vp = await page.$eval('.viewport-canvas', (e) => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
await page.mouse.click(vp.x + vp.w * 0.5, vp.y + vp.h * 0.9);
await page.waitForTimeout(200);
check((await T()).pending && Math.abs((await T()).pending[1]) < 1e-6, 'clicking empty floor picks a floor point (y = 0)');
await page.keyboard.press('Escape');
check(!(await T()).measuring, 'Esc stops measuring');

step('Isolate');
await page.click(`[data-testid=tree-row][data-id="${ids[1]}"]`);
await page.keyboard.press('i');
await page.waitForTimeout(200);
const vis = await page.evaluate((ids) => ids.map((id) => window.__workspace.registry.get(id).visible), ids);
check(vis[1] && !vis[0] && !vis[2] && !vis[3], 'I isolates the selection');
check(await page.isVisible('[data-testid=isolation-banner]'), 'isolation banner shown');
check((await S()).instances.every((i) => i.visible), 'saved visibility untouched');
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
check(await page.evaluate((ids) => ids.every((id) => window.__workspace.registry.get(id).visible), ids), 'Esc exits isolation');

step('Turntable');
const az0 = await page.evaluate(() => window.__workspace.viewport.controls.azimuthAngle);
await page.keyboard.press('t');
await page.waitForTimeout(2500);
const az1 = await page.evaluate(() => window.__workspace.viewport.controls.azimuthAngle);
check(Math.abs(az1 - az0) > 0.01, 'turntable orbits the camera');
await page.keyboard.press('t');

step('Saved views');
await page.click('[data-testid=view-front]');
await page.waitForTimeout(1000);
await page.click('[data-testid=views-menu]');
await page.fill('[data-testid=views-pop] input', 'Front hero');
await page.click('[data-testid=save-view]');
const camAt = () => page.evaluate(() => window.__workspace.viewport.controls.getPosition(window.__workspace.viewport.camera.position.clone(), true).toArray());
const saved = await camAt();
check((await S()).views.length === 1 && (await S()).views[0].name === 'Front hero', 'view saved with its name');
await page.keyboard.press('Escape');
await page.click('[data-testid=view-top]');
await page.waitForTimeout(1000);
await page.click('[data-testid=views-menu]');
await page.click('[data-testid=view-item]');
await page.waitForTimeout(1200);
const back = await camAt();
check(back.every((v, i) => Math.abs(v - saved[i]) < 1e-3), 'clicking the view returns the camera there');
await page.mouse.click(vp.x + 30, vp.y + vp.h - 30);

step('Notes');
await page.click(`[data-testid=tree-row][data-id="${ids[3]}"]`);
await page.click('.section-head:has-text("Notes")').catch(() => {});
await page.fill('[data-testid=notes]', 'Khronos sample, CC-BY. Check emissive.');
await page.click('[data-testid=props-name]');
await page.evaluate(() => document.activeElement.blur());
check((await S()).instances.find((i) => i.id === ids[3]).notes === 'Khronos sample, CC-BY. Check emissive.', 'notes saved on the model');
await page.keyboard.press('Control+z');
check(!(await S()).instances.find((i) => i.id === ids[3]).notes, 'notes edit is undoable');
await page.keyboard.press('Control+Shift+z');

step('Command palette');
await page.click('.viewport-canvas', { position: { x: 20, y: vp.h - 20 } });
await page.keyboard.press('Control+k');
await page.waitForSelector('[data-testid=palette] input:focus');
await page.keyboard.type('wire');
await page.keyboard.press('Enter');
await page.waitForTimeout(150);
check((await T()).viewMode === 'wireframe', 'palette: “wire” + Enter switches to wireframe');
await page.keyboard.press('Control+k');
await page.waitForSelector('[data-testid=palette] input:focus');
await page.keyboard.type('robot');
await page.keyboard.press('Enter');
await page.waitForTimeout(300);
check((await S()).selection[0] === ids[2], 'palette: typing a model name selects it');
await page.keyboard.press('v');
await page.keyboard.press('Shift+V');
await page.evaluate(() => window.__workspace.tools.getState().setViewMode('shaded'));

step('Hide UI');
await page.keyboard.press('Tab');
check(!(await page.isVisible('.panel.left')) && !(await page.isVisible('.panel.right')), 'Tab hides both panels');
await page.keyboard.press('Tab');
check(await page.isVisible('.panel.left'), 'Tab brings them back');

step('Capture image');
await page.keyboard.press('Escape');
await page.click('[data-testid=tool-capture]');
await page.click('.capture-opt:has-text("Full HD")');
const [img] = await Promise.all([page.waitForEvent('download'), page.click('[data-testid=capture-go]')]);
const imgPath = join(SHOTS, 'capture.png');
await img.saveAs(imgPath);
const png = readFileSync(imgPath);
const w = png.readUInt32BE(16), h = png.readUInt32BE(20);
check(png.slice(1, 4).toString() === 'PNG' && w === 1920 && h === 1080, `PNG downloaded at ${w}×${h}`);
const live = await page.evaluate(() => { const c = window.__workspace.viewport.gl.domElement; return { w: c.width, expected: Math.round(c.clientWidth * window.__workspace.viewport.gl.getPixelRatio()) }; });
check(live.w === live.expected, `viewport restored to its own size afterwards (${live.w}px)`);

step('Export GLB');
await page.click(`[data-testid=tree-row][data-id="${ids[3]}"]`);
const [glb] = await Promise.all([page.waitForEvent('download'), page.click('[data-testid=props-export]')]);
const glbPath = join(SHOTS, 'export.glb');
await glb.saveAs(glbPath);
const g = readFileSync(glbPath);
check(g.slice(0, 4).toString() === 'glTF' && g.length > 100000, `GLB exported (${(g.length / 1e6).toFixed(1)} MB, textures included)`);

step('Project file export → import');
await page.click('[data-testid=settings]');
const [pf] = await Promise.all([page.waitForEvent('download'), page.click('[data-testid=export-project]')]);
const pfPath = join(SHOTS, 'Tools Lab.3dws');
await pf.saveAs(pfPath);
check(readFileSync(pfPath).slice(0, 4).toString() === '3DWS', `project file written (${(readFileSync(pfPath).length / 1e6).toFixed(1)} MB)`);
await page.keyboard.press('Escape');
await page.click('[data-testid=home]');
await page.waitForSelector('.project-card:not(.skeleton)');
await page.setInputFiles('[data-testid=import-project-input]', pfPath);
await page.waitForSelector('.project-card:has-text("Tools Lab (imported)")', { timeout: 20000 });
const cards = await page.locator('.project-card').allTextContents();
check(cards.length === 2, 'imported as a second project (never overwrites)');
await page.click('.project-card:has-text("Tools Lab (imported)")');
await page.waitForFunction(() => window.__workspace.editor.getState().instances.length === 4 && !Object.keys(window.__workspace.editor.getState().assetLoad).length, null, { timeout: 60000 });
const imp = await S();
check(imp.instances.find((i) => i.name === 'DamagedHelmet') && imp.views.length === 1, 'imported project has its models, notes and saved views');
check(imp.instances.some((i) => i.notes?.includes('Khronos')), 'notes survived the round trip');
await page.waitForTimeout(800);
await page.screenshot({ path: join(SHOTS, '23-imported.png') });

check(errors.length === 0, `no console errors ${errors.slice(0, 3).join(' | ')}`);
await browser.close();
console.log(failures ? `\n${failures} FAILED` : '\nAll tool checks passed');
process.exit(failures ? 1 : 0);
