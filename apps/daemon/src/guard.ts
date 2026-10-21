import type { MiddlewareHandler } from "hono";
import { config } from "./config.ts";

// Any web page you visit can send requests to http://127.0.0.1:7077. Two checks stop it from driving Bits:
//
//  1. Origin: browsers attach it to cross-site fetches and form posts. Only Bits' own pages (the daemon itself,
//     the Vite dev server, or BITS_ALLOWED_ORIGINS) may call in. Non-browser clients send no Origin and pass.
//  2. Host: a DNS-rebinding page reaches us under its own hostname, so on a loopback bind only loopback
//     Host headers are accepted.

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);
const DEV_PORT = 5320;

function allowedOrigins() {
  const out = new Set<string>();
  for (const h of ["127.0.0.1", "localhost", "[::1]"]) {
    out.add(`http://${h}:${config.port}`);
    out.add(`http://${h}:${DEV_PORT}`);
  }
  for (const o of (process.env.BITS_ALLOWED_ORIGINS ?? "").split(",")) if (o.trim()) out.add(o.trim().replace(/\/$/, ""));
  return out;
}

export function localOnly(): MiddlewareHandler {
  const origins = allowedOrigins();
  const loopbackBind = LOOPBACK.has(config.host);
  return async (c, next) => {
    if (loopbackBind) {
      const host = (c.req.header("host") ?? "").replace(/:\d+$/, "");
      if (!LOOPBACK.has(host)) return c.json({ error: "forbidden host" }, 403);
    }
    const origin = c.req.header("origin");
    if (origin && !origins.has(origin)) return c.json({ error: "forbidden origin" }, 403);
    // Older browsers may omit Origin on some requests; Fetch Metadata still flags cross-site writes.
    if (!origin && c.req.method !== "GET" && c.req.method !== "HEAD" && c.req.header("sec-fetch-site") === "cross-site") {
      return c.json({ error: "forbidden" }, 403);
    }
    return next();
  };
}
