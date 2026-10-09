import {
  FATAL_SPEECH_ERRORS, SpeechError, type ContinuousOptions, type ContinuousSession, type SpeechProvider,
} from './types';

/**
 * Open the microphone for the whole level.
 *
 * Engines with a native continuous mode (the browser recogniser, the
 * simulator) use it. The others (the server proxy, the native plugin) are
 * driven as a loop of single utterances: each one ends on silence, its text
 * is delivered as a final result, and the next one starts at once. The
 * server engine never uploads a clip in which no speech was detected, so an
 * open microphone in a quiet room sends nothing anywhere.
 */
export function startContinuous(provider: SpeechProvider, opts: ContinuousOptions): ContinuousSession {
  if (provider.listen) return provider.listen(opts);

  let stopped = false;
  let current: { abort(): void } | null = null;
  let n = 0;
  let failures = 0;
  const loop = async () => {
    while (!stopped) {
      const id = `loop:${++n}`;
      const session = provider.start({
        lang: opts.lang,
        maxDurationMs: 12000,
        onLevel: opts.onLevel,
        onInterim: (text) => { if (!stopped && text.trim()) opts.onResult([{ transcript: text }], false, id); },
        simulateTarget: opts.simulateTarget?.(),
      });
      current = session;
      try {
        const res = await session.result;
        failures = 0;
        if (!stopped && res.alternatives.length) opts.onResult(res.alternatives, true, id);
      } catch (e) {
        const err = e instanceof SpeechError ? e : new SpeechError('unknown', String(e));
        if (err.code === 'aborted') continue;
        const fatal = FATAL_SPEECH_ERRORS.has(err.code);
        opts.onError(err, fatal);
        if (fatal) { stopped = true; return; }
        failures += 1;
        await new Promise((r) => setTimeout(r, Math.min(8000, 1000 * failures)));
      }
    }
  };
  loop();
  return { stop: () => { stopped = true; current?.abort(); } };
}
