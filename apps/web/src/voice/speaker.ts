import { api } from "../api";
import { levels } from "./levels";

type Mode = "browser" | "server";

interface Item {
  text: string;
  blob?: Promise<Blob>;
  abort?: AbortController;
}

/** Sequential sentence-by-sentence TTS with prefetch and instant stop (barge-in). */
export class Speaker {
  private queue: Item[] = [];
  private gen = 0;
  private audio: HTMLAudioElement | null = null;
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private levelTimer: ReturnType<typeof setInterval> | undefined;
  private browserPending = 0;
  private playing = false;
  onChange?: (speaking: boolean, sentence?: string) => void;

  private mode: Mode;
  constructor(mode: Mode) {
    this.mode = mode;
  }

  get speaking() {
    return this.playing || this.queue.length > 0 || this.browserPending > 0;
  }

  enqueue(text: string) {
    const t = text.trim();
    if (!t) return;
    if (this.mode === "browser") return this.speakBrowser(t);
    this.queue.push({ text: t });
    this.prefetch();
    void this.pump();
  }

  private prefetch() {
    // Current + next sentence in flight at most.
    for (const item of this.queue.slice(0, 2)) {
      if (item.blob) continue;
      item.abort = new AbortController();
      item.blob = api.speak(item.text, item.abort.signal);
      item.blob.catch(() => {});
    }
  }

  private ensureCtx() {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 512;
      this.analyser.connect(this.ctx.destination);
    }
    void this.ctx.resume().catch(() => {});
    if (!this.levelTimer) {
      const buf = new Float32Array(512);
      this.levelTimer = setInterval(() => {
        if (!this.analyser || !this.playing) {
          levels.out *= 0.8;
          return;
        }
        this.analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
        const v = Math.min(1, Math.sqrt(Math.sqrt(sum / buf.length)) * 2.4);
        levels.out = levels.out * 0.5 + v * 0.5;
      }, 30);
    }
  }

  private async pump() {
    if (this.playing) return;
    const item = this.queue[0];
    if (!item) {
      this.onChange?.(false);
      return;
    }
    const gen = this.gen;
    this.playing = true;
    this.ensureCtx();
    let blob: Blob;
    try {
      blob = await item.blob!;
    } catch {
      if (gen !== this.gen) return;
      this.queue.shift();
      this.playing = false;
      this.prefetch();
      return void this.pump();
    }
    if (gen !== this.gen) return;
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    this.audio = audio;
    try {
      this.ctx!.createMediaElementSource(audio).connect(this.analyser!);
    } catch {
      /* fall back to direct playback */
    }
    this.onChange?.(true, item.text);
    const done = () => {
      URL.revokeObjectURL(url);
      if (gen !== this.gen) return;
      this.queue.shift();
      this.playing = false;
      this.audio = null;
      this.prefetch();
      void this.pump();
    };
    audio.onended = done;
    audio.onerror = done;
    audio.play().catch(done);
  }

  private speakBrowser(text: string) {
    if (!("speechSynthesis" in window)) return;
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.04;
    const gen = this.gen;
    this.browserPending++;
    u.onstart = () => {
      if (gen !== this.gen) return;
      this.playing = true;
      this.onChange?.(true, text);
      this.syntheticPulse();
    };
    u.onend = u.onerror = () => {
      if (gen !== this.gen) return;
      this.browserPending = Math.max(0, this.browserPending - 1);
      if (!this.browserPending) {
        this.playing = false;
        this.onChange?.(false);
      }
    };
    speechSynthesis.speak(u);
  }

  /** speechSynthesis gives us no audio stream, so fake a lively level. */
  private syntheticPulse() {
    if (this.levelTimer) return;
    const t0 = performance.now();
    this.levelTimer = setInterval(() => {
      if (!this.playing) {
        levels.out *= 0.7;
        return;
      }
      const t = (performance.now() - t0) / 1000;
      const v = 0.35 + 0.25 * Math.sin(t * 11) * Math.sin(t * 3.7) + 0.15 * Math.random();
      levels.out = levels.out * 0.5 + Math.max(0, v) * 0.5;
    }, 40);
  }

  /** Stop immediately and drop everything queued. */
  stop() {
    this.gen++;
    for (const item of this.queue) item.abort?.abort();
    this.queue = [];
    this.browserPending = 0;
    if (this.mode === "browser" && "speechSynthesis" in window) speechSynthesis.cancel();
    if (this.audio) {
      this.audio.onended = null;
      this.audio.pause();
      this.audio = null;
    }
    const was = this.playing;
    this.playing = false;
    levels.out = 0;
    if (was) this.onChange?.(false);
  }

  dispose() {
    this.stop();
    clearInterval(this.levelTimer);
    this.levelTimer = undefined;
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
  }
}
