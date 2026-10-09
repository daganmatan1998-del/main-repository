import { sound } from '../audio/sfx';
import { speaker } from '../audio/tts';
import type { LanguageCode } from '../content/types';
import { stringsFor, t } from '../i18n/strings';
import { averageReadingMs, isMastered, recentAccuracy, transferRate, weakSkills } from '../learning/learner';
import { clearProfile, newProfile } from '../progress/profile';
import { ACHIEVEMENTS, buy, DAILY_REWARD, ensureDaily, equip, SHOP, shopColor } from '../progress/rewards';
import type { ProviderChoice } from '../speech/providerFactory';
import type { App } from './app';
import { drawCastle } from '../game/art';
import { el, icon, starsRow, toast } from './dom';

/* ================================================================ helpers */

function topbar(app: App, title: string, back: () => void): HTMLElement {
  const b = el('button', { class: 'btn btn-icon', 'aria-label': t('back'), 'data-testid': 'back' }, icon('back'));
  if (app.pack.dir === 'rtl') b.style.transform = 'scaleX(-1)';
  b.addEventListener('click', () => { sound.play('tap'); back(); });
  return el('div', { class: 'topbar' }, b, el('h2', {}, title), coinsPill(app));
}

function coinsPill(app: App): HTMLElement {
  return el('span', { class: 'pill', 'aria-label': `${t('coins')}: ${app.profile.coins}`, 'data-testid': 'coins' }, icon('coin'), String(app.profile.coins));
}

function modal(app: App, ...children: Array<Node | string>): { back: HTMLElement; close: () => void } {
  const back = el('div', { class: 'modal-back' });
  const m = el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' }, ...children);
  back.append(m);
  app.layer.append(back);
  return { back, close: () => back.remove() };
}

/* ============================================================ language */

export function languageScreen(app: App): void {
  const s = el('div', { class: 'screen dim', 'data-testid': 'screen-language' });
  const card = (lang: LanguageCode, sample: string, name: string) => {
    const b = el('button', { class: 'lang-card', lang, 'data-testid': `lang-${lang}` },
      el('span', { class: `sample ${lang}`, dir: lang === 'he' ? 'rtl' : 'ltr' }, sample),
      el('span', { class: 'name' }, name));
    b.addEventListener('click', () => {
      sound.unlock();
      sound.play('tap');
      app.setLanguage(lang);
      app.show('home');
    });
    return b;
  };
  s.append(
    el('div', { class: 'logo' }, el('h1', {}, 'Read ', el('span', { class: 'amp' }, '&'), ' Defend'), el('p', {}, 'קוֹרְאִים וּמְגִנִּים')),
    el('div', { class: 'center-col' },
      el('div', { class: 'panel', style: 'text-align:center' },
        el('h3', { lang: 'en' }, stringsFor('en').chooseLanguage),
        el('h3', { lang: 'he', dir: 'rtl' }, stringsFor('he').chooseLanguage)),
      el('div', { class: 'lang-cards' }, card('en', 'Aa', 'English'), card('he', 'אָ', 'עִבְרִית'))),
  );
  app.layer.append(s);
}

/* ================================================================ home */

