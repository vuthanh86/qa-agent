# qa-agent — Senior-QA AI Orchestrator

Platform-agnostic QA CLI that chains code-change → test cases → ADO audit →
browser execution → report. Works with DSH, Claude Code, Gemini CLI, and
Minimax Code.

## Quick Start

```bash
npm install -g qa-agent

# Mode A — generate test cases from a diff
qa-agent run --scope "diff main...HEAD" --depth smoke --platform dsh

# Mode B — audit an existing ADO test plan
qa-agent run --plan-url "https://dev.azure.com/org/proj/_testPlans/execute?planId=123" --platform dsh
```

## Two Modes

| Mode | Trigger | Flow |
|---|---|---|
| **A** | No `--plan-url` | codegen → draft → verify → translate → e2e → report |
| **B** | `--plan-url` provided | read → audit → improve → finalize → e2e → report |

## Platforms

| Flag | Platform | Requirement |
|---|---|---|
| `--platform dsh` | DeepSeek Harness | DSH running at localhost:3080 |
| `--platform claude-code` | Claude Code (Anthropic) | `claude` on PATH |
| `--platform gemini` | Gemini CLI (Google) | `gemini` on PATH |
| `--platform minimax` | Minimax Code | `minimax-code` on PATH |

Omit `--platform` to auto-detect.

## Commands

```bash
qa-agent run        # Full pipeline
qa-agent codegen    # git diff → test cases
qa-agent translate  # plan.md → scenario blocks
qa-agent report     # results → report + defects
qa-agent history    # QA history graph
qa-agent snapshot   # Browser snapshot save/restore/list
qa-agent help       # This help
```

## Environment

```bash
export QA_BASE_URL="https://qa.app.contoso.com"
export QA_USER="qa-bot"
export QA_PASS="..."
export AZURE_DEVOPS_PAT="..."       # for ADO test plan audit
export ADO_ORG="contoso"
export ADO_PROJECT="pmi"
```

## Output

```
plans/<timestamp>-qa-<slug>/
├── plan.md            # case table + impact map
├── scenarios.md       # ## Scenario blocks
├── results.json       # machine-readable results
├── results.md         # human-readable report
├── defects.md         # defect ledger
├── history.html       # pass-rate trend graph
└── evidence/          # per-step screenshots
```

## Requirements

- Node.js ≥ 18
- Git
- agent-browser (for e2e execution)
- A platform adapter (DSH / Claude Code / Gemini / Minimax)
