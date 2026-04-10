---
name: context-reset
description: "Clean and reset an agent's context window in a slock multi-agent group chat. Trigger this skill when: the user or coordinator says '/new', asks to 'clean context', 'reset context', 'fresh start', or requests context cleanup for any agent. Also trigger when context is getting full (>70% used) and needs refreshing. This skill handles the safe save-compress-reset workflow so no conversation history is lost."
---

# Context Reset for Slock Agents

When working in a slock multi-agent collaboration environment, agents accumulate large amounts of message history that fills their context window. This skill provides a safe workflow to reset context while preserving important information.

## Why this matters

An agent at 60-70%+ context usage becomes slower and less effective. But naively starting a new session loses all conversation history. The correct flow is: save key context to memory files, announce the reset, then let the session be refreshed. The new session automatically reads MEMORY.md on startup (slock system prompt enforces this), so the agent retains its accumulated knowledge.

## When this skill activates

- User or coordinator says `/new`, "clean context", "reset context", or "fresh start"
- Coordinator requests context cleanup for specific agents
- Agent notices its own context is getting full (>70%)

## Reset Workflow

Follow these steps in order. This is the agent's responsibility — execute all steps yourself before the session ends.

### Step 1: Save context to memory

Before anything else, update memory in **two locations**:

**A. Slock workspace MEMORY.md** — This is the MEMORY.md in your agent's working directory (e.g., `~/.slock/agents/<agent-id>/MEMORY.md`). This is what slock's system prompt reads on every startup. Update it with your role, team, repos, completed work, active tasks, and key rules.

**B. Claude project memory** — The `~/.claude/projects/<project-id>/memory/` directory. Write individual memory files here for detailed context that benefits from the frontmatter format.

Focus on:

- **Project state**: What's been built, what's in progress, what's blocked
- **Key decisions**: Architecture choices, tool selections, patterns adopted
- **Team assignments**: Who's working on what, who to ask about what
- **Open items**: Unfinished tasks, known bugs, next steps
- **User preferences**: Any feedback or working style preferences learned

Write or update memory files using the standard frontmatter format:
```markdown
---
name: <descriptive name>
description: <one-line description for relevance matching>
type: <user|feedback|project|reference>
---
<content>
```

Update MEMORY.md index with pointers to each file. Keep entries under 150 chars each, total index under 200 lines.

### Step 2: Push shared artifacts (if needed)

If there's context that other agents on different machines need (code snippets, architecture decisions, investigation results), push it to the shared artifact repo:

```bash
cd <slock-artifact-repo>
git pull
# Write artifact files
git add . && git commit -m "context snapshot: <agent-name> <date>"
git push
```

The artifact repo URL should be in your memory/reference files. Currently: https://github.com/ZaynJarvis/slock-artifact

### Step 3: Announce to chat

Send a message to the relevant slock channel via `send_message`:

```
Context cleanup in progress — saved state to memory files. Starting fresh session shortly. Will catch up via MEMORY.md on restart.
```

This lets teammates know you'll briefly be unavailable.

### Step 4: Execute context reset

**Important:** `/new` is an interactive-only slash command. It does NOT work via `--print` mode, stdin pipe, or `stream-json` mode. The reset method depends on how the agent is running.

**A. Find your own session ID:**

```bash
# Your working directory is your agent workspace (e.g., ~/.slock/agents/<agent-id>/)
# The Claude Code project directory maps from your cwd
PROJECT_DIR=$(echo "$PWD" | sed 's|/|--|g; s|^-|/Users/bytedance/.claude/projects/|')
# Find the largest (most recent active) .jsonl session file
SESSION_FILE=$(ls -tS "$PROJECT_DIR"/*.jsonl 2>/dev/null | head -1)
SESSION_ID=$(basename "$SESSION_FILE" .jsonl)
echo "My session ID: $SESSION_ID"
```

**B. Verify your context usage (optional):**

```bash
cd <your-agent-workspace> && claude -p "/context" --print 2>&1 | head -20
```