export function homeScreen(app: App): void {
  const s = el('div', { class: 'screen', 'data-testid': 'screen-home' });
  const settingsBtn = el('button', { class: 'btn btn-icon btn-ghost', 'aria-label': t('settings'), 'data-testid': 'open-settings' }, icon('gear'));
  settingsBtn.addEventListener('click', () => grownUpGate(app, () => app.show('settings')));
  const langBtn = el('button', { class: 'btn btn-ghost', 'aria-label': t('switchLanguage'), 'data-testid': 'switch-lang' }, app.lang === 'he' ? 'English' : 'עברית');
  langBtn.addEventListener('click', () => { app.setLanguage(app.lang === 'he' ? 'en' : 'he'); app.show('home'); });
  s.append(el('div', { class: 'home-top' }, coinsPill(app), el('div', { style: 'display:flex;gap:8px' }, langBtn, settingsBtn)));

  s.append(el('div', { class: 'logo' }, el('h1', {}, t('appName')), el('p', {}, t('tagline'))));

  const lp = app.progress;
  const actions = el('div', { class: 'home-actions' });
  const daily = ensureDaily(lp);
  const dailyBox = el('div', { class: 'daily', 'data-testid': 'daily' });
  const goalText = stringsFor(app.lang).dailyGoal[daily.goal].replace('{n}', String(daily.target));
  const done = daily.progress >= daily.target;
  dailyBox.append(icon('star'), el('div', { class: 'meter' },
    el('small', {}, t('dailyTitle')), el('div', {}, goalText),
    el('div', { class: 'bar' }, el('i', { style: `width:${Math.min(100, (daily.progress / daily.target) * 100)}%` }))));
  if (done && !daily.claimed) {
    const claim = el('button', { class: 'btn btn-gold' }, t('claim'));
    claim.addEventListener('click', () => {
      daily.claimed = true;
      app.profile.coins += DAILY_REWARD;
      app.save();
      sound.play('coin');
      toast(t('dailyDone', { n: DAILY_REWARD }), 'good');
      app.show('home');
    });
    dailyBox.append(claim);
  } else if (daily.claimed) {
    const ok = icon('check');
    ok.setAttribute('style', 'width:32px;height:32px;color:var(--good)');
    dailyBox.append(ok);
  }
  (dailyBox.firstChild as SVGElement).setAttribute('style', 'width:36px;height:36px');

  const play = el('button', { class: 'btn btn-gold btn-big', 'data-testid': 'play' }, icon('play'), lp.tutorialDone ? t('continue') : t('play'));
  play.addEventListener('click', () => {
    sound.unlock();
    sound.play('tap');
    if (!lp.tutorialDone) app.startLevel(app.levels[0], { tutorial: true });
    else app.startLevel(app.levels[app.nextLevelIndex()]);
  });
  const row = el('div', { class: 'home-row' });
  const nav = (label: string, ic: Parameters<typeof icon>[0], to: 'map' | 'shop' | 'progress', id: string) => {
    const b = el('button', { class: 'btn', 'data-testid': id }, icon(ic), label);
    b.addEventListener('click', () => { sound.play('tap'); app.show(to); });
    row.append(b);
  };
  nav(t('map'), 'map', 'map', 'open-map');
  nav(t('castle'), 'castle', 'shop', 'open-shop');
  nav(t('progress'), 'chart', 'progress', 'open-progress');
  actions.append(play, row, dailyBox);
  s.append(actions);
  app.layer.append(s);
  if (app.profile.settings.voiceHints && !lp.tutorialDone) speaker.speak(t('tagline'), app.pack.speechLang, 0.95);
}

/* ================================================================= map */

export function mapScreen(app: App): void {
  const s = el('div', { class: 'screen dim', 'data-testid': 'screen-map' });
  s.append(topbar(app, t('map'), () => app.show('home')));
  const levels = app.levels;
  const next = app.nextLevelIndex();
  const lp = app.progress;
  const weak = new Set(weakSkills(lp.learner));
  // Recommend revisiting the earliest unit that introduced a weak skill.
  const reviewUnit = app.pack.units.findIndex((u) => u.newSkills.some((k) => weak.has(k)));
  const byStage = new Map<number, typeof levels>();
  levels.forEach((l) => byStage.set(l.stage, [...(byStage.get(l.stage) ?? []), l]));
  for (const [stage, ls] of byStage) {
    const world = el('section', { class: 'world' });
    world.append(el('div', { class: 'world-head' }, el('span', { class: 'chip' }, `${t('stage')} ${stage}`), el('h3', {}, stringsFor(app.lang).stageNames[stage])));
    const grid = el('div', { class: 'levels' });
    for (const l of ls) {
      const idx = levels.indexOf(l);
      const unlocked = app.isUnlocked(idx);
      const rec = lp.levels[l.id];
      const unit = app.pack.units[l.unitIndex];
      const node = el('button', {
        class: `level-node ${unlocked ? '' : 'locked'} ${idx === next ? 'next' : ''} ${l.boss ? 'boss' : ''}`,
        'aria-label': `${t('level')} ${l.number}${unlocked ? '' : ` — ${t('locked')}`}${rec?.stars ? `, ${rec.stars} ${t('stars')}` : ''}`,
        'data-testid': `level-${l.number}`,
        disabled: !unlocked,
      });
      if (unlocked) {
        node.append(el('span', { class: 'num' }, String(l.number)), el('span', { class: 'sub' }, unit.title[app.lang]), starsRow(rec?.stars ?? 0));
        if (idx === next) node.append(el('span', { class: 'tag next-tag' }, t('play')));
        else if (l.unitIndex === reviewUnit && !l.boss && (rec?.wins ?? 0) > 0) node.append(el('span', { class: 'tag' }, t('practiceSuggest')));
        if (l.boss) node.append(el('span', { class: 'boss-badge' }, icon('troll')));
        node.addEventListener('click', () => { sound.play('tap'); app.startLevel(l); });
      } else {
        node.append(icon('lock', 'lock'), el('span', { class: 'sub' }, `${t('level')} ${l.number}`));
      }
      grid.append(node);
    }
    world.append(grid);
    s.append(world);
  }
  app.layer.append(s);
  requestAnimationFrame(() => s.querySelector('.level-node.next')?.scrollIntoView({ block: 'center' }));
}

