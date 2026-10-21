import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The site imports the real mascot from apps/web, so make sure both share one React.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { dedupe: ["react", "react-dom", "motion", "zustand"] },
  server: { port: 5330, strictPort: true },
  build: { outDir: "dist", emptyOutDir: true, target: "es2022" },
});
