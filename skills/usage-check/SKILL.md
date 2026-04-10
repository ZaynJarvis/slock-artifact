---
name: usage-check
description: "Check Claude Code usage and quota for any agent in a slock multi-agent setup. Trigger this skill when: the user or coordinator asks about usage, quota, remaining capacity, cost, token consumption, or wants to check how much an agent has used. Also trigger when someone says '/usage', 'check usage', 'how much have I used', 'quota remaining', or asks about any agent's spending/consumption."
---

# Usage Check for Slock Agents

Check token usage, cost, and quota information for Claude Code agents. Works for both self-checks and checking other agents' sessions.

## Why this matters

In a multi-agent slock setup, coordinators need visibility into each agent's consumption to manage costs and plan context resets. The built-in `/usage` slash command is interactive-only and can't be run via `--print` mode or piped through a daemon. This skill provides a working alternative.

## How it works

Claude Code's `--output-format json` flag returns detailed usage metadata after each invocation, including token counts, cost, model breakdown, and session info. We use a minimal one-shot invocation to extract this data.

## Check your own usage (current session)

For your current session's context window usage, you already have this info from the system — look at your context window stats. But if you need cost/token data for a specific session:

```bash
# Get usage for a specific session (costs a minimal amount of tokens)
claude --resume <session-id> --print -p "reply with only the word: done" --output-format json 2>/dev/null
```

Parse the JSON output for these fields:
- `total_cost_usd` — total cost for the session
- `usage.input_tokens` — input tokens used
- `usage.output_tokens` — output tokens generated  
- `usage.cache_read_input_tokens` — cached tokens read
- `usage.cache_creation_input_tokens` — tokens written to cache
- `modelUsage.<model>.costUSD` — cost broken down by model
- `modelUsage.<model>.contextWindow` — context window size
- `session_id` — the session identifier

## Check another agent's usage

To check another agent's session, you need their session ID. Find it from their project directory:

```bash
# Find the agent's most recent session
AGENT_DIR="/Users/bytedance/.slock/agents/<agent-id>"
PROJECT_DIR=$(echo "$AGENT_DIR" | sed 's|/|-|g; s|^-|/Users/bytedance/.claude/projects/|')
SESSION_FILE=$(ls -tS "$PROJECT_DIR"/*.jsonl 2>/dev/null | head -1)
SESSION_ID=$(basename "$SESSION_FILE" .jsonl)

# Run a minimal invocation to get usage JSON
cd "$AGENT_DIR" && claude --resume "$SESSION_ID" --print -p "reply with only the word: done" --output-format json 2>/dev/null
```

Note: this resumes their session briefly (adds minimal tokens), so use sparingly.

## Parsing the output

The JSON response contains everything needed. Here's how to extract key metrics:

```bash
# Pipe through jq for clean output
RESULT=$(cd "$AGENT_DIR" && claude --resume "$SESSION_ID" --print -p "reply with only the word: done" --output-format json 2>/dev/null)

echo "$RESULT" | jq '{
  session_id: .session_id,
  cost_usd: .total_cost_usd,
  input_tokens: .usage.input_tokens,
  output_tokens: .usage.output_tokens,
  cache_read: .usage.cache_read_input_tokens,
  cache_creation: .usage.cache_creation_input_tokens,
  model: (.modelUsage | keys[0]),
  context_window: (.modelUsage | to_entries[0].value.contextWindow)
}'
```

## Reporting format

When reporting usage to a channel, use this concise format:

```
Agent: @<name>
Session: <session-id>
Cost: $<cost_usd>
Tokens: <input>in / <output>out / <cache_read>cache-read / <cache_creation>cache-write
Model: <model-name> (context: <window>)
```

## Limitations

- Each check costs a small amount of tokens (~0.05 USD for an opus session due to cache read)
- The `--resume` approach adds to the target session's context (minimally)
- Cannot get quota/plan limits — only per-session usage is available via this method
- For plan-level quota (monthly limits, remaining allowance), `/usage` in an interactive session is still the only way
