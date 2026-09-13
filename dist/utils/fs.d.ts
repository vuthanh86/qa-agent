/**
 * File system helpers — directory creation, path resolution, file I/O.
 */
/** The qa-agent home directory (machine-wide, repo-agnostic). */
export declare function qaAgentHome(): string;
/** The memory store directory. */
export declare function memoryDir(): string;
/** The ADO cache directory. */
export declare function adoCacheDir(): string;
/** Ensure a directory exists, creating it recursively if needed. */
export declare function ensureDir(dir: string): string;
/** Write a file, ensuring the parent directory exists. */
export declare function writeFile(path: string, content: string): void;
/** Read a file, returning null if it doesn't exist. */
export declare function readFileSafe(path: string): string | null;
/** Generate a timestamped output directory name. */
export declare function generateOutDir(scope: string, prefix?: string): string;
/** Resolve the package root (where prompts/ and integrations/ live). */
export declare function packageRoot(): string;
/** Get the prompts directory. */
export declare function promptsDir(): string;
/** Read a bundled prompt file. */
export declare function readPrompt(name: string): string | null;
//# sourceMappingURL=fs.d.ts.map