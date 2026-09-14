import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runReport, type QaResults, type QaCase, type QaDefect } from "../../src/phases/report.js";
import { writeFile } from "../../src/utils/fs.js";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "qa-agent-report-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function makeCase(overrides: Partial<QaCase> = {}): QaCase {
  return {
    id: "TC-01",
    title: "Login succeeds",
    priority: "P0",
    surface: "/login",
    status: "PASS",
    durationMs: 1200,
    ...overrides,
  };
}

function makeResults(overrides: Partial<QaResults> = {}): QaResults {
  const cases = overrides.cases ?? [makeCase()];
  return {
    runId: "20260101T1200-qa-login",
    scope: "diff main...HEAD",
    env: "https://qa.example.com",
    depth: "smoke",
    date: "2026-01-01T12:00:00.000Z",
    summary: {
      total: cases.length,
      passed: cases.filter(c => c.status === "PASS").length,
      failed: cases.filter(c => c.status === "FAIL" || c.status === "ERROR").length,
      skipped: cases.filter(c => c.status === "SKIP").length,
      durationMs: 5000,
    },
    defects: [],
    qaAgent: {
      runId: "20260101T1200-qa-login",
      feature: "Login",
      env: "qa",
      checkpoint: null,
      snapshots: [],
    },
    ...overrides,
    cases,
  };
}

/** Write results.json into the temp run dir, run the report, return the markdown. */
function report(results: QaResults, options: { skipHistory?: boolean } = {}) {
  writeFile(join(tmp, "results.json"), JSON.stringify(results));
  const result = runReport({ runDir: tmp, ...options });
  return { result, md: readFileSync(result.reportPath, "utf-8") };
}

describe("input handling", () => {
  it("throws when results.json is absent", () => {
    expect(() => runReport({ runDir: tmp })).toThrow(/results\.json not found/);
  });

  it("writes results.md into the run directory", () => {
    const { result } = report(makeResults());

    expect(result.reportPath).toBe(join(tmp, "results.md"));
  });
});

describe("header", () => {
  it("records runId, scope, depth, env and date", () => {
    const { md } = report(makeResults());

    expect(md).toContain("# QA report — 20260101T1200-qa-login");
    expect(md).toContain("**Scope:** diff main...HEAD");
    expect(md).toContain("**Depth:** smoke");
    expect(md).toContain("**Env:** https://qa.example.com");
    expect(md).toContain("**Date:** 2026-01-01T12:00:00.000Z");
  });

  it("renders a null env as N/A", () => {
    expect(report(makeResults({ env: null })).md).toContain("**Env:** N/A");
  });
});

describe("history section", () => {
  it("references history.html by default", () => {
    expect(report(makeResults()).md).toContain("## History graph");
  });

  it("omits the history section when skipHistory is set", () => {
    expect(report(makeResults(), { skipHistory: true }).md).not.toContain("## History graph");
  });
});

describe("summary and pass rate", () => {
  it("renders the summary counters", () => {
    const { md } = report(makeResults());

    expect(md).toContain("| 1 | 1 | 0 | 0 | 5000ms |");
  });

  it("computes the pass rate to one decimal place", () => {
    const cases = [
      makeCase({ id: "TC-01", status: "PASS" }),
      makeCase({ id: "TC-02", status: "PASS" }),
      makeCase({ id: "TC-03", status: "FAIL" }),
    ];

    expect(report(makeResults({ cases })).md).toContain("**Pass rate:** 66.7%");
  });

  it("reports 0.0% rather than NaN when no cases ran", () => {
    const results = makeResults({ cases: [] });

    expect(report(results).md).toContain("**Pass rate:** 0.0%");
  });

  it("reports 100.0% when everything passes", () => {
    expect(report(makeResults()).md).toContain("**Pass rate:** 100.0%");
  });
});

describe("case results table", () => {
  it("renders one row per case", () => {
    const { md } = report(makeResults());

    expect(md).toContain("| TC-01 | Login succeeds | P0 | PASS | 1200ms |");
  });

  it("prefers rootCause over reason in the root-cause column", () => {
    const cases = [makeCase({ status: "FAIL", reason: "assert failed", rootCause: "null ref" })];

    const { md } = report(makeResults({ cases }));

    expect(md).toContain("| null ref |");
    expect(md).not.toContain("| assert failed |");
  });

  it("falls back to reason when there is no rootCause", () => {
    const cases = [makeCase({ status: "FAIL", reason: "assert failed" })];

    expect(report(makeResults({ cases })).md).toContain("| assert failed |");
  });

  it("leaves the root-cause column empty when neither is present", () => {
    expect(report(makeResults()).md).toContain("| TC-01 | Login succeeds | P0 | PASS | 1200ms |  |  |");
  });

  it("marks regressions in the table", () => {
    const cases = [makeCase({ status: "FAIL", regression: true })];

    expect(report(makeResults({ cases })).md).toContain("⚠️ YES");
  });
});

