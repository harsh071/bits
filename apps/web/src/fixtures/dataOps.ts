// Dev-only: a faithful-enough copy of the daemon's artifact data ops, used by the fixtures page's
// mocked fetch and by the scratch mock daemon. Plain erasable TS so Node can run it directly.

type Op =
  | { op: "set"; path: string; value: unknown }
  | { op: "merge"; path: string; value: Record<string, unknown> }
  | { op: "push"; path: string; value: unknown }
  | { op: "remove"; path: string }
  | { op: "increment"; path: string; by?: number }
  | { op: "toggle"; path: string };

type Seg = { key: string } | { index: number } | { match: { field: string; value: string } };

const rid = () => Math.random().toString(36).slice(2, 10);

function parsePath(p: string): Seg[] {
  const segs: Seg[] = [];
  const re = /([^.[\]]+)|\[(\d+)\]|\[([a-zA-Z0-9_]+)=([^\]]+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(p))) {
    if (m[1] !== undefined) segs.push({ key: m[1] });
    else if (m[2] !== undefined) segs.push({ index: Number(m[2]) });
    else segs.push({ match: { field: m[3], value: m[4] } });
  }
  return segs;
}

function ref(v: unknown, input: any): unknown {
  if (typeof v === "string") {
    if (v === "$id") return rid();
    if (v === "$now") return new Date().toISOString();
    if (v === "$input") return input;
    if (v.startsWith("$input.")) return v.slice(7).split(".").reduce((o: any, k) => (o == null ? undefined : o[k]), input);
    return v;
  }
  if (Array.isArray(v)) return v.map((x) => ref(x, input));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, ref(x, input)]));
  return v;
}

function step(c: any, s: Seg, input: any, create: boolean): { parent: any; key: string | number } | null {
  if ("key" in s) {
    if (create && c[s.key] == null) c[s.key] = {};
    return { parent: c, key: s.key };
  }
  if (!Array.isArray(c)) return null;
  if ("index" in s) return { parent: c, key: s.index };
  const want = ref(s.match.value, input);
  const i = c.findIndex((x: any) => x && String(x[s.match.field]) === String(want));
  return i === -1 ? null : { parent: c, key: i };
}

export function applyOps(data: Record<string, unknown>, ops: Op[], input: any = {}) {
  const next: any = structuredClone(data);
  for (const op of ops) {
    const segs = parsePath(op.path);
    let cur = next;
    let at: { parent: any; key: string | number } | null = null;
    for (let i = 0; i < segs.length; i++) {
      at = step(cur, segs[i], input, i < segs.length - 1);
      if (!at) throw new Error(`Nothing matches "${op.path}"`);
      if (i < segs.length - 1) cur = at.parent[at.key];
    }
    const { parent, key } = at!;
    if (op.op === "set") parent[key] = ref(op.value, input);
    else if (op.op === "merge") parent[key] = { ...(parent[key] ?? {}), ...(ref(op.value, input) as object) };
    else if (op.op === "push") {
      parent[key] ??= [];
      const v: any = ref(op.value, input);
      parent[key].push(v && typeof v === "object" && !Array.isArray(v) && !("id" in v) ? { id: rid(), ...v } : v);
    } else if (op.op === "remove") Array.isArray(parent) ? parent.splice(key as number, 1) : delete parent[key];
    else if (op.op === "increment") parent[key] = Number(parent[key] ?? 0) + Number(op.by ?? 1);
    else if (op.op === "toggle") parent[key] = !parent[key];
  }
  return next as Record<string, unknown>;
}

/** A sample artifact (reading list) shared by fixtures and the mock daemon. */
export function sampleReadingList(id = "reading-list-a1b2c3", conversationId = "home") {
  return {
    id,
    title: "Reading list",
    kind: "list",
    description: "Books to read, reading and done.",
    icon: "book",
    conversationId,
    version: 1,
    dataVersion: 1,
    createdAt: Date.now() - 86_400_000,
    updatedAt: Date.now() - 180_000,
    actions: {
      add_book: {
        description: "Add a book to the reading list",
        input: { type: "object", properties: { title: { type: "string", minLength: 1 }, author: { type: "string" } }, required: ["title"] },
        ops: [{ op: "push", path: "books", value: { title: "$input.title", author: "$input.author", status: "to read", added: "$now" } }],
      },
      mark_read: {
        description: "Mark a book as read",
        input: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
        ops: [{ op: "set", path: "books[id=$input.id].status", value: "done" }],
      },
      remove_book: {
        description: "Remove a book from the list",
        input: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
        confirm: true,
        ops: [{ op: "remove", path: "books[id=$input.id]" }],
      },
    },
    program: `root = Stack([summary, table, picked, form])
summary = Text("Click a row to act on it.", "muted")
table = RecordTable("Books", [{key: "title", label: "Title"}, {key: "author", label: "Author"}, {key: "status", label: "Status"}], $data.books, select: @Set($ui.selected, $event))
picked = Card($ui.selected.title, "Selected", [picked_row], when: $ui.selected)
picked_row = Stack("row", [done_btn, remove_btn])
done_btn = Button("Mark as read", "primary", press: [@Tool("mark_read", {id: $ui.selected.id}), @Remove($ui.selected)])
remove_btn = Button("Remove", "danger", press: [@Tool("remove_book", {id: $ui.selected.id}), @Remove($ui.selected)])
form = Card("Add a book", [title_in, author_in, add_btn])
title_in = TextInput("Title", $ui.title, "e.g. Piranesi", change: @Set($ui.title, $event))
author_in = TextInput("Author", $ui.author, change: @Set($ui.author, $event))
add_btn = Button("Add to list", "primary", press: [@Tool("add_book", {title: $ui.title, author: $ui.author}), @Set($ui.title, ""), @Set($ui.author, "")])`,
    data: {
      books: [
        { id: "b1", title: "The Overstory", author: "Richard Powers", status: "reading" },
        { id: "b2", title: "Piranesi", author: "Susanna Clarke", status: "to read" },
        { id: "b3", title: "Project Hail Mary", author: "Andy Weir", status: "done" },
      ],
    },
  };
}
