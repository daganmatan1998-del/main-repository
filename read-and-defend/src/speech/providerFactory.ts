import type { Settings } from '../progress/profile';
import { NativeProvider, getNativePlugin } from './nativeProvider';
import { ServerProvider } from './serverProvider';
import { SimulatedProvider } from './simulatedProvider';
import type { Availability, SpeechErrorCode, SpeechProvider } from './types';
import { WebSpeechProvider } from './webSpeechProvider';

export interface ProviderChoice {
  provider: SpeechProvider | null;
  /** Why each candidate was rejected, for the help screen. */
  tried: Array<{ id: string; reason?: SpeechErrorCode; detail?: string }>;
}

/**
 * Pick a working recogniser, honestly:
 *  1. Development mode → the simulator (and the UI says so everywhere).
 *  2. An explicit engine choice → that engine or nothing.
 *  3. Auto → native plugin (in the app) → browser → server proxy.
 * If nothing works, return null; the UI explains why and how to fix it.
 * The simulator is NEVER an automatic fallback.
 */
export async function chooseProvider(settings: Settings, speechLang: string): Promise<ProviderChoice> {
  if (settings.devMode) return { provider: new SimulatedProvider(), tried: [] };

  const candidates: SpeechProvider[] = [];
  const add = (id: Settings['engine']) => {
    if (id === 'native') candidates.push(new NativeProvider());
    if (id === 'browser') candidates.push(new WebSpeechProvider());
    if (id === 'server') candidates.push(new ServerProvider(settings.sttEndpoint));
  };
  if (settings.engine === 'auto') {
    if (getNativePlugin()) add('native');
    add('browser');
    add('server');
  } else {
    add(settings.engine);
  }

  const tried: ProviderChoice['tried'] = [];
  for (const p of candidates) {
    let a: Availability;
    try { a = await p.checkAvailability(speechLang); } catch { a = { ok: false, reason: 'unknown' }; }
    if (a.ok) return { provider: p, tried };
    tried.push({ id: p.id, reason: a.reason, detail: a.detail });
  }
  return { provider: null, tried };
}
