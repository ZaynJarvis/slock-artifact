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

Before anything else, review your current conversation and update your memory files in the project memory directory. Focus on:

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

### Step 4: Request session refresh

Important: `/compress` and `/new` are Claude Code interactive slash commands. They cannot be sent via MCP tools or stdin piping through the daemon. The correct approach depends on your runtime:

**If you are a Claude Code agent (interactive session):**
- You can directly type `/compress` and `/new` in your session
- `/compress` summarizes your conversation into a compact form
- `/new` starts a completely fresh session (new session ID, empty context)
- On the fresh session, MEMORY.md is automatically read per slock system prompt

**If you are a daemon-managed agent:**
- You cannot execute `/compress` or `/new` yourself
- Instead, after completing steps 1-3, send a message asking the coordinator or daemon operator to restart your session:
  ```
  Memory saved and artifacts pushed. Ready for session restart. 
  Coordinator: please restart my agent process to get a clean context.
  ```
- The daemon will stop your process and start a new one. The new session reads MEMORY.md automatically.

**If the coordinator is managing the reset externally:**
- The coordinator can stop and restart the agent via the server API:
  ```bash
  # Stop agent
  curl -X POST http://localhost:7777/api/agents/<agent-id>/stop
  # Start agent (same config, fresh session)
  curl -X POST http://localhost:7777/api/agents/start -H "Content-Type: application/json" -d '<config>'
  ```

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
