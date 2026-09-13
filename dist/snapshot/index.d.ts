/**
 * Snapshot management — wraps agent-browser CLI for named snapshots,
 * checkpoints, and restore operations.
 *
 * Requires `agent-browser` on PATH.
 */
export interface SnapshotInfo {
    name: string;
    feature: string;
    env: string;
    url: string;
    textHash: string;
    timestamp: string;
    sessionId?: string;
}
/** Check if agent-browser is available. */
export declare function isAgentBrowserAvailable(): boolean;
/** Get the snapshot directory for a feature/env. */
export declare function snapshotDir(feature: string, env: string): string;
/** Save a named snapshot. */
export declare function saveSnapshot(name: string, feature: string, env: string): SnapshotInfo;
/** Restore a named snapshot. */
export declare function restoreSnapshot(name: string, feature: string, env: string): SnapshotInfo | null;
/** List snapshots for a feature/env. */
export declare function listSnapshots(feature: string, env: string): SnapshotInfo[];
//# sourceMappingURL=index.d.ts.map