/* ================================================================ shop */

export function shopScreen(app: App): void {
  const s = el('div', { class: 'screen dim', 'data-testid': 'screen-shop' });
  s.append(topbar(app, t('shop'), () => app.show('home')));
  const col = el('div', { class: 'center-col', style: 'margin-top:0' });
  const preview = el('canvas', { class: 'castle-preview', 'aria-hidden': 'true' }) as HTMLCanvasElement;
  col.append(preview);
  const drawPreview = () => {
    const r = preview.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    preview.width = r.width * dpr; preview.height = r.height * dpr;
    const ctx = preview.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    const g = ctx.createLinearGradient(0, 0, 0, r.height);
    g.addColorStop(0, '#7ec8f2'); g.addColorStop(1, '#fff4d6');
    ctx.fillStyle = g; ctx.fillRect(0, 0, r.width, r.height);
    ctx.fillStyle = '#6cc46a'; ctx.fillRect(0, r.height * 0.82, r.width, r.height);
    drawCastle(ctx, r.width / 2, r.height * 0.88, r.height / 95, {
      walls: shopColor(app.profile.equipped.walls), banner: shopColor(app.profile.equipped.banner), hp: 1, t: 0.4,
      charging: true, magic: shopColor(app.profile.equipped.magic), mirror: app.pack.dir === 'rtl',
    });
  };
  for (const slot of ['banner', 'walls', 'magic'] as const) {
    const panel = el('div', { class: 'panel' }, el('h3', {}, t(slot === 'banner' ? 'banners' : slot)));
    const grid = el('div', { class: 'shop-grid' });
    for (const it of SHOP.filter((x) => x.slot === slot)) {
      const owned = app.profile.owned.includes(it.id);
      const equipped = app.profile.equipped[slot] === it.id;
      const sw = el('span', { class: 'swatch' });
      sw.style.background = it.color === 'rainbow' ? 'linear-gradient(135deg,#ff595e,#ffca3a,#8ac926,#1982c4,#6a4c93)' : it.color;
      const btn = el('button', { class: `btn ${equipped ? '' : owned ? 'btn-blue' : 'btn-gold'}`, disabled: equipped || (!owned && app.profile.coins < it.price) },
        equipped ? t('equipped') : owned ? t('equip') : el('span', { style: 'display:inline-flex;gap:4px;align-items:center' }, icon('coin'), String(it.price)));
      btn.addEventListener('click', () => {
        if (owned) equip(app.profile, it.id);
        else if (buy(app.profile, it.id)) sound.play('coin');
        app.save();
        app.applyDocumentSettings();
        app.show('shop');
      });
      grid.append(el('div', { class: 'shop-item' }, sw, el('span', {}, it.name[app.lang]), btn));
    }
    panel.append(grid);
    col.append(panel);
  }
  s.append(col);
  app.layer.append(s);
  requestAnimationFrame(drawPreview);
}

/* ============================================================ progress */