describe("skipped cases section", () => {
  it("lists skipped cases with their reason", () => {
    const cases = [makeCase({ status: "SKIP", reason: "env unavailable" })];

    const { md } = report(makeResults({ cases }));

    expect(md).toContain("### Skipped cases");
    expect(md).toContain("- **TC-01** — env unavailable");
  });

  it("notes when a skipped case has no recorded reason", () => {
    const cases = [makeCase({ status: "SKIP" })];

    expect(report(makeResults({ cases })).md).toContain("- **TC-01** — No reason recorded");
  });

  it("omits the section when nothing was skipped", () => {
    expect(report(makeResults()).md).not.toContain("### Skipped cases");
  });
});

describe("regression and flaky sections", () => {
  it("calls out regressions", () => {
    const cases = [makeCase({ status: "FAIL", regression: true })];

    const { md } = report(makeResults({ cases }));

    expect(md).toContain("## ⚠️ Regressions (passed previously)");
    expect(md).toContain("last status was PASS, now FAIL");
  });

  it("calls out flaky cases", () => {
    const cases = [makeCase({ flaky: true })];

    const { md } = report(makeResults({ cases }));

    expect(md).toContain("## Flaky cases (PASS on retry)");
    expect(md).toContain("first run FAIL, retry PASS");
  });

  it("omits both sections for a clean run", () => {
    const { md } = report(makeResults());

    expect(md).not.toContain("## ⚠️ Regressions (passed previously)");
    expect(md).not.toContain("## Flaky cases (PASS on retry)");
  });
});

describe("defects section", () => {
  const defect: QaDefect = {
    id: "D-01",
    severity: "S2",
    title: "Save button inert",
    case: "TC-01",
    steps: "Click Save",
    expected: "Row persists",
    actual: "Nothing happens",
    evidence: ["evidence/TC-01-after.png"],
  };

  it("renders each defect with its detail fields", () => {
    const { md } = report(makeResults({ defects: [defect] }));

    expect(md).toContain("### D-01 — S2 — Save button inert");
    expect(md).toContain("- **Case:** TC-01");
    expect(md).toContain("- **Steps:** Click Save");
    expect(md).toContain("- **Expected:** Row persists");
    expect(md).toContain("- **Actual:** Nothing happens");
    expect(md).toContain("- **Evidence:** evidence/TC-01-after.png");
  });

  it("joins multiple evidence paths", () => {
    const withEvidence = { ...defect, evidence: ["a.png", "b.png"] };

    expect(report(makeResults({ defects: [withEvidence] })).md).toContain(
      "- **Evidence:** a.png, b.png",
    );
  });

  it("omits the evidence line when there is none", () => {
    const noEvidence = { ...defect, evidence: [] };

    expect(report(makeResults({ defects: [noEvidence] })).md).not.toContain("- **Evidence:**");
  });

  it("omits the defects section entirely when there are none", () => {
    expect(report(makeResults()).md).not.toContain("## Defects");
  });
});

describe("ship / no-ship verdict", () => {
  it("ships a clean run", () => {
    expect(report(makeResults()).md).toContain("**✅ SHIP** — all cases pass");
  });

  it("ships with caution when there are failures but no S1", () => {
    const cases = [makeCase({ status: "FAIL" })];

    expect(report(makeResults({ cases })).md).toContain("**⚠️ SHIP WITH CAUTION**");
  });

  it("blocks the ship when an S1 defect is present", () => {
    const s1: QaDefect = {
      id: "D-99",
      severity: "S1",
      title: "Data loss",
      case: "TC-01",
      steps: "",
      expected: "",
      actual: "",
      evidence: [],
    };

    expect(report(makeResults({ defects: [s1] })).md).toContain("**🚫 NO-SHIP** — S1 defects present.");
  });

  it("prioritises the S1 verdict over the failure verdict", () => {
    const cases = [makeCase({ status: "FAIL" })];
    const s1: QaDefect = {
      id: "D-99",
      severity: "S1",
      title: "Data loss",
      case: "TC-01",
      steps: "",
      expected: "",
      actual: "",
      evidence: [],
    };

    const { md } = report(makeResults({ cases, defects: [s1] }));

    expect(md).toContain("**🚫 NO-SHIP**");
    expect(md).not.toContain("**⚠️ SHIP WITH CAUTION**");
  });
});

describe("AI task block", () => {
  it("appends the follow-up instructions for the AI reviewer", () => {
    const { md } = report(makeResults());

    expect(md).toContain("## AI Task: Review results and draft defects");
    expect(md).toContain("Add defects to `defects.md` and update `results.json`.");
  });
});
