import { applyOps, sampleReadingList } from "./dataOps";

/** Dev-only: answer /api/artifacts/* for fixture artifacts in-memory, so they work without the daemon. */
export function installArtifactMock(prefix = "fx-") {
  const store = new Map<string, ReturnType<typeof sampleReadingList>>();
  store.set(`${prefix}reading-list-a1b2c3`, sampleReadingList(`${prefix}reading-list-a1b2c3`, "fixture"));
  const activity: Record<string, unknown[]> = {};
  const real = window.fetch.bind(window);
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const m = url.match(/\/api\/artifacts\/([^/?]+)(\/actions\/([^/?]+)|\/activity)?/);
    if (!m || !store.has(decodeURIComponent(m[1]))) return real(input, init);
    const id = decodeURIComponent(m[1]);
    const a = store.get(id)!;
    await new Promise((r) => setTimeout(r, 120));
    if (m[2] === "/activity") return json(activity[id] ?? []);
    if (m[3]) {
      const body = JSON.parse(String(init?.body ?? "{}"));
      const action = (a.actions as Record<string, { ops: any[] }>)[m[3]];
      if (!action) return json({ error: `No action "${m[3]}"` }, 400);
      if (m[3] === "add_book" && !body.input?.title) return json({ error: "Invalid input: title is required" }, 400);
      try {
        a.data = applyOps(a.data, action.ops, body.input ?? {}) as typeof a.data;
      } catch (e) {
        return json({ error: (e as Error).message }, 400);
      }
      a.dataVersion++;
      (activity[id] ??= []).push({ at: Date.now(), action: m[3], input: body.input, by: body.by });
      return json({ data: a.data, dataVersion: a.dataVersion });
    }
    return json(a);
  };
}
