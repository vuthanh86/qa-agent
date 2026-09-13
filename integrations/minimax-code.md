# qa-agent with Minimax Code

## Setup (one-time)

```bash
# Install the CLI globally
npm install -g qa-agent

# Verify
qa-agent help

# Verify Minimax Code is available
minimax-code --version
```

## Usage

```bash
# Mode A — generate from scratch
qa-agent run --scope "diff main...HEAD" --depth smoke --platform minimax

# Mode B — audit existing ADO test plan
qa-agent run --plan-url "https://dev.azure.com/org/proj/_testPlans/execute?planId=123" --platform minimax

# Individual phases
qa-agent codegen --scope "diff main...HEAD"
qa-agent translate --input plans/x/plan.md
qa-agent report --runDir plans/x
qa-agent history --feature MyFeature --env qa
```

## How Minimax integration works

1. The CLI writes a prompt file to `.qa-agent/minimax-prompt-<uuid>.md`
2. The CLI spawns `minimax-code run --file prompt.md`
3. Minimax reads the prompt, does the AI reasoning, and returns the result
4. The CLI captures stdout and continues to the next phase

## Environment

```bash
export QA_BASE_URL="https://qa.app.contoso.com"
export QA_USER="qa-bot"
export QA_PASS="..."
export AZURE_DEVOPS_PAT="..."            # for ADO test plan audit
export MINIMAX_API_KEY="..."    # if not already configured
```