export function progressScreen(app: App): void {
  const s = el('div', { class: 'screen dim', 'data-testid': 'screen-progress' });
  s.append(topbar(app, t('progress'), () => app.show('home')));
  const col = el('div', { class: 'center-col', style: 'margin-top:0' });
  const lp = app.progress;
  const L = lp.learner;
  const pct = (x?: number) => (x === undefined ? '—' : `${Math.round(x * 100)}%`);
  const ms = averageReadingMs(L);
  const stats = el('div', { class: 'stat-grid' },
    el('div', { class: 'stat' }, el('b', {}, String(L.mastered.filter((k) => isMastered(L, k)).length)), el('span', {}, t('skillsMastered'))),
    el('div', { class: 'stat' }, el('b', {}, String(Object.values(L.items).filter((i) => i.solved > 0).length)), el('span', {}, t('wordsRead'))),
    el('div', { class: 'stat' }, el('b', {}, pct(transferRate(L))), el('span', {}, t('transferRate'))),
    el('div', { class: 'stat' }, el('b', {}, pct(recentAccuracy(L))), el('span', {}, t('accuracy'))),
    el('div', { class: 'stat' }, el('b', {}, ms ? `${(ms / 1000).toFixed(1)}s` : '—'), el('span', {}, t('readingSpeed'))),
  );
  col.append(el('div', { class: 'panel' }, stats));

  // Skills, unit by unit. State is shown by icon + text, not colour alone.
  const skillsPanel = el('div', { class: 'panel' }, el('h3', {}, t('skillsMastered')));
  skillsPanel.append(el('div', { class: 'legend' },
    el('span', {}, icon('check'), app.lang === 'he' ? 'נרכש' : 'mastered'),
    el('span', {}, icon('alert'), app.lang === 'he' ? 'לתרגול' : 'practise'),
    el('span', {}, icon('ring'), app.lang === 'he' ? 'בלמידה' : 'learning')));
  const grid = el('div', { class: 'skills-grid', lang: app.lang });
  const weak = new Set(weakSkills(L));
  for (const u of app.pack.units) {
    for (const k of u.newSkills) {
      const sk = app.pack.skills[k];
      const st = L.skills[k];
      if (!sk || !st) continue;
      const mastered = isMastered(L, k);
      const isWeak = weak.has(k);
      grid.append(el('span', { class: `skill ${mastered ? 'mastered' : isWeak ? 'weak' : ''}`, lang: app.lang, title: sk.label },
        icon(mastered ? 'check' : isWeak ? 'alert' : 'ring'), el('span', { class: 'g', dir: app.pack.dir }, sk.display)));
    }
  }
  if (!grid.childElementCount) grid.append(el('span', {}, '—'));
  skillsPanel.append(grid);
  col.append(skillsPanel);

  const weakPanel = el('div', { class: 'panel' }, el('h3', {}, t('needsPractice')));
  const wl = weakSkills(L).slice(0, 8).map((k) => app.pack.skills[k]).filter(Boolean);
  weakPanel.append(wl.length
    ? el('div', { class: 'skills-grid' }, ...wl.map((sk) => el('span', { class: 'skill weak', lang: app.lang }, icon('alert'), el('span', { class: 'g', dir: app.pack.dir }, sk.display), el('small', {}, sk.label))))
    : el('p', {}, t('allGood')));
  col.append(weakPanel);

  const ach = el('div', { class: 'panel' }, el('h3', {}, t('achievements')));
  for (const a of ACHIEVEMENTS) {
    const got = !!app.profile.achievements[`${app.lang}:${a.id}`];
    const row = el('div', { class: 'achv', style: got ? '' : 'opacity:.45;background:#eee' }, icon(got ? (a.icon === 'star' ? 'star' : a.icon) : 'lock'), a.title[app.lang]);
    ach.append(row);
  }
  col.append(ach);
  const note = el('p', { style: 'color:#fff;text-align:center' }, t('privacyNote'));
  col.append(note);
  if (lp.stats.simulatedReadings > 0) col.append(el('p', { style: 'color:#ffe066;text-align:center;font-weight:700' }, t('simulatedNote', { n: lp.stats.simulatedReadings })));
  s.append(col);
  app.layer.append(s);
}

/* ============================================================ settings */

