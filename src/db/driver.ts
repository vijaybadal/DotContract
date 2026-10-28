/**
 * Picks the database driver at run time (tests, scripts, local and hosted servers).
 * In the StackBlitz build, next.config.ts swaps this file for driver.stackblitz.ts so the page bundles
 * never include node-postgres.
 */
import { dbDriver } from "@/lib/runtime";
import * as pg from "./driver-pg";
import * as pglite from "./driver-pglite";

export const driver = dbDriver() === "pglite" ? pglite : pg;
