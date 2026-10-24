/**
 * Routing-rule evaluator: a small, safe subset of JSON-logic (no code execution).
 *
 * Supported operators: and, or, !, ==, !=, >, >=, <, <=, in, var, if
 *   {"var": "contract.totalValue"}                       → value lookup (dot path)
 *   {">": [{"var":"contract.totalValue"}, {"var":"policy.financeThreshold"}]}
 *   {"in": [{"var":"contract.dataSensitivity"}, ["CONFIDENTIAL","RESTRICTED"]]}
 * A null/undefined rule means "always applies".
 */
export type Rule = null | undefined | boolean | number | string | Rule[] | { [op: string]: Rule | Rule[] };

const OPS = new Set(["and", "or", "!", "==", "!=", ">", ">=", "<", "<=", "in", "var", "if"]);

export class RuleError extends Error {}

function lookup(data: unknown, path: string): unknown {
  if (path === "") return data;
  let cur: unknown = data;
  for (const part of path.split(".")) {
    if (cur == null || typeof cur !== "object") return null;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur ?? null;
}

function num(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  return NaN;
}

function compare(op: string, a: unknown, b: unknown): boolean {
  const na = num(a);
  const nb = num(b);
  if (!Number.isNaN(na) && !Number.isNaN(nb)) {
    switch (op) {
      case ">": return na > nb;
      case ">=": return na >= nb;
      case "<": return na < nb;
      case "<=": return na <= nb;
    }
  }
  if (typeof a === "string" && typeof b === "string") {
    switch (op) {
      case ">": return a > b;
      case ">=": return a >= b;
      case "<": return a < b;
      case "<=": return a <= b;
    }
  }
  return false; // null or mismatched types never satisfy an ordering comparison
}

function truthy(v: unknown): boolean {
  if (Array.isArray(v)) return v.length > 0;
  return Boolean(v);
}

export function evaluate(rule: Rule, data: unknown, depth = 0): unknown {
  if (depth > 32) throw new RuleError("Rule is nested too deeply");
  if (rule === null || rule === undefined) return true;
  if (typeof rule !== "object") return rule;
  if (Array.isArray(rule)) return rule.map((r) => evaluate(r, data, depth + 1));

  const keys = Object.keys(rule);
  if (keys.length !== 1) throw new RuleError("Each rule object must have exactly one operator");
  const op = keys[0];
  if (!OPS.has(op)) throw new RuleError(`Unsupported operator: ${op}`);
  const rawArgs = (rule as Record<string, Rule | Rule[]>)[op];
  const args = Array.isArray(rawArgs) ? rawArgs : [rawArgs];

  switch (op) {
    case "var": {
      const path = evaluate(args[0], data, depth + 1);
      const v = lookup(data, String(path ?? ""));
      return v ?? (args.length > 1 ? evaluate(args[1], data, depth + 1) : null);
    }
    case "and": {
      let last: unknown = true;
      for (const a of args) {
        last = evaluate(a, data, depth + 1);
        if (!truthy(last)) return last;
      }
      return last;
    }
    case "or": {
      let last: unknown = false;
      for (const a of args) {
        last = evaluate(a, data, depth + 1);
        if (truthy(last)) return last;
      }
      return last;
    }
    case "!":
      return !truthy(evaluate(args[0], data, depth + 1));
    case "==":
      return evaluate(args[0], data, depth + 1) === evaluate(args[1], data, depth + 1);
    case "!=":
      return evaluate(args[0], data, depth + 1) !== evaluate(args[1], data, depth + 1);
    case ">":
    case ">=":
    case "<":
    case "<=":
      return compare(op, evaluate(args[0], data, depth + 1), evaluate(args[1], data, depth + 1));
    case "in": {
      const needle = evaluate(args[0], data, depth + 1);
      const hay = evaluate(args[1], data, depth + 1);
      if (Array.isArray(hay)) return hay.includes(needle as never);
      if (typeof hay === "string" && typeof needle === "string") return hay.includes(needle);
      return false;
    }
    case "if": {
      for (let i = 0; i + 1 < args.length; i += 2) {
        if (truthy(evaluate(args[i], data, depth + 1))) return evaluate(args[i + 1], data, depth + 1);
      }
      return args.length % 2 === 1 ? evaluate(args[args.length - 1], data, depth + 1) : null;
    }
  }
  throw new RuleError(`Unsupported operator: ${op}`);
}

export function applies(rule: Rule, data: unknown): boolean {
  return truthy(evaluate(rule, data));
}

/** Validates structure without evaluating against data; returns an error message or null. */
export function validateRule(rule: unknown): string | null {
  try {
    evaluate(rule as Rule, {});
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/** Plain-English rendering for the admin UI and audit trail. */
export function describe(rule: Rule): string {
  if (rule === null || rule === undefined) return "Always";
  if (typeof rule !== "object") return JSON.stringify(rule);
  if (Array.isArray(rule)) return `[${rule.map(describe).join(", ")}]`;
  const op = Object.keys(rule)[0];
  const raw = (rule as Record<string, Rule | Rule[]>)[op];
  const a = Array.isArray(raw) ? raw : [raw];
  switch (op) {
    case "var":
      return String(a[0]);
    case "and":
      return a.map((x) => `(${describe(x)})`).join(" and ");
    case "or":
      return a.map((x) => `(${describe(x)})`).join(" or ");
    case "!":
      return `not (${describe(a[0])})`;
    case "in":
      return `${describe(a[0])} is one of ${describe(a[1])}`;
    default:
      return `${describe(a[0])} ${op} ${describe(a[1])}`;
  }
}
