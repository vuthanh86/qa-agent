/**
 * Azure DevOps REST client (v7.2).
 *
 * Handles: test plan pull, test case CRUD, work item fetch.
 * Auth via AZURE_DEVOPS_PAT env var (Basic auth).
 * Cache: 1-hour TTL in ~/.qa-agent/ado-cache/.
 */
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
export declare function parsePlanUrl(url: string): {
    org: string;
    project: string;
    planId: number;
} | null;
/** Pull a test plan by ID. */
export declare function getTestPlan(config: AdoConfig, planId: number): Promise<AdoTestPlan>;
/** List suites under a test plan. */
export declare function getTestSuites(config: AdoConfig, planId: number): Promise<AdoTestSuite[]>;
/** List test cases under a suite. */
export declare function getTestCases(config: AdoConfig, planId: number, suiteId: number): Promise<AdoTestCase[]>;
/** Fetch a work item by ID. */
export declare function getWorkItem(config: AdoConfig, workItemId: number): Promise<AdoWorkItem>;
/**
 * Score a test case for the ADO audit.
 * Returns issues found.
 */
export declare function auditTestCase(tc: AdoTestCase, story?: AdoWorkItem): string[];
//# sourceMappingURL=client.d.ts.map