/** Grown-up gate: press and hold for three seconds. Simple, no reading needed by adults, hard for small children by accident. */
export function grownUpGate(app: App, onPass: () => void): void {
  const btn = el('button', { class: 'btn btn-gold btn-big gate-btn', 'data-testid': 'gate' }, el('span', { class: 'fill' }), el('span', { style: 'position:relative' }, t('gateQ')));
  const cancel = el('button', { class: 'btn' }, t('close'));
  const { close } = modal(app, el('h2', {}, t('grownUps')), btn, cancel);
  cancel.addEventListener('click', close);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const fill = btn.querySelector('.fill') as HTMLElement;
  const start = (e: Event) => {
    e.preventDefault();
    fill.style.transition = 'transform 3s linear';
    fill.style.transform = 'scaleX(1)';
    timer = setTimeout(() => { close(); onPass(); }, 3000);
  };
  const stop = () => {
    if (timer) clearTimeout(timer);
    fill.style.transition = 'transform 200ms';
    fill.style.transform = 'scaleX(0)';
  };
  btn.addEventListener('pointerdown', start);
  btn.addEventListener('pointerup', stop);
  btn.addEventListener('pointerleave', stop);
  btn.addEventListener('pointercancel', stop);
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
}

export function settingsScreen(app: App): void {
  const s = el('div', { class: 'screen dim', 'data-testid': 'screen-settings' });
  s.append(topbar(app, t('settings'), () => app.show('home')));
  const col = el('div', { class: 'center-col', style: 'margin-top:0' });
  const st = app.profile.settings;
  const refresh = () => { app.save(); app.applyDocumentSettings(); app.show('settings'); };

  const seg = <T extends string>(label: string, value: T, options: Array<[T, string]>, set: (v: T) => void, id: string) => {
    const g = el('div', { class: 'seg', role: 'group', 'aria-label': label });
    for (const [v, l] of options) {
      const b = el('button', { 'aria-pressed': String(v === value), 'data-testid': `${id}-${v}` }, l);
      b.addEventListener('click', () => { set(v); refresh(); });
      g.append(b);
    }
    return el('div', { class: 'setting' }, el('span', { class: 'lbl' }, label), g);
  };
  const toggle = (label: string, value: boolean, set: (v: boolean) => void, id: string) =>
    seg(label, value ? 'on' : 'off', [['on', t('on')], ['off', t('off')]], (v) => set(v === 'on'), id);

  const child = el('div', { class: 'panel' });
  child.append(
    seg(t('pace'), st.pace, [['slow', t('paceSlow')], ['normal', t('paceNormal')], ['fast', t('paceFast')]], (v) => { st.pace = v; }, 'pace'),
    seg(t('micMode'), st.micMode, [['hold', t('micHold')], ['tap', t('micTap')]], (v) => { st.micMode = v; }, 'mic'),
    toggle(t('soundFx'), st.sound, (v) => { st.sound = v; }, 'sound'),
    toggle(t('voiceHints'), st.voiceHints, (v) => { st.voiceHints = v; }, 'voice'),
    toggle(t('bigText'), st.bigText, (v) => { st.bigText = v; }, 'bigtext'),
    toggle(t('reducedMotion'), st.reducedMotion, (v) => { st.reducedMotion = v; }, 'motion'),
    seg(t('difficulty'), st.difficultyCap, [['auto', t('diffAuto')], ['ease', t('diffEase')], ['normal', t('diffNormal')]], (v) => { st.difficultyCap = v; }, 'diff'),
  );
  col.append(child);

  const tech = el('div', { class: 'panel' }, el('h3', {}, t('grownUps')));
  tech.append(seg(t('engine'), st.engine, [['auto', t('engineAuto')], ['browser', t('engineBrowser')], ['server', t('engineServer')], ['native', t('engineNative')]], (v) => { st.engine = v; }, 'engine'));
  const input = el('input', { class: 'text-input', value: st.sttEndpoint, 'aria-label': t('sttEndpoint'), inputmode: 'url', spellcheck: 'false' }) as HTMLInputElement;
  input.addEventListener('change', () => { st.sttEndpoint = input.value.trim() || '/api/stt'; app.save(); });
  tech.append(el('div', { class: 'setting' }, el('label', {}, t('sttEndpoint')), input));
  tech.append(toggle(t('devMode'), st.devMode, (v) => { st.devMode = v; }, 'dev'));
  if (st.devMode) tech.append(el('p', { style: 'color:#a61e4d;font-weight:700;margin:6px 0' }, t('devBanner')));
  const langBtn = el('button', { class: 'btn', 'data-testid': 'settings-lang' }, t('switchLanguage'));
  langBtn.addEventListener('click', () => app.show('language'));
  const reset = el('button', { class: 'btn danger', 'data-testid': 'reset' }, t('resetProgress'));
  reset.addEventListener('click', () => {
    const yes = el('button', { class: 'btn danger' }, t('resetProgress'));
    const no = el('button', { class: 'btn btn-green' }, t('close'));
    const { close } = modal(app, el('p', {}, t('resetConfirm')), el('div', { class: 'actions' }, no, yes));
    no.addEventListener('click', close);
    yes.addEventListener('click', () => {
      clearProfile(app.storage);
      app.profile = newProfile();
      app.save();
      close();
      app.applyDocumentSettings();
      app.show('language');
    });
  });
  tech.append(el('div', { class: 'setting' }, langBtn, reset));
  tech.append(el('p', { style: 'color:var(--ink-soft);font-size:.9rem;margin:8px 0 0' }, t('privacyNote')));
  col.append(tech);
  s.append(col);
  app.layer.append(s);
}

