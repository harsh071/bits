import { generateSpeech, transcribe } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { config } from "./config.ts";

// Cascaded voice: the client does VAD + capture, the daemon turns audio into text and text into audio.
// The text goes through the same conversation and agent loop as typed messages, so voice and text
// share memory, tools and generative UI. "browser" providers mean the client uses the Web Speech API.

export async function speechToText(audio: Uint8Array, mediaType: string): Promise<string> {
  if (config.voice.stt !== "openai") throw new Error("Server STT is not configured (BITS_STT=openai needs OPENAI_API_KEY)");
  const openai = createOpenAI();
  const result = await transcribe({
    model: openai.transcription(process.env.BITS_STT_MODEL ?? "gpt-4o-mini-transcribe"),
    audio,
    mediaType,
  } as any);
  return result.text.trim();
}

export async function textToSpeech(text: string): Promise<{ audio: Uint8Array; mediaType: string }> {
  if (config.voice.tts === "cartesia") {
    const r = await fetch("https://api.cartesia.ai/tts/bytes", {
      method: "POST",
      headers: {
        "X-API-Key": process.env.CARTESIA_API_KEY ?? "",
        "Cartesia-Version": process.env.CARTESIA_VERSION ?? "2025-04-16",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model_id: process.env.CARTESIA_MODEL ?? "sonic-3",
        transcript: text,
        voice: { mode: "id", id: process.env.CARTESIA_VOICE_ID ?? "694f9389-aac1-45b6-b726-9d9369183238" },
        output_format: { container: "mp3", sample_rate: 44100, bit_rate: 128000 },
        language: "en",
      }),
    });
    if (!r.ok) throw new Error(`Cartesia TTS failed: ${r.status} ${await r.text()}`);
    return { audio: new Uint8Array(await r.arrayBuffer()), mediaType: "audio/mpeg" };
  }
  if (config.voice.tts === "openai") {
    const openai = createOpenAI();
    const result = await generateSpeech({
      model: openai.speech(process.env.BITS_TTS_MODEL ?? "gpt-4o-mini-tts"),
      text,
      voice: process.env.BITS_TTS_VOICE ?? "marin",
      instructions: "Warm, friendly, natural pace. A thoughtful personal assistant.",
    } as any);
    return { audio: result.audio.uint8Array, mediaType: result.audio.mediaType ?? "audio/mpeg" };
  }
  throw new Error("Server TTS is not configured");
}
