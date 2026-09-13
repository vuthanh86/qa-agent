# qa-agent with DeepSeek Harness (DSH)

## Setup (one-time)

```powershell
# Install the CLI globally
npm install -g qa-agent

# Verify
qa-agent help
```

## Usage

From within a DSH session, run:

```bash
# Mode A — generate from scratch
qa-agent run --scope "diff main...HEAD" --depth smoke --platform dsh

# Mode B — audit existing ADO test plan
qa-agent run --plan-url "https://dev.azure.com/org/proj/_testPlans/execute?planId=123" --platform dsh

# Individual phases
qa-agent codegen --scope "diff main...HEAD"
qa-agent translate --input plans/x/plan.md
qa-agent report --runDir plans/x
qa-agent history --feature MyFeature --env qa
```

## How DSH integration works

1. The CLI writes a prompt file to `.qa-agent/prompt-<uuid>.md`
2. The CLI calls the DSH REST API at `http://127.0.0.1:3080/api/agent/message`
   with instructions to read and execute the prompt
3. DSH spawns a sub-agent that reads the prompt, does the AI reasoning,
   and writes the result to `.qa-agent/prompt-<uuid>.result.md`
4. The CLI polls for the result file and continues to the next phase

If the REST API is unavailable, the CLI falls back to writing the prompt
and outputting instructions for the DSH AI to read from stdout.

## Environment

```powershell
$env:QA_BASE_URL = "https://qa.app.contoso.com"
$env:QA_USER = "qa-bot"
$env:QA_PASS = "..."
$env:ADO_PAT = "..."       # for ADO test plan audit
$env:ADO_ORG = "contoso"
$env:ADO_PROJECT = "pmi"
```
