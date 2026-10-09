import { sound } from '../audio/sfx';
import { speaker } from '../audio/tts';
import { createRng } from '../core/rng';
import { eligibleItems, selectLevelItems } from '../content/selector';
import type { LearningItem } from '../content/types';
import { evaluate, type Evaluation } from '../evaluation/evaluator';
import type { LevelDef } from '../game/levels';
import {
  applyEvaluation, createLevelState, currentItem, currentTarget, drainEvents, setPaused, starsFor, tick,
  type Enemy, type GameEvent, type LevelState,
} from '../game/levelState';
import { buildEnemyPlan } from '../game/plan';
import { setPathLength } from '../game/levelState';
import { fastTrackTarget } from '../progress/fastTrack';
import { stringsFor, t } from '../i18n/strings';
import { chooseDifficulty, scaffoldFor, type DifficultyProfile } from '../learning/adaptive';
import { recordResult } from '../learning/learner';
import { haptic, keepAwake } from '../platform/platform';
import { levelRecord } from '../progress/profile';
import { ACHIEVEMENTS, advanceDaily, checkAchievements, coinsForReading, xpForReading, type Achievement } from '../progress/rewards';
import { queryMicPermission } from '../speech/micPermission';
import { simulatorBus, type SimulatedAnswer } from '../speech/simulatedProvider';
import { SpeechError, type ListenSession, type SpeechProvider } from '../speech/types';
import type { App } from './app';
import { clear, el, icon, starsRow, toast } from './dom';
import { micExplainer, micProblem } from './screens';

const PACE_FACTOR = { slow: 1.45, normal: 1, fast: 0.8 } as const;

interface ReadRecord { item: LearningItem; novel: boolean; firstTry: boolean; solved: boolean }

/**
 * One attempt at one level: builds the enemy plan from the learner's skills,
 * runs the loop, listens, evaluates, gives feedback, records learning, and
 * shows the result. Everything speech-related goes through SpeechProvider.
 */
export class GameSession {
  private state!: LevelState;
  private provider: SpeechProvider | null = null;
  private session: ListenSession | null = null;
  private busy = false;
  private cooldownUntil = 0;
  private listenTargetId: number | null = null;
  private raf = 0;
  private last = 0;
  private ended = false;
  private profileD!: DifficultyProfile;
  private reads: ReadRecord[] = [];
  private newSkills: string[] = [];
  private coins = 0;
  private xp = 0;
  private panelKey = '';
  private showParts = false;
  private lastEval: { enemyId: number; ev: Evaluation } | null = null;
  private pressStart = 0;
  private tutorialStep = -1;
  private noVoiceToasted = false;
  private disposers: Array<() => void> = [];

  // DOM
  private root!: HTMLElement;
  private hud!: HTMLElement;
  private panel!: HTMLElement;
  private card!: HTMLElement;
  private mic!: HTMLButtonElement;
  private micCaption!: HTMLElement;
  private feedback!: HTMLElement;
  private overlay: HTMLElement | null = null;

  constructor(private app: App, private level: LevelDef, private opts: { tutorial?: boolean } = {}) {}

  private get lp() { return this.app.progress; }
  private get settings() { return this.app.profile.settings; }

  async start(): Promise<void> {
    // Test hook (read by e2e/smoke.mjs); holds no secrets.
    (window as unknown as { __rd?: Record<string, unknown> }).__rd!.session = this;
    this.app.sessionActive = true;
    this.app.stopIdle();
    clear(this.app.layer);
    this.app.renderer.reset();
    this.app.renderer.setScene(this.level.environment, this.app.pack.dir === 'rtl');
    this.buildDom();
    this.app.fieldOverride = () => this.field();
    this.app.onResize();
    this.setupLevel();
    setPaused(this.state, true);
    this.loop(performance.now());
    keepAwake(true);

    const ok = await this.ensureVoice();
    if (!ok) return;
    if (this.opts.tutorial) this.runTutorial();
    else this.begin();
  }

  private begin(): void {
    setPaused(this.state, false);
    if (this.settings.voiceHints) speaker.speak(t('tut2'), this.app.pack.speechLang, 0.95);
  }

  /* ----------------------------------------------------------- voice */

