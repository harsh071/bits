import { create } from "zustand";

/** How Bits looks: "binary" (0 and 1 eyes, the default) or "pixel" (an 8×8 LED sprite). */
export type MascotStyle = "binary" | "pixel";

export const MASCOT_STYLES: { id: MascotStyle; label: string }[] = [
  { id: "binary", label: "Binary" },
  { id: "pixel", label: "Pixel" },
];

const KEY = "bits.mascot";

function read(): MascotStyle {
  try {
    return localStorage.getItem(KEY) === "pixel" ? "pixel" : "binary";
  } catch {
    return "binary";
  }
}

export const useMascotStyle = create<{ style: MascotStyle; set: (s: MascotStyle) => void; toggle: () => void }>()((set, get) => {
  // Keep other windows (the desktop overlay) in step.
  if (typeof window !== "undefined") {
    window.addEventListener("storage", (e) => {
      if (e.key === KEY || e.key === null) set({ style: read() });
    });
  }
  return {
    style: read(),
    set(style) {
      try {
        if (style === "binary") localStorage.removeItem(KEY);
        else localStorage.setItem(KEY, style);
      } catch {
        /* ignore */
      }
      set({ style });
    },
    toggle() {
      get().set(get().style === "binary" ? "pixel" : "binary");
    },
  };
});
