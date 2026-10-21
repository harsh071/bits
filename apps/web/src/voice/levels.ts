/** Live audio levels (0..1), written ~30×/s by the audio engines and read by the mascot via rAF. */
export const levels = { mic: 0, out: 0 };
export const micLevel = () => levels.mic;
export const outLevel = () => levels.out;
