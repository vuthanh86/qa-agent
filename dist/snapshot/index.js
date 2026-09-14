/**
 * Snapshot management — wraps agent-browser CLI for named snapshots,
 * checkpoints, and restore operations.
 *
 * Requires `agent-browser` on PATH.
 */
import { execSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { ensureDir, readFileSafe, writeFile } from "../utils/fs.js";
import { memoryDir } from "../utils/fs.js";
import { createHash } from "node:crypto";
/** Check if agent-browser is available. */
export function isAgentBrowserAvailable() {
    try {
        execSync("agent-browser --version", { stdio: "ignore" });
        return true;
    }
    catch {
        return false;
    }
}
/** Get the snapshot directory for a feature/env. */
export function snapshotDir(feature, env) {
    return join(memoryDir(), "snapshots", feature, env);
}
/** Save a named snapshot. */
export function saveSnapshot(name, feature, env) {
    if (!isAgentBrowserAvailable()) {
        throw new Error("agent-browser is required for snapshots. Install it first.");
    }
    const dir = snapshotDir(feature, env);
    ensureDir(dir);
    // Get current URL
    const url = execSync("agent-browser url", { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    // Get visible text
    const text = execSync("agent-browser text", { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    const textHash = createHash("sha256").update(text).digest("hex").slice(0, 16);
    // Save snapshot metadata
    const info = {
        name,
        feature,
        env,
        url,
        textHash,
        timestamp: new Date().toISOString(),
    };
    // Save cookies + storage via agent-browser
    execSync(`agent-browser snapshot save --name "${name}" --dir "${dir}"`, { stdio: "ignore" });
    writeFile(join(dir, `${name}.json`), JSON.stringify(info, null, 2));
    console.log(`[qa-agent] snapshot saved: ${name} (${url}, hash: ${textHash})`);
    return info;
}
/** Restore a named snapshot. */
export function restoreSnapshot(name, feature, env) {
    if (!isAgentBrowserAvailable()) {
        throw new Error("agent-browser is required for snapshots. Install it first.");
    }
    const dir = snapshotDir(feature, env);
    const infoPath = join(dir, `${name}.json`);
    const raw = readFileSafe(infoPath);
    if (!raw) {
        console.error(`[qa-agent] snapshot not found: ${name} (${feature}/${env})`);
        return null;
    }
    const info = JSON.parse(raw);
    // Restore via agent-browser
    execSync(`agent-browser snapshot restore --name "${name}" --dir "${dir}"`, { stdio: "ignore" });
    console.log(`[qa-agent] snapshot restored: ${name} (${info.url})`);
    return info;
}
/** List snapshots for a feature/env. */
export function listSnapshots(feature, env) {
    const dir = snapshotDir(feature, env);
    const snapshots = [];
    try {
        const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
        for (const f of files) {
            const raw = readFileSafe(join(dir, f));
            if (raw) {
                try {
                    snapshots.push(JSON.parse(raw));
                }
                catch { /* skip corrupt */ }
            }
        }
    }
    catch {
        // Directory doesn't exist yet
    }
    return snapshots;
}
//# sourceMappingURL=index.js.map