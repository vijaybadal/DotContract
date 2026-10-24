# ADR-001: Drizzle ORM instead of Prisma

**Status:** Accepted for Phase 1 · **Date:** 2026-10-23 · **For:** DOTComm Architecture Review Board

## Context

The master build prompt recommends Prisma. In the build environment, Prisma 6 and 7 both download
native engine binaries from `binaries.prisma.sh` at install or generate time; that host was not
reachable, so Prisma could not be installed, generated or tested. Locked-down government networks often
have the same restriction.

## Decision

Use **Drizzle ORM** (`drizzle-orm` 0.45, `drizzle-kit` 0.31) with the `pg` driver.

- Pure TypeScript; no native engine or binary download.
- Plain SQL migrations committed to `drizzle/`, reviewable by a DBA, and able to hold triggers and
  partial indexes (used for the append-only guards).
- Type-safe queries and a relational query API comparable to Prisma's.
- Everything else in the recommended stack is unchanged: Next.js, TypeScript, Tailwind, PostgreSQL.

## Consequences

- Developers familiar with Prisma need a short ramp-up; the schema reads similarly.
- Switching back later is possible: the schema is conventional PostgreSQL and migrations are SQL.
- No dependency on an external binary host at build or deploy time.
