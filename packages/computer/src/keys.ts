// Key names → CDP key events. Accepts "Enter", "Escape", "Tab", "ArrowDown", "a", "Meta+a", "Shift+Tab"…

const NAMED: Record<string, [key: string, code: string, vk: number, text?: string]> = {
  enter: ["Enter", "Enter", 13, "\r"],
  return: ["Enter", "Enter", 13, "\r"],
  tab: ["Tab", "Tab", 9],
  escape: ["Escape", "Escape", 27],
  esc: ["Escape", "Escape", 27],
  backspace: ["Backspace", "Backspace", 8],
  delete: ["Delete", "Delete", 46],
  space: [" ", "Space", 32, " "],
  arrowup: ["ArrowUp", "ArrowUp", 38],
  arrowdown: ["ArrowDown", "ArrowDown", 40],
  arrowleft: ["ArrowLeft", "ArrowLeft", 37],
  arrowright: ["ArrowRight", "ArrowRight", 39],
  up: ["ArrowUp", "ArrowUp", 38],
  down: ["ArrowDown", "ArrowDown", 40],
  left: ["ArrowLeft", "ArrowLeft", 37],
  right: ["ArrowRight", "ArrowRight", 39],
  home: ["Home", "Home", 36],
  end: ["End", "End", 35],
  pageup: ["PageUp", "PageUp", 33],
  pagedown: ["PageDown", "PageDown", 34],
};

const MODS: Record<string, number> = { alt: 1, option: 1, control: 2, ctrl: 2, meta: 4, cmd: 4, command: 4, shift: 8 };

// On macOS, editing shortcuts sent over CDP need the editor command named explicitly.
const MAC_COMMANDS: Record<string, string> = { a: "selectAll", c: "copy", x: "cut", v: "paste", z: "undo" };

export function keyEvents(combo: string): Record<string, unknown>[] {
  const parts = combo.split("+").map((p) => p.trim()).filter(Boolean);
  const last = parts.pop();
  if (!last) throw new Error(`Empty key: "${combo}"`);
  let modifiers = 0;
  for (const m of parts) {
    const bit = MODS[m.toLowerCase()];
    if (bit === undefined) throw new Error(`Unknown modifier "${m}" in "${combo}"`);
    modifiers |= bit;
  }

  let key: string, code: string, vk: number, text: string | undefined;
  const named = NAMED[last.toLowerCase()];
  if (named) [key, code, vk, text] = named;
  else if (last.length === 1) {
    key = modifiers & 8 ? last.toUpperCase() : last;
    const up = last.toUpperCase();
    code = /[A-Z]/.test(up) ? `Key${up}` : /\d/.test(last) ? `Digit${last}` : "";
    vk = up.charCodeAt(0);
    text = key;
  } else throw new Error(`Unknown key "${last}"`);

  const chord = modifiers & (2 | 4); // Control or Meta: no text is typed
  const commands = modifiers & 4 && process.platform === "darwin" && MAC_COMMANDS[last.toLowerCase()];
  const base = { key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers };
  return [
    {
      ...base,
      type: text && !chord ? "keyDown" : "rawKeyDown",
      ...(text && !chord ? { text, unmodifiedText: text } : {}),
      ...(commands ? { commands: [commands] } : {}),
    },
    { ...base, type: "keyUp" },
  ];
}
