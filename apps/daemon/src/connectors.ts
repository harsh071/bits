import crypto from "node:crypto";
import fs from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { auth, UnauthorizedError, type OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { AddConnectorBody, ConnectorAuth, ConnectorInfo, ConnectorPreset, ConnectorsOverview } from "@bits/protocol";
import { bus } from "./bus.ts";
import { config } from "./config.ts";
import { refsIn, resolveMap, secrets } from "./secrets.ts";
import type { ToolDef } from "./agent/tools.ts";

// Connectors are MCP servers, configured in ~/.bits/connectors.json:
// {
//   "servers": {
//     "notion":   { "url": "https://mcp.notion.com/mcp", "auth": "oauth" },
//     "github":   { "url": "https://api.githubcopilot.com/mcp/", "headers": { "Authorization": "Bearer {{secret:github}}" } },
//     "calendar": { "command": "npx", "args": ["-y", "some-calendar-mcp"], "env": { "TOKEN": "{{secret:calendar}}" } }
//   }
// }
//
// Credentials are never written here: {{secret:NAME}} points into the encrypted vault (secrets.ts) and
// {{env:NAME}} into the environment. "auth": "oauth" runs the standard MCP authorization flow
// (OAuth 2.1 + PKCE, dynamic client registration, loopback redirect) and keeps tokens in the vault.
//
// Local (command) servers run code on this machine, so they can only be added by editing this file,
// never through the HTTP API.
//
// Tools marked readOnlyHint run freely; destructiveHint always asks; everything else is auto-reviewed.

type RemoteConfig = { url: string; headers?: Record<string, string>; auth?: ConnectorAuth; scope?: string; preset?: string; disabled?: boolean };
type LocalConfig = { command: string; args?: string[]; env?: Record<string, string>; disabled?: boolean };
type ServerConfig = RemoteConfig | LocalConfig;

const isRemote = (s: ServerConfig): s is RemoteConfig => "url" in s;

export const PRESETS: (ConnectorPreset & { header?: { name: string; prefix: string } })[] = [
  {
    id: "composio",
    name: "Composio",
    blurb: "Gmail, Calendar, Slack, Drive and 250+ apps behind one key. Composio handles each app's sign-in.",
    auth: "key",
    urlHint: "https://backend.composio.dev/v3/mcp/…",
    keyUrl: "https://platform.composio.dev",
    keyLabel: "Composio API key",
    docsUrl: "https://docs.composio.dev/docs/mcp-quickstart",
    header: { name: "x-api-key", prefix: "" },
  },
  {
    id: "notion",
    name: "Notion",
    blurb: "Search, read and write pages and databases.",
    auth: "oauth",
    url: "https://mcp.notion.com/mcp",
    docsUrl: "https://developers.notion.com/docs/mcp",
  },
  {
    id: "linear",
    name: "Linear",
    blurb: "Issues, projects and comments.",
    auth: "oauth",
    url: "https://mcp.linear.app/mcp",
    docsUrl: "https://linear.app/docs/mcp",
  },
  {
    id: "sentry",
    name: "Sentry",
    blurb: "Errors, issues and releases.",
    auth: "oauth",
    url: "https://mcp.sentry.dev/mcp",
    docsUrl: "https://docs.sentry.io/product/sentry-mcp/",
  },
  {
    id: "github",
    name: "GitHub",
    blurb: "Repos, issues and pull requests.",
    auth: "key",
    url: "https://api.githubcopilot.com/mcp/",
    keyUrl: "https://github.com/settings/personal-access-tokens/new",
    keyLabel: "Fine-grained personal access token",
    docsUrl: "https://github.com/github/github-mcp-server",
    header: { name: "Authorization", prefix: "Bearer " },
  },
];

const clean = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, "_");
const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const OAUTH_TTL_MS = 10 * 60_000;

function readFile(): Record<string, ServerConfig> {
  if (!fs.existsSync(config.paths.connectors)) {
    fs.writeFileSync(config.paths.connectors, JSON.stringify({ servers: {} }, null, 2) + "\n", { mode: 0o600 });
    return {};
  }
  return JSON.parse(fs.readFileSync(config.paths.connectors, "utf8")).servers ?? {};
}

function writeFile(servers: Record<string, ServerConfig>) {
  const tmp = config.paths.connectors + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify({ servers }, null, 2) + "\n", { mode: 0o600 });
  fs.renameSync(tmp, config.paths.connectors);
}

