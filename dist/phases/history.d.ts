/**
 * History phase — render the QA history graph (HTML + Mermaid).
 *
 * Wraps the existing render-qa-history.mjs logic.
 * Falls back to a simple inline renderer when Node.js is available.
 */
export interface HistoryOptions {
    outDir: string;
    feature?: string;
    env?: string;
    last?: number;
}
export interface HistoryResult {
    htmlPath: string;
    mermaidPath: string;
}
export declare function runHistory(options: HistoryOptions): HistoryResult;
//# sourceMappingURL=history.d.ts.map