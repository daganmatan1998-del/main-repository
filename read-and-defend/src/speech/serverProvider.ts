import { mapMediaError, requestMicrophone } from './micPermission';
import {
  nextSessionId, SpeechError, type Availability, type ListenOptions, type ListenSession,
  type RecognitionResult, type SpeechProvider,
} from './types';

/**
 * Records a short clip and sends it to OUR server proxy (see server/), which
 * forwards it to a transcription service using a key the browser never sees.
 *
 * Privacy: audio lives only in memory for the length of one reading, is sent
 * once, and is never written to storage. Clips with no detected speech are
 * never uploaded at all.
 *
 * Expected endpoint contract:
 *   GET  {endpoint}/health            → 200 {"ok":true}
 *   POST {endpoint}?lang=he-IL        body: audio blob
 *                                     → 200 {"text": "...", "alternatives"?: [{"transcript","confidence"?}]}
 */
export class ServerProvider implements SpeechProvider {
  readonly id = 'server' as const;
  readonly simulated = false;

  constructor(private endpoint: string) {}

  async checkAvailability(): Promise<Availability> {
    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      return { ok: false, reason: 'not-supported' };
    }
    if (window.isSecureContext === false) return { ok: false, reason: 'insecure-context' };
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 4000);
      const res = await fetch(`${this.endpoint.replace(/\/$/, '')}/health`, { signal: ctrl.signal });
      clearTimeout(t);
      if (!res.ok) return { ok: false, reason: res.status === 503 ? 'not-configured' : 'service-unavailable' };
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean };
      return body.ok ? { ok: true } : { ok: false, reason: 'not-configured' };
    } catch {
      return { ok: false, reason: 'not-configured', detail: 'No speech server at ' + this.endpoint };
    }
  }

  requestPermission(): Promise<Availability> {
    return requestMicrophone();
  }

  start(opts: ListenOptions): ListenSession {
    const id = nextSessionId();
    let stopRequested = false;
    let aborted = false;
    let stopFn: () => void = () => { stopRequested = true; };

    const result = (async (): Promise<RecognitionResult> => {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      } catch (e) {
        throw mapMediaError(e);
      }
      const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find((m) => MediaRecorder.isTypeSupported?.(m)) ?? '';
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };

      // Level meter + simple voice-activity detection.
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AC();
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      src.connect(analyser);
      const buf = new Float32Array(analyser.fftSize);
      let heardSpeech = false;
      let lastLoud = performance.now();
      const started = performance.now();
      const SPEECH_RMS = 0.03;

      const done = new Promise<void>((resolve) => { rec.onstop = () => resolve(); });
      stopFn = () => { if (rec.state === 'recording') rec.stop(); };
      rec.start(250);
      if (stopRequested) stopFn();

      const maxMs = opts.maxDurationMs ?? 9000;
      const meter = setInterval(() => {
        analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
        const rms = Math.sqrt(sum / buf.length);
        opts.onLevel?.(Math.min(1, rms * 8));
        const now = performance.now();
        if (rms > SPEECH_RMS) { heardSpeech = true; lastLoud = now; }
        // Auto-stop: 1.2 s of quiet after speech, or the hard limit.
        if ((heardSpeech && now - lastLoud > 1200) || now - started > maxMs) stopFn();
      }, 60);

      await done;
      clearInterval(meter);
      stream.getTracks().forEach((t) => t.stop());
      ctx.close().catch(() => undefined);

      if (aborted || !heardSpeech) return { alternatives: [], provider: this.id };
      const blob = new Blob(chunks, { type: rec.mimeType || mime || 'audio/webm' });
      chunks.length = 0;
      let res: Response;
      try {
        res = await fetch(`${this.endpoint}?lang=${encodeURIComponent(opts.lang)}`, {
          method: 'POST', body: blob, headers: { 'Content-Type': blob.type },
        });
      } catch {
        throw new SpeechError('network');
      }
      if (res.status === 503) throw new SpeechError('not-configured');
      if (!res.ok) throw new SpeechError('service-unavailable', `HTTP ${res.status}`);
      const body = (await res.json()) as { text?: string; alternatives?: Array<{ transcript: string; confidence?: number }> };
      const alts = body.alternatives?.length ? body.alternatives : body.text ? [{ transcript: body.text }] : [];
      return { alternatives: alts, provider: this.id };
    })();

    return {
      id,
      result,
      stop: () => stopFn(),
      abort: () => { aborted = true; stopFn(); },
    };
  }
}
