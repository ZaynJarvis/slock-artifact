# Slock Ops Console

Real-time monitoring dashboard for slock agents across multiple machines.

## Features

- Per-agent token usage (input/output/cache ratio)
- Agent activity time series (per-minute data points, 24h rolling window)
- Context window utilization (% used per agent)
- Multi-runtime support (Claude, Codex, Hermes)
- Multi-machine federation (push/pull between bytedance and lululiang)
- Metrics persistence (survives server restarts)
- Full-page screenshot API (`/api/screenshot`)
- Structured context export (`/api/context`)

## Setup

```bash
cd ops-console
npm install
npm start
```

Dashboard: http://localhost:5939

### Multi-machine

Push local data to a remote ops-console:
```bash
PUSH_TARGET=http://<remote-ip>:5939 npm start
```

## API Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/` | GET | Dashboard UI |
| `/api/agents` | GET | All agents (local + remote), add `?refresh=1` to force |
| `/api/agents/:id/metrics` | GET | Time series for one agent |
| `/api/stats` | GET | Historical daily stats |
| `/api/context` | GET | Full metrics as JSON (for agent consumption) |
| `/api/push` | POST | Receive agent data from remote machines |
| `/api/screenshot` | GET | Full-page screenshot (returns PNG) |

## Architecture

```
ops-console/
├── server.js              — Express app, routes, lifecycle
├── lib/
│   ├── agents.js          — Agent ID → name mapping
│   ├── collector.js       — Process parsing, session/token data collection
│   ├── metrics.js         — Time-series ring buffer + file persistence
│   └── remote.js          — Push/pull remote agent data
├── public/
│   └── index.html         — Dashboard frontend (Chart.js)
├── CLAUDE.md              — Development guide for agents
├── README.md
└── package.json
```

## Data Sources

- `ps aux` — running agent processes (claude, codex, hermes)
- `~/.claude/sessions/*.json` — active session info (pid, sessionId, startedAt)
- `~/.claude/projects/*/<sessionId>.jsonl` — token usage transcripts
- `~/.claude/stats-cache.json` — daily activity counts
- `~/.claude/ops-metrics-history.json` — persisted time-series metrics

## Machines

| Machine | Role | IP | Agents |
|---|---|---|---|
| bytedance | Mobile (MacBook Pro) | 192.168.1.238:5939 | Tim, Zeus, QA |
| lululiang | Master (iMac, always-on) | 192.168.1.35:5939 | Alice, Bob, Hela, fe-helper, clone |
