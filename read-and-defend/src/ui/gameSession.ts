import { sound } from '../audio/sfx';
import { speaker } from '../audio/tts';
import { createRng } from '../core/rng';
import { eligibleItems, selectLevelItems } from '../content/selector';
import type { LearningItem } from '../content/types';
import { evaluate, type Evaluation, type RecognitionAlternative } from '../evaluation/evaluator';
import { getEvalConfig } from '../evaluation/config';
import type { LevelDef } from '../game/levels';
import {
  applyEvaluation, createLevelState, currentItem, currentTarget, drainEvents, setPaused, starsFor, tick,
  type Enemy, type GameEvent, type LevelState,
} from '../game/levelState';
import { buildEnemyPlan } from '../game/plan';
import { setPathLength } from '../game/levelState';
import { matchUtterance, readingOrder, tokenize } from '../game/utterance';
import { fastTrackTarget } from '../progress/fastTrack';
import { stringsFor, t } from '../i18n/strings';
import { chooseDifficulty, scaffoldFor, type DifficultyProfile } from '../learning/adaptive';
import { recordResult } from '../learning/learner';
import { haptic, keepAwake } from '../platform/platform';
import { levelRecord, PACE_FACTOR, PACES, type Pace } from '../progress/profile';
import { ACHIEVEMENTS, advanceDaily, checkAchievements, coinsForReading, xpForReading, type Achievement } from '../progress/rewards';
import { queryMicPermission } from '../speech/micPermission';
import { simulatorBus, type SimulatedAnswer } from '../speech/simulatedProvider';
import { startContinuous } from '../speech/continuous';
import { type ContinuousSession, type SpeechError, type SpeechProvider } from '../speech/types';
import type { App } from './app';
import { clear, el, icon, starsRow, toast } from './dom';
import { micExplainer, micProblem } from './screens';

interface ReadRecord { item: LearningItem; novel: boolean; firstTry: boolean; solved: boolean }

/**
 * One attempt at one level: builds the enemy plan from the learner's skills,
 * runs the loop, listens, evaluates, gives feedback, records learning, and
 * shows the result. Everything speech-related goes through SpeechProvider.
 */
export class GameSession {
  private state!: LevelState;
  private provider: SpeechProvider | null = null;
  /** The always-open microphone, while the level is running. */
  private ears: ContinuousSession | null = null;
  /** Readings already credited per utterance (partial results repeat). */
  private consumed = new Map<string, number>();
  /** The child is mid-utterance until then (enemies slow down meanwhile). */
  private speakingUntil = 0;
  private raf = 0;
  private last = 0;
  private ended = false;
  private profileD!: DifficultyProfile;
  private reads: ReadRecord[] = [];
  private newSkills: string[] = [];
  private coins = 0;
  private xp = 0;
  private hintKey = '';
  private showParts = false;
  private lastEval: { enemyId: number; ev: Evaluation } | null = null;
  private tutorialStep = -1;
  private noVoiceToasted = false;
  private disposers: Array<() => void> = [];
  private feedbackTimer: ReturnType<typeof setTimeout> | undefined;

