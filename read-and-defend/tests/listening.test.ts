import { describe, expect, it } from 'vitest';
import { getPack } from '../src/content/registry';
import { createLevelState, tick, type EnemySpec } from '../src/game/levelState';
import { MemoryStorageAdapter } from '../src/persistence/storage';
import { loadProfile, PACE_FACTOR, PACES, saveProfile, newProfile } from '../src/progress/profile';
import { buy, equip, SHOP } from '../src/progress/rewards';
import { startContinuous } from '../src/speech/continuous';
import { SimulatedProvider, simulatorBus } from '../src/speech/simulatedProvider';
import { SpeechError, type ListenOptions, type RecognitionResult, type SpeechProvider } from '../src/speech/types';

const cat = getPack('en').items.find((i) => i.id === 'en:word:cat')!;

describe('monster speed levels', () => {
  const walk = (factor: number) => {
    const s = createLevelState([{ type: 'goblin', items: [cat] }] as EnemySpec[], { durationFactor: factor });
    let spawned = -1;
    for (let i = 0; i < 100000; i++) {
      tick(s, 1 / 60);
      if (spawned < 0 && s.enemies[0].status === 'walking') spawned = s.time - 1 / 60;
      if (s.enemies[0].status === 'breached') return s.time - spawned;
    }
    return Infinity;
  };

  it('offers five speeds, from very slow to fast, normal staying at 7 s', () => {
    expect(PACES).toEqual(['verySlow', 'slow', 'relaxed', 'normal', 'fast']);
    expect(walk(PACE_FACTOR.normal)).toBeCloseTo(7, 1);
    expect(walk(PACE_FACTOR.verySlow)).toBeCloseTo(21, 0);
    expect(walk(PACE_FACTOR.slow)).toBeCloseTo(14, 0);
    expect(walk(PACE_FACTOR.relaxed)).toBeCloseTo(10.2, 0);
    expect(walk(PACE_FACTOR.fast)).toBeCloseTo(5.6, 1);
  });

  it('each slower setting gives strictly more time', () => {
    const times = PACES.map((p) => 7 * PACE_FACTOR[p]);
    for (let i = 1; i < times.length; i++) expect(times[i]).toBeLessThan(times[i - 1]);
  });
});

describe('profile migration and the weapons shop', () => {
  it('an older save (no weapon, old pace) loads with the free weapon owned and equipped', () => {
    const store = new MemoryStorageAdapter();
    const old = newProfile() as unknown as Record<string, unknown>;
    old.owned = ['banner-red', 'walls-stone', 'magic-gold'];
    old.equipped = { banner: 'banner-red', walls: 'walls-stone', magic: 'magic-gold' };
    (old.settings as Record<string, unknown>).pace = 'slow';
    store.set('read-and-defend:profile:v1', JSON.stringify(old));
    const p = loadProfile(store);
    expect(p.owned).toContain('weapon-magic');
    expect(p.equipped.weapon).toBe('weapon-magic');
    expect(p.settings.pace).toBe('slow');
    expect(PACE_FACTOR[p.settings.pace]).toBeGreaterThan(1);
  });

  it('weapons are bought with coins and equipped; they persist', () => {
    const store = new MemoryStorageAdapter();
    const p = newProfile();
    p.coins = 100;
    expect(buy(p, 'weapon-fire')).toBe(true);
    expect(p.coins).toBe(10);
    expect(p.equipped.weapon).toBe('weapon-fire');
    expect(buy(p, 'weapon-lightning')).toBe(false); // not enough coins
    expect(equip(p, 'weapon-magic')).toBe(true);
    saveProfile(store, p);
    const again = loadProfile(store);
    expect(again.owned).toContain('weapon-fire');
    expect(again.equipped.weapon).toBe('weapon-magic');
  });

  it('there are several weapons, each with a price, and one is free', () => {
    const weapons = SHOP.filter((s) => s.slot === 'weapon');
    expect(weapons.length).toBeGreaterThanOrEqual(6);
    expect(weapons.filter((w) => w.price === 0)).toHaveLength(1);
  });
});

/* ------------------------------------------------- always-on listening */

