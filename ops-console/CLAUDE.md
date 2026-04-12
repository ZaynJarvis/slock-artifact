# Ops Console — Development Guide

## Quick Start

```bash
cd ops-console
npm install
node server.js          # starts on :5939, binds 0.0.0.0
```

## Module Overview

| File | Responsibility |
|---|---|
| `server.js` | Express routes, startup, periodic collection loop |
| `lib/agents.js` | `KNOWN_AGENTS` map (agent ID → display name), `resolveAgentName()` |
| `lib/collector.js` | `parseAgentProcesses()` (ps aux), `readSessions()`, `sumTokensFromJSONL()`, `collectAgentData()` |
| `lib/metrics.js` | Ring buffer (`pushMetric`/`getMetrics`), persistence (`loadMetrics`/`saveMetrics`) to `~/.claude/ops-metrics-history.json` |
| `lib/remote.js` | `pushToRemote()`, `receiveRemoteAgents()`, `getRemoteAgents()` — multi-machine federation |
| `public/index.html` | Single-page dashboard with Chart.js (inline JS/CSS) |

## Common Tasks

### Add a new agent
Edit `lib/agents.js` — add the agent's UUID and display name to `KNOWN_AGENTS`.

### Add a new runtime (e.g., a new CLI agent)
1. In `lib/collector.js` → `parseAgentProcesses()`: add the binary name to the grep pattern and runtime detection logic.
2. The rest (metrics, API, frontend) will pick it up automatically via the `runtime` field.

### Add a new API endpoint
Add the route in `server.js`. Use `getAgents()` for agent data, `getMetrics(id)` for time series, `readStatsCache()` for daily stats.

### Change chart colors or layout
Edit `public/index.html`. Chart.js config starts around line 300. Color constants:
- Activity line: `#8b949e` (gray)
- Context % line: `#e3b341` (yellow)
- Token bars: `#388bfd` (input), `#3fb950` (output), `#9e6a03` (cache)

### Metrics persistence
- Saved to `~/.claude/ops-metrics-history.json` every 60s and on SIGINT/SIGTERM.
- Loaded on startup, discarding points older than 24h.
- Ring buffer max: 1440 points (24h at 1-min intervals).

## Multi-machine Setup

Two machines share agent data:
- **bytedance** (192.168.1.238:5939) — Tim, Zeus, QA
- **lululiang** (192.168.1.35:5939) — Alice, Bob, Hela, fe-helper, clone

Data flows via `/api/push` POST or polling `/api/agents`. Remote agents expire after 3 min without update.

## Important Notes

- Always sync changes to BOTH machines (bytedance + lululiang). Coordinate with Alice for lululiang.
- Restarting the server preserves metrics (file persistence) but remote agent data must be re-pushed.
- The `parseAgentProcesses()` grep matches `claude`, `codex`, and `hermes` binaries. Runtime is detected from the command before the first `--` flag.
- Context window % is calculated from the last turn's `cache_read_input_tokens + input_tokens` divided by 200k.
