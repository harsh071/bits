import { test, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "bits-conn-"));
process.env.BITS_HOME = home;
process.env.BITS_SECRETS = "file"; // never touch the real keychain from tests
process.env.BITS_MODEL = "mock:main";

const { secrets, resolveRefs } = await import("../src/secrets.ts");
const { connectors, checkUrl } = await import("../src/connectors.ts");
const { localOnly } = await import("../src/guard.ts");
const { Hono } = await import("hono");

after(async () => {
  await connectors.close();
  fs.rmSync(home, { recursive: true, force: true });
});

test("vault encrypts at rest and resolves {{secret:…}} refs", () => {
  secrets.set("demo_key", "sk-very-secret-123");
  const onDisk = fs.readFileSync(path.join(home, "secrets.enc"), "utf8");
  assert.ok(!onDisk.includes("sk-very-secret"), "plaintext must not be on disk");
  assert.equal((fs.statSync(path.join(home, "secrets.enc")).mode & 0o777).toString(8), "600");
  assert.equal(resolveRefs("Bearer {{secret:demo_key}}"), "Bearer sk-very-secret-123");
  assert.throws(() => resolveRefs("{{secret:nope}}"), /Missing secret/);
  assert.ok(secrets.names().includes("demo_key"));

  // Tampering is detected (GCM auth tag).
  const env = JSON.parse(onDisk);
  const bytes = Buffer.from(env.data, "base64");
  bytes[0] ^= 1;
  fs.writeFileSync(path.join(home, "secrets.enc"), JSON.stringify({ ...env, data: bytes.toString("base64") }));
  assert.throws(() => secrets.get("demo_key"));
  fs.writeFileSync(path.join(home, "secrets.enc"), onDisk);
  assert.equal(secrets.get("demo_key"), "sk-very-secret-123");
});

test("connector URLs must be https unless local", () => {
  assert.throws(() => checkUrl("http://example.com/mcp"), /https/);
  assert.throws(() => checkUrl("https://user:pw@example.com/mcp"), /credentials/);
  assert.ok(checkUrl("https://example.com/mcp"));
  assert.ok(checkUrl("http://127.0.0.1:9999/mcp"));
});

test("guard blocks cross-site origins and rebinding hosts", async () => {
  const app = new Hono();
  app.use("*", localOnly());
  app.post("/api/x", (c) => c.json({ ok: true }));
  const call = (headers: Record<string, string>) =>
    app.request("http://127.0.0.1:7077/api/x", { method: "POST", headers: { host: "127.0.0.1:7077", ...headers } });
  assert.equal((await call({})).status, 200); // curl, desktop shell
  assert.equal((await call({ origin: "http://localhost:5320" })).status, 200); // Vite dev
  assert.equal((await call({ origin: "https://evil.example" })).status, 403);
  assert.equal((await call({ "sec-fetch-site": "cross-site" })).status, 403);
  assert.equal((await call({ host: "evil.example:7077" })).status, 403);
});

// ----- a fake OAuth-protected MCP server, to run the whole sign-in flow -----