**C. Interactive agents (running in tmux, e.g. Tim, Zeus):**

After saving memory (steps 1-3), open a tmux session and run `/new` interactively:

```bash
# Create a temporary tmux session, resume your claude session, and send /new
TMUX_NAME="reset-$(basename $PWD)"
tmux new-session -d -s "$TMUX_NAME" "cd $PWD && claude --resume $SESSION_ID"
# Wait for claude to load, then send /new
sleep 3
tmux send-keys -t "$TMUX_NAME" "/new" Enter
# Optionally send an initial message to the fresh session
sleep 2
tmux send-keys -t "$TMUX_NAME" "Read MEMORY.md and check_messages to catch up." Enter
```

The `/new` command inside the interactive session starts a fresh context with a new session ID. The new session reads MEMORY.md automatically per slock system prompt.

**D. Reset another interactive agent on the same machine:**

Same approach — find their session ID and workspace, then use tmux:

```bash
TARGET_DIR=~/.slock/agents/<target-agent-id>
PROJECT_DIR=$(echo "$TARGET_DIR" | sed 's|/|--|g; s|^-|/Users/bytedance/.claude/projects/|')
SESSION_FILE=$(ls -tS "$PROJECT_DIR"/*.jsonl 2>/dev/null | head -1)
SESSION_ID=$(basename "$SESSION_FILE" .jsonl)

TMUX_NAME="reset-$(basename $TARGET_DIR)"
tmux new-session -d -s "$TMUX_NAME" "cd $TARGET_DIR && claude --resume $SESSION_ID"
sleep 3
tmux send-keys -t "$TMUX_NAME" "/new" Enter
sleep 2
tmux send-keys -t "$TMUX_NAME" "Read MEMORY.md and check_messages to catch up." Enter
```

**E. Daemon-managed agents (running in stream-json mode, e.g. Alice, Bob):**

Daemon-managed agents run with `--input-format stream-json --output-format stream-json` — they have no interactive TTY, so `/new` cannot be sent to them via tmux or any other method.

**Current limitation:** There is no way to reset a daemon-managed agent's context without daemon support. The daemon always restarts with `--resume <same-session-id>`, so killing the process does NOT create a fresh session.

**Proposed solutions (require daemon changes):**
1. **Daemon protocol command:** Add a `{"type":"new_session"}` message type that tells the daemon to restart the agent WITHOUT `--resume`
2. **Slock API endpoint:** `POST /api/agents/<id>/reset` — stops the agent and starts a new session (no `--resume`)
3. **Daemon restart flag:** When an agent exits with a specific exit code (e.g. exit 42), the daemon starts a fresh session instead of resuming

Until one of these is implemented, daemon-managed agents can only rely on Claude Code's built-in auto-compaction to manage context usage.

**F. Reset an agent on a different machine:**

For agents on another machine (e.g., lululiang), send a message asking an agent on that machine to perform the reset using option C or D above.

**Why this works:** The slock daemon monitors agent processes. When a process exits, the daemon automatically spawns a new `claude` session in the same workspace. The new session starts fresh (no `--resume`), reads MEMORY.md via the slock system prompt, and picks up where it left off.

### Step 5: Post-reset verification (new session)

After the new session starts, the agent should:
1. Read MEMORY.md to restore context (this happens automatically via slock system prompt)
2. Send a message to chat: "Context reset complete. Caught up via memory files. Ready for new tasks."
3. Call `check_messages` to catch anything received during the reset window
4. Claim any tasks that were previously assigned to you

## Quick Reference

| Step | Action | Who |
|------|--------|-----|
| 1 | Save memory files | Agent (automatic) |
| 2 | Push shared artifacts | Agent (if cross-machine context needed) |
| 3 | Announce to chat | Agent (via send_message) |
| 4 | Session restart | Coordinator or agent (depends on runtime) |
| 5 | Post-reset catch-up | Agent (automatic on new session) |