  /** Find a recogniser and the microphone; explain and stop if there is none. */
  private async ensureVoice(): Promise<boolean> {
    const choice = await this.app.findProvider();
    if (!choice.provider) {
      micProblem(this.app, choice, { onRetry: () => this.retryVoice(), onBack: () => this.exit('home') });
      return false;
    }
    this.provider = choice.provider;
    document.getElementById('devBanner')!.hidden = !this.provider.simulated;
    if (this.provider.simulated) {
      document.getElementById('devBanner')!.textContent = t('devBanner');
      return true;
    }
    const perm = await queryMicPermission();
    if (perm === 'granted') return true;
    return new Promise<boolean>((resolve) => {
      micExplainer(this.app, async () => {
        const a = await this.provider!.requestPermission();
        if (a.ok) { resolve(true); return true; }
        micProblem(this.app, { provider: null, tried: [{ id: this.provider!.id, reason: a.reason }] }, {
          onRetry: () => this.retryVoice(), onBack: () => this.exit('home'),
        });
        resolve(false);
        return false;
      }, () => { resolve(false); this.exit('home'); });
    });
  }

  private async retryVoice(): Promise<void> {
    this.closeOverlay();
    const ok = await this.ensureVoice();
    if (ok) { if (this.opts.tutorial && this.tutorialStep < 0) this.runTutorial(); else this.begin(); }
  }

  /* ----------------------------------------------------------- level */

  private setupLevel(): void {
    const pack = this.app.pack;
    const learner = this.lp.learner;
    this.profileD = chooseDifficulty(learner, this.settings.difficultyCap === 'auto' ? undefined : this.settings.difficultyCap);
    const durationFactor = PACE_FACTOR[this.settings.pace] * this.profileD.durationFactor;

    if (this.opts.tutorial) {
      // Practice: two of the very first items, enemies that cannot hurt the castle.
      const first = eligibleItems(pack, 0).filter((i) => i.difficulty <= 1).slice(0, 4);
      const rng = createRng(Date.now());
      const picks = first.sort(() => rng() - 0.5).slice(0, 2);
      this.state = createLevelState(picks.map((it) => ({ type: 'slime', items: [it] })), {
        practice: true, durationFactor: 1.6, maxAlive: 1, spawnInterval: 3,
      });
      return;
    }
    const rec = levelRecord(this.lp, this.level.id);
    const sel = selectLevelItems(pack, this.level.unitIndex, learner, {
      count: Math.max(4, this.level.enemyCount + this.profileD.enemyDelta),
      rng: createRng(Date.now() ^ (rec.attempts * 7919)),
      profile: this.profileD,
      previous: rec.history,
      boss: this.level.boss,
    });
    rec.history.unshift([...sel.items, ...sel.boss].map((i) => i.id));
    rec.history = rec.history.slice(0, 3);
    rec.attempts += 1;
    this.app.save();
    this.state = createLevelState(buildEnemyPlan(sel, learner, this.profileD), {
      durationFactor, maxAlive: this.profileD.maxAlive, castleHp: this.profileD.mode === 'ease' ? 6 : 5,
    });
  }

  private loop = (now: number): void => {
    if (this.ended) return;
    const dt = Math.min(0.05, (now - (this.last || now)) / 1000);
    this.last = now;
    // The road's real length drives enemy speed (levelState.speedOf), so a
    // resize rescales speed and the walk still takes the same time.
    setPathLength(this.state, this.app.renderer.sceneLayout.total);
    tick(this.state, dt);
    const events = drainEvents(this.state);
    if (events.length) this.handleEvents(events);
    const target = currentTarget(this.state);
    this.app.renderer.render(this.state, dt, { targetId: target?.id ?? null, listening: this.state.listening, intro: this.state.intro, introTotal: this.state.config.bossIntroSeconds });
    this.updateHud();
    this.updatePanel(target);
    this.raf = requestAnimationFrame(this.loop);
  };

  /* ----------------------------------------------------------- DOM */

  private fieldCache: { w: number; h: number; f: { x: number; y: number; w: number; h: number } } | null = null;

