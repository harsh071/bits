import { useChat, isTerminal } from "../store/chat";
import { useVoice } from "../voice/voice";
import type { MascotState } from "../components/Mascot";

/** What the mascot should be doing for a conversation, plus a short human status line. */
export function useAgentStatus(conversationId: string): { state: MascotState; label: string; running: boolean } {
  const turn = useChat((s) => s.turns[conversationId]);
  const live = useChat((s) => !!s.live[conversationId]?.text);
  const connection = useChat((s) => s.connection);
  const voiceActive = useVoice((s) => s.active && s.conversationId === conversationId);
  const voicePhase = useVoice((s) => s.phase);

  const running = !!turn && !isTerminal(turn.status) && turn.status !== "waiting";
  if (voiceActive && voicePhase === "speaking") return { state: "speaking", label: "Speaking…", running };
  if (turn?.status === "waiting") return { state: "waiting", label: "Needs your OK", running: false };
  if (running) {
    if (turn!.activity && !/^thinking/i.test(turn!.activity)) return { state: "working", label: turn!.activity, running };
    return { state: "thinking", label: live ? "Writing…" : turn!.status === "queued" ? "Getting ready…" : "Thinking…", running };
  }
  if (voiceActive && (voicePhase === "listening" || voicePhase === "transcribing"))
    return { state: "listening", label: voicePhase === "transcribing" ? "Got it…" : "Listening…", running };
  if (connection === "offline") return { state: "offline", label: "Waking up…", running };
  return { state: "idle", label: "Here with you", running };
}