/* ===================================================== microphone help */

/** Shown before the browser's own permission prompt, so a child and grown-up know why. */
export function micExplainer(app: App, onAllow: () => Promise<boolean>, onBack: () => void): void {
  const allow = el('button', { class: 'btn btn-gold btn-big', 'data-testid': 'allow-mic' }, icon('mic'), t('allowMic'));
  const back = el('button', { class: 'btn' }, t('back'));
  const { close } = modal(app, icon('mic', 'illus'), el('h2', {}, t('micTitle')), el('p', {}, t('micBody')), el('p', { style: 'font-size:.95rem' }, t('micPrivacy')), el('div', { class: 'actions' }, allow, back));
  allow.addEventListener('click', async () => {
    allow.setAttribute('disabled', '');
    close();
    await onAllow();
  });
  back.addEventListener('click', () => { close(); onBack(); });
  if (app.profile.settings.voiceHints) speaker.speak(t('micTitle'), app.pack.speechLang, 0.95);
}

const REASON_TEXT = (reason?: string): string => {
  switch (reason) {
    case 'permission-denied': return t('micDeniedBody');
    case 'insecure-context': return t('insecure');
    case 'no-microphone': return t('micDeniedBody');
    case 'not-configured': return t('noSttHelp');
    case 'network': return t('networkErr');
    case 'service-unavailable': return t('serviceErr');
    default: return t('noSttBody');
  }
};

/** Clear explanation when voice cannot work — never a silent fake. */
export function micProblem(
  app: App,
  choice: ProviderChoice,
  actions: { onRetry: () => void; onBack: () => void },
  register?: (overlay: HTMLElement) => void,
): void {
  const denied = choice.tried.some((x) => x.reason === 'permission-denied' || x.reason === 'no-microphone');
  const title = denied ? t('micDeniedTitle') : t('noSttTitle');
  const reasons = el('ul', { class: 'help-list', 'data-testid': 'mic-reasons' });
  const seen = new Set<string>();
  for (const tr of choice.tried) {
    const text = REASON_TEXT(tr.reason);
    if (seen.has(text)) continue;
    seen.add(text);
    reasons.append(el('li', {}, text));
  }
  if (!denied && !seen.has(t('noSttHelp'))) reasons.append(el('li', {}, t('noSttHelp')));
  const retry = el('button', { class: 'btn btn-gold', 'data-testid': 'mic-retry' }, icon('retry'), t('checkAgain'));
  const back = el('button', { class: 'btn' }, t('back'));
  const { back: overlay, close } = modal(app, icon('alert', 'illus'), el('h2', { 'data-testid': denied ? 'mic-denied' : 'stt-unavailable' }, title), reasons, el('div', { class: 'actions' }, retry, back));
  overlay.querySelector('.illus')?.setAttribute('style', 'color:#f08c00');
  retry.addEventListener('click', () => { close(); actions.onRetry(); });
  back.addEventListener('click', () => { close(); actions.onBack(); });
  register?.(overlay);
}
