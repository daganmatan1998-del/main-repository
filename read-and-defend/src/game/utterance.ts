import type { LanguageCode, LearningItem } from '../content/types';
import type { EvalConfig } from '../evaluation/config';
import { evaluate, prefixCoverage, type RecognitionAlternative } from '../evaluation/evaluator';
import { HE_FILLERS, normalizeEnglish, normalizeHebrew } from '../evaluation/normalize';
import type { Enemy } from './levelState';

/**
 * One stretch of speech can defeat several monsters.
 *
 * With the microphone always open, a fast reader says "מם, למד, שין" in one
 * breath, and the recogniser returns it as one utterance. Evaluating that
 * whole string against one target fails, and the child has to repeat
 * themselves — the bug this module exists to fix. Instead the utterance is
 * split into tokens and matched, left to right, against every monster on the
 * road (the one nearest the castle first), so each word read is credited.
 *
 * It is also called on *partial* results while the child is still speaking,
 * so a reading is credited as soon as it is recognisable, and the start of a
 * longer word can be enough (see prefixCoverage).
 *
 * Guard rails, because the microphone also hears the room:
 *  - most of what was said must be readings (a parent's "מה אתה עושה" does
 *    not defeat the מ monster just because it starts with "מה");
 *  - inside a multi-word utterance a letter is only matched by its name or
 *    sound, never by the "short word that starts with the letter" recovery;
 *  - only the monster nearest the castle can be guessed from a word's start.
 */

export interface Hit {
  enemyId: number;
  /** Which of the enemy's items was read (a boss has three). */
  phase: number;
  via: 'match' | 'prefix';
}

export interface MatchOptions {
  lang: LanguageCode;
  /** The engine has finished this utterance (otherwise it is a partial result). */
  final: boolean;
  cfg: EvalConfig;
}

/** Share of the utterance's tokens that must be readings, when it has 3+ tokens. */
export const MIN_READING_SHARE = 0.5;
const EN_HESITATIONS = new Set(['um', 'uh', 'er', 'erm', 'hmm', 'oh', 'okay', 'ok']);
const MAX_WINDOW = 3;

export function tokenize(text: string, lang: LanguageCode): string[] {
  if (lang === 'he') {
    const all = normalizeHebrew(text).split(' ').filter(Boolean);
    const content = all.filter((t) => !HE_FILLERS.has(t));
    return content.length ? content : all;
  }
  return normalizeEnglish(text).split(' ').filter((t) => t && !EN_HESITATIONS.has(t));
}

interface Candidate { enemy: Enemy; phase: number }

const itemOf = (c: Candidate): LearningItem => c.enemy.items[Math.min(c.phase, c.enemy.items.length - 1)];

function matchAlternative(alt: RecognitionAlternative, enemies: Enemy[], opts: MatchOptions): Hit[] {
  const tokens = tokenize(alt.transcript, opts.lang);
  if (!tokens.length) return [];
  // Counted with fillers: "מה זה" is two words, not the letter-sound "מה".
  const spokenWords = alt.transcript.trim().split(/\s+/).filter(Boolean).length;
  const cands: Candidate[] = enemies.map((e) => ({ enemy: e, phase: e.phase }));
  const hits: Hit[] = [];
  const say = (text: string): RecognitionAlternative[] => [{ transcript: text, confidence: alt.confidence }];

  // A sentence is read as a whole.
  for (const c of cands) {
    if (itemOf(c).kind === 'sentence' && evaluate(itemOf(c), [alt], opts.cfg).outcome === 'correct') {
      return [{ enemyId: c.enemy.id, phase: c.phase, via: 'match' }];
    }
  }

  let lastEnd = -1; // token index just after the last match
  const credit = (c: Candidate, via: Hit['via']) => {
    hits.push({ enemyId: c.enemy.id, phase: c.phase, via });
    if (c.phase < c.enemy.items.length - 1) c.phase += 1; // a boss moves on to its next word
    else cands.splice(cands.indexOf(c), 1);
  };

  if (tokens.length === 1 && spokenWords === 1) {
    // A single word: the full evaluator, including the letter recovery rules.
    const c = cands.find((x) => evaluate(itemOf(x), say(tokens[0]), opts.cfg).outcome === 'correct');
    if (c) { credit(c, 'match'); lastEnd = 1; }
  } else {
    // Several words: no "short word starting with the letter" recovery.
    const strictCfg: EvalConfig = { ...opts.cfg, he: { ...opts.cfg.he, letterRecoveryMax: 0 } };
    let i = 0;
    let consumed = 0;
    while (i < tokens.length) {
      let matched = false;
      // Shortest window first: one token is one reading unless it takes two
      // words to say ("double you", "מם סופית").
      for (let w = 1; w <= Math.min(MAX_WINDOW, tokens.length - i) && !matched; w++) {
        const text = tokens.slice(i, i + w).join(' ');
        const c = cands.find((x) => itemOf(x).kind !== 'sentence' && evaluate(itemOf(x), say(text), strictCfg).outcome === 'correct');
        if (c) { credit(c, 'match'); i += w; consumed += w; matched = true; lastEnd = i; }
      }
      if (!matched) i += 1;
    }
    if (tokens.length >= 3 && consumed / tokens.length < MIN_READING_SHARE) return [];
  }

  // The last word may still be being said (or was cut off): guess from its start,
  // for the monster nearest the castle only.
  const lastToken = tokens[tokens.length - 1];
  const front = cands[0];
  const lastUsed = lastEnd === tokens.length;
  void spokenWords;
  if (front && !lastUsed && enemies[0] && front.enemy.id === enemies[0].id) {
    const coverage = prefixCoverage(itemOf(front), lastToken, opts.cfg);
    const needed = opts.final ? opts.cfg.prefix.fallback : opts.cfg.prefix.early;
    const readingLike = tokens.length < 3 || (hits.length + 1) / tokens.length >= MIN_READING_SHARE;
    if (coverage > 0 && coverage >= needed && readingLike) credit(front, 'prefix');
  }
  return hits;
}

/**
 * The readings in one utterance, in the order they were said. `enemies` are
 * the monsters currently walking, nearest the castle first. The alternative
 * that explains the most readings wins.
 */
export function matchUtterance(alts: RecognitionAlternative[], enemies: Enemy[], opts: MatchOptions): Hit[] {
  let best: Hit[] = [];
  for (const alt of alts.slice(0, 5)) {
    if (!alt.transcript?.trim()) continue;
    const hits = matchAlternative(alt, enemies, opts);
    if (hits.length > best.length) best = hits;
  }
  return best;
}

/** Monsters on the road, nearest the castle first (the reading order). */
export function readingOrder(enemies: Enemy[]): Enemy[] {
  return enemies.filter((e) => e.status === 'walking').sort((a, b) => b.progress - a.progress);
}
