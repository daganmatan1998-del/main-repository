import { getPack } from '../content/registry';
import type { LanguageCode, LanguagePack } from '../content/types';
import { buildLevels, type LevelDef } from '../game/levels';
import { SceneRenderer } from '../game/renderer';
import { setUiLanguage, t } from '../i18n/strings';
import { sound } from '../audio/sfx';
import { speaker } from '../audio/tts';
import { prefersReducedMotion } from '../platform/platform';
import { createStorage, type StorageAdapter } from '../persistence/storage';
import { loadProfile, saveProfile, type LangProgress, type Profile } from '../progress/profile';
import { levelDone } from '../progress/fastTrack';
import { shopColor } from '../progress/rewards';
import { configForMode, setEvalConfig } from '../evaluation/config';
import { chooseProvider, type ProviderChoice } from '../speech/providerFactory';
import { clear } from './dom';

export type ScreenName = 'language' | 'home' | 'map' | 'shop' | 'progress' | 'settings';

/**
 * Application shell: owns the profile, the background scene and navigation.
 * Screens are plain functions that render into #layer; the game session is
 * its own controller (GameSession) and hands control back when it ends.
 */
export class App {
  readonly storage: StorageAdapter;
  profile: Profile;
  readonly renderer: SceneRenderer;
  readonly layer: HTMLElement;
  private idleRaf = 0;
  private lastFrame = 0;
  /** While a game session runs, it drives the renderer itself. */
  sessionActive = false;
  /** Registered screen builders (filled by screens.ts to avoid import cycles). */
  screens: Partial<Record<ScreenName, (app: App) => void>> = {};
  startLevel: (level: LevelDef, opts?: { tutorial?: boolean }) => void = () => undefined;

  constructor() {
    this.storage = createStorage();
    this.profile = loadProfile(this.storage);
    this.layer = document.getElementById('layer')!;
    const canvas = document.getElementById('scene') as HTMLCanvasElement;
    this.renderer = new SceneRenderer(canvas, {
      walls: shopColor(this.profile.equipped.walls),
      banner: shopColor(this.profile.equipped.banner),
      magic: shopColor(this.profile.equipped.magic),
      reducedMotion: this.profile.settings.reducedMotion || prefersReducedMotion(),
      bigText: this.profile.settings.bigText,
      lang: this.profile.lang ?? 'en',
      bossLabel: 'BOSS',
      weapon: this.profile.equipped.weapon ?? 'weapon-magic',
    });
    sound.enabled = this.profile.settings.sound;
    window.addEventListener('resize', () => this.onResize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.onResize(), 200));
    // First touch anywhere unlocks Web Audio (required on iOS).
    window.addEventListener('pointerdown', () => sound.unlock(), { once: false, passive: true });
    this.applyDocumentSettings();
  }

  get lang(): LanguageCode { return this.profile.lang ?? 'en'; }
  get pack(): LanguagePack { return getPack(this.lang); }
  get progress(): LangProgress { return this.profile.langs[this.lang]; }
  get levels(): LevelDef[] { return buildLevels(this.pack); }

  save(): void {
    saveProfile(this.storage, this.profile);
  }

  setLanguage(lang: LanguageCode): void {
    this.profile.lang = lang;
    this.save();
    this.applyDocumentSettings();
  }

  /** Language decides UI strings, direction and fonts for the whole page. */
  applyDocumentSettings(): void {
    const lang = this.lang;
    setUiLanguage(lang);
    const root = document.documentElement;
    root.lang = lang;
    root.dir = getPack(lang).dir;
    root.dataset.bigText = this.profile.settings.bigText ? '1' : '0';
    root.dataset.reducedMotion = this.profile.settings.reducedMotion ? '1' : '0';
    document.title = t('appName');
    sound.enabled = this.profile.settings.sound;
    setEvalConfig(configForMode(this.profile.settings.hebrewLetterMode ?? 'normal'));
    this.renderer.setOptions({
      bossLabel: t('boss'),
      weapon: this.profile.equipped.weapon ?? 'weapon-magic',
      lang,
      bigText: this.profile.settings.bigText,
      reducedMotion: this.profile.settings.reducedMotion || prefersReducedMotion(),
      walls: shopColor(this.profile.equipped.walls),
      banner: shopColor(this.profile.equipped.banner),
      magic: shopColor(this.profile.equipped.magic),
    });
  }

  /** Index of the next level to play: the first not yet won (or skipped by fast-track). */
  nextLevelIndex(): number {
    const lv = this.levels;
    const i = lv.findIndex((l) => !levelDone(this.progress, l.id));
    return i === -1 ? lv.length - 1 : i;
  }

  isUnlocked(index: number): boolean {
    if (index === 0) return true;
    return levelDone(this.progress, this.levels[index - 1].id);
  }

  show(name: ScreenName): void {
    if (this.sessionActive) return;
    clear(this.layer);
    speaker.cancel();
    const build = this.screens[name];
    if (build) build(this);
    this.ensureIdleScene();
  }

  /** Background scene behind the menus: the castle in its current world. */
  ensureIdleScene(): void {
    if (this.sessionActive) return;
    const lvl = this.levels[this.nextLevelIndex()];
    this.renderer.setScene(lvl?.environment ?? 'meadow', this.pack.dir === 'rtl');
    this.onResize();
    if (this.idleRaf) return;
    const loop = (now: number) => {
      if (this.sessionActive) { this.idleRaf = 0; return; }
      const dt = Math.min(0.05, (now - (this.lastFrame || now)) / 1000);
      this.lastFrame = now;
      this.renderer.render(null, dt, { targetId: null, listening: false, hpRatio: 1 });
      this.idleRaf = requestAnimationFrame(loop);
    };
    this.idleRaf = requestAnimationFrame(loop);
  }

  stopIdle(): void {
    if (this.idleRaf) cancelAnimationFrame(this.idleRaf);
    this.idleRaf = 0;
    this.lastFrame = 0;
  }

  /** Called on resize; the game session overrides the field while playing. */
  fieldOverride: (() => { x: number; y: number; w: number; h: number }) | null = null;

  onResize(): void {
    const w = window.innerWidth, h = window.innerHeight;
    const field = this.fieldOverride ? this.fieldOverride() : { x: 0, y: h * 0.08, w, h: h * 0.9 };
    this.renderer.resize(field);
  }

  async findProvider(): Promise<ProviderChoice> {
    return chooseProvider(this.profile.settings, this.pack.speechLang);
  }
}
