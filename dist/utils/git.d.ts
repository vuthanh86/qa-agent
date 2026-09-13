/**
 * Git helpers — diff enumeration, base resolution, commit info.
 */
export interface DiffFile {
    path: string;
    bucket: Bucket;
}
export type Bucket = "Frontend" | "Backend" | "Schema" | "Queue" | "Docs" | "Build" | "Unresolvable";
/**
 * Get the list of changed files between base and HEAD.
 */
export declare function getDiffFiles(base: string, head?: string): string[];
/**
 * Get the full diff content between base and HEAD.
 */
export declare function getDiffContent(base: string, head?: string): string;
/**
 * Get the last commit message.
 */
export declare function getLastCommitMessage(): string;
/**
 * Get the current branch name.
 */
export declare function getCurrentBranch(): string;
/**
 * Classify a changed file path into a bucket.
 * PMI-aware but works in any repo.
 */
export declare function classifyPath(path: string): Bucket;
/**
 * Try to resolve a diff scope string to a base ref.
 * "diff main...HEAD" → base="main", head="HEAD"
 * "diff origin/main...HEAD" → base="origin/main", head="HEAD"
 */
export declare function parseDiffScope(scope: string): {
    base: string;
    head: string;
} | null;
//# sourceMappingURL=git.d.ts.map