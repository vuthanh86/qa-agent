#!/usr/bin/env node
/**
 * qa-agent — Senior-QA AI Orchestrator CLI
 *
 * Single entry point. Two modes:
 *   Mode A (no --plan-url): codegen → draft → verify → translate → e2e → report
 *   Mode B (--plan-url):     read → audit → improve → finalize → e2e → report
 *
 * Usage:
 *   qa-agent run --scope "diff main...HEAD" --platform dsh
 *   qa-agent run --plan-url "https://dev.azure.com/..." --platform claude-code
 *   qa-agent codegen --scope "diff main...HEAD"
 *   qa-agent history --feature X --env qa
 */
import { PlatformAdapter } from "./platforms/types.js";
export interface CliArgs {
    action: string;
    scope?: string;
    base?: string;
    depth?: string;
    planUrl?: string;
    workItem?: string;
    target?: string;
    outDir?: string;
    feature?: string;
    env?: string;
    checkpoint?: string;
    snapshot?: string;
    platform?: string;
    history?: string;
    headed?: string;
    timeboxMs?: string;
    adoOrg?: string;
    adoProject?: string;
    adoPlanId?: string;
    adoPat?: string;
    adoPublish?: string;
    [key: string]: string | undefined;
}
export declare function parseArgs(raw: string[]): CliArgs;
export declare function showHelp(): void;
export declare function resolvePlatform(args: CliArgs): Promise<PlatformAdapter>;
export declare function actionCodegen(args: CliArgs): Promise<void>;
export declare function actionTranslate(args: CliArgs): Promise<void>;
export declare function actionReport(args: CliArgs): Promise<void>;
export declare function actionHistory(args: CliArgs): Promise<void>;
export declare function actionSnapshot(args: CliArgs): Promise<void>;
export declare function actionRun(args: CliArgs): Promise<void>;
export declare function main(): Promise<void>;
//# sourceMappingURL=cli.d.ts.map