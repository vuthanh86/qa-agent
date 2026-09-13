import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTranslate } from "../../src/phases/translate.js";
import { writeFile } from "../../src/utils/fs.js";

let tmp: string;
const originalBaseUrl = process.env.QA_BASE_URL;

const CASE_HEADER =
  "| id | title | priority | surface | preconditions | test data | expected | trace |";
const CASE_DIVIDER = "|---|---|---|---|---|---|---|---|";

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "qa-agent-translate-"));
  delete process.env.QA_BASE_URL;
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  if (originalBaseUrl === undefined) delete process.env.QA_BASE_URL;
  else process.env.QA_BASE_URL = originalBaseUrl;
});

/** Write a plan.md containing the given case-table rows, then translate it. */
function translate(rows: string[], options: { target?: string } = {}) {
  const planPath = join(tmp, "plan.md");
  writeFile(planPath, ["# Plan", "", CASE_HEADER, CASE_DIVIDER, ...rows].join("\n"));

  const result = runTranslate({ in: planPath, outDir: tmp, target: options.target });
  return { result, scenarios: readFileSync(result.scenariosPath, "utf-8") };
}

const ROW_A =
  "| TC-01 | Login succeeds | P0 | /login | user exists | alice/secret | dashboard loads | story:1 |";

describe("input handling", () => {
  it("throws a clear error when plan.md is missing", () => {
    expect(() => runTranslate({ in: join(tmp, "nope.md"), outDir: tmp })).toThrow(
      /plan\.md not found/,
    );
  });

  it("writes scenarios.md into the output directory", () => {
    const { result } = translate([ROW_A]);

    expect(result.scenariosPath).toBe(join(tmp, "scenarios.md"));
  });
});

describe("target resolution", () => {
  it("uses the explicit target when provided", () => {
    expect(translate([ROW_A], { target: "https://qa.example.com" }).scenarios).toContain(
      "> **Target:** https://qa.example.com",
    );
  });

  it("falls back to QA_BASE_URL when no target is given", () => {
    process.env.QA_BASE_URL = "https://env.example.com";

    expect(translate([ROW_A]).scenarios).toContain("> **Target:** https://env.example.com");
  });

  it("falls back to a placeholder when neither is set", () => {
    expect(translate([ROW_A]).scenarios).toContain("> **Target:** {{QA_BASE_URL}}");
  });

  it("prefers the explicit target over QA_BASE_URL", () => {
    process.env.QA_BASE_URL = "https://env.example.com";

    expect(translate([ROW_A], { target: "https://explicit.example.com" }).scenarios).toContain(
      "> **Target:** https://explicit.example.com",
    );
  });
});

describe("case table parsing", () => {
  it("renders one scenario per case row", () => {
    const { result } = translate([
      ROW_A,
      "| TC-02 | Logout works | P1 | /app | signed in | n/a | back to login | story:2 |",
    ]);

    expect(result.caseCount).toBe(2);
  });

  it("carries every case field into the scenario metadata block", () => {
    const { scenarios } = translate([ROW_A]);

    expect(scenarios).toContain("## Scenario: TC-01 - Login succeeds");
    expect(scenarios).toContain("> priority       : P0");
    expect(scenarios).toContain("> surface        : /login");
    expect(scenarios).toContain("> preconditions  : user exists");
    expect(scenarios).toContain("> test data      : alice/secret");
    expect(scenarios).toContain("> expected       : dashboard loads");
    expect(scenarios).toContain("> trace          : story:1");
    expect(scenarios).toContain("> timebox        : 5m");
  });

  it("ignores rows with fewer than eight cells", () => {
    const { result } = translate([ROW_A, "| TC-02 | too short | P1 |"]);

    expect(result.caseCount).toBe(1);
  });

  it("stops collecting once the table ends and does not resume for later prose", () => {
    const planPath = join(tmp, "plan.md");
    writeFile(
      planPath,
      [
        CASE_HEADER,
        CASE_DIVIDER,
        ROW_A,
        "",
        "Some prose between tables.",
        "| X | not a case row | a | b | c | d | e | f |",
      ].join("\n"),
    );

    // The parser only re-enters a table on an `| id | title` header line.
    const result = runTranslate({ in: planPath, outDir: tmp });

    expect(result.caseCount).toBe(1);
  });

  it("returns zero cases when the plan has no case table", () => {
    const planPath = join(tmp, "plan.md");
    writeFile(planPath, "# Plan\n\nNo table here.\n");

    const result = runTranslate({ in: planPath, outDir: tmp });

    expect(result.caseCount).toBe(0);
    expect(readFileSync(result.scenariosPath, "utf-8")).toContain("## Scenarios");
  });
});

describe("generated steps", () => {
  it("opens the resolved target as the first step", () => {
    const { scenarios } = translate([ROW_A], { target: "https://qa.example.com" });

    expect(scenarios).toContain("1.  open `https://qa.example.com`");
  });

  it("uses credential placeholders rather than literal secrets", () => {
    const { scenarios } = translate([ROW_A]);

    expect(scenarios).toContain("`{{QA_USER}}`");
    expect(scenarios).toContain("`{{QA_PASS}}`");
  });

  it("asserts on the case's expected result", () => {
    const { scenarios } = translate([ROW_A]);

    expect(scenarios).toContain("7.  assert `dashboard loads` == `dashboard loads`");
  });

  it("names the evidence screenshot after the case id", () => {
    const { scenarios } = translate([ROW_A]);

    expect(scenarios).toContain("8.  screenshot `evidence/TC-01-after.png`");
  });

  it("documents the healing policy in the header and per scenario", () => {
    const { scenarios } = translate([ROW_A]);

    expect(scenarios.match(/\*\*Healing:\*\*/g)).toHaveLength(2);
  });
});
