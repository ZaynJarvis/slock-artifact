import express from 'express';
import { readdir, readFile, stat } from 'fs/promises';
import { execSync } from 'child_process';
import { join } from 'path';
import { homedir } from 'os';

const PORT = 5939;
const CLAUDE_DIR = join(homedir(), '.claude');
const SESSIONS_DIR = join(CLAUDE_DIR, 'sessions');
const PROJECTS_DIR = join(CLAUDE_DIR, 'projects');
const STATS_CACHE = join(CLAUDE_DIR, 'stats-cache.json');

// --- Ring Buffer for time series (24h, 1-min intervals = 1440 points max) ---
const MAX_POINTS = 1440;
const metricsHistory = new Map(); // agentId -> [{ts, activityCount, contextWindowPct}]

function pushMetric(agentId, point) {
  if (!metricsHistory.has(agentId)) metricsHistory.set(agentId, []);
  const buf = metricsHistory.get(agentId);
  buf.push(point);
  if (buf.length > MAX_POINTS) buf.shift();
}

// --- Known agent name mapping ---
const KNOWN_AGENTS = {
  '3e6e492d-70d8-40d8-96bd-ea2e127b7be4': 'Tim',
  'f3a88464-ae05-438a-8fd7-3389aa42f9ff': 'Zeus',
  '9cb54521-9825-467f-858e-f83fefa0ab32': 'QA',
  'c5d68c4e-8289-4d5e-b1aa-ef3351b54d34': 'Alice',
  'd49b593d-c83b-4f4e-badb-ecc68f3fcc7c': 'Bob',
  '2a137135-5c9c-4c51-8698-fdfb9f8b0d23': 'clone',
  'agent-alpha': 'alpha',
  'agent-beta': 'beta',
  'test-agent': 'test-agent',
};

function resolveAgentName(agentId, session) {
  if (KNOWN_AGENTS[agentId]) return KNOWN_AGENTS[agentId];
  if (session?.cwd) {
    const m = session.cwd.match(/agents\/([^/]+)/);
    if (m) return m[1].substring(0, 16);
  }
  return agentId.substring(0, 12);
}

// --- Data Collection ---

function parseAgentProcesses() {
  try {
    const out = execSync("ps aux | grep 'claude.*agent-id' | grep -v grep", {
      encoding: 'utf-8', timeout: 5000,
    });
    const agents = [];
    for (const line of out.trim().split('\n')) {
      if (!line) continue;
      const parts = line.split(/\s+/);
      const pid = parseInt(parts[1]);
      const cpu = parseFloat(parts[2]);
      const rss = parseInt(parts[5]); // KB
      const agentIdMatch = line.match(/--agent-id","([^"]+)"/);
      const modelMatch = line.match(/--model\s+(\S+)/);
      if (agentIdMatch) {
        agents.push({
          pid, agentId: agentIdMatch[1],
          model: modelMatch ? modelMatch[1] : 'unknown',
          cpuPercent: cpu, memMB: Math.round(rss / 1024),
        });
      }
    }
    return agents;
  } catch { return []; }
}

async function readSessions() {
  try {
    const files = await readdir(SESSIONS_DIR);
    const sessions = [];
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      try {
        sessions.push(JSON.parse(await readFile(join(SESSIONS_DIR, f), 'utf-8')));
      } catch { /* skip */ }
    }
    return sessions;
  } catch { return []; }
}

// Sum token usage from JSONL transcript (last N lines for speed)
async function sumTokensFromJSONL(filePath, maxLines = 1000) {
  try {
    const content = await readFile(filePath, 'utf-8');
    const lines = content.trim().split('\n').slice(-maxLines);

    let totalInput = 0, totalOutput = 0, totalCache = 0;
    let messageCount = 0, model = 'unknown';
    // Track the last turn's context size for context window %
    let lastTurnCacheRead = 0, lastTurnInput = 0;

    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        const msg = entry.message || {};
        const usage = msg.usage;
        if (usage) {
          totalInput += usage.input_tokens || 0;
          totalOutput += usage.output_tokens || 0;
          totalCache += (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0);
          if (msg.model) model = msg.model;
          // Track last turn's context (cache_read ~ conversation context sent)
          lastTurnCacheRead = usage.cache_read_input_tokens || 0;
          lastTurnInput = usage.input_tokens || 0;
        }
        if (entry.type === 'user' || entry.type === 'assistant') messageCount++;
      } catch { /* skip */ }
    }

    return {
      input: totalInput, output: totalOutput, cache: totalCache,
      total: totalInput + totalOutput + totalCache,
      messageCount, model,
      lastTurnContext: lastTurnCacheRead + lastTurnInput,
    };
  } catch { return null; }
}

async function findJSONLForSession(sessionId) {
  try {
    const dirs = await readdir(PROJECTS_DIR);
    for (const dir of dirs) {
      const p = join(PROJECTS_DIR, dir, `${sessionId}.jsonl`);
      try { await stat(p); return p; } catch { /* not here */ }
    }
  } catch { /* no projects dir */ }
  return null;
}

