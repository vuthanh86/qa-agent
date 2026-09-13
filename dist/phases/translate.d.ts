/**
 * Phase 3 — Translate: plan.md case table → ## Scenario blocks.
 *
 * Parses the case table from plan.md and renders each case as a
 * `## Scenario: <id> - <title>` block with natural agent-browser steps.
 */
export interface TranslateOptions {
    in: string;
    outDir: string;
    target?: string;
}
export interface TranslateResult {
    scenariosPath: string;
    caseCount: number;
}
export declare function runTranslate(options: TranslateOptions): TranslateResult;
//# sourceMappingURL=translate.d.ts.map