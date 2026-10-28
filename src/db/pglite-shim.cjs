/**
 * Stands in for "@electric-sql/pglite" inside the Next.js server bundles in PGlite (StackBlitz) mode.
 * See next.config.ts.
 *
 * PGlite is an ES module. If it is loaded as an external package, every page that touches the
 * database is compiled as an async module, and on StackBlitz's in-browser Node that loses Next.js's
 * request context ("Expected workUnitAsyncStorage to have a store"). Instead,
 * src/instrumentation-node.ts loads PGlite once at startup, outside any request, and this file hands
 * that module to the bundles synchronously.
 */
const mod = globalThis.__clmPgliteModule;

if (mod) {
  module.exports = mod;
} else {
  // Next.js also loads dynamic pages (such as /requests/[id]) in short-lived helper processes that only
  // inspect the page and never run the startup step or query the database. They get a placeholder.
  const unavailable = () => {
    throw new Error("PGlite is not loaded in this process. Pages are served by the main server, where src/instrumentation-node.ts loads it.");
  };
  class PGlite {
    query() { return unavailable(); }
    exec() { return unavailable(); }
    transaction() { return unavailable(); }
    close() { return Promise.resolve(); }
  }
  module.exports = { PGlite, types: {} };
}
