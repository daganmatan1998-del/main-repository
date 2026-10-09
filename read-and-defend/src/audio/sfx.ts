/**
 * Synthesised sound effects (Web Audio) — no audio files to load, license or
 * fail to fetch. Every sound is soft; the "try again" sound is a gentle
 * two-note hum, never a buzzer. If audio is unavailable, the game is silent
 * and otherwise unchanged.
 */
type Sfx = 'zap' | 'pop' | 'correct' | 'tryAgain' | 'unclear' | 'breach' | 'win' | 'lose' | 'tap' | 'listen' | 'coin' | 'boss';

export class SoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  enabled = true;

  /** Must be called from a user gesture on iOS before sound can play. */
  unlock(): void {
    if (this.ctx) { this.ctx.resume().catch(() => undefined); return; }
    try {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.35;
      this.master.connect(this.ctx.destination);
    } catch {
      this.ctx = null;
    }
  }

  private tone(freq: number, start: number, dur: number, type: OscillatorType = 'sine', vol = 0.5, slideTo?: number): void {
    if (!this.ctx || !this.master) return;
    const t0 = this.ctx.currentTime + start;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  private noise(start: number, dur: number, vol = 0.3, freq = 1200): void {
    if (!this.ctx || !this.master) return;
    const len = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.value = vol;
    src.connect(f).connect(g).connect(this.master);
    src.start(this.ctx.currentTime + start);
  }

  play(s: Sfx): void {
    if (!this.enabled || !this.ctx) return;
    try {
      switch (s) {
        case 'zap': this.tone(880, 0, 0.25, 'triangle', 0.35, 1760); break;
        case 'pop': this.noise(0, 0.25, 0.4, 900); this.tone(520, 0, 0.18, 'sine', 0.3, 180); break;
        case 'correct': [523, 659, 784].forEach((f, i) => this.tone(f, i * 0.08, 0.22, 'triangle', 0.35)); break;
        case 'tryAgain': this.tone(392, 0, 0.18, 'sine', 0.25); this.tone(440, 0.16, 0.24, 'sine', 0.25); break;
        case 'unclear': this.tone(600, 0, 0.12, 'sine', 0.18); this.tone(600, 0.15, 0.12, 'sine', 0.18); break;
        case 'breach': this.noise(0, 0.35, 0.35, 300); this.tone(180, 0, 0.3, 'sine', 0.3, 110); break;
        case 'win': [523, 659, 784, 1047, 784, 1047].forEach((f, i) => this.tone(f, i * 0.11, 0.3, 'triangle', 0.32)); break;
        case 'lose': [392, 349, 330].forEach((f, i) => this.tone(f, i * 0.2, 0.35, 'sine', 0.22)); break;
        case 'tap': this.tone(700, 0, 0.06, 'sine', 0.15); break;
        case 'listen': this.tone(660, 0, 0.1, 'sine', 0.2, 990); break;
        case 'coin': this.tone(988, 0, 0.08, 'square', 0.12); this.tone(1319, 0.07, 0.16, 'square', 0.12); break;
        case 'boss': this.tone(110, 0, 0.6, 'sawtooth', 0.15, 80); this.noise(0, 0.5, 0.15, 200); break;
      }
    } catch { /* never let sound break the game */ }
  }
}

export const sound = new SoundEngine();
