# qa-agent with Claude Code

## Setup (one-time)

```bash
# Install the CLI globally
npm install -g qa-agent

# Verify
qa-agent help

# Verify Claude Code is available
claude --version
```

## Usage

```bash
# Mode A — generate from scratch
qa-agent run --scope "diff main...HEAD" --depth smoke --platform claude-code

# Mode B — audit existing ADO test plan
qa-agent run --plan-url "https://dev.azure.com/org/proj/_testPlans/execute?planId=123" --platform claude-code

# Individual phases
qa-agent codegen --scope "diff main...HEAD"
qa-agent translate --input plans/x/plan.md
qa-agent report --runDir plans/x
qa-agent history --feature MyFeature --env qa
```

## How Claude Code integration works

1. The CLI writes a prompt file to `.qa-agent/claude-prompt-<uuid>.md`
2. The CLI spawns `claude -p "$(cat prompt.md)"` in non-interactive print mode
3. Claude Code reads the prompt, does the AI reasoning, and returns the result
4. The CLI captures stdout and continues to the next phase

## Custom slash command (optional)

Add to `.claude/commands/qa-agent.md`:

```
Run qa-agent with the provided arguments.
Usage: /qa-agent run --scope "diff main...HEAD" --depth smoke
```

## Environment

```bash
export QA_BASE_URL="https://qa.app.contoso.com"
export QA_USER="qa-bot"
export QA_PASS="..."
export ADO_PAT="..."       # for ADO test plan audit
export ANTHROPIC_API_KEY="..."  # if not already configured
```
