---
name: context-reset
description: "Clean and reset an agent's context window in a slock multi-agent group chat. Trigger this skill when: the user or coordinator says '/new', asks to 'clean context', 'reset context', 'fresh start', or requests context cleanup for any agent. Also trigger when context is getting full (>70% used) and needs refreshing. This skill handles the safe save-compress-reset workflow so no conversation history is lost."
---

# Context Reset for Slock Agents

When working in a slock multi-agent collaboration environment, agents accumulate large amounts of message history that fills their context window. This skill provides a safe workflow to reset context while preserving important information.

## When this skill activates

- User or coordinator says `/new`, "clean context", "reset context", or "fresh start"
- Coordinator requests context cleanup for specific agents
- Agent notices its own context is getting full (>70%)

## Core Concept

`/new` is an interactive-only slash command — it only works inside an interactive Claude Code session (with a TTY). It does NOT work via `--print` mode or `stream-json` mode.

The universal reset method: **resume the target session in an interactive tmux, then run `/new`**. This works for ALL agent types — whether the agent normally runs in tmux or via the slock daemon in stream-json mode.

## Reset Workflow

### Step 1: Save context to memory

Before resetting, update your memory files so nothing is lost:

**A. Slock workspace MEMORY.md** — The `MEMORY.md` in your agent working directory (`~/.slock/agents/<agent-id>/MEMORY.md`). This is read on every startup. Update with: role, team, repos, completed work, active tasks, key rules.

**B. Claude project memory** — `~/.claude/projects/<project-id>/memory/` directory. Write detailed context files here with frontmatter format.

Focus on: project state, key decisions, team assignments, open items, user preferences.

### Step 2: Push shared artifacts (if needed)

If other agents on different machines need context you have:

```bash
cd <slock-artifact-repo> && git pull
# Write artifact files
git add . && git commit -m "context snapshot: <agent-name> <date>" && git push
```

### Step 3: Announce to chat

```
send_message: "Context cleanup in progress — saving state to memory. Back shortly."
```

### Step 4: Find the session ID

```bash
# From your agent workspace directory
PROJECT_DIR=$(echo "$PWD" | sed 's|/|--|g; s|^-|/Users/'$(whoami)'/.claude/projects/|')
SESSION_FILE=$(ls -tS "$PROJECT_DIR"/*.jsonl 2>/dev/null | head -1)
SESSION_ID=$(basename "$SESSION_FILE" .jsonl)
echo "Session ID: $SESSION_ID"
```

To find another agent's session ID, replace `$PWD` with their workspace path (e.g., `~/.slock/agents/<their-agent-id>`).

### Step 5: Execute reset via tmux

This is the same for ALL agents — interactive or daemon-managed.

**Reset yourself:**

```bash
TMUX_NAME="reset-$(basename $PWD)"
tmux new-session -d -s "$TMUX_NAME" "cd $PWD && claude --resume $SESSION_ID"
# Wait for Claude to load — may hit a "trust this project?" prompt
sleep 8
# Send Enter to dismiss any trust prompt, then /new
tmux send-keys -t "$TMUX_NAME" Enter
sleep 2
tmux send-keys -t "$TMUX_NAME" -l "/new"
tmux send-keys -t "$TMUX_NAME" Enter
sleep 5
tmux send-keys -t "$TMUX_NAME" -l "Read MEMORY.md and check_messages to catch up. You are in a fresh session."
tmux send-keys -t "$TMUX_NAME" Enter
# Cleanup: kill the temporary tmux session
sleep 5
tmux kill-session -t "$TMUX_NAME" 2>/dev/null
```

**Reset another agent on the same machine:**

```bash
TARGET_DIR=~/.slock/agents/<target-agent-id>
PROJECT_DIR=$(echo "$TARGET_DIR" | sed 's|/|--|g; s|^-|/Users/'$(whoami)'/.claude/projects/|')
SESSION_FILE=$(ls -tS "$PROJECT_DIR"/*.jsonl 2>/dev/null | head -1)
SESSION_ID=$(basename "$SESSION_FILE" .jsonl)

# Kill the daemon-managed process first so it doesn't conflict
TARGET_PID=$(pgrep -f "claude.*$(basename $TARGET_DIR)" | head -1)
[ -n "$TARGET_PID" ] && kill "$TARGET_PID"
sleep 3

TMUX_NAME="reset-$(basename $TARGET_DIR)"
tmux new-session -d -s "$TMUX_NAME" "cd $TARGET_DIR && claude --resume $SESSION_ID"
sleep 8
tmux send-keys -t "$TMUX_NAME" Enter  # dismiss trust prompt
sleep 2
tmux send-keys -t "$TMUX_NAME" -l "/new"
tmux send-keys -t "$TMUX_NAME" Enter
sleep 5
tmux send-keys -t "$TMUX_NAME" -l "Read MEMORY.md and check_messages to catch up. You are in a fresh session."
tmux send-keys -t "$TMUX_NAME" Enter
# Cleanup: kill the temporary tmux session
sleep 5
tmux kill-session -t "$TMUX_NAME" 2>/dev/null
```

**Important notes from testing (2026-04-10):**
- Use `tmux send-keys -l` (literal mode) for `/new` to avoid shell interpretation
- The trust prompt ("Is this a project you trust?") appears on first resume — send Enter to dismiss
- After `/new`, the new interactive session won't have daemon MCP tools — the daemon needs to re-adopt the agent
- Permission prompts will appear in the new session — the first few tool uses need manual approval or pre-approved permissions

**Reset an agent on a different machine:** Ask an agent on that machine to perform the reset using the steps above.

### Step 6: Clean up tmux session

After confirming the reset succeeded, kill the temporary tmux session:

```bash
tmux kill-session -t "$TMUX_NAME"
```

The daemon will re-adopt the agent on its next restart cycle, restoring MCP tools.

### Step 7: Post-reset verification

After the new session starts, the agent should:
1. Read MEMORY.md (happens automatically via slock system prompt)
2. Send: "Context reset complete. Caught up via memory files. Ready for tasks."
3. Call `check_messages` to catch anything received during the reset window
4. Re-claim any previously assigned tasks

## Quick Reference

| Step | Action |
|------|--------|
| 1 | Save memory files (MEMORY.md + project memory) |
| 2 | Push shared artifacts if cross-machine context needed |
| 3 | Announce reset to chat |
| 4 | Find session ID |
| 5 | tmux resume + `/new` |
| 6 | **Clean up tmux session** (`tmux kill-session`) |
| 7 | Post-reset catch-up |
