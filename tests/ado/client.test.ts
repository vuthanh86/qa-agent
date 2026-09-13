import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const homedirMock = vi.hoisted(() => vi.fn());
vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, homedir: homedirMock };
});

const {
  parsePlanUrl,
  auditTestCase,
  getTestPlan,
  getTestSuites,
  getTestCases,
  getWorkItem,
} = await import("../../src/ado/client.js");
const { adoCacheDir, writeFile } = await import("../../src/utils/fs.js");

type AdoTestCase = Parameters<typeof auditTestCase>[0];

let tmp: string;
let fetchMock: ReturnType<typeof vi.fn>;
const originalPat = process.env.ADO_PAT;

const config = { org: "contoso", project: "pmi", pat: "secret-pat" };

/** Build an ok Response stub carrying the given JSON body. */
function jsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

/** A test case with all audit checks satisfied, for targeted overriding. */
function cleanCase(overrides: Partial<AdoTestCase> = {}): AdoTestCase {
  return {
    id: 1,
    title: "Clean case",
    state: "Design",
    priority: 1,
    steps: [
      { stepNumber: 1, action: "Given the user is signed in", expected: "Dashboard is shown" },
      { stepNumber: 2, action: "Click Save", expected: "Toast confirms the save" },
    ],
    lastResult: "Passed",
    lastResultDate: new Date().toISOString(),
    createdDate: new Date().toISOString(),
    modifiedDate: new Date().toISOString(),
    linkedWorkItems: [],
    ...overrides,
  };
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "qa-agent-ado-"));
  homedirMock.mockReturnValue(tmp);
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  delete process.env.ADO_PAT;
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  vi.unstubAllGlobals();
  if (originalPat === undefined) delete process.env.ADO_PAT;
  else process.env.ADO_PAT = originalPat;
});

describe("parsePlanUrl", () => {
  it("parses an execute-view plan URL", () => {
    expect(
      parsePlanUrl("https://dev.azure.com/contoso/pmi/_testPlans/execute?planId=123"),
    ).toEqual({ org: "contoso", project: "pmi", planId: 123 });
  });

  it("parses a define-view plan URL", () => {
    expect(
      parsePlanUrl("https://dev.azure.com/contoso/pmi/_testPlans/define?planId=456"),
    ).toEqual({ org: "contoso", project: "pmi", planId: 456 });
  });

  it("returns planId as a number, not a string", () => {
    const parsed = parsePlanUrl("https://dev.azure.com/o/p/_testPlans/execute?planId=007");

    expect(parsed!.planId).toBe(7);
  });

  it("ignores query parameters trailing planId, such as suiteId", () => {
    expect(
      parsePlanUrl(
        "https://dev.azure.com/d2odevops/PMI/_testPlans/define?planId=43944&suiteId=43964",
      ),
    ).toEqual({ org: "d2odevops", project: "PMI", planId: 43944 });
  });

  it("preserves the case of the project segment", () => {
    expect(
      parsePlanUrl("https://dev.azure.com/d2odevops/PMI/_testPlans/define?planId=1")!.project,
    ).toBe("PMI");
  });

  it.each([
    "https://dev.azure.com/contoso/pmi/_testPlans/execute",
    "https://dev.azure.com/contoso/_testPlans/execute?planId=1",
    "https://example.com/contoso/pmi/_testPlans/execute?planId=1",
    "https://dev.azure.com/contoso/pmi/_testPlans/execute?planId=abc",
    "not a url",
    "",
  ])("returns null for unparseable URL %o", (url) => {
    expect(parsePlanUrl(url)).toBeNull();
  });
});

