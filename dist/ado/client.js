/**
 * Azure DevOps REST client (v7.2).
 *
 * Handles: test plan pull, test case CRUD, work item fetch.
 * Auth via AZURE_DEVOPS_PAT env var (Basic auth).
 * Cache: 1-hour TTL in ~/.qa-agent/ado-cache/.
 */
import { writeFile, readFileSafe, ensureDir, adoCacheDir } from "../utils/fs.js";
import { flattenWorkItemFields, parseTestSteps, normalizeOutcome } from "./work-item-fields.js";
import { join } from "node:path";
// The testplan resources are preview-only; plain "7.2" is rejected with HTTP 400.
const API_VERSION = "7.2-preview";
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
/**
 * Parse an ADO test plan URL into org, project, planId.
 * Supports formats:
 *   https://dev.azure.com/{org}/{project}/_testPlans/execute?planId={id}
 *   https://dev.azure.com/{org}/{project}/_testPlans/define?planId={id}
 */
export function parsePlanUrl(url) {
    const m = url.match(/dev\.azure\.com\/([^/]+)\/([^/]+)\/_testPlans\/\w+\?planId=(\d+)/);
    if (!m)
        return null;
    return { org: m[1], project: m[2], planId: parseInt(m[3], 10) };
}
/** Resolve the PAT from config or env. */
function resolvePat(config) {
    return config.pat ?? process.env.AZURE_DEVOPS_PAT ?? "";
}
/** Build the Basic auth header. */
function authHeader(pat) {
    return `Basic ${Buffer.from(`:${pat}`).toString("base64")}`;
}
/** Build the ADO REST base URL. */
function baseUrl(config) {
    return `https://dev.azure.com/${config.org}/${config.project}`;
}
/** Fetch with ADO auth and caching. */
async function adoFetch(config, path, cacheKey) {
    const cacheFile = join(adoCacheDir(), `${cacheKey}.json`);
    const cached = readFileSafe(cacheFile);
    if (cached) {
        try {
            const data = JSON.parse(cached);
            if (Date.now() - data._ts < CACHE_TTL_MS)
                return data;
        }
        catch { /* stale cache */ }
    }
    const pat = resolvePat(config);
    if (!pat)
        throw new Error("AZURE_DEVOPS_PAT is required. Set AZURE_DEVOPS_PAT env var or pass --ado.pat.");
    const resp = await fetch(`${baseUrl(config)}${path}?api-version=${API_VERSION}`, {
        headers: {
            Authorization: authHeader(pat),
            "Content-Type": "application/json",
        },
    });
    if (!resp.ok) {
        const body = await resp.text();
        throw new Error(`ADO API ${resp.status}: ${body.slice(0, 500)}`);
    }
    const data = await resp.json();
    data._ts = Date.now();
    ensureDir(adoCacheDir());
    writeFile(cacheFile, JSON.stringify(data, null, 2));
    return data;
}
/** Pull a test plan by ID. */
export async function getTestPlan(config, planId) {
    const data = await adoFetch(config, `/_apis/testplan/plans/${planId}`, `plan/${config.org}/${config.project}/${planId}`);
    return {
        id: data.id,
        name: data.name,
        state: data.state ?? "unknown",
        createdDate: data.createdDate ?? "",
    };
}
/** List suites under a test plan. */
export async function getTestSuites(config, planId) {
    const data = await adoFetch(config, `/_apis/testplan/plans/${planId}/suites`, `suites/${config.org}/${config.project}/${planId}`);
    return (data.value ?? []).map((s) => ({
        id: s.id,
        name: s.name,
        suiteType: s.suiteType ?? "static",
        parentSuiteId: s.parent?.id,
    }));
}
/**
 * Last-run outcome per test case id, from the suite's test points.
 *
 * Outcomes live on test points, not on the test case itself. A failure here is
 * non-fatal: the audit degrades to "execution history unknown" rather than
 * aborting the whole plan pull.
 */
