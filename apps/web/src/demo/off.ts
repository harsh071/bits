// Stand-in for ./api.ts in normal builds, so no demo code or sample data ships with the real app.
// vite.config.ts points "@bits-demo" here unless VITE_BITS_DEMO=1.
export const demoApi = undefined as never;
export const onDemoEvent = (_fn: unknown) => () => {};