/** Remote servers must use https, except on this machine. */
export function checkUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("That isn't a valid URL.");
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
  if (u.protocol !== "https:" && !(u.protocol === "http:" && loopback)) throw new Error("Connector URLs must use https.");
  if (u.username || u.password) throw new Error("Put credentials in a key, not in the URL.");
  return u;
}

// ----- OAuth (MCP authorization spec) -----

/** OAuth state for one connector. Tokens and client registration live in the vault under oauth:<name>:*. */
class VaultOAuthProvider implements OAuthClientProvider {
  readonly name: string;
  readonly scope?: string;
  authUrl: URL | null = null;
  private verifier: string | null = null;
  private stateValue: string | null = null;
  private discovery: any;

  constructor(name: string, scope?: string) {
    this.name = name;
    this.scope = scope;
  }

  get redirectUrl() {
    // RFC 8252: loopback IP literal, not "localhost".
    return `http://127.0.0.1:${config.port}/oauth/callback`;
  }
  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "Bits",
      client_uri: "https://github.com/harsh071/bits",
      redirect_uris: [this.redirectUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      ...(this.scope ? { scope: this.scope } : {}),
    };
  }
  state() {
    this.stateValue = crypto.randomBytes(32).toString("base64url");
    pendingStates.set(this.stateValue, { name: this.name, expires: Date.now() + OAUTH_TTL_MS });
    return this.stateValue;
  }
  private get(key: string) {
    const v = secrets.get(`oauth:${this.name}:${key}`);
    return v ? JSON.parse(v) : undefined;
  }
  private put(key: string, value: unknown) {
    secrets.set(`oauth:${this.name}:${key}`, JSON.stringify(value));
  }
  clientInformation(): OAuthClientInformationMixed | undefined {
    return this.get("client");
  }
  saveClientInformation(info: OAuthClientInformationMixed) {
    this.put("client", info);
  }
  tokens(): OAuthTokens | undefined {
    return this.get("tokens");
  }
  saveTokens(tokens: OAuthTokens) {
    this.put("tokens", tokens);
  }
  redirectToAuthorization(url: URL) {
    // We can't open a browser from the daemon; the UI shows a "Sign in" button with this URL.
    this.authUrl = url;
  }
  saveCodeVerifier(v: string) {
    this.verifier = v;
  }
  codeVerifier() {
    if (!this.verifier) throw new Error("No sign-in in progress. Start again from Connectors.");
    return this.verifier;
  }
  saveDiscoveryState(s: unknown) {
    this.discovery = s;
  }
  discoveryState() {
    return this.discovery;
  }
  invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery") {
    if (scope === "all" || scope === "client") secrets.delete(`oauth:${this.name}:client`);
    if (scope === "all" || scope === "tokens") secrets.delete(`oauth:${this.name}:tokens`);
    if (scope === "all" || scope === "verifier") this.verifier = null;
    if (scope === "all" || scope === "discovery") this.discovery = undefined;
  }
}

const pendingStates = new Map<string, { name: string; expires: number }>();

// ----- connections -----

interface Live {
  config: ServerConfig;
  state: ConnectorInfo["state"];
  client?: Client;
  oauth?: VaultOAuthProvider;
  tools: ToolDef[];
  error?: string;
}

const live = new Map<string, Live>();

function toolsFor(name: string, client: Client, list: any[]): ToolDef[] {
  return list.slice(0, 100).map((t) => {
    const ann = (t.annotations ?? {}) as { readOnlyHint?: boolean; destructiveHint?: boolean };
    return {
      name: `mcp__${clean(name)}__${clean(t.name)}`.slice(0, 64),
      description: `[${name}] ${t.description ?? t.name}`.slice(0, 1000),
      input: { jsonSchema: (t.inputSchema as Record<string, unknown>) ?? { type: "object", properties: {} } },
      risk: ann.readOnlyHint ? "read" : ann.destructiveHint ? "destructive" : "external",
      activity: () => `Using ${name}`,
      async execute(input: unknown) {
        const res = await client.callTool({ name: t.name, arguments: (input ?? {}) as Record<string, unknown> });
        const text = (res.content as any[] | undefined)?.map((c) => (c.type === "text" ? c.text : `[${c.type}]`)).join("\n");
        if (res.isError) throw new Error(text || "Connector error");
        const out = res.structuredContent ?? text ?? res;
        return typeof out === "string" && out.length > 20_000 ? out.slice(0, 20_000) + "…" : out;
      },
    } satisfies ToolDef;
  });
}

