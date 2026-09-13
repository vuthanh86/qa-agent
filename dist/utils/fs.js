/**
 * File system helpers — directory creation, path resolution, file I/O.
 */
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { homedir } from "node:os";
/** The qa-agent home directory (machine-wide, repo-agnostic). */
export function qaAgentHome() {
    return join(homedir(), ".qa-agent");
}
/** The memory store directory. */
export function memoryDir() {
    return join(qaAgentHome(), "memory");
}
/** The ADO cache directory. */
export function adoCacheDir() {
    return join(qaAgentHome(), "ado-cache");
}
/** Ensure a directory exists, creating it recursively if needed. */
export function ensureDir(dir) {
    mkdirSync(dir, { recursive: true });
    return dir;
}
/** Write a file, ensuring the parent directory exists. */
export function writeFile(path, content) {
    ensureDir(dirname(path));
    writeFileSync(path, content, "utf-8");
}
/** Read a file, returning null if it doesn't exist. */
export function readFileSafe(path) {
    try {
        return readFileSync(path, "utf-8");
    }
    catch {
        return null;
    }
}
/** Generate a timestamped output directory name. */
export function generateOutDir(scope, prefix = "plans") {
    const slug = scope
        .replace(/[^a-zA-Z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .toLowerCase()
        .slice(0, 40);
    const ts = new Date().toISOString().replace(/[:.]/g, "").slice(0, 15);
    return join(prefix, `${ts}-qa-${slug}`);
}
/** Resolve the package root (where prompts/ and integrations/ live). */
export function packageRoot() {
    // When running from dist/, the root is one level up
    const distPath = resolve(import.meta.dirname ?? __dirname);
    if (distPath.endsWith("dist")) {
        return dirname(distPath);
    }
    return distPath;
}
/** Get the prompts directory. */
export function promptsDir() {
    return join(packageRoot(), "prompts");
}
/** Read a bundled prompt file. */
export function readPrompt(name) {
    return readFileSafe(join(promptsDir(), name));
}
//# sourceMappingURL=fs.js.map