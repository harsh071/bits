/** Bridge exposed by the Electron preload (apps/desktop). Undefined in a normal browser. */
export interface BitsDesktop {
  platform?: string;
  hideOverlay?: () => void;
  openMain?: () => void;
  resizeOverlay?: (heightPx: number) => void;
  onOverlayShown?: (fn: () => void) => () => void;
}

declare global {
  interface Window {
    bitsDesktop?: BitsDesktop;
  }
}

export const desktop = (): BitsDesktop | undefined => (typeof window !== "undefined" ? window.bitsDesktop : undefined);