  /**
   * The play area between HUD and reading panel. Measured once per window
   * size (with room for the hint row), so hints appearing in the panel never
   * re-lay the battlefield under the child's eyes.
   */
  private field() {
    const w = window.innerWidth, h = window.innerHeight;
    if (this.fieldCache && this.fieldCache.w === w && this.fieldCache.h === h) return this.fieldCache.f;
    const top = this.hud ? this.hud.getBoundingClientRect().bottom : 60;
    const pr = this.panel?.getBoundingClientRect();
    let f: { x: number; y: number; w: number; h: number };
    if (h <= 560 && w > h && pr) {
      // Panel docked at the side (see styles.css): the field is the rest.
      const rtl = this.app.pack.dir === 'rtl';
      const x = rtl ? pr.right : 0;
      f = { x, y: top + 4, w: Math.max(200, (rtl ? w - pr.right : pr.left) - 8), h: h - top - 12 };
    } else {
      // Leave room for the hint row and feedback the card grows into.
      const panelTop = pr ? pr.top : h * 0.7;
      const room = h > w ? 96 : 24;
      f = { x: 0, y: top + 4, w, h: Math.max(120, panelTop - room - top - 4) };
    }
    this.fieldCache = { w, h, f };
    return f;
  }

  private buildDom(): void {
    const lang = this.app.lang;
    this.root = el('div', { class: 'game' });
    this.hud = el('div', { class: 'hud' });
    const pauseBtn = el('button', { class: 'btn btn-icon', 'aria-label': t('pause'), 'data-testid': 'pause' }, icon('pause'));
    pauseBtn.addEventListener('click', () => this.pause());
    this.hud.append(pauseBtn, el('div', { class: 'hearts', role: 'img' }), el('div', { class: 'progress' }), el('div', { class: 'pill score' }));

    this.panel = el('div', { class: 'reading' });
    this.card = el('div', { class: 'read-card', 'data-testid': 'read-card' });
    this.feedback = el('div', { class: 'feedback', 'aria-live': 'polite', 'data-testid': 'feedback' });
    this.mic = el('button', { class: 'mic', 'aria-label': t(this.settings.micMode === 'hold' ? 'holdToRead' : 'tapToRead'), 'data-testid': 'mic' }, icon('mic'), el('span', { class: 'mic-level' })) as HTMLButtonElement;
    this.micCaption = el('div', { class: 'mic-caption' }, t(this.settings.micMode === 'hold' ? 'holdToRead' : 'tapToRead'));
    const micRow = el('div', { class: 'mic-row' }, this.mic, this.micCaption);
    this.panel.append(this.card, micRow);
    if (this.app.profile.settings.devMode) {
      const dev = el('div', { class: 'dev-panel', 'aria-label': 'Development simulator' });
      const add = (label: string, a: SimulatedAnswer) => {
        const b = el('button', { class: 'btn', 'data-sim': a }, label);
        b.addEventListener('click', () => this.simulate(a));
        dev.append(b);
      };
      add(t('simCorrect'), 'correct'); add(t('simWrong'), 'wrong'); add(t('simUnclear'), 'unclear'); add(t('simSilence'), 'silence');
      this.panel.append(dev);
    }
    this.root.append(this.hud, this.panel);
    this.app.layer.append(this.root);
    void lang;

    // Mic: press-and-hold, or tap-to-toggle. A short press in hold mode
    // behaves like a tap so small fingers that let go early still work.
    this.mic.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      sound.unlock();
      try { this.mic.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
      this.pressStart = performance.now();
      if (this.session) { this.stopListening(); return; }
      this.startListening();
    });
    const release = () => {
      if (this.settings.micMode !== 'hold' || !this.session) return;
      if (performance.now() - this.pressStart > 350) this.stopListening();
    };
    this.mic.addEventListener('pointerup', release);
    this.mic.addEventListener('pointercancel', release);
    this.mic.addEventListener('contextmenu', (e) => e.preventDefault());
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || (e.key !== ' ' && e.key !== 'Enter') || document.activeElement !== this.mic) return;
      e.preventDefault();
      if (e.type === 'keydown') { this.pressStart = performance.now(); if (this.session) this.stopListening(); else this.startListening(); }
      else release();
    };
    this.mic.addEventListener('keydown', onKey);
    this.mic.addEventListener('keyup', onKey);

    const onVis = () => { if (document.hidden) this.pause(); };
    document.addEventListener('visibilitychange', onVis);
    this.disposers.push(() => document.removeEventListener('visibilitychange', onVis));
  }

  private updateHud(): void {
    const s = this.state;
    const hearts = this.hud.querySelector('.hearts') as HTMLElement;
    const key = `${s.castleHp}/${s.castleMax}`;
    if (hearts.dataset.k !== key) {
      hearts.dataset.k = key;
      clear(hearts);
      for (let i = 0; i < s.castleMax; i++) {
        const h = icon(i < s.castleHp ? 'heart' : 'heartEmpty');
        h.style.color = i < s.castleHp ? 'var(--heart)' : 'rgba(255,255,255,0.7)';
        hearts.append(h);
      }
      hearts.append(el('span', { class: 'num' }, key));
      hearts.setAttribute('aria-label', `${t('castleHealth')}: ${key}`);
    }
    const total = s.enemies.length;
    const done = s.enemies.filter((e) => e.status === 'defeated' || e.status === 'breached').length;
    const prog = this.hud.querySelector('.progress') as HTMLElement;
    const pk = `${done}/${total}`;
    if (prog.dataset.k !== pk) {
      prog.dataset.k = pk;
      clear(prog);
      prog.append(icon('monster'), el('div', { class: 'bar' }, el('i', { style: `width:${(done / total) * 100}%` })), el('span', {}, pk));
      prog.setAttribute('aria-label', `${t('enemiesLeft')}: ${total - done}`);
    }
    const score = this.hud.querySelector('.score') as HTMLElement;
    const sk = `${s.score}|${this.coins}`;
    if (score.dataset.k !== sk) {
      score.dataset.k = sk;
      clear(score);
      score.append(icon('coin'), el('span', {}, String(this.app.profile.coins + this.coins)));
    }
  }

  /** Reading panel: the big text, sound-it-out parts, listen, feedback. */
  private updatePanel(target: Enemy | null): void {
    const item = target ? currentItem(target) : null;
    const wrong = target?.wrong ?? 0;
    const sc = scaffoldFor(wrong);
    const evKey = this.lastEval && target && this.lastEval.enemyId === target.id ? this.lastEval.ev.outcome + (this.lastEval.ev.focusPart ?? '') : '';
    const key = `${target?.id}|${target?.phase}|${wrong}|${this.showParts}|${evKey}|${this.state.listening}`;
    if (key === this.panelKey) return;
    const targetChanged = !this.panelKey.startsWith(`${target?.id}|${target?.phase}|`);
    this.panelKey = key;
    if (targetChanged) { this.showParts = false; this.lastEval = null; }
    this.card.classList.toggle('listening', this.state.listening);
    this.card.classList.toggle('retry', wrong > 0 && !this.state.listening);
    clear(this.card);
    if (!item) {
      // Same shape as a real card, so the layout does not jump when it fills.
      this.card.append(el('div', { class: 'label' }, icon('monster'), t('readThis')), el('div', { class: 'target-text', 'aria-hidden': 'true' }, '\u00a0'), this.feedback);
      return;
    }
    const lang = item.lang;
    this.card.append(el('div', { class: 'label' }, icon('spark'), target?.type === 'boss' ? `${t('boss')} — ${t('bossWord', { n: target.phase + 1, total: target.items.length })}` : t('readThis')));

    const text = el('div', { class: `target-text ${item.kind === 'sentence' ? 'sentence' : ''}`, lang, dir: this.app.pack.dir, 'data-testid': 'target-text' });
    const ev = this.lastEval && this.lastEval.enemyId === target?.id ? this.lastEval.ev : null;
    if (item.kind === 'sentence') {
      item.parts.forEach((w, i) => {
        const read = ev?.wordsRead?.[i];
        text.append(el('span', { class: `w ${ev?.wordsRead ? (read ? 'read' : 'missed') : ''}` }, w), ' ');
      });
      // Keep the final punctuation visible.
      const punct = item.display.match(/[.!?]$/)?.[0];
      if (punct) text.lastChild!.textContent = punct;
    } else {
      text.textContent = item.display;
    }
    this.card.append(text);

    const showParts = (this.showParts || sc.breakdown || !!target?.assist) && item.parts.length > 1 && item.kind !== 'sentence';
    if (showParts) {
      const parts = el('div', { class: 'parts', lang, dir: this.app.pack.dir, 'aria-label': t('tryParts') });
      item.parts.forEach((p, i) => {
        if (i) parts.append(el('span', { class: 'sep' }, '·'));
        const focus = sc.highlight && ev?.focusPart === i;
        parts.append(el('span', { class: `part ${focus ? 'focus' : ''}` }, p.replace('_', '…')));
      });
      this.card.append(parts);
    }

    const tools = el('div', { class: 'read-tools' });
    if (item.parts.length > 1 && item.kind !== 'sentence' && !showParts) {
      const help = el('button', { class: 'btn', 'data-testid': 'help' }, icon('puzzle'), t('help'));
      help.addEventListener('click', () => { this.showParts = true; sound.play('tap'); });
      tools.append(help);
    }
    const canListen = (sc.listen || this.opts.tutorial || !!target?.assist) && speaker.canSpeak(this.app.pack.speechLang);
    if (sc.listen && !speaker.canSpeak(this.app.pack.speechLang) && !this.noVoiceToasted) {
      this.noVoiceToasted = true;
      toast(t('noVoice'));
    }
    if (canListen) {
      const lb = el('button', { class: 'btn btn-blue', 'data-testid': 'listen' }, icon('speaker'), t('listen'));
      lb.addEventListener('click', () => speaker.speak(item.speakAs, this.app.pack.speechLang, 0.7));
      tools.append(lb);
    }
    if (tools.childElementCount) this.card.append(tools);
    this.card.append(this.feedback);
  }

  private say(text: string, kind: '' | 'good' | 'soft' | 'info' = ''): void {
    this.feedback.textContent = text;
    this.feedback.className = `feedback ${kind}`;
  }

  private setMicState(s: 'idle' | 'on' | 'busy'): void {
    this.mic.classList.toggle('on', s === 'on');
    this.mic.classList.toggle('busy', s === 'busy');
    this.mic.setAttribute('aria-pressed', String(s === 'on'));
    clear(this.mic);
    this.mic.append(icon(s === 'busy' ? 'spinner' : 'mic'), el('span', { class: 'mic-level' }));
    this.micCaption.textContent = s === 'on' ? t('listening') : s === 'busy' ? t('checking') : t(this.settings.micMode === 'hold' ? 'holdToRead' : 'tapToRead');
  }

  /* ----------------------------------------------------------- listening */

  private startListening(): void {
    if (!this.provider || this.session || this.busy || this.state.status !== 'playing') return;
    if (performance.now() < this.cooldownUntil) return;
    const target = currentTarget(this.state);
    if (!target) return;
    const item = currentItem(target);
    this.listenTargetId = target.id;
    this.state.listening = true;
    speaker.cancel();
    this.setMicState('on');
    sound.play('listen');
    haptic('light');
    this.say('');
    const session = this.provider.start({
      lang: this.app.pack.speechLang,
      maxDurationMs: item.kind === 'sentence' ? 12000 : 7000,
      simulateTarget: item.display,
      onLevel: (lvl) => this.mic.querySelector<HTMLElement>('.mic-level')?.style.setProperty('--lvl', String(0.9 + lvl * 0.5)),
    });
    this.session = session;
    session.result.then(
      (res) => this.onResult(session.id, res.alternatives),
      (err) => this.onSpeechError(session.id, err),
    );
  }

  private stopListening(): void {
    this.session?.stop();
  }

  private simulate(a: SimulatedAnswer): void {
    if (!this.session) this.startListening();
    setTimeout(() => simulatorBus.emit('answer', a), 30);
  }

  private onResult(sessionId: number, alts: Array<{ transcript: string; confidence?: number }>): void {
    if (!this.session || this.session.id !== sessionId) return; // stale: ignore
    this.session = null;
    this.state.listening = false;
    if (this.ended || this.state.status !== 'playing') { this.setMicState('idle'); return; }
    this.busy = true;
    this.setMicState('busy');

    const target = this.state.enemies.find((e) => e.id === this.listenTargetId && e.status === 'walking') ?? currentTarget(this.state);
    if (!target) { this.finishListening(); return; }
    const item = currentItem(target);
    const ev = evaluate(item, alts);
    const otherOk = (e: Enemy) => evaluate(currentItem(e), alts).outcome === 'correct';
    const hit = applyEvaluation(this.state, target.id, ev, otherOk);
    this.lastEval = { enemyId: target.id, ev };
    if (this.provider?.simulated) this.lp.stats.simulatedReadings += 1;

    if (hit) {
      const msgs = stringsFor(this.app.lang).greatReading;
      this.say(msgs[Math.floor(Math.random() * msgs.length)], 'good');
      this.card.classList.add('good');
      setTimeout(() => this.card.classList.remove('good'), 500);
      sound.play('correct');
      setTimeout(() => sound.play('zap'), 120);
      haptic('success');
    } else if (ev.outcome === 'incorrect') {
      sound.play('tryAgain');
      this.say(item.kind === 'sentence' ? t('almostSentence') : t('almost'), 'soft');
      if (target.wrong >= 3) this.say(t('almost'), 'soft');
    } else {
      sound.play('unclear');
      this.say(ev.reason === 'silence' ? t('silence') : ev.reason === 'too-long' ? t('tooLong') : t('unclear'), 'info');
    }
    this.finishListening();
  }

  private finishListening(): void {
    // A short cooldown stops one utterance from triggering twice.
    this.cooldownUntil = performance.now() + 450;
    setTimeout(() => { this.busy = false; if (!this.session) this.setMicState('idle'); }, 300);
  }

  private onSpeechError(sessionId: number, err: unknown): void {
    if (this.session && this.session.id !== sessionId) return;
    this.session = null;
    this.state.listening = false;
    this.setMicState('idle');
    const code = err instanceof SpeechError ? err.code : 'unknown';
    if (code === 'aborted') return;
    if (code === 'permission-denied' || code === 'not-supported' || code === 'insecure-context' || code === 'no-microphone') {
      setPaused(this.state, true);
      micProblem(this.app, { provider: null, tried: [{ id: this.provider?.id ?? '?', reason: code }] }, {
        onRetry: () => this.retryVoice(), onBack: () => this.exit('home'),
      }, (o) => { this.overlay = o; });
      return;
    }
    const msg = code === 'network' ? t('networkErr') : code === 'language-unsupported' ? t('langNotSupported') : t('serviceErr');
    this.say(msg, 'info');
    toast(msg);
  }

  /* ----------------------------------------------------------- events */

  private handleEvents(events: GameEvent[]): void {
    this.app.renderer.onEvents(events, this.state);
    for (const ev of events) {
      switch (ev.type) {
        case 'resolved': this.recordLearning(ev.item, ev.wrongAttempts, ev.solved, ev.ms); break;
        case 'defeat': sound.play('pop'); break;
        case 'phase': sound.play('pop'); break;
        case 'bossIntro':
          sound.play('boss');
          haptic('success');
          toast(t('bossIncoming'), '', 2600);
          if (this.settings.voiceHints) speaker.speak(t('bossIncoming'), this.app.pack.speechLang, 0.95);
          break;
        case 'breach':
          sound.play('breach');
          haptic('soft');
          if (!ev.returns) this.say(`${t('practiceNow')}: ${currentItem(ev.enemy).display}`, 'info');
          break;
        case 'won':
          sound.play('win');
          setTimeout(() => this.finish(true), 1300);
          break;
        case 'lost':
          sound.play('lose');
          setTimeout(() => this.finish(false), 900);
          break;
        default: break;
      }
    }
  }

  private recordLearning(item: LearningItem, wrongAttempts: number, solved: boolean, ms?: number): void {
    const lp = this.lp;
    const out = recordResult(lp.learner, { item, wrongAttempts, solved, ms });
    const firstTry = solved && wrongAttempts === 0;
    this.reads.push({ item, novel: out.novel, firstTry, solved });
    if (solved) {
      lp.stats.readings += 1;
      if (out.novel) lp.stats.newItemsRead += 1;
      if (item.kind === 'word') lp.stats.wordsRead += 1;
      if (item.kind === 'sentence') lp.stats.sentencesRead += 1;
      const c = coinsForReading(firstTry, out.novel);
      this.coins += c;
      this.xp += xpForReading(firstTry, out.novel, out.newlyMastered.length);
      advanceDaily(lp, item, firstTry, out.novel);
      if (out.novel && item.kind !== 'letter') setTimeout(() => toast(t('newWord'), 'good', 1200), 600);
    }
    for (const k of out.newlyMastered) {
      this.newSkills.push(k);
      const sk = this.app.pack.skills[k];
      if (sk) setTimeout(() => toast(t('newSkill', { s: sk.kind === 'grapheme' || sk.kind === 'vowel' ? sk.display : sk.label }), 'good', 2200), 900);
    }
    this.app.save();
  }

  /* ----------------------------------------------------------- flow */

  private pause(): void {
    if (this.ended || this.state.status !== 'playing' || this.overlay) return;
    this.session?.abort();
    setPaused(this.state, true);
    const back = el('div', { class: 'modal-back' });
    const m = el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('paused') });
    const resume = el('button', { class: 'btn btn-green btn-big', 'data-testid': 'resume' }, icon('play'), t('resume'));
    resume.addEventListener('click', () => { this.closeOverlay(); setPaused(this.state, false); });
    const retry = el('button', { class: 'btn' }, icon('retry'), t('retry'));
    retry.addEventListener('click', () => this.restart());
    const quit = el('button', { class: 'btn' }, icon('map'), t('quit'));
    quit.addEventListener('click', () => this.exit('map'));
    const soundBtn = el('button', { class: 'btn', 'aria-pressed': String(this.settings.sound) }, `${t('soundFx')}: ${this.settings.sound ? t('on') : t('off')}`);
    soundBtn.addEventListener('click', () => {
      this.settings.sound = !this.settings.sound;
      sound.enabled = this.settings.sound;
      soundBtn.textContent = `${t('soundFx')}: ${this.settings.sound ? t('on') : t('off')}`;
      this.app.save();
    });
    m.append(el('h2', {}, t('paused')), resume, el('div', { class: 'actions' }, retry, quit), soundBtn);
    back.append(m);
    this.showOverlay(back);
    resume.focus();
  }

  private showOverlay(node: HTMLElement): void {
    this.closeOverlay();
    this.overlay = node;
    this.app.layer.append(node);
  }

  private closeOverlay(): void {
    this.overlay?.remove();
    this.overlay = null;
    document.querySelectorAll('.modal-back').forEach((n) => n.remove());
  }

  private runTutorial(): void {
    const steps = [t('tut1'), t('tut2'), t('tut3')];
    this.tutorialStep = 0;
    const show = () => {
      const wrap = el('div', { class: 'tut-card' });
      const m = el('div', { class: 'modal', role: 'dialog', 'aria-label': t('tutorialTitle') });
      const last = this.tutorialStep === steps.length - 1;
      const next = el('button', { class: 'btn btn-gold btn-big', 'data-testid': 'tut-next' }, last ? t('start') : t('next'));
      next.addEventListener('click', () => {
        sound.play('tap');
        if (last) {
          this.closeOverlay();
          toast(t('tutPractice'), '', 2600);
          setPaused(this.state, false);
          return;
        }
        this.tutorialStep++;
        show();
      });
      m.append(el('h2', {}, this.tutorialStep === steps.length - 1 ? t('tutPracticeTitle') : t('tutorialTitle')), el('p', {}, steps[this.tutorialStep]), next);
      wrap.append(m);
      this.showOverlay(wrap);
      if (this.settings.voiceHints) speaker.speak(steps[this.tutorialStep], this.app.pack.speechLang, 0.95);
    };
    show();
  }

  private finish(won: boolean): void {
    if (this.ended) return;
    this.ended = true;
    this.session?.abort();
    cancelAnimationFrame(this.raf);
    keepAwake(false);
    const p = this.app.profile;
    const lp = this.lp;

    if (this.opts.tutorial) {
      lp.tutorialDone = true;
      this.app.save();
      this.resultModal(won, 0, [], () => this.exit('none', () => this.app.startLevel(this.app.levels[0])));
      return;
    }
    const stars = starsFor(this.state);
    const rec = levelRecord(lp, this.level.id);
    if (won) {
      rec.wins += 1;
      rec.stars = Math.max(rec.stars, stars);
      rec.bestScore = Math.max(rec.bestScore, this.state.score);
      lp.stats.levelsWon += 1;
      this.coins += stars * 2;
    }
    if (won) {
      const skip = fastTrackTarget(lp, this.app.pack, this.app.levels, this.level, stars);
      if (skip) {
        levelRecord(lp, skip.id).skipped = true;
        setTimeout(() => toast(t('fastTrack'), 'good', 2800), 600);
      }
    }
    p.coins += this.coins;
    p.xp += this.xp;
    const earned = checkAchievements(p, this.app.lang, this.app.pack);
    this.app.save();
    this.resultModal(won, stars, earned);
  }

  private resultModal(won: boolean, stars: number, earned: Achievement[], onTutorialDone?: () => void): void {
    const back = el('div', { class: 'modal-back' });
    const m = el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'data-testid': won ? 'victory' : 'defeat' });
    if (onTutorialDone) {
      const go = el('button', { class: 'btn btn-gold btn-big', 'data-testid': 'tut-done' }, icon('play'), t('play'));
      go.addEventListener('click', onTutorialDone);
      m.append(icon('castle', 'illus'), el('h2', {}, t('tutDone')), go);
      back.append(m);
      this.app.layer.append(back);
      if (this.settings.voiceHints) speaker.speak(t('tutDone'), this.app.pack.speechLang, 0.95);
      return;
    }
    m.append(el('h2', {}, won ? t('victory') : t('defeat')));
    if (won) m.append(el('div', { class: 'big-stars' }, ...Array.from(starsRow(stars).children)));
    else m.append(el('p', {}, t('defeatSub')));

    const solved = this.reads.filter((r) => r.solved);
    if (solved.length) {
      const chips = el('div', { class: 'word-chips', lang: this.app.lang, dir: this.app.pack.dir });
      const seen = new Set<string>();
      for (const r of solved) {
        if (seen.has(r.item.id) || r.item.kind === 'sentence') continue;
        seen.add(r.item.id);
        chips.append(el('span', { class: r.novel ? 'new' : '', title: r.novel ? t('newWord') : '' }, r.novel ? `${r.item.display} ✓` : r.item.display));
      }
      if (chips.childElementCount) m.append(chips);
    }
    const rewards = el('div', { class: 'reward-row' },
      el('span', { class: 'pill' }, icon('coin'), `+${this.coins}`),
      el('span', { class: 'pill' }, icon('spark'), `+${this.xp} ${t('xp')}`));
    m.append(rewards);
    for (const k of this.newSkills) {
      const sk = this.app.pack.skills[k];
      if (sk) m.append(el('div', { class: 'achv' }, icon('star'), t('newSkill', { s: sk.kind === 'grapheme' || sk.kind === 'vowel' ? sk.display : sk.label })));
    }
    for (const a of earned) m.append(el('div', { class: 'achv' }, icon(a.icon === 'star' ? 'star' : a.icon), a.title[this.app.lang]));
    void ACHIEVEMENTS;

    const actions = el('div', { class: 'actions' });
    const idx = this.app.levels.findIndex((l) => l.id === this.level.id);
    const next = this.app.levels[idx + 1];
    if (won && next) {
      const nb = el('button', { class: 'btn btn-gold btn-big', 'data-testid': 'next-level' }, icon('play'), t('nextLevel'));
      nb.addEventListener('click', () => this.exit('none', () => this.app.startLevel(next)));
      actions.append(nb);
    }
    const rb = el('button', { class: `btn ${won ? '' : 'btn-gold btn-big'}`, 'data-testid': 'retry' }, icon('retry'), t('retry'));
    rb.addEventListener('click', () => this.restart());
    const mb = el('button', { class: 'btn', 'data-testid': 'to-map' }, icon('map'), t('map'));
    mb.addEventListener('click', () => this.exit('map'));
    actions.append(rb, mb);
    m.append(actions);
    back.append(m);
    this.app.layer.append(back);
    if (this.settings.voiceHints) speaker.speak(won ? t('victory') : t('defeatSub'), this.app.pack.speechLang, 0.95);
  }

  private restart(): void {
    this.exit('none', () => this.app.startLevel(this.level, this.opts));
  }

  private teardown(): void {
    this.ended = true;
    this.session?.abort();
    cancelAnimationFrame(this.raf);
    keepAwake(false);
    speaker.cancel();
    this.disposers.forEach((d) => d());
    this.app.fieldOverride = null;
    this.app.sessionActive = false;
    document.getElementById('devBanner')!.hidden = true;
    this.app.save();
  }

  exit(to: 'home' | 'map' | 'none', then?: () => void): void {
    this.teardown();
    clear(this.app.layer);
    if (to !== 'none') this.app.show(to);
    then?.();
  }
}
