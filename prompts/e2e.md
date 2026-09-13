# QA Agent — End-to-End Browser Execution

You are executing `## Scenario` blocks via the `agent-browser` CLI.

## Setup

1. Verify `agent-browser --version` returns a version.
2. Read the `## Scenario` blocks from the provided scenarios.md.
3. Read the results.json scaffold — you will write PASS/FAIL/SKIP here.

## Execution loop (per case)

```
For each ## Scenario block:
  1. If a checkpoint is specified, restore it first:
     agent-browser snapshot restore --name <checkpoint>

  2. Execute each step in order:
     agent-browser open <url>
     agent-browser fill <selector> <value>
     agent-browser click <selector>
     agent-browser select <selector> <option>
     agent-browser press <key>
     agent-browser expect <selector> visible|hidden|enabled|disabled
     agent-browser assert <selector> == <expected>
     agent-browser screenshot evidence/<case-id>-step-<n>.png

  3. After each action, re-snapshot to re-resolve @eN refs:
     agent-browser snapshot

  4. If an @eN ref is stale:
     - Re-snapshot once
     - Try role+name → visible text → stable id/data-*
     - Record healing: { healed: true, healNote: "..." }

  5. After the last step, take the final screenshot:
     agent-browser screenshot evidence/<case-id>-after.png

  6. Record result in results.json:
     {
       "id": "<case-id>",
       "status": "PASS" | "FAIL" | "SKIP",
       "durationMs": <ms>,
       "rootCause": "<if FAIL>",
       "healed": <true|false>,
       "healNote": "<if healed>",
       "evidence": ["evidence/<case-id>-step-1.png", ...]
     }

  7. Retry-once on FAIL:
     - Re-navigate fresh
     - Re-execute all steps
     - PASS on retry → flaky: true
     - FAIL again → FAIL with rootCause
```

## Timeout

Each case has a timebox (default 5 minutes). If the case exceeds it, mark SKIP
with reason "timeout".

## Evidence

- Per-step screenshots in `evidence/`
- Console errors on FAIL: `agent-browser console`
- Network errors on FAIL: `agent-browser network`
- Final screenshot per case: `evidence/<case-id>-after.png`

## Environment

- `QA_BASE_URL` — web app URL
- `QA_USER` / `QA_PASS` — login credentials
- Never write credentials to logs, results, or evidence.
