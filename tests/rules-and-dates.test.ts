import { describe, expect, it } from "vitest";
import { applies, describe as describeRule, evaluate, validateRule } from "@/lib/rules";
import { addMonths, daysBetween, noticeDeadline, todayIn, isValidISODate } from "@/lib/dates";
import { dueThreshold } from "@/lib/renewals";
import { allocate } from "@/lib/money";

const ctx = { contract: { totalValue: 120000, dataSensitivity: "CONFIDENTIAL", isSubscription: false }, policy: { financeReviewThreshold: 25000 }, parties: { crossAgency: true } };

describe("routing rules", () => {
  it("evaluates comparisons against policy variables", () => {
    expect(applies({ ">=": [{ var: "contract.totalValue" }, { var: "policy.financeReviewThreshold" }] }, ctx)).toBe(true);
    expect(applies({ "<": [{ var: "contract.totalValue" }, 1000] }, ctx)).toBe(false);
  });
  it("supports and/or/not/in", () => {
    expect(applies({ or: [{ in: [{ var: "contract.dataSensitivity" }, ["CONFIDENTIAL", "RESTRICTED"]] }, { var: "contract.isSubscription" }] }, ctx)).toBe(true);
    expect(applies({ and: [{ var: "parties.crossAgency" }, { "!": { var: "contract.isSubscription" } }] }, ctx)).toBe(true);
  });
  it("treats missing values as not meeting ordering comparisons", () => {
    expect(applies({ ">": [{ var: "contract.missing" }, 0] }, ctx)).toBe(false);
  });
  it("null rule always applies", () => {
    expect(applies(null, ctx)).toBe(true);
  });
  it("rejects unsupported operators (no code execution)", () => {
    expect(validateRule({ eval: ["process.exit()"] })).toMatch(/Unsupported operator/);
    expect(() => evaluate({ a: 1, b: 2 } as never, ctx)).toThrow();
  });
  it("describes rules in plain language", () => {
    expect(describeRule({ ">=": [{ var: "contract.totalValue" }, 25000] })).toBe("contract.totalValue >= 25000");
  });
});

describe("calendar dates", () => {
  it("clamps month arithmetic to month end", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonths("2026-10-15", 12)).toBe("2027-10-15");
  });
  it("computes notice deadlines", () => {
    expect(noticeDeadline("2027-03-31", 60)).toBe("2027-01-30");
    expect(noticeDeadline("2027-03-31", null)).toBe("2027-03-31");
    expect(noticeDeadline(null, 30)).toBeNull();
  });
  it("computes today in the contracting entity's time zone, not UTC", () => {
    // 03:30 UTC on Nov 1 is still Oct 31 in Omaha
    expect(todayIn("America/Chicago", new Date("2026-11-01T03:30:00Z"))).toBe("2026-10-31");
    expect(todayIn("UTC", new Date("2026-11-01T03:30:00Z"))).toBe("2026-11-01");
  });
  it("handles DST transitions in day counts", () => {
    expect(daysBetween("2026-03-07", "2026-03-09")).toBe(2);
    expect(daysBetween("2026-10-31", "2026-11-02")).toBe(2);
  });
  it("validates ISO dates", () => {
    expect(isValidISODate("2026-02-30")).toBe(false);
    expect(isValidISODate("2026-02-28")).toBe(true);
  });
});

describe("renewal thresholds", () => {
  const offsets = [180, 120, 90, 60, 30];
  it("fires the smallest threshold crossed", () => {
    expect(dueThreshold(200, offsets)).toBeNull();
    expect(dueThreshold(180, offsets)).toBe(180);
    expect(dueThreshold(95, offsets)).toBe(120);
    expect(dueThreshold(10, offsets)).toBe(30);
  });
});

describe("cost allocation", () => {
  it("allocates in whole cents and preserves the total", () => {
    const parts = allocate(100000.01, [55, 45]);
    expect(parts).toEqual([55000.01, 45000]);
    expect(allocate(100, [1, 1, 1]).reduce((a, b) => a + b, 0)).toBeCloseTo(100, 2);
  });
});
