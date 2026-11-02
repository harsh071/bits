import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

// Demo builds (VITE_BITS_DEMO=1) swap the daemon for in-memory sample data; normal builds get an empty stub.
const DEMO = process.env.VITE_BITS_DEMO === "1";
const demoBackend = fileURLToPath(new URL(DEMO ? "./src/demo/api.ts" : "./src/demo/off.ts", import.meta.url));

const DAEMON = process.env.BITS_DAEMON_URL ?? `http://127.0.0.1:${process.env.BITS_PORT ?? 7077}`;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@bits-demo": demoBackend } },
  server: {
    port: 5320,
    strictPort: true,
    proxy: {
      "/api": {
        target: DAEMON,
        changeOrigin: true,
        // Keep SSE streaming: never buffer or compress event-stream responses.
        configure(proxy) {
          proxy.on("proxyReq", (req, incoming) => {
            if (incoming.url?.startsWith("/api/events")) req.setHeader("accept-encoding", "identity");
          });
          proxy.on("proxyRes", (res) => {
            if (String(res.headers["content-type"] ?? "").includes("text/event-stream")) {
              res.headers["cache-control"] = "no-cache, no-transform";
              res.headers["x-accel-buffering"] = "no";
            }
          });
        },
      },
    },
  },
  build: { outDir: "dist", emptyOutDir: true, target: "es2022", chunkSizeWarningLimit: 900 },
});
