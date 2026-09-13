/**
 * Memory store helpers — read/write the durable QA memory at ~/.qa-agent/memory/.
 *
 * Schema is backward-compatible with the existing ~/.dsh/qa-memory/ store.
 */
export interface MemoryIndex {
    note: string;
    staleAfterDays: number;
    files: Record<string, string>;
    lastUpdated: string;
    lastUpdateNote: string;
}
export interface TrendPoint {
    runId: string;
    date: string;
    feature: string;
    env: string;
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    durationMs: number;
}
export interface TcHistoryEntry {
    tcId: string;
    feature: string;
    env: string;
    lastStatus: "PASS" | "FAIL" | "SKIP" | "ERROR";
    lastRunId: string;
    lastDate: string;
    flaky: boolean;
}
/** Read the memory index. */
export declare function readMemoryIndex(): MemoryIndex | null;
/** Write the memory index. */
export declare function writeMemoryIndex(index: MemoryIndex): void;
/** Read the trend file. */
export declare function readTrend(): TrendPoint[];
/** Append a trend point (dedup on runId). */
export declare function appendTrend(point: TrendPoint): void;
/** Ensure the memory store directory exists. */
export declare function ensureMemoryStore(): void;
/** Resolve the legacy DSH memory path for backward compat. */
export declare function legacyMemoryDir(): string;
//# sourceMappingURL=memory.d.ts.map