  // DOM
  private root!: HTMLElement;
  private hud!: HTMLElement;
  private ear!: HTMLElement;
  private bottom!: HTMLElement;
  private hints!: HTMLElement;
  private feedback!: HTMLElement;
  private srTarget!: HTMLElement;
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
    this.startEars();
    toast(t('justRead'), '', 2200);
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
    if (ok) {
      if (this.opts.tutorial && this.tutorialStep < 0) this.runTutorial();
      else { this.closeOverlay(); this.begin(); }
    }
  }

  /* ----------------------------------------------------------- level */

  private setupLevel(): void {
    const pack = this.app.pack;
    const learner = this.lp.learner;
    this.profileD = chooseDifficulty(learner, this.settings.difficultyCap === 'auto' ? undefined : this.settings.difficultyCap);
    const durationFactor = (PACE_FACTOR[this.settings.pace] ?? 1) * this.profileD.durationFactor;

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
    // Enemies slow down while the child is in the middle of saying something.
    this.state.listening = performance.now() < this.speakingUntil;
    tick(this.state, dt);
    const events = drainEvents(this.state);
    if (events.length) this.handleEvents(events);
    const target = currentTarget(this.state);
    this.app.renderer.render(this.state, dt, { targetId: target?.id ?? null, listening: this.state.listening, intro: this.state.intro, introTotal: this.state.config.bossIntroSeconds });
    this.updateHud();
    this.updateHints(target);
    this.raf = requestAnimationFrame(this.loop);
  };

  /* ----------------------------------------------------------- DOM */

  private fieldCache: { w: number; h: number; f: { x: number; y: number; w: number; h: number } } | null = null;

  /**
   * The play area: everything below the HUD. The word to read is on the
   * monster's own sign, so there is no reading panel taking up the map —
   * only a thin strip at the bottom for hints (and the dev buttons, in
   * development mode). Measured once per window size so nothing jumps.
   */
  private field() {
    const w = window.innerWidth, h = window.innerHeight;
    if (this.fieldCache && this.fieldCache.w === w && this.fieldCache.h === h) return this.fieldCache.f;
    const top = this.hud ? this.hud.getBoundingClientRect().bottom : 60;
    const bottomUsed = this.bottom ? h - this.bottom.getBoundingClientRect().top : 0;
    const reserve = Math.max(bottomUsed, h > w ? 72 : 56); // room for the hint chips
    const f = { x: 0, y: top + 4, w, h: Math.max(160, h - top - reserve - 4) };
    this.fieldCache = { w, h, f };
    return f;
  }

  private buildDom(): void {
    this.root = el('div', { class: 'game' });
    this.hud = el('div', { class: 'hud' });
    const pauseBtn = el('button', { class: 'btn btn-icon', 'aria-label': t('pause'), 'data-testid': 'pause' }, icon('pause'));
    pauseBtn.addEventListener('click', () => this.pause());
    this.ear = el('div', { class: 'ear off', role: 'status', 'aria-live': 'polite', 'data-testid': 'ear' }, icon('mic'), el('span', { class: 'ear-dot' }));
    this.hud.append(pauseBtn, this.ear, el('div', { class: 'hearts', role: 'img' }), el('div', { class: 'progress' }), el('div', { class: 'pill score' }));

    // Screen readers (and tests) get the current word as text; sighted
    // players read it on the monster's sign.
    this.srTarget = el('div', { class: 'sr-only', 'aria-live': 'polite', 'data-testid': 'target-text' });

    this.bottom = el('div', { class: 'game-bottom' });
    this.feedback = el('div', { class: 'feedback-bubble', 'aria-live': 'polite', 'data-testid': 'feedback' });
    this.hints = el('div', { class: 'hints' });
    this.bottom.append(this.feedback, this.hints);
    if (this.app.profile.settings.devMode) {
      const dev = el('div', { class: 'dev-panel', 'aria-label': 'Development simulator' });
      const add = (label: string, a: SimulatedAnswer) => {
        const b = el('button', { class: 'btn', 'data-sim': a }, label);
        b.addEventListener('click', () => simulatorBus.emit('answer', a));
        dev.append(b);
      };
      add(t('simCorrect'), 'correct'); add(t('simWrong'), 'wrong'); add(t('simUnclear'), 'unclear'); add(t('simSilence'), 'silence');
      this.bottom.append(dev);
    }
    this.root.append(this.hud, this.srTarget, this.bottom);
    this.app.layer.append(this.root);

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
    const earState = !this.ears ? 'off' : this.state.listening ? 'hearing' : 'on';
    if (this.ear.dataset.k !== earState) {
      this.ear.dataset.k = earState;
      this.ear.className = `ear ${earState}`;
      this.ear.setAttribute('aria-label', earState === 'off' ? t('earOff') : earState === 'hearing' ? t('earHearing') : t('earOn'));
      this.ear.title = this.ear.getAttribute('aria-label') ?? '';
    }
  }

  /**
   * Hints live in a thin strip at the bottom and only appear when they help:
   * the word split into sounds after a miss, the sound that went wrong
   * highlighted, and a listen button after two misses. The word itself is
   * on the monster's sign.
   */
  private updateHints(target: Enemy | null): void {
    const item = target ? currentItem(target) : null;
    const wrong = target?.wrong ?? 0;
    const sc = scaffoldFor(wrong);
    const ev = this.lastEval && target && this.lastEval.enemyId === target.id ? this.lastEval.ev : null;
    const key = `${target?.id}|${target?.phase}|${wrong}|${this.showParts}|${ev?.outcome ?? ''}${ev?.focusPart ?? ''}`;
    if (key === this.hintKey) return;
    const targetChanged = !this.hintKey.startsWith(`${target?.id}|${target?.phase}|`);
    this.hintKey = key;
    if (targetChanged) { this.showParts = false; this.lastEval = null; }

    this.srTarget.textContent = item ? (target?.type === 'boss' ? `${t('bossWord', { n: target.phase + 1, total: target.items.length })}: ${item.display}` : item.display) : '';
    if (item) { this.srTarget.setAttribute('lang', item.lang); this.srTarget.setAttribute('dir', this.app.pack.dir); }
    clear(this.hints);
    if (!item) return;

    const multi = item.parts.length > 1 && item.kind !== 'sentence';
    const showParts = multi && (this.showParts || sc.breakdown || !!target?.assist);
    if (showParts) {
      const parts = el('div', { class: 'parts', lang: item.lang, dir: this.app.pack.dir, 'aria-label': t('tryParts') });
      item.parts.forEach((p, i) => {
        if (i) parts.append(el('span', { class: 'sep' }, '·'));
        parts.append(el('span', { class: `part ${sc.highlight && ev?.focusPart === i ? 'focus' : ''}` }, p.replace('_', '…')));
      });
      this.hints.append(parts);
    } else if (item.kind === 'sentence' && ev?.wordsRead) {
      const words = el('div', { class: 'parts', lang: item.lang, dir: this.app.pack.dir });
      item.parts.forEach((w, i) => words.append(el('span', { class: `part ${ev.wordsRead![i] ? 'read' : 'focus'}` }, w)));
      this.hints.append(words);
    }
    const fabs = el('div', { class: 'fabs' });
    if (multi && !showParts) {
      const help = el('button', { class: 'fab', 'aria-label': t('help'), title: t('help'), 'data-testid': 'help' }, icon('puzzle'));
      help.addEventListener('click', () => { this.showParts = true; sound.play('tap'); });
      fabs.append(help);
    }
    const canSpeak = speaker.canSpeak(this.app.pack.speechLang);
    if ((sc.listen || this.opts.tutorial || !!target?.assist) && canSpeak) {
      const lb = el('button', { class: 'fab fab-blue', 'aria-label': t('listen'), title: t('listen'), 'data-testid': 'listen' }, icon('speaker'));
      lb.addEventListener('click', () => speaker.speak(item.speakAs, this.app.pack.speechLang, 0.7));
      fabs.append(lb);
    } else if (sc.listen && !canSpeak && !this.noVoiceToasted) {
      this.noVoiceToasted = true;
      toast(t('noVoice'));
    }
    if (fabs.childElementCount) this.hints.append(fabs);
  }

  private say(text: string, kind: '' | 'good' | 'soft' | 'info' = ''): void {
    this.feedback.textContent = text;
    this.feedback.className = `feedback-bubble ${kind} ${text ? 'show' : ''}`;
    if (this.feedbackTimer) clearTimeout(this.feedbackTimer);
    if (text) this.feedbackTimer = setTimeout(() => this.feedback.classList.remove('show'), 2600);
  }

  /* ----------------------------------------------------------- listening */

  /**
   * Open the microphone for the rest of the level (or until a pause). There
   * is no button: once permission is granted, the castle simply listens.
   */
  private startEars(): void {
    if (!this.provider || this.ears || this.ended) return;
    this.consumed.clear();
    this.ears = startContinuous(this.provider, {
      lang: this.app.pack.speechLang,
      onResult: (alts, final, id) => this.onSpeech(alts, final, id),
      onError: (err, fatal) => this.onSpeechError(err, fatal),
      onLevel: (lvl) => { if (lvl > 0.25) this.speakingUntil = performance.now() + 600; },
      simulateTarget: () => { const tg = currentTarget(this.state); return tg ? currentItem(tg).display : ''; },
    });
  }

  private stopEars(): void {
    this.ears?.stop();
    this.ears = null;
    this.speakingUntil = 0;
  }

  /**
   * One recognition result (partial while the child speaks, or final).
   * Readings are credited as soon as they are recognisable; a partial result
   * that already contains a reading defeats the monster without waiting for
   * the engine to finish. Several readings in one breath each count.
   */
  private onSpeech(alts: RecognitionAlternative[], final: boolean, id: string): void {
    if (this.ended || this.state.status !== 'playing' || this.state.intro > 0) return;
    // The game's own voice (the Listen button, spoken instructions) is not the child.
    if (speaker.isBusy()) return;
    if (!final) this.speakingUntil = performance.now() + 1200;
    else this.speakingUntil = 0;

    const road = readingOrder(this.state.enemies);
    if (!road.length) return;
    const lang = this.app.lang;
    const hits = matchUtterance(alts, road, { lang, final, cfg: getEvalConfig() });
    const already = this.consumed.get(id) ?? 0;
    const fresh = hits.slice(already);
    if (hits.length > already) this.consumed.set(id, hits.length);
    if (this.provider?.simulated && final) this.lp.stats.simulatedReadings += 1;

    let credited = 0;
    for (const h of fresh) {
      const enemy = this.state.enemies.find((e) => e.id === h.enemyId && e.status === 'walking');
      if (!enemy || enemy.phase !== h.phase) continue;
      if (applyEvaluation(this.state, enemy.id, { outcome: 'correct', heard: alts[0].transcript })) credited++;
    }
    if (credited) {
      const msgs = stringsFor(lang).greatReading;
      this.say(credited > 1 ? `${msgs[0]} ×${credited}` : msgs[Math.floor(Math.random() * msgs.length)], 'good');
      sound.play('correct');
      setTimeout(() => sound.play('zap'), 120);
      haptic('success');
      return;
    }
    if (!final || already > 0) return;

    // Nothing was read in this utterance. Was it a reading attempt at all?
    // The microphone also hears the room, so only a short utterance is
    // treated as an attempt at the monster nearest the castle.
    const target = road[0];
    const item = currentItem(target);
    const words = Math.max(...alts.map((a) => tokenize(a.transcript, lang).length));
    const limit = item.kind === 'sentence' ? item.parts.length + 3 : 3;
    if (words === 0 || words > limit) return;
    const ev = evaluate(item, alts);
    this.lastEval = { enemyId: target.id, ev };
    if (ev.outcome === 'incorrect') {
      applyEvaluation(this.state, target.id, ev);
      sound.play('tryAgain');
      this.say(item.kind === 'sentence' ? t('almostSentence') : t('almost'), 'soft');
    } else if (ev.outcome === 'uncertain' && ev.reason !== 'too-long') {
      sound.play('unclear');
      this.say(t('unclear'), 'info');
    }
  }

  private onSpeechError(err: SpeechError, fatal: boolean): void {
    const code = err.code;
    if (code === 'aborted') return;
    if (fatal) {
      this.stopEars();
      setPaused(this.state, true);
      micProblem(this.app, { provider: null, tried: [{ id: this.provider?.id ?? '?', reason: code }] }, {
        onRetry: () => this.retryVoice(), onBack: () => this.exit('home'),
      }, (o) => { this.overlay = o; });
      return;
    }
    const msg = code === 'network' ? t('networkErr') : t('serviceErr');
    this.say(msg, 'info');
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
    this.stopEars();
    setPaused(this.state, true);
    const back = el('div', { class: 'modal-back' });
    const m = el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('paused') });
    const resume = el('button', { class: 'btn btn-green btn-big', 'data-testid': 'resume' }, icon('play'), t('resume'));
    resume.addEventListener('click', () => { this.closeOverlay(); setPaused(this.state, false); this.startEars(); });
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
    m.append(el('h2', {}, t('paused')), resume, this.paceControl(), el('div', { class: 'actions' }, retry, quit), soundBtn);
    back.append(m);
    this.showOverlay(back);
    resume.focus();
  }

  /** Monster speed, changeable mid-level: it applies to monsters already on the road. */
  private paceControl(): HTMLElement {
    const box = el('div', { class: 'pace' }, el('div', { class: 'pace-title' }, t('monsterSpeed')));
    const seg = el('div', { class: 'seg seg-wrap', role: 'group', 'aria-label': t('monsterSpeed') });
    const names: Record<Pace, string> = { verySlow: t('paceVerySlow'), slow: t('paceSlow'), relaxed: t('paceRelaxed'), normal: t('paceNormal'), fast: t('paceFast') };
    const render = () => {
      clear(seg);
      for (const p of PACES) {
        const secs = Math.round(7 * PACE_FACTOR[p] * this.profileD.durationFactor);
        const b = el('button', { 'aria-pressed': String(p === this.settings.pace), 'data-testid': `pace-${p}` }, el('span', {}, names[p]), el('small', {}, t('seconds', { n: secs })));
        b.addEventListener('click', () => {
          this.settings.pace = p;
          this.state.config.durationFactor = PACE_FACTOR[p] * this.profileD.durationFactor;
          this.app.save();
          sound.play('tap');
          render();
        });
        seg.append(b);
      }
    };
    render();
    box.append(seg);
    return box;
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
          this.startEars();
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
    this.stopEars();
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
    this.stopEars();
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