async function getLastResults(config, planId, suiteId) {
    const byCaseId = new Map();
    try {
        const data = await adoFetch(config, `/_apis/testplan/plans/${planId}/suites/${suiteId}/TestPoint`, `points/${config.org}/${config.project}/${planId}/${suiteId}`);
        for (const point of data.value ?? []) {
            const caseId = point.testCaseReference?.id;
            if (typeof caseId !== "number")
                continue;
            const completed = point.results?.lastResultDetails?.dateCompleted;
            byCaseId.set(caseId, {
                outcome: normalizeOutcome(point.results?.outcome),
                // ADO uses year 0001 as "never completed".
                date: completed && !completed.startsWith("0001-") ? completed : null,
            });
        }
    }
    catch {
        // Leave the map empty; callers treat a miss as unknown execution history.
    }
    return byCaseId;
}
/** List test cases under a suite. */
export async function getTestCases(config, planId, suiteId) {
    const data = await adoFetch(config, 
    // The resource is "TestCase" (singular); "testcases" returns HTTP 404.
    `/_apis/testplan/plans/${planId}/suites/${suiteId}/TestCase`, `cases/${config.org}/${config.project}/${planId}/${suiteId}`);
    const cases = data.value ?? [];
    const lastResults = cases.length > 0
        ? await getLastResults(config, planId, suiteId)
        : new Map();
    return cases.map((tc) => {
        // Attributes arrive as an array of single-key objects, not plain properties.
        const fields = flattenWorkItemFields(tc.workItem?.workItemFields);
        const id = tc.workItem?.id ?? tc.id;
        const priority = Number(fields["Microsoft.VSTS.Common.Priority"]);
        const result = lastResults.get(id);
        return {
            id,
            title: tc.workItem?.name ?? tc.title ?? "",
            state: fields["System.State"] ?? "",
            priority: Number.isFinite(priority) ? priority : 2,
            steps: parseTestSteps(fields["Microsoft.VSTS.TCM.Steps"]),
            lastResult: result?.outcome ?? null,
            lastResultDate: result?.date ?? null,
            createdDate: fields["System.CreatedDate"] ?? "",
            modifiedDate: fields["System.ChangedDate"] ?? fields["Microsoft.VSTS.Common.StateChangeDate"] ?? "",
            linkedWorkItems: [],
        };
    });
}
/** Fetch a work item by ID. */
export async function getWorkItem(config, workItemId) {
    const data = await adoFetch(config, `/_apis/wit/workitems/${workItemId}?$expand=all`, `wi/${config.org}/${config.project}/${workItemId}`);
    return {
        id: data.id,
        title: data.fields?.["System.Title"] ?? "",
        type: data.fields?.["System.WorkItemType"] ?? "",
        state: data.fields?.["System.State"] ?? "",
        description: data.fields?.["System.Description"] ?? "",
        acceptanceCriteria: data.fields?.["Microsoft.VSTS.Common.AcceptanceCriteria"] ?? "",
    };
}
/**
 * Score a test case for the ADO audit.
 * Returns issues found.
 */
export function auditTestCase(tc, story) {
    const issues = [];
    // Steps density
    if (tc.steps.length === 0) {
        issues.push("ZERO steps — not executable");
    }
    else if (tc.steps.length === 1) {
        issues.push("SINGLE step — too thin to assert, needs more granularity");
    }
    // Expected results
    const missingExpected = tc.steps.filter(s => !s.expected.trim());
    if (missingExpected.length > 0) {
        issues.push(`${missingExpected.length} step(s) missing expected result`);
    }
    // Pre-conditions check
    const hasPrecondition = tc.steps.some(s => /pre[- ]condition|given |assume |before /i.test(s.action));
    if (!hasPrecondition) {
        issues.push("No preconditions specified — end-user may not know required state");
    }
    // Required params
    const hasParams = tc.steps.some(s => /\{\{|<param|<input|required|mandatory/i.test(s.action));
    if (!hasParams && tc.steps.length > 0) {
        // Not always an issue, but flag for review
    }
    // Priority check
    if (tc.priority >= 3) {
        issues.push("P3 priority — verify this is intentional for the surface");
    }
    // Age / staleness
    if (tc.modifiedDate) {
        const age = Date.now() - new Date(tc.modifiedDate).getTime();
        if (age > 180 * 24 * 60 * 60 * 1000) {
            issues.push("Not modified in 180+ days — may be stale");
        }
    }
    // Last result
    if (!tc.lastResult) {
        issues.push("Never executed — coverage gap");
    }
    return issues;
}
//# sourceMappingURL=client.js.map