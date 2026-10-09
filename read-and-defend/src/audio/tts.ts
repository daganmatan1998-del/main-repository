/**
 * Example pronunciation and spoken instructions via the platform's speech
 * synthesis. Hebrew voices are not installed everywhere; when none exists we
 * say so rather than reading Hebrew with an English voice.
 */
export class Speaker {
  private voices: SpeechSynthesisVoice[] = [];

  constructor() {
    if (typeof speechSynthesis === 'undefined') return;
    const load = () => { this.voices = speechSynthesis.getVoices(); };
    load();
    speechSynthesis.addEventListener?.('voiceschanged', load);
  }

  get supported(): boolean {
    return typeof speechSynthesis !== 'undefined';
  }

  voiceFor(lang: string): SpeechSynthesisVoice | null {
    const base = lang.slice(0, 2).toLowerCase();
    const matches = this.voices.filter((v) => v.lang.toLowerCase().replace('_', '-').startsWith(base) || (base === 'he' && v.lang.toLowerCase().startsWith('iw')));
    return matches.find((v) => v.lang.toLowerCase() === lang.toLowerCase()) ?? matches[0] ?? null;
  }

  canSpeak(lang: string): boolean {
    return this.supported && !!this.voiceFor(lang);
  }

  speak(text: string, lang: string, rate = 0.8): Promise<void> {
    return new Promise((resolve) => {
      if (!this.supported) return resolve();
      const voice = this.voiceFor(lang);
      if (!voice) return resolve();
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = voice.lang;
      u.voice = voice;
      u.rate = rate;
      u.onend = () => resolve();
      u.onerror = () => resolve();
      speechSynthesis.speak(u);
      setTimeout(resolve, 6000);
    });
  }

  cancel(): void {
    if (this.supported) speechSynthesis.cancel();
  }
}

export const speaker = new Speaker();