/** An engine that answers each utterance from a script, like the server or native engines. */
function scriptedProvider(script: Array<string | Error>): SpeechProvider & { starts: number } {
  const p = {
    id: 'server' as const, simulated: false, starts: 0,
    checkAvailability: async () => ({ ok: true }), requestPermission: async () => ({ ok: true }),
    start(opts: ListenOptions) {
      p.starts++;
      const next = script.shift();
      let resolve!: (r: RecognitionResult) => void;
      let reject!: (e: unknown) => void;
      const result = new Promise<RecognitionResult>((res, rej) => { resolve = res; reject = rej; });
      setTimeout(() => {
        if (next instanceof Error) reject(next);
        else if (next === undefined) resolve({ alternatives: [], provider: 'server' });
        else { opts.onInterim?.(next.slice(0, 2)); resolve({ alternatives: [{ transcript: next }], provider: 'server' }); }
      }, 5);
      return { id: p.starts, result, stop() {}, abort() { resolve({ alternatives: [], provider: 'server' }); } };
    },
  };
  return p;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('always-on listening', () => {
  it('keeps listening, utterance after utterance, without a button', async () => {
    const provider = scriptedProvider(['cat', 'sun', 'map']);
    const finals: string[] = [];
    const partials: string[] = [];
    const ears = startContinuous(provider, {
      lang: 'en-US',
      onResult: (alts, final) => (final ? finals : partials).push(alts[0].transcript),
      onError: () => undefined,
    });
    await wait(80);
    ears.stop();
    expect(finals.slice(0, 3)).toEqual(['cat', 'sun', 'map']);
    expect(partials.length).toBeGreaterThan(0);         // partial results arrive while speaking
    expect(provider.starts).toBeGreaterThanOrEqual(3);  // restarted by itself
  });

  it('a passing hiccup is reported and listening carries on; a blocked microphone stops it', async () => {
    const errors: Array<[string, boolean]> = [];
    const finals: string[] = [];
    const provider = scriptedProvider([new SpeechError('network'), 'cat', new SpeechError('permission-denied'), 'never']);
    const ears = startContinuous(provider, {
      lang: 'en-US', onResult: (a, f) => { if (f) finals.push(a[0].transcript); }, onError: (e, fatal) => errors.push([e.code, fatal]),
    });
    await wait(1300);
    ears.stop();
    expect(errors).toEqual([['network', false], ['permission-denied', true]]);
    expect(finals).toEqual(['cat']);
  });

  it('stops for good when asked (pause, end of level)', async () => {
    const provider = scriptedProvider(['cat', 'sun', 'map', 'pig', 'hen']);
    const finals: string[] = [];
    const ears = startContinuous(provider, { lang: 'en-US', onResult: (a, f) => { if (f) finals.push(a[0].transcript); }, onError: () => undefined });
    await wait(12);
    ears.stop();
    const n = finals.length;
    await wait(60);
    expect(finals.length).toBe(n);
  });

  it('the development simulator listens continuously too, and says so', () => {
    const sim = new SimulatedProvider();
    expect(sim.simulated).toBe(true);
    const got: string[] = [];
    const ears = sim.listen!({ lang: 'he-IL', onResult: (a) => got.push(a[0].transcript), onError: () => undefined, simulateTarget: () => 'מ' });
    simulatorBus.emit('answer', 'correct');
    simulatorBus.emit('answer', 'silence');
    simulatorBus.emit('answer', 'wrong');
    ears.stop();
    simulatorBus.emit('answer', 'correct');
    expect(got).toEqual(['מ', 'מכונית']);
  });
});

describe('live listening in the Android app (native plugin with partial results)', () => {
  it('delivers words while they are said, then the final words, then listens again', async () => {
    const { listenLive } = await import('../src/speech/nativeProvider');
    let partial: ((d: { matches?: string[] }) => void) | null = null;
    let listening = false;
    let starts = 0;
    const plugin = {
      available: async () => ({ available: true }),
      requestPermissions: async () => ({ speechRecognition: 'granted' }),
      start: async () => { starts++; listening = true; return {}; },
      stop: async () => { listening = false; },
      isListening: async () => ({ listening }),
      addListener: async (_e: 'partialResults', fn: (d: { matches?: string[] }) => void) => { partial = fn; return { remove: () => undefined }; },
    };
    const got: Array<[string, boolean]> = [];
    const session = listenLive(plugin, { lang: 'he-IL', onResult: (a, final) => got.push([a[0].transcript, final]), onError: () => undefined });
    await new Promise((r) => setTimeout(r, 30));
    partial!({ matches: ['מם'] });                 // live, mid-utterance
    expect(got).toEqual([['מם', false]]);
    partial!({ matches: ['מם למד'] });
    listening = false;                             // the child paused
    await new Promise((r) => setTimeout(r, 900));
    expect(got.at(-1)).toEqual(['מם למד', true]);  // final words delivered
    expect(starts).toBeGreaterThanOrEqual(2);      // and it is listening again
    session.stop();
  });

  it('a blocked microphone stops live listening and is reported', async () => {
    const { listenLive } = await import('../src/speech/nativeProvider');
    const errors: Array<[string, boolean]> = [];
    const plugin = {
      available: async () => ({ available: true }),
      requestPermissions: async () => ({ speechRecognition: 'denied' }),
      start: async () => { throw new Error('Missing permission'); },
      stop: async () => undefined,
      isListening: async () => ({ listening: false }),
      addListener: async () => ({ remove: () => undefined }),
    };
    listenLive(plugin, { lang: 'he-IL', onResult: () => undefined, onError: (e, fatal) => errors.push([e.code, fatal]) });
    await new Promise((r) => setTimeout(r, 50));
    expect(errors).toEqual([['permission-denied', true]]);
  });
});