function startFakeServer() {
  let challenge = "";
  let issued = "";
  const server = http.createServer(async (req, res) => {
    const base = `http://127.0.0.1:${(server.address() as any).port}`;
    const url = new URL(req.url!, base);
    const json = (status: number, body: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(status, { "content-type": "application/json", ...headers });
      res.end(JSON.stringify(body));
    };
    const body = await new Promise<string>((r) => {
      let b = "";
      req.on("data", (d) => (b += d));
      req.on("end", () => r(b));
    });

    if (url.pathname.startsWith("/.well-known/oauth-protected-resource")) {
      return json(200, { resource: `${base}/mcp`, authorization_servers: [base] });
    }
    if (url.pathname === "/.well-known/oauth-authorization-server") {
      return json(200, {
        issuer: base,
        authorization_endpoint: `${base}/authorize`,
        token_endpoint: `${base}/token`,
        registration_endpoint: `${base}/register`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none"],
      });
    }
    if (url.pathname === "/register") return json(201, { ...JSON.parse(body), client_id: "client-1" });
    if (url.pathname === "/token") {
      const p = new URLSearchParams(body);
      const ok =
        p.get("code") === "the-code" &&
        crypto.createHash("sha256").update(p.get("code_verifier") ?? "").digest("base64url") === challenge;
      if (!ok) return json(400, { error: "invalid_grant" });
      issued = crypto.randomBytes(8).toString("hex");
      return json(200, { access_token: issued, token_type: "Bearer", expires_in: 3600 });
    }
    if (url.pathname === "/mcp") {
      if (!issued || req.headers.authorization !== `Bearer ${issued}`) {
        return json(401, { error: "unauthorized" }, {
          "www-authenticate": `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"`,
        });
      }
      const mcp = new McpServer({ name: "fake", version: "1.0.0" });
      mcp.registerTool("echo", { description: "Echo", inputSchema: { text: z.string() }, annotations: { readOnlyHint: true } }, async ({ text }) => ({
        content: [{ type: "text", text: `echo: ${text}` }],
      }));
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      await mcp.connect(transport);
      await transport.handleRequest(req, res, body ? JSON.parse(body) : undefined);
      return;
    }
    json(404, {});
  });
  return new Promise<{ base: string; close: () => void; setChallenge: (c: string) => void }>((r) =>
    server.listen(0, "127.0.0.1", () =>
      r({
        base: `http://127.0.0.1:${(server.address() as any).port}`,
        close: () => server.close(),
        setChallenge: (c) => (challenge = c),
      }),
    ),
  );
}

test("OAuth: sign in with PKCE, tokens land in the vault, tools appear", async () => {
  const fake = await startFakeServer();
  try {
    const added = await connectors.add({ name: "fake", url: `${fake.base}/mcp`, auth: "oauth" });
    assert.equal(added.state, "needs_auth");

    const authUrl = new URL(await connectors.beginAuth("fake"));
    assert.equal(authUrl.searchParams.get("code_challenge_method"), "S256");
    assert.equal(authUrl.searchParams.get("client_id"), "client-1");
    assert.match(authUrl.searchParams.get("redirect_uri")!, /^http:\/\/127\.0\.0\.1:\d+\/oauth\/callback$/);
    fake.setChallenge(authUrl.searchParams.get("code_challenge")!);

    await assert.rejects(connectors.finishAuth("forged-state", "the-code"), /expired|wasn't started/);
    const name = await connectors.finishAuth(authUrl.searchParams.get("state")!, "the-code");
    assert.equal(name, "fake");

    const info = connectors.overview().connectors.find((c) => c.name === "fake")!;
    assert.equal(info.state, "connected");
    const tool = connectors.tools().find((t) => t.name === "mcp__fake__echo")!;
    assert.equal(tool.risk, "read");
    assert.equal(await tool.execute({ text: "hi" }, {} as any), "echo: hi");

    // Tokens are in the vault, not in connectors.json, and never listed.
    const file = fs.readFileSync(path.join(home, "connectors.json"), "utf8");
    assert.ok(!/access_token|Bearer [0-9a-f]/.test(file));
    assert.ok(!connectors.overview().secrets.some((s) => s.startsWith("oauth:")));

    await connectors.remove("fake");
    assert.equal(secrets.get("oauth:fake:tokens"), undefined);
  } finally {
    fake.close();
  }
});

test("API-key connectors keep the key in the vault", async () => {
  await assert.rejects(connectors.add({ name: "gh", preset: "github" }), /API key/);
  await assert.rejects(connectors.add({ name: "x", url: "http://example.com/mcp" }), /https/);
  // GitHub is unreachable/unauthorized in tests; we only check what was stored.
  await connectors.add({ name: "gh", preset: "github", apiKey: "ghp_secret" }).catch(() => {});
  const file = fs.readFileSync(path.join(home, "connectors.json"), "utf8");
  assert.ok(!file.includes("ghp_secret"));
  assert.ok(file.includes("{{secret:gh_key}}"));
  assert.equal(secrets.get("gh_key"), "ghp_secret");
  await connectors.remove("gh");
  assert.equal(secrets.get("gh_key"), undefined);
});
