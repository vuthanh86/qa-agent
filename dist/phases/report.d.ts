/**
 * Phase 5 — Report: results.json → results.md + summary.html.
 *
 * Reads the machine-readable results and produces the human-readable report.
 * The AI adds defects and the ship/no-ship recommendation by reading prompts/report.md.
 */
export interface ReportOptions {
    runDir: string;
    skipHistory?: boolean;
}
export interface ReportResult {
    reportPath: string;
}
export interface QaResults {
    runId: string;
    scope: string;
    env: string | null;
    depth: string;
    date: string;
    summary: {
        total: number;
        passed: number;
        failed: number;
        skipped: number;
        durationMs: number;
    };
    cases: QaCase[];
    defects: QaDefect[];
    qaAgent: {
        runId: string;
        feature: string;
        env: string;
        checkpoint: {
            name: string;
            hashMatched: boolean;
        } | null;
        snapshots: string[];
    };
}
export interface QaCase {
    id: string;
    title: string;
    priority: string;
    surface: string;
    status: "PASS" | "FAIL" | "SKIP" | "ERROR";
    reason?: string;
    durationMs: number;
    regression?: boolean;
    flaky?: boolean;
    rootCause?: string;
    healed?: boolean;
    healNote?: string;
    a11yAudit?: {
        violations: number;
        passes: number;
    };
}
export interface QaDefect {
    id: string;
    severity: "S1" | "S2" | "S3";
    title: string;
    case: string;
    steps: string;
    expected: string;
    actual: string;
    evidence: string[];
}
export declare function runReport(options: ReportOptions): ReportResult;
//# sourceMappingURL=report.d.ts.map