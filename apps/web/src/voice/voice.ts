import { create } from "zustand";
import type { Message, VoiceConfig } from "@bits/protocol";
import { api } from "../api";
import { isTerminal, useChat } from "../store/chat";
import { textOf } from "../lib/blocks";
import { stripMarkdown, takeSentences } from "../lib/text";
import { BrowserRecognizer, browserSttSupported, Mic } from "./mic";
import { Speaker } from "./speaker";

export type VoicePhase = "starting" | "listening" | "transcribing" | "thinking" | "speaking" | "error";

interface VoiceState {
  active: boolean;
  conversationId: string | null;
  phase: VoicePhase;
  muted: boolean;
  userCaption: string;
  botCaption: string;
  error: string | null;
  start: (conversationId: string) => Promise<void>;
  stop: () => void;
  toggleMute: () => void;
}

// Engine instances live outside React state.
let mic: Mic | null = null;
let recognizer: BrowserRecognizer | null = null;
let speaker: Speaker | null = null;
let unsubChat: (() => void) | null = null;
let transcribing = 0;

export const useVoice = create<VoiceState>()((set, get) => {
  const derivePhase = () => {
    const s = get();
    if (!s.active || s.phase === "error" || s.phase === "starting") return;
    const turn = s.conversationId ? useChat.getState().turns[s.conversationId] : undefined;
    const phase: VoicePhase = speaker?.speaking
      ? "speaking"
      : transcribing > 0
        ? "transcribing"
        : turn && !isTerminal(turn.status) && turn.status !== "waiting"
          ? "thinking"
          : "listening";
    if (phase !== s.phase) set({ phase });
    recognizer?.setPaused(phase === "speaking" || s.muted);
  };

  const sendUtterance = (text: string) => {
    const id = get().conversationId;
    if (!id || !text.trim()) return;
    set({ userCaption: text, botCaption: "" });
    void useChat.getState().send(id, text, { source: "voice" });
  };

  /** Speak the assistant's reply as it streams (live deltas), then whatever remains once persisted. */
  const watchReplies = (conversationId: string) => {
    const startSeq = useChat.getState().convs[conversationId]?.lastSeq ?? 0;
    const spoken = new Set<string>(useChat.getState().convs[conversationId]?.messages.map((m) => m.id) ?? []);
    let liveText = "";
    let liveSpoken = 0; // chars of the current live text already handed to the speaker
    let carry = 0; // chars spoken from a live stream that has since been persisted

    const speakText = (text: string, final: boolean) => {
      const { sentences, consumed } = takeSentences(text, final);
      for (const s of sentences) {
        const clean = stripMarkdown(s);
        if (clean) speaker?.enqueue(clean);
      }
      return consumed;
    };

    unsubChat = useChat.subscribe((state, prev) => {
      const live = state.live[conversationId];
      const prevLive = prev.live[conversationId];
      if (live !== prevLive) {
        const text = live?.text ?? "";
        if (text && text.startsWith(liveText)) {
          liveSpoken += speakText(text.slice(liveSpoken), false);
          set({ botCaption: text });
        } else {
          carry = liveSpoken; // stream ended (or restarted): remember how much we already said
          liveSpoken = text ? speakText(text, false) : 0;
          if (text) set({ botCaption: text });
        }
        liveText = text;
      }

      const msgs: Message[] = state.convs[conversationId]?.messages ?? [];
      if (msgs !== prev.convs[conversationId]?.messages) {
        for (const m of msgs) {
          if (spoken.has(m.id)) continue;
          spoken.add(m.id);
          if (m.role !== "assistant" || m.seq <= startSeq) continue;
          const full = textOf(m);
          if (!full) continue;
          const skip = Math.min(carry, full.length);
          carry = 0;
          // Snap to a sentence boundary we already spoke.
          speakText(full.slice(skip), true);
          set({ botCaption: full });
        }
      }
      if (state.turns[conversationId] !== prev.turns[conversationId]) derivePhase();
    });
  };

  return {
    active: false,
    conversationId: null,
    phase: "starting",
    muted: false,
    userCaption: "",
    botCaption: "",
    error: null,

    async start(conversationId) {
      if (get().active) return;
      set({ active: true, conversationId, phase: "starting", muted: false, userCaption: "", botCaption: "", error: null });
      let config: VoiceConfig = { stt: "browser", tts: "browser" };
      try {
        config = await api.voiceConfig();
      } catch {
        /* daemon offline or no voice config: fall back to the browser */
      }
      if (!get().active) return;
      const useBrowserStt = config.stt === "browser";
      if (useBrowserStt && !browserSttSupported()) {
        set({ phase: "error", error: "This browser can’t do speech recognition. Configure BITS_STT=openai, or try Chrome." });
        return;
      }

      speaker = new Speaker(config.tts === "browser" ? "browser" : "server");
      speaker.onChange = (_speaking, sentence) => {
        if (sentence) set({ botCaption: get().botCaption || sentence });
        derivePhase();
      };

      mic = new Mic({
        record: !useBrowserStt,
        outputActive: () => !!speaker?.speaking,
        onSpeechStart: () => {
          // Barge-in: the user talks over Bits → stop talking right away.
          if (speaker?.speaking) {
            speaker.stop();
            derivePhase();
          }
        },
        onUtterance: async (blob) => {
          transcribing++;
          set({ userCaption: "…" });
          derivePhase();
          try {
            const { text } = await api.transcribe(blob);
            if (get().active && text?.trim()) sendUtterance(text.trim());
            else if (get().active) set({ userCaption: "" });
          } catch {
            set({ userCaption: "Couldn’t catch that — try again?" });
          } finally {
            transcribing--;
            derivePhase();
          }
        },
      });
      try {
        await mic.start();
      } catch {
        mic = null;
        set({ phase: "error", error: "Bits needs microphone access to talk. Check your browser’s permission settings." });
        return;
      }
      if (!get().active) return mic.stop();

      if (useBrowserStt) {
        recognizer = new BrowserRecognizer({
          onInterim: (t) => set({ userCaption: t }),
          onFinal: (t) => sendUtterance(t),
          onError: (e) => set({ phase: "error", error: e }),
        });
        recognizer.start();
      }
      watchReplies(conversationId);
      set({ phase: "listening" });
      derivePhase();
    },

    stop() {
      unsubChat?.();
      unsubChat = null;
      recognizer?.stop();
      recognizer = null;
      mic?.stop();
      mic = null;
      speaker?.dispose();
      speaker = null;
      transcribing = 0;
      set({ active: false, phase: "starting", conversationId: null });
    },

    toggleMute() {
      const muted = !get().muted;
      if (mic) mic.muted = muted;
      recognizer?.setPaused(muted);
      set({ muted });
    },
  };
});
