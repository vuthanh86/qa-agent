/**
 * Phase 1 — Codegen: git diff → risk-ranked test case skeleton.
 *
 * This is the MECHANICAL part only:
 * - Resolves the diff scope
 * - Classifies changed paths into buckets
 * - Writes a skeleton plan.md with impact map + case table (TBD fields)
 *
 * The AI reasoning (reading the diff, authoring real cases, filling TBDs)
 * is done by the platform adapter reading prompts/codegen.md.
 */
export interface CodegenOptions {
    scope: string;
    base: string;
    depth: "smoke" | "core" | "full";
    outDir?: string;
}
export interface CodegenResult {
    outDir: string;
    planPath: string;
    pathCount: number;
    diffContent: string;
}
export declare function runCodegen(options: CodegenOptions): CodegenResult;
//# sourceMappingURL=codegen.d.ts.map