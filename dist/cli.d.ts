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
export {};
//# sourceMappingURL=cli.d.ts.map