/**
 * Demo mode (build with VITE_BITS_DEMO=1): the app runs on in-memory sample data instead of a
 * daemon. Nothing calls the daemon, and no token or API key is read or sent.
 */
export const DEMO = import.meta.env.VITE_BITS_DEMO === "1";
