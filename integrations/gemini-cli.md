# qa-agent with Gemini CLI

## Setup (one-time)

```bash
# Install the CLI globally
npm install -g qa-agent

# Verify
qa-agent help

# Verify Gemini CLI is available
gemini --version
```

## Usage

```bash
# Mode A — generate from scratch
qa-agent run --scope "diff main...HEAD" --depth smoke --platform gemini

# Mode B — audit existing ADO test plan
qa-agent run --plan-url "https://dev.azure.com/org/proj/_testPlans/execute?planId=123" --platform gemini

# Individual phases
qa-agent codegen --scope "diff main...HEAD"
qa-agent translate --input plans/x/plan.md
qa-agent report --runDir plans/x
qa-agent history --feature MyFeature --env qa
```

## How Gemini CLI integration works

1. The CLI writes a prompt file to `.qa-agent/gemini-prompt-<uuid>.md`
2. The CLI spawns `gemini chat --prompt-file prompt.md`
3. Gemini reads the prompt, does the AI reasoning, and returns the result
4. The CLI captures stdout and continues to the next phase

## Environment

```bash
export QA_BASE_URL="https://qa.app.contoso.com"
export QA_USER="qa-bot"
export QA_PASS="..."
export ADO_PAT="..."         # for ADO test plan audit
export GOOGLE_API_KEY="..."  # if not already configured
```