async function readStatsCache() {
  try { return JSON.parse(await readFile(STATS_CACHE, 'utf-8')); }
  catch { return null; }
}

// --- Collect all agent data (returns Alice-compatible format) ---
async function collectAgentData() {
  const processes = parseAgentProcesses();
  const sessions = await readSessions();
  const sessionByPid = new Map();
  for (const s of sessions) sessionByPid.set(s.pid, s);

  const agents = [];
  for (const proc of processes) {
    const session = sessionByPid.get(proc.pid);
    let tokens = null;

    if (session) {
      const jsonlPath = await findJSONLForSession(session.sessionId);
      if (jsonlPath) tokens = await sumTokensFromJSONL(jsonlPath);
    }

    const uptimeSec = session ? Math.round((Date.now() - session.startedAt) / 1000) : 0;
    const name = resolveAgentName(proc.agentId, session);

    // Context window % = last turn's context tokens / model context window
    const contextWindow = proc.model.includes('opus') ? 200000 : 200000;
    let contextWindowPct = 0;
    if (tokens?.lastTurnContext) {
      contextWindowPct = Math.min(100, Math.round((tokens.lastTurnContext / contextWindow) * 100 * 10) / 10);
    }

    // Determine status: active if CPU > 0.5%, idle if running but low CPU
    const status = proc.cpuPercent > 0.5 ? 'active' : 'idle';

    agents.push({
      id: proc.agentId,
      name,
      status,
      tokens: tokens ? { input: tokens.input, output: tokens.output, cache: tokens.cache, total: tokens.total } : { input: 0, output: 0, cache: 0, total: 0 },
      contextWindowPct,
      activityCount: tokens?.messageCount || 0,
      model: proc.model,
      // Extra fields for /api/context
      pid: proc.pid,
      cpuPercent: proc.cpuPercent,
      memMB: proc.memMB,
      uptimeSec,
      sessionId: session?.sessionId || null,
    });

    // Push to time series ring buffer
    pushMetric(proc.agentId, {
      ts: Date.now(),
      activityCount: tokens?.messageCount || 0,
      contextWindowPct,
    });
  }

  return agents;
}

// --- Cache (refresh every 60s) ---
let cachedAgents = [];
let lastCollect = 0;
const COLLECT_INTERVAL = 60_000;

async function getAgents(force = false) {
  if (force || Date.now() - lastCollect > COLLECT_INTERVAL) {
    cachedAgents = await collectAgentData();
    lastCollect = Date.now();
  }
  return cachedAgents;
}

// --- Express Server ---
const app = express();
app.use(express.static(join(import.meta.dirname, 'public')));
app.use((_, res, next) => { res.header('Access-Control-Allow-Origin', '*'); next(); });

// GET /api/agents — returns array directly (Alice's frontend expects array)
app.get('/api/agents', async (req, res) => {
  try {
    const agents = await getAgents(req.query.refresh === '1');
    res.json(agents);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/agents/:id/metrics — returns array of {ts, activityCount, contextWindowPct}
app.get('/api/agents/:id/metrics', (req, res) => {
  const data = metricsHistory.get(req.params.id);
  if (!data || data.length === 0) {
    return res.status(404).json({ error: 'No metrics for this agent' });
  }
  res.json(data);
});

// GET /api/stats — historical daily stats
app.get('/api/stats', async (_, res) => {
  try {
    const stats = await readStatsCache();
    res.json(stats || { error: 'not found' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/context — full metrics as JSON (for agent consumption)
app.get('/api/context', async (_, res) => {
  try {
    const agents = await getAgents();
    const stats = await readStatsCache();
    res.json({
      collectedAt: new Date(lastCollect).toISOString(),
      agents: agents.map(a => ({
        id: a.id, name: a.name, status: a.status, model: a.model,
        pid: a.pid, cpuPercent: a.cpuPercent, memMB: a.memMB,
        uptimeSec: a.uptimeSec, sessionId: a.sessionId,
        tokens: a.tokens, contextWindowPct: a.contextWindowPct,
        activityCount: a.activityCount,
      })),
      globalModelUsage: stats?.modelUsage || {},
      totalSessions: stats?.totalSessions || 0,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/screenshot — full-page screenshot via puppeteer
app.get('/api/screenshot', async (_, res) => {
  try {
    const { default: puppeteer } = await import('puppeteer');
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto(`http://localhost:${PORT}`, { waitUntil: 'networkidle0', timeout: 15000 });
    const buf = await page.screenshot({ fullPage: true, type: 'png' });
    await browser.close();
    res.type('image/png').send(buf);
  } catch (err) {
    res.status(500).json({ error: 'Screenshot failed: ' + err.message });
  }
});

// --- Start ---
app.listen(PORT, () => {
  console.log(`Ops Console running at http://localhost:${PORT}`);
  console.log(`API: http://localhost:${PORT}/api/agents`);

  getAgents(true).then(agents => {
    console.log(`Collected ${agents.length} active agents`);
  });

  // Periodic collection
  setInterval(() => {
    getAgents(true).catch(err => console.error('Collection error:', err.message));
  }, COLLECT_INTERVAL);
});
