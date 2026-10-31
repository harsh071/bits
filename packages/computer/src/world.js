// Runs inside the page in an isolated world: it shares the page's DOM but none of its
// JavaScript, so the page can't see or tamper with it, and we never add attributes to the DOM.
// Installs `globalThis.__bits`. Evaluated once per document.
(() => {
  if (globalThis.__bits) return true;

  // ---------- refs: stable numbers for elements, per document ----------
  const refs = new Map(); // ref -> WeakRef<Element>
  const ids = new WeakMap(); // Element -> ref
  let next = 1;
  const refOf = (el) => {
    let r = ids.get(el);
    if (r === undefined) {
      r = next++;
      ids.set(el, r);
      refs.set(r, new WeakRef(el));
    }
    return r;
  };
  const byRef = (r) => {
    const el = refs.get(r)?.deref();
    return el && el.isConnected ? el : null;
  };

  // ---------- "has the page stopped changing?" ----------
  // Only structure and text count. Attribute churn (animations, timers) would keep it busy forever.
  let lastMutation = performance.now();
  new MutationObserver(() => (lastMutation = performance.now())).observe(document, {
    subtree: true,
    childList: true,
    characterData: true,
  });

  const clean = (s, n) => {
    s = String(s ?? "").replace(/\s+/g, " ").trim();
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
  };

  // ---------- roles and names ----------
  const ROLES = new Set([
    "button", "link", "checkbox", "radio", "switch", "tab", "menuitem", "menuitemcheckbox", "menuitemradio",
    "option", "textbox", "searchbox", "combobox", "slider", "spinbutton", "treeitem", "gridcell", "row",
  ]);
  const TEXT_ROLES = new Set(["textbox", "searchbox", "combobox", "spinbutton"]);
  const INPUT_ROLE = {
    checkbox: "checkbox", radio: "radio", range: "slider", number: "spinbutton", search: "searchbox",
    button: "button", submit: "button", reset: "button", image: "button", file: "button", color: "button",
  };

  const implicitRole = (el) => {
    switch (el.tagName) {
      case "A": return el.hasAttribute("href") ? "link" : "";
      case "BUTTON": case "SUMMARY": return "button";
      case "INPUT": return INPUT_ROLE[el.type] ?? "textbox";
      case "SELECT": return "combobox";
      case "TEXTAREA": return "textbox";
      case "H1": case "H2": case "H3": return "heading";
    }
    if (el.isContentEditable && !el.parentElement?.isContentEditable) return "textbox";
    return "";
  };
  const roleOf = (el) => el.getAttribute("role")?.trim().split(/\s+/)[0] || implicitRole(el);

  const nameOf = (el, role) => {
    const labelledby = el.getAttribute("aria-labelledby");
    if (labelledby) {
      const t = labelledby.split(/\s+/).map((id) => document.getElementById(id)?.innerText ?? "").join(" ");
      if (t.trim()) return clean(t, 80);
    }
    const direct =
      el.getAttribute("aria-label") ||
      (el.labels && el.labels[0]?.innerText) ||
      el.getAttribute("alt") ||
      (el.tagName === "INPUT" && /^(button|submit|reset)$/.test(el.type) ? el.value : "");
    if (direct) return clean(direct, 80);
    if (!TEXT_ROLES.has(role) && el.tagName !== "SELECT") {
      const text = el.innerText;
      if (text && text.trim()) return clean(text, 80);
    }
    return clean(
      el.getAttribute("title") ||
        el.getAttribute("placeholder") ||
        el.getAttribute("data-tooltip") ||
        el.querySelector?.("img[alt]")?.getAttribute("alt") ||
        el.querySelector?.("[aria-label]")?.getAttribute("aria-label") ||
        el.querySelector?.("[title]")?.getAttribute("title") ||
        el.querySelector?.("svg title")?.textContent ||
        "",
      80,
    );
  };

  const deepActive = () => {
    let a = document.activeElement;
    while (a?.shadowRoot?.activeElement) a = a.shadowRoot.activeElement;
    return a;
  };

  const visible = (el, r) =>
    r.width >= 1 && r.height >= 1 && el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });

  // Semantic controls. `null` means "not by its markup" — the pointer-cursor check may still say yes.
  const semantic = (el, role) => {
    if (el.tagName === "INPUT" && el.type === "hidden") return false;
    if (role && ROLES.has(role)) return true;
    if (el.tagName === "SELECT" || el.tagName === "TEXTAREA") return true;
    if (el.tabIndex >= 0 && el.hasAttribute("tabindex") && el.getAttribute("tabindex") !== "-1") return true;
    if (typeof el.onclick === "function") return true;
    return null;
  };

  // Clickable only by its look (a div with cursor:pointer). Count the outermost one only.
  const pointerStart = (el) =>
    getComputedStyle(el).cursor === "pointer" && (!el.parentElement || getComputedStyle(el.parentElement).cursor !== "pointer");

  const walk = (root, visit) => {
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let n;
    while ((n = tw.nextNode())) {
      if (visit(n) === "skip") continue;
      if (n.shadowRoot) walk(n.shadowRoot, visit);
    }
  };

  const topModal = () => {
    const candidates = document.querySelectorAll('dialog[open], [aria-modal="true"], [role="dialog"], [role="alertdialog"]');
    for (let i = candidates.length - 1; i >= 0; i--) {
      const d = candidates[i];
      const r = d.getBoundingClientRect();
      if (visible(d, r) && (d.matches("dialog:modal, [aria-modal=true], [role=alertdialog]"))) return d;
    }
    return null;
  };

  const describe = (el, role) => {
    const item = { ref: refOf(el), role: role || "clickable", name: nameOf(el, role) };
    if (TEXT_ROLES.has(role) || el.tagName === "SELECT") {
      const v = el.tagName === "SELECT" ? el.selectedOptions?.[0]?.text : "value" in el ? el.value : el.innerText;
      item.value = clean(v, 60);
    }
    if (role === "checkbox" || role === "radio" || role === "switch" || role === "menuitemcheckbox") {
      item.checked = "checked" in el && el.tagName === "INPUT" ? el.checked : el.getAttribute("aria-checked") === "true";
    }
    for (const a of ["expanded", "selected", "pressed"]) {
      const v = el.getAttribute("aria-" + a);
      if (v === "true" || v === "false") item[a] = v === "true";
    }
    if (el.disabled || el.getAttribute("aria-disabled") === "true") item.disabled = true;
    if (el === deepActive()) item.focused = true;
    if (role === "link" && !item.name) item.name = clean(el.getAttribute("href"), 80);
    return item;
  };

  globalThis.__bits = {
    snapshot({ all = false, max = 250 } = {}) {
      const vw = innerWidth, vh = innerHeight;
      const modal = topModal();
      const items = [];
      let above = 0, below = 0;
      walk(modal ?? document.documentElement, (el) => {
        if (el.getAttribute("aria-hidden") === "true" || el.inert) return "skip";
        const role = roleOf(el);
        const isHeading = role === "heading";
        let inter = isHeading ? false : semantic(el, role);
        if (inter === false && !isHeading) return;
        const r = el.getBoundingClientRect();
        const inView = r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw;
        if (inter === null) {
          if (!inView || !pointerStart(el)) return;
          inter = true;
        }
        if (!visible(el, r)) return;
        if (!inView && !all) {
          if (isHeading) return;
          if (r.bottom <= 0) above++;
          else below++;
          return;
        }
        if (items.length >= max) {
          below++;
          return;
        }
        items.push(describe(el, role));
      });
      return {
        url: location.href,
        title: document.title,
        modal: modal ? nameOf(modal, "dialog") || "dialog" : null,
        items,
        above,
        below,
      };
    },

    text(max = 8000) {
      const root = topModal() ?? document.body;
      const t = (root?.innerText ?? "").replace(/\n{3,}/g, "\n\n").trim();
      return t.length > max ? t.slice(0, max) + `\n…[${t.length - max} more chars]` : t;
    },

    // Where to press `ref`. Scrolls it into view, then finds a point where it is not covered.
    target(ref) {
      const el = byRef(ref);
      if (!el) return { error: "gone" };
      let r = el.getBoundingClientRect();
      if (r.top < 0 || r.bottom > innerHeight || r.left < 0 || r.right > innerWidth) {
        el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
        r = el.getBoundingClientRect();
      }
      if (r.width < 1 || r.height < 1) return { error: "hidden" };
      const hits = (x, y) => {
        let hit = document.elementFromPoint(x, y);
        while (hit?.shadowRoot) {
          const inner = hit.shadowRoot.elementFromPoint(x, y);
          if (!inner || inner === hit) break;
          hit = inner;
        }
        if (!hit) return { ok: false, hit };
        for (let n = hit; n; n = n.parentNode || n.host) if (n === el) return { ok: true, hit };
        // A label for the element (custom checkboxes) also counts.
        if (el.labels && [...el.labels].some((l) => l.contains(hit))) return { ok: true, hit };
        return { ok: false, hit };
      };
      const points = [
        [0.5, 0.5], [0.25, 0.5], [0.75, 0.5], [0.5, 0.25], [0.5, 0.75], [0.15, 0.15], [0.85, 0.85],
      ];
      let cover = null;
      for (const [fx, fy] of points) {
        const x = Math.min(Math.max(r.left + r.width * fx, 0), innerWidth - 1);
        const y = Math.min(Math.max(r.top + r.height * fy, 0), innerHeight - 1);
        const h = hits(x, y);
        if (h.ok) return { x, y, w: r.width, h: r.height, rect: { x: r.left, y: r.top } };
        cover ??= h.hit;
      }
      const role = cover ? roleOf(cover) : "";
      return {
        error: "covered",
        cover: cover ? clean(`${role || cover.tagName.toLowerCase()} "${nameOf(cover, role)}"`, 80) : "nothing",
      };
    },

    // Focus and (optionally) select the current contents, so typed text replaces it.
    prepareType(ref, clear) {
      const el = byRef(ref);
      if (!el) return false;
      if (deepActive() !== el && !el.contains(deepActive())) el.focus();
      if (clear) {
        if (/^(INPUT|TEXTAREA)$/.test(el.tagName) && typeof el.select === "function") el.select();
        else if (el.isContentEditable) {
          const range = document.createRange();
          range.selectNodeContents(el);
          const s = getSelection();
          s.removeAllRanges();
          s.addRange(range);
        }
      }
      return true;
    },

    selectOption(ref, value) {
      const el = byRef(ref);
      if (!el) return "gone";
      if (el.tagName !== "SELECT") return "not-select";
      const want = String(value).toLowerCase();
      const opt = [...el.options].find((o) => o.value.toLowerCase() === want || o.text.trim().toLowerCase() === want)
        ?? [...el.options].find((o) => o.text.toLowerCase().includes(want));
      if (!opt) return "no-option: " + [...el.options].map((o) => o.text.trim()).join(" | ");
      el.value = opt.value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return "ok";
    },

    quiet() {
      return performance.now() - lastMutation;
    },

    geometry() {
      return { sx: screenX, sy: screenY, ow: outerWidth, oh: outerHeight, iw: innerWidth, ih: innerHeight };
    },
  };
  return true;
})();
