import { StrictMode, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { MotionConfig } from "motion/react";
import "./styles.css";
import { App } from "./App";
import { Overlay } from "./overlay/Overlay";
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

function Root() {
  if (Fixtures && params.get("fixtures") === "1") {
    return (
      <Suspense fallback={null}>
        <Fixtures />
      </Suspense>
    );
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
      <Root />
    </MotionConfig>
  </StrictMode>,
);