describe("adoFetch behaviour (via getTestPlan)", () => {
  it("throws a clear error when no PAT is available", async () => {
    await expect(getTestPlan({ org: "o", project: "p" }, 1)).rejects.toThrow(/ADO_PAT is required/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to the ADO_PAT env var when config has no pat", async () => {
    process.env.ADO_PAT = "env-pat";
    fetchMock.mockResolvedValue(jsonResponse({ id: 1, name: "Plan" }));

    await getTestPlan({ org: "o", project: "p" }, 1);

    const headers = fetchMock.mock.calls[0][1].headers;
    expect(headers.Authorization).toBe(`Basic ${Buffer.from(":env-pat").toString("base64")}`);
  });

  it("sends Basic auth built from an empty username and the PAT", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 1, name: "Plan" }));

    await getTestPlan(config, 1);

    const headers = fetchMock.mock.calls[0][1].headers;
    expect(headers.Authorization).toBe(`Basic ${Buffer.from(":secret-pat").toString("base64")}`);
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("targets the org/project base URL with the pinned api-version", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 9, name: "Plan" }));

    await getTestPlan(config, 9);

    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://dev.azure.com/contoso/pmi/_apis/testplan/plans/9?api-version=7.2",
    );
  });

  it("throws with the status and truncated body on a non-ok response", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "Unauthorized",
      json: async () => ({}),
    });

    await expect(getTestPlan(config, 1)).rejects.toThrow("ADO API 401: Unauthorized");
  });

  it("writes the response to the cache directory", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 5, name: "Plan" }));

    await getTestPlan(config, 5);

    expect(existsSync(join(adoCacheDir(), "plan", "contoso", "pmi", "5.json"))).toBe(true);
  });

  it("serves a fresh cache entry without hitting the network", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 5, name: "Original" }));
    await getTestPlan(config, 5);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const second = await getTestPlan(config, 5);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second.name).toBe("Original");
  });

  it("refetches when the cache entry is older than the 1-hour TTL", async () => {
    const stale = { id: 5, name: "Stale", _ts: Date.now() - 2 * 60 * 60 * 1000 };
    writeFile(join(adoCacheDir(), "plan", "contoso", "pmi", "5.json"), JSON.stringify(stale));
    fetchMock.mockResolvedValue(jsonResponse({ id: 5, name: "Fresh" }));

    const plan = await getTestPlan(config, 5);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(plan.name).toBe("Fresh");
  });

  it("refetches when the cache entry is corrupt", async () => {
    writeFile(join(adoCacheDir(), "plan", "contoso", "pmi", "5.json"), "{ corrupt");
    fetchMock.mockResolvedValue(jsonResponse({ id: 5, name: "Fresh" }));

    const plan = await getTestPlan(config, 5);

    expect(plan.name).toBe("Fresh");
  });
});

describe("getTestPlan", () => {
  it("maps the plan fields", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ id: 3, name: "Regression", state: "Active", createdDate: "2026-01-01" }),
    );

    expect(await getTestPlan(config, 3)).toEqual({
      id: 3,
      name: "Regression",
      state: "Active",
      createdDate: "2026-01-01",
    });
  });

  it("defaults missing state and createdDate", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 3, name: "Regression" }));

    const plan = await getTestPlan(config, 3);

    expect(plan.state).toBe("unknown");
    expect(plan.createdDate).toBe("");
  });
});

describe("getTestSuites", () => {
  it("maps suites and flattens the parent id", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        value: [
          { id: 1, name: "Root", suiteType: "staticTestSuite" },
          { id: 2, name: "Child", parent: { id: 1 } },
        ],
      }),
    );

    expect(await getTestSuites(config, 10)).toEqual([
      { id: 1, name: "Root", suiteType: "staticTestSuite", parentSuiteId: undefined },
      { id: 2, name: "Child", suiteType: "static", parentSuiteId: 1 },
    ]);
  });

  it("returns an empty array when the response has no value list", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}));

    expect(await getTestSuites(config, 10)).toEqual([]);
  });
});

describe("getTestCases", () => {
  it("prefers workItem fields and numbers the steps from 1", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        value: [
          {
            id: 99,
            workItem: {
              id: 42,
              name: "Login works",
              state: "Ready",
              priority: 1,
              steps: [
                { action: "Open app", expected: "Login page" },
                { description: "Enter creds", expected: "Dashboard" },
              ],
              createdDate: "2026-01-01",
              lastUpdatedDate: "2026-02-01",
            },
            lastResult: { outcome: "Passed", completedDate: "2026-03-01" },
          },
        ],
      }),
    );

    const [tc] = await getTestCases(config, 1, 2);

    expect(tc.id).toBe(42);
    expect(tc.title).toBe("Login works");
    expect(tc.priority).toBe(1);
    expect(tc.lastResult).toBe("Passed");
    expect(tc.modifiedDate).toBe("2026-02-01");
    expect(tc.steps).toEqual([
      { stepNumber: 1, action: "Open app", expected: "Login page" },
      { stepNumber: 2, action: "Enter creds", expected: "Dashboard" },
    ]);
  });

  it("falls back to top-level id/title and default priority", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ value: [{ id: 7, title: "Bare case" }] }));

    const [tc] = await getTestCases(config, 1, 2);

    expect(tc.id).toBe(7);
    expect(tc.title).toBe("Bare case");
    expect(tc.priority).toBe(2);
    expect(tc.steps).toEqual([]);
    expect(tc.lastResult).toBeNull();
  });

  it("returns an empty array when the suite has no cases", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ value: [] }));

    expect(await getTestCases(config, 1, 2)).toEqual([]);
  });
});

