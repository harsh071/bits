import { useMemo, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { Mascot, type MascotState } from "../components/Mascot";
import { GenUIBlock } from "../genui";
import { Thread } from "../components/Thread";
import { Composer } from "../components/Composer";
import { EmptyState } from "../components/EmptyState";
import { buildBlocks } from "../lib/blocks";
import { useTheme } from "../store/theme";
import { useVoice } from "../voice/voice";
import { VoiceOverlay } from "../voice/VoiceOverlay";
import { installArtifactMock } from "./mockFetch";
import { ArtifactEmbed } from "../artifacts/ArtifactEmbed";
import { FX_ARTIFACT, NODES, PRESENTS, msg, sampleMessages } from "./samples";

installArtifactMock();
const STATES: MascotState[] = ["idle", "thinking", "working", "listening", "speaking", "waiting", "offline"];

export default function Fixtures() {
  const { dark, cycle } = useTheme();
  const [sent, setSent] = useState<string[]>([]);
  const messages = useMemo(sampleMessages, []);
  const blocks = useMemo(() => buildBlocks(messages, {}), [messages]);
  const liveBlocks = useMemo(
    () =>
      buildBlocks(
        [msg("user", [{ type: "text", text: "Plan my week" }], { id: "lu" }), msg("assistant", [{ type: "tool-call", toolCallId: "l1", toolName: "read_file", input: { path: "calendar/week.ics" } }], { id: "la", turnId: "t9" })],
        {
          live: { turnId: "t9", text: "Here’s a first pass at your week. Monday looks **light**, so I’d put deep work there and" },
          runningTurnId: "t9",
          pending: [{ id: "p1", conversationId: "x", text: "Also keep Friday afternoon free", source: "app", createdAt: Date.now(), status: "failed" }],
        },
      ),
    [],
  );
  const onSend = (t: string) => setSent((s) => [...s, t]);

  return (
    <div className="min-h-dvh bg-bg pb-24">
      <div className="sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-bg/85 px-4 py-3 backdrop-blur-xl sm:px-8">
        <Mascot size={28} />
        <div className="font-serif text-[22px]">Bits · fixtures</div>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() =>
            useVoice.setState({
              active: true,
              phase: "speaking",
              userCaption: "What's the weather like tomorrow?",
              botCaption: "Tomorrow looks **crisp and sunny** — a high of 14°, with a light breeze in the afternoon.",
              error: null,
            })
          }
          className="rounded-full border border-line px-3 py-1.5 text-[13px] text-ink-2 hover:bg-surface-2"
        >
          Preview voice
        </button>
        <button type="button" onClick={cycle} aria-label="Toggle theme" className="grid h-9 w-9 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-ink">
          {dark ? <Sun size={17} /> : <Moon size={17} />}
        </button>
      </div>

      <VoiceOverlay />
      <div className="mx-auto max-w-[1100px] px-4 sm:px-8">
        {(["binary", "pixel"] as const).map((variant) => (
          <div key={variant}>
            <h2 className="mt-10 mb-4 text-[13px] font-semibold uppercase tracking-[0.08em] text-muted">Mascot states · {variant}</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
              {STATES.map((s) => (
                <div key={s} className="flex flex-col items-center gap-3 rounded-[18px] border border-line bg-surface py-5">
                  <Mascot variant={variant} state={s} size={64} level={() => 0.3 + 0.3 * Math.sin(performance.now() / 160)} />
                  <div className="flex items-end gap-2">
                    <Mascot variant={variant} state={s} size={22} />
                    <Mascot variant={variant} state={s} size={30} />
                  </div>
                  <span className="text-[12.5px] text-muted">{s}</span>
                </div>
              ))}
            </div>
          </div>
        ))}

        <div className="mt-12 grid grid-cols-1 gap-10 lg:grid-cols-2">
          <div className="min-w-0">
            <h2 className="mb-4 text-[13px] font-semibold uppercase tracking-[0.08em] text-muted">Thread (finished turn, approval, ask_user waiting)</h2>
            <Thread blocks={blocks} onSend={onSend} waiting />
            <h2 className="mt-12 mb-4 text-[13px] font-semibold uppercase tracking-[0.08em] text-muted">Live turn + failed send</h2>
            <Thread blocks={liveBlocks} onSend={onSend} running activity="Reading your calendar" />
            <div className="mt-8">
              <Composer onSend={onSend} onMic={() => {}} />
            </div>
            <div className="mt-3">
              <Composer onSend={onSend} running onStop={() => {}} compact placeholder="Compact (overlay) composer, running" />
            </div>
            {sent.length > 0 && <div className="mt-3 text-[12.5px] text-muted">Sent: {sent.join(" · ")}</div>}
            <h2 className="mt-12 mb-2 text-[13px] font-semibold uppercase tracking-[0.08em] text-muted">Empty state</h2>
            <div className="rounded-[22px] border border-line">
              <EmptyState onPick={onSend} compact />
            </div>
          </div>
          <div className="min-w-0">
            <h2 className="mb-4 text-[13px] font-semibold uppercase tracking-[0.08em] text-muted">Agentable · present</h2>
            <div className="mb-12 flex flex-col gap-8">
              {PRESENTS.map((p) => (
                <div key={p.name}>
                  <div className="mb-2 font-mono text-[11.5px] text-faint">{p.name}</div>
                  <GenUIBlock part={{ type: "tool-call", toolCallId: p.name, toolName: "present", input: { title: p.title, program: p.program } }} onAction={onSend} />
                </div>
              ))}
            </div>
            <h2 className="mb-4 text-[13px] font-semibold uppercase tracking-[0.08em] text-muted">Artifact (mocked fetch)</h2>
            <div className="mb-12">
              <ArtifactEmbed id={FX_ARTIFACT} />
            </div>
            <h2 className="mb-4 text-[13px] font-semibold uppercase tracking-[0.08em] text-muted">Legacy render_ui catalog</h2>
            <div className="flex flex-col gap-8">
              {NODES.map(({ name, node }) => (
                <div key={name}>
                  <div className="mb-2 font-mono text-[11.5px] text-faint">{name}</div>
                  <GenUIBlock part={{ type: "tool-call", toolCallId: name, toolName: "render_ui", input: { ui: node } }} onAction={onSend} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
