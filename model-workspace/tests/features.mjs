/** Secondary checks: samples, animation, ortho, quality modes, environments, project management. */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
const URL_ = process.env.APP_URL ?? 'http://localhost:5199/';
const SHOTS = resolve(process.env.SHOTS ?? 'test-results');
mkdirSync(SHOTS, { recursive: true });
let failures = 0;
const check = (c, m) => { console.log(`${c ? '  ✓' : '  ✗'} ${m}`); if (!c) failures++; };
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 960 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const S = () => page.evaluate(() => window.__workspace.editor.getState());

await page.goto(URL_);
await page.click('[data-testid=new-project]');
await page.fill('.modal input', 'Showroom');
await page.keyboard.press('Enter');
await page.waitForSelector('.viewport-canvas canvas');
await page.waitForFunction(() => !!window.__workspace.viewport.controls);

console.log('▶ Asset library samples');
await page.click('[data-testid=assets-tab]');
for (const a of ['car', 'chair', 'table', 'robot', 'lamp', 'spheres']) {
  await page.click(`[data-asset="builtin:${a}"]`);
  await page.waitForFunction((n) => window.__workspace.editor.getState().instances.length === n, ['car', 'chair', 'table', 'robot', 'lamp', 'spheres'].indexOf(a) + 1);
}
await page.click(`[data-asset="builtin:chair"]`);
await page.waitForFunction(() => window.__workspace.editor.getState().instances.length === 7);
const st = await S();
check(st.instances.filter((i) => i.assetId === 'builtin:chair').length === 2, 'same asset added twice (instancing)');
check(st.instances.some((i) => i.name === 'Chair (2)'), 'second instance gets a unique name');

console.log('▶ Animation playback');
const robot = st.instances.find((i) => i.assetId === 'builtin:robot');
await page.click('.panel-tab >> text=Scene');
await page.click(`[data-testid=tree-row][data-id="${robot.id}"]`);
await page.click('button[aria-label="Play"]');
const armBefore = await page.evaluate((id) => { let q; window.__workspace.registry.get(id).traverse((o) => { if (o.name === 'ArmL') q = o.quaternion.toArray(); }); return q; }, robot.id);
await page.waitForTimeout(1500);
const armAfter = await page.evaluate((id) => { let q; window.__workspace.registry.get(id).traverse((o) => { if (o.name === 'ArmL') q = o.quaternion.toArray(); }); return q; }, robot.id);
check(JSON.stringify(armBefore) !== JSON.stringify(armAfter), 'robot animation plays (arm moves)');
check((await S()).instances.find((i) => i.id === robot.id).animation.playing === true, 'playing state stored in the project');
await page.click('[data-testid=fit-scene]');
await page.waitForTimeout(1500);
await page.screenshot({ path: join(SHOTS, '10-samples.png') });

console.log('▶ Orthographic camera');
await page.keyboard.press('Escape');
await page.click('text=Ortho');
await page.waitForTimeout(600);
check(await page.evaluate(() => window.__workspace.viewport.camera.isOrthographicCamera === true), 'ortho camera active');
await page.click('[data-testid=view-top]');
await page.waitForTimeout(1200);
await page.screenshot({ path: join(SHOTS, '11-ortho-top.png') });
await page.click('text=Persp');
await page.waitForTimeout(600);
check(await page.evaluate(() => window.__workspace.viewport.camera.isPerspectiveCamera === true), 'back to perspective');

console.log('▶ Quality modes & environments');
for (const q of ['Ultra', 'Performance', 'Balanced']) {
  await page.click(`.bottombar .segmented button:has-text("${q}")`);
  await page.waitForTimeout(1200);
  check((await S()).settings.quality === q.toLowerCase(), `${q} mode applied`);
  if (q === 'Ultra') {
    await page.click('[data-testid=fit-scene]');
    await page.waitForTimeout(1500);
    await page.screenshot({ path: join(SHOTS, '12-ultra.png') });
  }
}
for (const e of ['Cool', 'Overcast', 'Studio']) {
  await page.click(`[data-testid=scene-props] .segmented button:has-text("${e}")`);
  await page.waitForTimeout(500);
}
check((await S()).settings.environment.preset === 'studio', 'environment presets switch');
await page.keyboard.press('Control+z');
check((await S()).settings.environment.preset === 'soft', 'scene setting changes are undoable');
await page.keyboard.press('Control+Shift+z');

console.log('▶ Project settings: rename, duplicate, delete');
await page.click('[data-testid=settings]');
const nameInput = page.locator('[data-testid=project-settings] input[aria-label="Project name"]');
await nameInput.fill('Showroom Final');
await nameInput.press('Enter');
check((await S()).project.name === 'Showroom Final', 'renamed from settings');
const code1 = await page.textContent('[data-testid=save-code]');
await page.click('button:has-text("Duplicate project")');
await page.waitForFunction((c) => window.__workspace.editor.getState().project?.saveCode && window.__workspace.editor.getState().project.saveCode !== c, code1, { timeout: 20000 });
const dup = await S();
check(dup.project.name === 'Showroom Final (copy)' && dup.project.saveCode !== code1, `duplicate opened with a new save code (${dup.project.saveCode})`);
await page.waitForFunction(() => window.__workspace.editor.getState().instances.length === 7);
await page.click('[data-testid=settings]');
await page.click('button:has-text("Delete project")');
await page.click('.modal .btn-danger');
await page.waitForSelector('.hero-title');
const cards = await page.locator('.project-card').allTextContents();
check(cards.length === 1 && cards[0].includes('Showroom Final'), 'copy deleted after confirmation, original remains');
await page.screenshot({ path: join(SHOTS, '13-home.png') });

console.log('▶ Rename & delete from the home screen');
await page.click('.pc-menu');
await page.click('.menu-item:has-text("Rename")');
await page.fill('.modal input', 'Renamed Showroom');
await page.keyboard.press('Enter');
await page.waitForSelector('.project-card:has-text("Renamed Showroom")');
check(true, 'renamed from the card menu');
await page.click('.pc-menu');
await page.click('.menu-item:has-text("Delete")');
check(await page.isVisible('text=can’t be undone'), 'delete asks for confirmation');
await page.click('.modal .btn-danger');
await page.waitForSelector('.empty');
check(true, 'project deleted');

check(errors.length === 0, `no console errors ${errors.slice(0, 3).join(' | ')}`);
await browser.close();
console.log(failures ? `${failures} FAILED` : 'All feature checks passed');
process.exit(failures ? 1 : 0);
