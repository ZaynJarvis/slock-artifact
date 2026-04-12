// Time-series ring buffer with JSON file persistence.

import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';

const CLAUDE_DIR = join(homedir(), '.claude');
const MAX_POINTS = 1440; // 24h at 1-min intervals
const METRICS_FILE = join(CLAUDE_DIR, 'ops-metrics-history.json');

const metricsHistory = new Map(); // agentId -> [{ts, activityCount, contextWindowPct}]

export function pushMetric(agentId, point) {
  if (!metricsHistory.has(agentId)) metricsHistory.set(agentId, []);
  const buf = metricsHistory.get(agentId);
  buf.push(point);
  if (buf.length > MAX_POINTS) buf.shift();
}

export function getMetrics(agentId) {
  return metricsHistory.get(agentId) || null;
}

// Return the last recorded metric point for an agent (for carry-forward when current reading is 0).
export function getLastMetric(agentId) {
  const buf = metricsHistory.get(agentId);
  return buf && buf.length > 0 ? buf[buf.length - 1] : null;
}

export async function loadMetrics() {
  try {
    const data = JSON.parse(await readFile(METRICS_FILE, 'utf-8'));
    const cutoff = Date.now() - MAX_POINTS * 60_000;
    for (const [id, points] of Object.entries(data)) {
      const fresh = points.filter(p => p.ts > cutoff);
      if (fresh.length > 0) metricsHistory.set(id, fresh);
    }
    console.log(`Loaded metrics for ${metricsHistory.size} agents from disk`);
  } catch { /* no file or corrupt — start fresh */ }
}

export async function saveMetrics() {
  try {
    const obj = {};
    for (const [id, points] of metricsHistory) obj[id] = points;
    await writeFile(METRICS_FILE, JSON.stringify(obj), 'utf-8');
  } catch (err) {
    console.error('Failed to save metrics:', err.message);
  }
}
