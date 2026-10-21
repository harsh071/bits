import { levels } from "./levels";

/** Microphone + analyser + energy-based VAD, optionally recording each utterance. */
export interface VadOptions {
  record: boolean;
  onSpeechStart?: () => void;
  onUtterance?: (audio: Blob) => void;
  /** While Bits is talking we require louder speech to count as barge-in (echo guard). */
  outputActive?: () => boolean;
  silenceMs?: number;
  minSpeechMs?: number;
}

const pickMime = () => {
  for (const t of ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"]) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)) return t;
  }
  return "";
};

export class Mic {
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private buf: Float32Array<ArrayBuffer> = new Float32Array(1024);
  private timer: ReturnType<typeof setInterval> | undefined;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private noise = 0.01;
  private speaking = false;
  private aboveSince = 0;
  private belowSince = 0;
  private voicedMs = 0;
  private lastTick = 0;
  muted = false;

  private opts: VadOptions;
  constructor(opts: VadOptions) {
    this.opts = opts;
  }

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    this.ctx = new AudioContext();
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.buf = new Float32Array(this.analyser.fftSize);
    src.connect(this.analyser);
    this.lastTick = performance.now();
    this.timer = setInterval(() => this.tick(), 30);
  }

  private rms() {
    if (!this.analyser) return 0;
    this.analyser.getFloatTimeDomainData(this.buf);
    let sum = 0;
    for (let i = 0; i < this.buf.length; i++) sum += this.buf[i] * this.buf[i];
    return Math.sqrt(sum / this.buf.length);
  }

  private tick() {
    const now = performance.now();
    const dt = now - this.lastTick;
    this.lastTick = now;
    const r = this.muted ? 0 : this.rms();
    // Display level: perceptual-ish curve, smoothed.
    const display = Math.min(1, Math.sqrt(r) * 3.2);
    levels.mic = levels.mic * 0.6 + display * 0.4;
    if (this.muted) {
      if (this.speaking) this.finish(now, true);
      return;
    }

    if (!this.speaking) this.noise = this.noise * 0.97 + Math.min(r, 0.05) * 0.03;
    const echo = this.opts.outputActive?.() ? 2.2 : 1;
    const threshold = Math.max(0.012, this.noise * 2.8) * echo;

    if (r > threshold) {
      this.belowSince = 0;
      if (!this.aboveSince) this.aboveSince = now;
      if (this.speaking) this.voicedMs += dt;
      else if (now - this.aboveSince > 60) this.begin(now);
    } else {
      this.aboveSince = 0;
      if (this.speaking) {
        if (!this.belowSince) this.belowSince = now;
        if (now - this.belowSince > (this.opts.silenceMs ?? 700)) this.finish(now, false);
      }
    }
  }

  private begin(_now: number) {
    this.speaking = true;
    this.voicedMs = 60;
    this.opts.onSpeechStart?.();
    if (this.opts.record && this.stream) {
      this.chunks = [];
      const mime = pickMime();
      try {
        this.recorder = new MediaRecorder(this.stream, mime ? { mimeType: mime } : undefined);
        this.recorder.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
        this.recorder.start(100);
      } catch {
        this.recorder = null;
      }
    }
  }

  private finish(_now: number, discard: boolean) {
    this.speaking = false;
    this.belowSince = 0;
    const rec = this.recorder;
    this.recorder = null;
    const tooShort = this.voicedMs < (this.opts.minSpeechMs ?? 300);
    if (!rec) return;
    rec.onstop = () => {
      if (discard || tooShort || !this.chunks.length) return;
      this.opts.onUtterance?.(new Blob(this.chunks, { type: rec.mimeType || "audio/webm" }));
    };
    try {
      rec.stop();
    } catch {
      /* ignore */
    }
  }

  stop() {
    clearInterval(this.timer);
    if (this.recorder) {
      this.recorder.onstop = null;
      try {
        this.recorder.stop();
      } catch {
        /* ignore */
      }
    }
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close().catch(() => {});
    this.stream = null;
    this.ctx = null;
    levels.mic = 0;
  }
}

// ---------- Browser speech recognition ----------

type Rec = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
};

export function browserSttSupported() {
  const w = window as unknown as Record<string, unknown>;
  return !!(w.SpeechRecognition || w.webkitSpeechRecognition);
}

export class BrowserRecognizer {
  private rec: Rec | null = null;
  private active = false;
  private paused = false;

  private handlers: { onInterim: (t: string) => void; onFinal: (t: string) => void; onError: (e: string) => void };
  constructor(handlers: BrowserRecognizer["handlers"]) {
    this.handlers = handlers;
  }

  start() {
    const w = window as unknown as Record<string, new () => Rec>;
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) {
      this.handlers.onError("Speech recognition isn’t supported in this browser.");
      return;
    }
    this.active = true;
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = navigator.language || "en-US";
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) {
          const t = r[0].transcript.trim();
          if (t) this.handlers.onFinal(t);
        } else interim += r[0].transcript;
      }
      if (interim) this.handlers.onInterim(interim.trim());
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        this.active = false;
        this.handlers.onError("Microphone access was blocked.");
      }
    };
    rec.onend = () => {
      if (this.active && !this.paused) {
        try {
          rec.start();
        } catch {
          /* already started */
        }
      }
    };
    this.rec = rec;
    try {
      rec.start();
    } catch {
      /* ignore */
    }
  }

  /** Pause while Bits speaks so it doesn't transcribe itself. */
  setPaused(paused: boolean) {
    if (this.paused === paused || !this.rec) return;
    this.paused = paused;
    try {
      if (paused) this.rec.abort();
      else this.rec.start();
    } catch {
      /* ignore */
    }
  }

  stop() {
    this.active = false;
    try {
      this.rec?.abort();
    } catch {
      /* ignore */
    }
    this.rec = null;
  }
}
