import { EventEmitter } from "node:events";
import type { ServerEvent } from "@bits/protocol";

// In-process fan-out of live signals to SSE subscribers (and channels like Slack later).
const emitter = new EventEmitter();
emitter.setMaxListeners(0);

export const bus = {
  emit(event: ServerEvent) {
    emitter.emit("event", event);
  },
  subscribe(fn: (event: ServerEvent) => void) {
    emitter.on("event", fn);
    return () => emitter.off("event", fn);
  },
};
