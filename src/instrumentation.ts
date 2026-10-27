// Next.js calls register() once per server start, before serving requests. The Node-only work lives in
// instrumentation-node.ts; this guard (NEXT_RUNTIME is replaced at compile time) keeps it out of the edge bundle.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation-node");
  }
}
