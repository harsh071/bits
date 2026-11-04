import { motionCatalog } from "@agentable-ui/motion";
import type { Catalog } from "@agentable-ui/genui";

/**
 * The Agentable catalog with spring physics: every @agentable-ui/ui component springs in, plus
 * Device, Flashcards, Quiz, Lesson, Rings, Ranking, HoloCard, Carousel and friends. The daemon
 * builds the model's prompt from the same catalog (apps/daemon/src/artifacts.ts).
 */
export const catalog = motionCatalog as unknown as Catalog;