const changed = () => bus.emit({ type: "connectors" });

async function connect(name: string, cfg: ServerConfig) {
  const prev = live.get(name);
  await prev?.client?.close().catch(() => {});
  const entry: Live = { config: cfg, state: cfg.disabled ? "disabled" : "connecting", tools: [], oauth: prev?.oauth };
  live.set(name, entry);
  changed();
  if (cfg.disabled) return;

  const client = new Client({ name: "bits", version: config.version });
  try {
    let transport;
    if (isRemote(cfg)) {
      const url = checkUrl(cfg.url);
      if (cfg.auth === "oauth") entry.oauth ??= new VaultOAuthProvider(name, cfg.scope);
      transport = new StreamableHTTPClientTransport(url, {
        requestInit: { headers: resolveMap(cfg.headers) },
        authProvider: cfg.auth === "oauth" ? entry.oauth : undefined,
      });
    } else {
      transport = new StdioClientTransport({
        command: cfg.command,
        args: cfg.args,
        env: { ...(process.env as Record<string, string>), ...resolveMap(cfg.env) },
        stderr: "ignore",
      });
    }
    await client.connect(transport);
    const { tools } = await client.listTools();
    entry.client = client;
    entry.tools = toolsFor(name, client, tools);
    entry.state = "connected";
  } catch (e: any) {
    await client.close().catch(() => {});
    const unauthorized = e instanceof UnauthorizedError || /\b401\b|unauthorized/i.test(String(e?.message));
    entry.state = unauthorized ? "needs_auth" : "error";
    entry.error = unauthorized
      ? isRemote(cfg) && cfg.auth === "oauth"
        ? "Sign in to connect."
        : "The server rejected the key."
      : String(e?.message ?? e).slice(0, 300);
    if (!unauthorized) console.error(`[bits] connector ${name} failed:`, entry.error);
  }
  changed();
}

