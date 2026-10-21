import crypto from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.ts";

// Secrets vault: API keys and OAuth tokens for connectors.
//
// Values live in ~/.bits/secrets.enc, encrypted with AES-256-GCM. The 256-bit key lives in the OS keychain
// (macOS Keychain via `security`, Linux Secret Service via `secret-tool`), so copying ~/.bits alone leaks nothing.
// Without a keychain (or with BITS_SECRETS=file) the key falls back to ~/.bits/secrets.key, mode 0600.
//
// Secrets never reach the model, the transcript or the HTTP API: the API only lists names, and connectors.json
// refers to them as {{secret:NAME}}.

const SERVICE = "bits";
const ACCOUNT = "vault-key";
const NAME_RE = /^[a-zA-Z0-9_.:-]{1,128}$/;

interface Envelope {
  v: 1;
  iv: string;
  tag: string;
  data: string;
}

export type KeyStore = "keychain" | "secret-service" | "file";

function vaultFile() {
  return path.join(config.home, "secrets.enc");
}
function keyFile() {
  return path.join(config.home, "secrets.key");
}

function backend(): KeyStore {
  if (process.env.BITS_SECRETS === "file") return "file";
  if (process.platform === "darwin" && has("security")) return "keychain";
  if (process.platform === "linux" && has("secret-tool") && process.env.DBUS_SESSION_BUS_ADDRESS) return "secret-service";
  return "file";
}

function has(bin: string) {
  return spawnSync("which", [bin], { stdio: "ignore" }).status === 0;
}

let cachedKey: Buffer | null = null;
let cachedStore: KeyStore | null = null;

function readKey(store: KeyStore): string | null {
  try {
    if (store === "keychain") {
      return execFileSync("security", ["find-generic-password", "-s", SERVICE, "-a", ACCOUNT, "-w"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    }
    if (store === "secret-service") {
      return execFileSync("secret-tool", ["lookup", "service", SERVICE, "account", ACCOUNT], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    }
    return fs.readFileSync(keyFile(), "utf8").trim();
  } catch {
    return null;
  }
}

function writeKey(store: KeyStore, hex: string) {
  // The key goes over stdin, never argv, so it never shows up in `ps`.
  if (store === "keychain") {
    const r = spawnSync("security", ["-i"], {
      input: `add-generic-password -U -s ${SERVICE} -a ${ACCOUNT} -l "Bits secrets" -w ${hex}\n`,
      stdio: ["pipe", "ignore", "pipe"],
    });
    if (r.status !== 0) throw new Error(`Keychain write failed: ${r.stderr}`);
    return;
  }
  if (store === "secret-service") {
    const r = spawnSync("secret-tool", ["store", "--label=Bits secrets", "service", SERVICE, "account", ACCOUNT], {
      input: hex,
      stdio: ["pipe", "ignore", "pipe"],
    });
    if (r.status !== 0) throw new Error(`Secret Service write failed: ${r.stderr}`);
    return;
  }
  fs.writeFileSync(keyFile(), hex + "\n", { mode: 0o600 });
}

function key(): Buffer {
  if (cachedKey) return cachedKey;
  const store = backend();
  let hex = readKey(store);
  if (!hex || !/^[0-9a-f]{64}$/.test(hex)) {
    if (fs.existsSync(vaultFile())) {
      throw new Error(`Can't read the secrets key from the ${store}, so ${vaultFile()} can't be decrypted.`);
    }
    hex = crypto.randomBytes(32).toString("hex");
    writeKey(store, hex);
  }
  cachedStore = store;
  cachedKey = Buffer.from(hex, "hex");
  return cachedKey;
}

function load(): Record<string, string> {
  if (!fs.existsSync(vaultFile())) return {};
  const env = JSON.parse(fs.readFileSync(vaultFile(), "utf8")) as Envelope;
  const decipher = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(env.iv, "base64"));
  decipher.setAuthTag(Buffer.from(env.tag, "base64"));
  const plain = Buffer.concat([decipher.update(Buffer.from(env.data, "base64")), decipher.final()]);
  return JSON.parse(plain.toString("utf8"));
}

function save(values: Record<string, string>) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(values), "utf8"), cipher.final()]);
  const env: Envelope = { v: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") };
  const tmp = vaultFile() + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(env), { mode: 0o600 });
  fs.renameSync(tmp, vaultFile());
}

export const secrets = {
  get(name: string): string | undefined {
    return load()[name];
  },
  set(name: string, value: string) {
    if (!NAME_RE.test(name)) throw new Error("Secret names may only use letters, numbers and _ . : -");
    const all = load();
    all[name] = value;
    save(all);
  },
  delete(name: string) {
    const all = load();
    if (!(name in all)) return;
    delete all[name];
    save(all);
  },
  /** Removes every secret whose name starts with `prefix`. */
  deletePrefix(prefix: string) {
    const all = load();
    const keep = Object.fromEntries(Object.entries(all).filter(([k]) => !k.startsWith(prefix)));
    if (Object.keys(keep).length !== Object.keys(all).length) save(keep);
  },
  /** Names only, never values. OAuth bookkeeping (oauth:*) is hidden. */
  names(): string[] {
    return Object.keys(load())
      .filter((k) => !k.startsWith("oauth:"))
      .sort();
  },
  store(): KeyStore {
    key();
    return cachedStore!;
  },
};

/**
 * Replaces {{secret:NAME}} and {{env:NAME}} in a config value. Throws when a secret is missing,
 * so a connector fails loudly instead of sending an empty token.
 */
export function resolveRefs(value: string): string {
  return value.replace(/\{\{\s*(secret|env):([a-zA-Z0-9_.:-]+)\s*\}\}/g, (_, kind: string, name: string) => {
    const v = kind === "secret" ? secrets.get(name) : process.env[name];
    if (v === undefined || v === "") throw new Error(`Missing ${kind} "${name}". Add it under Connectors → Keys.`);
    return v;
  });
}

export function resolveMap(map: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!map) return undefined;
  return Object.fromEntries(Object.entries(map).map(([k, v]) => [k, resolveRefs(String(v))]));
}

/** Secret names a config value refers to. */
export function refsIn(map: Record<string, string> | undefined): string[] {
  const out: string[] = [];
  for (const v of Object.values(map ?? {})) for (const m of String(v).matchAll(/\{\{\s*secret:([a-zA-Z0-9_.:-]+)\s*\}\}/g)) out.push(m[1]);
  return out;
}
