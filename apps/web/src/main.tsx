import { StrictMode, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { MotionConfig } from "motion/react";
import { AgentableProvider } from "@agentable-ui/react";
import "@agentable-ui/ui/styles.css";
import "./styles.css";
import { App } from "./App";
import { Overlay } from "./overlay/Overlay";
import { StandaloneArtifact } from "./artifacts/Standalone";
import { startSync } from "./store/sync";
import { desktop } from "./lib/desktop";

const params = new URLSearchParams(location.search);
const root = document.documentElement;
const d = desktop();
if (d) {
  root.dataset.desktop = "1";
  if (d.platform) root.dataset.platform = d.platform;
}

// Dev-only fixtures page (tree-shaken out of production builds).
const Fixtures = import.meta.env.DEV ? lazy(() => import("./fixtures/Fixtures")) : null;
// Agentable devtools (Alt+A) in development only.
const Devtools = import.meta.env.DEV
  ? lazy(() => import("@agentable-ui/devtools/react").then((m) => ({ default: m.AgentableDevtools })))
  : null;

function Root() {
  if (Fixtures && params.get("fixtures") === "1") {
    return (
      <Suspense fallback={null}>
        <Fixtures />
      </Suspense>
    );
  }
  const artifact = params.get("artifact");
  if (artifact) {
    startSync();
    return <StandaloneArtifact id={artifact} />;
  }
  if (params.get("overlay") === "1") {
    root.dataset.overlay = "1";
    startSync();
    return <Overlay />;
  }
  return <App />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      <AgentableProvider budget={24}>
        <Root />
        {Devtools && (
          <Suspense fallback={null}>
            <Devtools />
          </Suspense>
        )}
      </AgentableProvider>
    </MotionConfig>
  </StrictMode>,
);