describe("getWorkItem", () => {
  it("maps the ADO system fields", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        id: 33672,
        fields: {
          "System.Title": "Implement SSO",
          "System.WorkItemType": "User Story",
          "System.State": "Active",
          "System.Description": "<p>desc</p>",
          "Microsoft.VSTS.Common.AcceptanceCriteria": "<p>AC</p>",
        },
      }),
    );

    expect(await getWorkItem(config, 33672)).toEqual({
      id: 33672,
      title: "Implement SSO",
      type: "User Story",
      state: "Active",
      description: "<p>desc</p>",
      acceptanceCriteria: "<p>AC</p>",
    });
  });

  it("defaults every field to an empty string when fields are absent", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 1 }));

    const wi = await getWorkItem(config, 1);

    expect(wi).toEqual({
      id: 1,
      title: "",
      type: "",
      state: "",
      description: "",
      acceptanceCriteria: "",
    });
  });
});

describe("auditTestCase", () => {
  it("reports no issues for a well-formed, recently-run case", () => {
    expect(auditTestCase(cleanCase())).toEqual([]);
  });

  it("flags a case with zero steps as not executable", () => {
    const issues = auditTestCase(cleanCase({ steps: [] }));

    expect(issues).toContain("ZERO steps — not executable");
  });

  it("flags a single-step case as too thin", () => {
    const issues = auditTestCase(
      cleanCase({
        steps: [{ stepNumber: 1, action: "Given signed in", expected: "OK" }],
      }),
    );

    expect(issues).toContain("SINGLE step — too thin to assert, needs more granularity");
  });

  it("counts steps that are missing an expected result", () => {
    const issues = auditTestCase(
      cleanCase({
        steps: [
          { stepNumber: 1, action: "Given signed in", expected: "" },
          { stepNumber: 2, action: "Click Save", expected: "   " },
          { stepNumber: 3, action: "Reload", expected: "Data persists" },
        ],
      }),
    );

    expect(issues).toContain("2 step(s) missing expected result");
  });

  it("flags a case with no precondition language", () => {
    const issues = auditTestCase(
      cleanCase({
        steps: [
          { stepNumber: 1, action: "Click Save", expected: "Saved" },
          { stepNumber: 2, action: "Reload", expected: "Persisted" },
        ],
      }),
    );

    expect(issues).toContain(
      "No preconditions specified — end-user may not know required state",
    );
  });

  it.each(["Pre-condition: signed in", "Given a tenant", "Assume the grid is loaded", "Before each run"])(
    "accepts %o as a precondition",
    (action) => {
      const issues = auditTestCase(
        cleanCase({
          steps: [
            { stepNumber: 1, action, expected: "ok" },
            { stepNumber: 2, action: "Click Save", expected: "Saved" },
          ],
        }),
      );

      expect(issues).not.toContain(
        "No preconditions specified — end-user may not know required state",
      );
    },
  );

  it("flags P3 and lower-priority cases for review", () => {
    expect(auditTestCase(cleanCase({ priority: 3 }))).toContain(
      "P3 priority — verify this is intentional for the surface",
    );
    expect(auditTestCase(cleanCase({ priority: 4 }))).toContain(
      "P3 priority — verify this is intentional for the surface",
    );
  });

  it("does not flag P0-P2 priorities", () => {
    for (const priority of [0, 1, 2]) {
      expect(auditTestCase(cleanCase({ priority }))).not.toContain(
        "P3 priority — verify this is intentional for the surface",
      );
    }
  });

  it("flags a case untouched for more than 180 days as stale", () => {
    const old = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString();

    expect(auditTestCase(cleanCase({ modifiedDate: old }))).toContain(
      "Not modified in 180+ days — may be stale",
    );
  });

  it("does not flag a case modified within 180 days", () => {
    const recent = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();

    expect(auditTestCase(cleanCase({ modifiedDate: recent }))).not.toContain(
      "Not modified in 180+ days — may be stale",
    );
  });

  it("skips the staleness check when modifiedDate is absent", () => {
    expect(auditTestCase(cleanCase({ modifiedDate: "" }))).not.toContain(
      "Not modified in 180+ days — may be stale",
    );
  });

  it("flags a never-executed case as a coverage gap", () => {
    expect(auditTestCase(cleanCase({ lastResult: undefined }))).toContain(
      "Never executed — coverage gap",
    );
  });

  it("accumulates every applicable issue for a worst-case test case", () => {
    const issues = auditTestCase(
      cleanCase({
        steps: [],
        priority: 3,
        lastResult: undefined,
        modifiedDate: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString(),
      }),
    );

    expect(issues).toEqual([
      "ZERO steps — not executable",
      "No preconditions specified — end-user may not know required state",
      "P3 priority — verify this is intentional for the surface",
      "Not modified in 180+ days — may be stale",
      "Never executed — coverage gap",
    ]);
  });

  it("accepts an optional story argument without changing the verdict", () => {
    const story = {
      id: 1,
      title: "Story",
      type: "User Story",
      state: "Active",
      description: "",
      acceptanceCriteria: "",
    };

    expect(auditTestCase(cleanCase(), story)).toEqual([]);
  });
});
