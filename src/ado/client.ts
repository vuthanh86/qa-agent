/**
 * Azure DevOps REST client (v7.2).
 *
 * Handles: test plan pull, test case CRUD, work item fetch.
 * Auth via ADO_PAT env var (Basic auth).
 * Cache: 1-hour TTL in ~/.qa-agent/ado-cache/.
 */

import { writeFile, readFileSafe, ensureDir, adoCacheDir } from "../utils/fs.js";
import { join } from "node:path";

const API_VERSION = "7.2";
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

export interface AdoConfig {
  org: string;
  project: string;
  pat?: string;
}

export interface AdoTestPlan {
  id: number;
  name: string;
  state: string;
  createdDate: string;
}

export interface AdoTestSuite {
  id: number;
  name: string;
  suiteType: string;
  parentSuiteId?: number;
}

export interface AdoTestCase {
  id: number;
  title: string;
  state: string;
  priority: number;
  steps: AdoTestCaseStep[];
  lastResult?: string;
  lastResultDate?: string;
  createdDate: string;
  modifiedDate: string;
  linkedWorkItems: AdoLinkedItem[];
}

export interface AdoTestCaseStep {
  stepNumber: number;
  action: string;
  expected: string;
}

export interface AdoLinkedItem {
  id: number;
  type: string;
  title: string;
}

export interface AdoWorkItem {
  id: number;
  title: string;
  type: string;
  state: string;
  description: string;
  acceptanceCriteria: string;
}

export interface AuditVerdict {
  caseId: number;
  title: string;
  verdict: "keep" | "update" | "split" | "merge" | "drop";
  reason: string;
  proposedEdits: string;
  linkedWorkItem: string;
}

/**
 * Parse an ADO test plan URL into org, project, planId.
 * Supports formats:
 *   https://dev.azure.com/{org}/{project}/_testPlans/execute?planId={id}
 *   https://dev.azure.com/{org}/{project}/_testPlans/define?planId={id}
 */
export function parsePlanUrl(url: string): { org: string; project: string; planId: number } | null {
  const m = url.match(/dev\.azure\.com\/([^/]+)\/([^/]+)\/_testPlans\/\w+\?planId=(\d+)/);
  if (!m) return null;
  return { org: m[1], project: m[2], planId: parseInt(m[3], 10) };
}

/** Resolve the PAT from config or env. */
function resolvePat(config: AdoConfig): string {
  return config.pat ?? process.env.ADO_PAT ?? "";
}

/** Build the Basic auth header. */
function authHeader(pat: string): string {
  return `Basic ${Buffer.from(`:${pat}`).toString("base64")}`;
}

/** Build the ADO REST base URL. */
function baseUrl(config: AdoConfig): string {
  return `https://dev.azure.com/${config.org}/${config.project}`;
}

/** Fetch with ADO auth and caching. */
async function adoFetch(
  config: AdoConfig,
  path: string,
  cacheKey: string,
): Promise<any> {
  const cacheFile = join(adoCacheDir(), `${cacheKey}.json`);
  const cached = readFileSafe(cacheFile);

  if (cached) {
    try {
      const data = JSON.parse(cached);
      if (Date.now() - data._ts < CACHE_TTL_MS) return data;
    } catch { /* stale cache */ }
  }

  const pat = resolvePat(config);
  if (!pat) throw new Error("ADO_PAT is required. Set ADO_PAT env var or pass --ado.pat.");

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
export async function getTestPlan(config: AdoConfig, planId: number): Promise<AdoTestPlan> {
  const data = await adoFetch(config, `/_apis/testplan/plans/${planId}`, `plan/${config.org}/${config.project}/${planId}`);
  return {
    id: data.id,
    name: data.name,
    state: data.state ?? "unknown",
    createdDate: data.createdDate ?? "",
  };
}

/** List suites under a test plan. */
export async function getTestSuites(config: AdoConfig, planId: number): Promise<AdoTestSuite[]> {
  const data = await adoFetch(
    config,
    `/_apis/testplan/plans/${planId}/suites`,
    `suites/${config.org}/${config.project}/${planId}`,
  );
  return (data.value ?? []).map((s: any) => ({
    id: s.id,
    name: s.name,
    suiteType: s.suiteType ?? "static",
    parentSuiteId: s.parent?.id,
  }));
}

/** List test cases under a suite. */
export async function getTestCases(config: AdoConfig, planId: number, suiteId: number): Promise<AdoTestCase[]> {
  const data = await adoFetch(
    config,
    `/_apis/testplan/plans/${planId}/suites/${suiteId}/testcases`,
    `cases/${config.org}/${config.project}/${planId}/${suiteId}`,
  );
  return (data.value ?? []).map((tc: any) => ({
    id: tc.workItem?.id ?? tc.id,
    title: tc.workItem?.name ?? tc.title ?? "",
    state: tc.workItem?.state ?? "",
    priority: tc.workItem?.priority ?? 2,
    steps: (tc.workItem?.steps ?? []).map((s: any, i: number) => ({
      stepNumber: i + 1,
      action: s.action ?? s.description ?? "",
      expected: s.expected ?? "",
    })),
    lastResult: tc.lastResult?.outcome ?? null,
    lastResultDate: tc.lastResult?.completedDate ?? null,
    createdDate: tc.workItem?.createdDate ?? "",
    modifiedDate: tc.workItem?.lastUpdatedDate ?? "",
    linkedWorkItems: [],
  }));
}

/** Fetch a work item by ID. */
export async function getWorkItem(config: AdoConfig, workItemId: number): Promise<AdoWorkItem> {
  const data = await adoFetch(
    config,
    `/_apis/wit/workitems/${workItemId}?$expand=all`,
    `wi/${config.org}/${config.project}/${workItemId}`,
  );
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
export function auditTestCase(tc: AdoTestCase, story?: AdoWorkItem): string[] {
  const issues: string[] = [];

  // Steps density
  if (tc.steps.length === 0) {
    issues.push("ZERO steps — not executable");
  } else if (tc.steps.length === 1) {
    issues.push("SINGLE step — too thin to assert, needs more granularity");
  }

  // Expected results
  const missingExpected = tc.steps.filter(s => !s.expected.trim());
  if (missingExpected.length > 0) {
    issues.push(`${missingExpected.length} step(s) missing expected result`);
  }

  // Pre-conditions check
  const hasPrecondition = tc.steps.some(s =>
    /pre[- ]condition|given |assume |before /i.test(s.action));
  if (!hasPrecondition) {
    issues.push("No preconditions specified — end-user may not know required state");
  }

  // Required params
  const hasParams = tc.steps.some(s =>
    /\{\{|<param|<input|required|mandatory/i.test(s.action));
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