export const connectors = {
  /** Connects everything in connectors.json. */
  async load() {
    let servers: Record<string, ServerConfig>;
    try {
      servers = readFile();
    } catch (e) {
      console.error("[bits] connectors.json is not valid JSON:", e);
      return;
    }
    await Promise.all(Object.entries(servers).map(([name, cfg]) => connect(name, cfg)));
  },

  tools(): ToolDef[] {
    return [...live.values()].flatMap((l) => (l.state === "connected" ? l.tools : []));
  },

  overview(): ConnectorsOverview {
    const have = new Set(secrets.names());
    const list: ConnectorInfo[] = [...live.entries()].map(([name, l]) => {
      const remote = isRemote(l.config);
      let target = remote ? "" : (l.config as LocalConfig).command;
      if (remote) {
        try {
          const u = new URL((l.config as RemoteConfig).url);
          target = u.origin + u.pathname;
        } catch {
          target = "(invalid URL)";
        }
      }
      const refs = remote ? refsIn((l.config as RemoteConfig).headers) : refsIn((l.config as LocalConfig).env);
      return {
        name,
        kind: remote ? "remote" : "local",
        target,
        auth: remote ? ((l.config as RemoteConfig).auth ?? (refs.length ? "key" : "none")) : refs.length ? "key" : "none",
        preset: remote ? (l.config as RemoteConfig).preset : undefined,
        state: l.state,
        tools: l.tools.map((t) => ({ name: t.name, description: t.description, risk: t.risk })),
        error: l.error,
        missingSecrets: [...new Set(refs.filter((r) => !have.has(r)))],
      };
    });
    return {
      connectors: list.sort((a, b) => a.name.localeCompare(b.name)),
      presets: PRESETS.map(({ header: _h, ...p }) => p),
      secrets: [...have],
      keyStore: (() => {
        try {
          return secrets.store();
        } catch {
          return "file" as const;
        }
      })(),
      configPath: config.paths.connectors,
    };
  },

  /** Adds a remote connector. Local (command) connectors are file-only by design. */
  async add(body: AddConnectorBody) {
    const name = String(body.name ?? "").trim().toLowerCase();
    if (!NAME_RE.test(name)) throw new Error("Name: lowercase letters, numbers, - and _, up to 32 characters.");
    const servers = readFile();
    if (servers[name]) throw new Error(`There's already a connector called "${name}".`);

    const preset = body.preset ? PRESETS.find((p) => p.id === body.preset) : undefined;
    if (body.preset && !preset) throw new Error("Unknown preset.");
    const url = preset?.url ?? body.url;
    if (!url) throw new Error("Add the server URL.");
    checkUrl(url);
    const authKind: ConnectorAuth = preset?.auth ?? body.auth ?? "none";

    const cfg: RemoteConfig = { url, auth: authKind, ...(preset ? { preset: preset.id } : {}) };
    if (authKind === "key") {
      const key = String(body.apiKey ?? "").trim();
      if (!key) throw new Error("Paste the API key.");
      const secretName = `${name}_key`;
      secrets.set(secretName, key);
      const header = preset?.header ?? { name: "Authorization", prefix: "Bearer " };
      cfg.headers = { [header.name]: `${header.prefix}{{secret:${secretName}}}` };
    }
    servers[name] = cfg;
    writeFile(servers);
    await connect(name, cfg);
    return connectors.overview().connectors.find((c) => c.name === name)!;
  },

  async remove(name: string) {
    const servers = readFile();
    if (!servers[name]) throw new Error("Not found.");
    const cfg = servers[name];
    delete servers[name];
    writeFile(servers);
    await live.get(name)?.client?.close().catch(() => {});
    live.delete(name);
    secrets.deletePrefix(`oauth:${name}:`);
    // Remove the key we created for it, but leave secrets the user named themselves.
    if (isRemote(cfg) && refsIn(cfg.headers).includes(`${name}_key`)) secrets.delete(`${name}_key`);
    changed();
  },

  async setDisabled(name: string, disabled: boolean) {
    const servers = readFile();
    if (!servers[name]) throw new Error("Not found.");
    servers[name] = { ...servers[name], disabled };
    writeFile(servers);
    await connect(name, servers[name]);
  },

  async reconnect(name: string) {
    const servers = readFile();
    if (!servers[name]) throw new Error("Not found.");
    await connect(name, servers[name]);
  },

  /** Starts OAuth sign-in. Returns the provider's authorization URL for the person to open. */
  async beginAuth(name: string): Promise<string> {
    const cfg = readFile()[name];
    if (!cfg || !isRemote(cfg) || cfg.auth !== "oauth") throw new Error("This connector doesn't use sign-in.");
    const l = live.get(name) ?? { config: cfg, state: "needs_auth", tools: [] };
    l.oauth ??= new VaultOAuthProvider(name, cfg.scope);
    live.set(name, l);
    l.oauth.authUrl = null;
    // Drop stale tokens so auth() goes to the authorization step instead of a refresh.
    l.oauth.invalidateCredentials("tokens");
    const result = await auth(l.oauth, { serverUrl: cfg.url, scope: cfg.scope });
    if (result === "AUTHORIZED") {
      await connect(name, cfg);
      return "";
    }
    const authUrl = l.oauth.authUrl as URL | null; // set by redirectToAuthorization during auth()
    if (!authUrl) throw new Error("The server didn't return a sign-in page.");
    return authUrl.toString();
  },

  /** Completes OAuth from the loopback redirect. `state` must match a sign-in we started. */
  async finishAuth(state: string, code: string) {
    const now = Date.now();
    for (const [s, p] of pendingStates) if (p.expires < now) pendingStates.delete(s);
    const pending = pendingStates.get(state);
    if (!pending) throw new Error("This sign-in link expired or wasn't started by Bits. Try again from Connectors.");
    pendingStates.delete(state);
    const cfg = readFile()[pending.name];
    const l = live.get(pending.name);
    if (!cfg || !isRemote(cfg) || !l?.oauth) throw new Error("That connector is gone.");
    const result = await auth(l.oauth, { serverUrl: cfg.url, authorizationCode: code, scope: cfg.scope });
    if (result !== "AUTHORIZED") throw new Error("Sign-in didn't finish.");
    await connect(pending.name, cfg);
    return pending.name;
  },

  async signOut(name: string) {
    secrets.deletePrefix(`oauth:${name}:`);
    const l = live.get(name);
    l?.oauth?.invalidateCredentials("all");
    await connectors.reconnect(name);
  },

  setSecret(name: string, value: string) {
    if (name.startsWith("oauth:")) throw new Error("That name is reserved.");
    if (!value) throw new Error("Empty value.");
    secrets.set(name, value);
    changed();
  },
  deleteSecret(name: string) {
    if (name.startsWith("oauth:")) throw new Error("That name is reserved.");
    secrets.delete(name);
    changed();
  },

  async close() {
    await Promise.allSettled([...live.values()].map((l) => l.client?.close()));
  },
};
