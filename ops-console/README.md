# Slock Ops Console

Independent monitoring dashboard for slock agents.

## Features

- Per-agent token usage (input/output/cache ratio, cost)
- Agent activity time series (per-minute data points)
- Context window utilization (% used per agent)
- Full-page screenshot API (`/api/screenshot`)
- Full-page context text export (`/api/context`)

## Setup

```bash
cd ops-console
npm install
npm run dev
```

Dashboard: http://localhost:5939
API: http://localhost:5939/api/

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /` | Dashboard UI |
| `GET /api/agents` | All agents current status + token usage |
| `GET /api/agents/:id/metrics` | Single agent time series data |
| `GET /api/screenshot` | Full-page screenshot (returns PNG) |
| `GET /api/context` | Full metrics as structured text (for agent consumption) |

## Architecture

```
ops-console/
  ├── server.js        — Express server on :5939
  ├── collector.js     — Data collection (agent sessions, token usage, stats)
  ├── public/          — Frontend dashboard (static HTML + Chart.js)
  └── screenshot.js    — Puppeteer self-screenshot
```

## Data Sources

- `~/.claude/stats-cache.json` — daily activity counts
- `~/.claude/sessions/*.json` — active session info
- `claude -p --output-format json` — per-session token usage
- Process monitoring (pgrep) — agent liveness
