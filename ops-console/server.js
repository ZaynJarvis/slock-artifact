// Slock Ops Console — Express server and API routes.
// See lib/ for business logic, CLAUDE.md for development guide.

import express from 'express';
import { join } from 'path';
import { collectAgentData, readStatsCache } from './lib/collector.js';
import { loadMetrics, saveMetrics, getMetrics, pushMetric } from './lib/metrics.js';
import { getRemoteAgents, receiveRemoteAgents, pushToRemote } from './lib/remote.js';

const PORT = 5939;
const COLLECT_INTERVAL = 60_000;

let cachedAgents = [];
let lastCollect = 0;

async function getAgents(force = false) {
  if (force || Date.now() - lastCollect > COLLECT_INTERVAL) {
    cachedAgents = await collectAgentData();
    lastCollect = Date.now();
  }
  return [...cachedAgents, ...getRemoteAgents()];
}

// --- Express App ---
const app = express();
app.use(express.static(join(import.meta.dirname, 'public')));
app.use((_, res, next) => { res.header('Access-Control-Allow-Origin', '*'); next(); });
app.use(express.json());

// GET /api/agents — all agents current status + token usage
app.get('/api/agents', async (req, res) => {
  try {
    const agents = await getAgents(req.query.refresh === '1');
    res.json(agents);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/agents/:id/metrics — single agent time series
app.get('/api/agents/:id/metrics', (req, res) => {
  const data = getMetrics(req.params.id);
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
        id: a.id, name: a.name, status: a.status, model: a.model, runtime: a.runtime,
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

// POST /api/push — receive agent data from remote machines
app.post('/api/push', (req, res) => {
  const { machine, agents } = req.body;
  if (!agents || !Array.isArray(agents)) {
    return res.status(400).json({ error: 'Invalid payload' });
  }
  receiveRemoteAgents(machine, agents);
  console.log(`Received ${agents.length} agents from ${machine || 'unknown'}`);
  res.json({ ok: true, count: agents.length });
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
await loadMetrics();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Ops Console running at http://localhost:${PORT}`);
  console.log(`API: http://localhost:${PORT}/api/agents`);

  getAgents(true).then(agents => {
    console.log(`Collected ${agents.length} active agents`);
  });

  // Periodic collection + push + save metrics
  setInterval(async () => {
    try {
      const localAgents = await collectAgentData();
      cachedAgents = localAgents;
      lastCollect = Date.now();
      await pushToRemote(localAgents);
      await saveMetrics();
    } catch (err) {
      console.error('Collection error:', err.message);
    }
  }, COLLECT_INTERVAL);
});

// Save metrics on graceful shutdown
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    console.log(`${sig} received, saving metrics...`);
    await saveMetrics();
    process.exit(0);
  });
}
