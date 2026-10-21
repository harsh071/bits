import { create } from "zustand";

export type ThemePref = "system" | "light" | "dark";

function read(): ThemePref {
  try {
    const t = localStorage.getItem("bits.theme");
    return t === "light" || t === "dark" ? t : "system";
  } catch {
    return "system";
  }
}

function apply(pref: ThemePref) {
  const root = document.documentElement;
  if (pref === "system") delete root.dataset.theme;
  else root.dataset.theme = pref;
}

const media = typeof window !== "undefined" ? window.matchMedia("(prefers-color-scheme: dark)") : null;

export function resolvedDark(pref: ThemePref) {
  return pref === "dark" || (pref === "system" && !!media?.matches);
}

export const useTheme = create<{ pref: ThemePref; dark: boolean; cycle: () => void; set: (p: ThemePref) => void }>()(
  (set, get) => {
    media?.addEventListener("change", () => set({ dark: resolvedDark(get().pref) }));
    return {
      pref: read(),
      dark: resolvedDark(read()),
      set(pref) {
        try {
          if (pref === "system") localStorage.removeItem("bits.theme");
          else localStorage.setItem("bits.theme", pref);
        } catch {
          /* ignore */
        }
        apply(pref);
        set({ pref, dark: resolvedDark(pref) });
      },
      cycle() {
        // Toggle against what's currently on screen, so one click always flips it.
        get().set(get().dark ? "light" : "dark");
      },
    };
  },
);
