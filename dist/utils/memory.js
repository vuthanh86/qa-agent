/**
 * Memory store helpers — read/write the durable QA memory at ~/.qa-agent/memory/.
 *
 * Schema is backward-compatible with the existing ~/.dsh/qa-memory/ store.
 */
import { readFileSafe, writeFile, memoryDir, ensureDir } from "./fs.js";
import { join } from "node:path";
import { homedir } from "node:os";
/** Read the memory index. */
export function readMemoryIndex() {
    const raw = readFileSafe(join(memoryDir(), "index.json"));
    if (!raw)
        return null;
    try {
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
/** Write the memory index. */
export function writeMemoryIndex(index) {
    writeFile(join(memoryDir(), "index.json"), JSON.stringify(index, null, 2));
}
/** Read the trend file. */
export function readTrend() {
    const raw = readFileSafe(join(memoryDir(), "trend.json"));
    if (!raw)
        return [];
    try {
        return JSON.parse(raw);
    }
    catch {
        return [];
    }
}
/** Append a trend point (dedup on runId). */
export function appendTrend(point) {
    const trends = readTrend();
    if (trends.some(t => t.runId === point.runId))
        return;
    trends.push(point);
    writeFile(join(memoryDir(), "trend.json"), JSON.stringify(trends, null, 2));
}
/** Ensure the memory store directory exists. */
export function ensureMemoryStore() {
    ensureDir(memoryDir());
    ensureDir(join(memoryDir(), "snapshots"));
}
/** Resolve the legacy DSH memory path for backward compat. */
export function legacyMemoryDir() {
    const home = process.env.DSH_HOME ?? join(homedir(), ".dsh");
    return join(home, "qa-memory");
}
//# sourceMappingURL=memory.js.map