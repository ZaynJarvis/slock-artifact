// Agent data collection: process parsing, session reading, token usage.

import { readdir, readFile, stat } from 'fs/promises';
import { execSync } from 'child_process';
import { join } from 'path';
import { homedir } from 'os';
import { resolveAgentName } from './agents.js';
import { pushMetric, getLastMetric } from './metrics.js';

const CLAUDE_DIR = join(homedir(), '.claude');
const SESSIONS_DIR = join(CLAUDE_DIR, 'sessions');
const PROJECTS_DIR = join(CLAUDE_DIR, 'projects');
const STATS_CACHE = join(CLAUDE_DIR, 'stats-cache.json');

// Parse running agent processes (claude, codex, hermes).
export function parseAgentProcesses() {
  try {
    const out = execSync("ps aux | grep 'agent-id' | grep -E '(claude|codex|hermes)' | grep -v grep", {
      encoding: 'utf-8', timeout: 5000,
    });
    const agents = [];
    for (const line of out.trim().split('\n')) {
      if (!line) continue;
      const parts = line.split(/\s+/);
      const pid = parseInt(parts[1]);
      const cpu = parseFloat(parts[2]);
      const rss = parseInt(parts[5]); // KB
      const agentIdMatch = line.match(/--agent-id","([^"]+)"/) || line.match(/--agent-id\s+(\S+)/);
      const modelMatch = line.match(/--model\s+(\S+)/) || line.match(/-m\s+(\S+)/);
      // Detect runtime from process command (before first --)
      let runtime = 'claude';
      if (/\bcodex\b/.test(line.split('--')[0])) runtime = 'codex';
      else if (/\bhermes\b/.test(line.split('--')[0])) runtime = 'hermes';
      if (agentIdMatch) {
        agents.push({
          pid, agentId: agentIdMatch[1],
          model: modelMatch ? modelMatch[1] : 'unknown',
          runtime,
          cpuPercent: cpu, memMB: Math.round(rss / 1024),
        });
      }
    }
    return agents;
  } catch { return []; }
}

// Read active Claude Code sessions from ~/.claude/sessions/.
export async function readSessions() {
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

// Sum token usage from a JSONL transcript file.
export async function sumTokensFromJSONL(filePath, maxLines = 1000) {
  try {
    const content = await readFile(filePath, 'utf-8');
    const lines = content.trim().split('\n').slice(-maxLines);

    let totalInput = 0, totalOutput = 0, totalCache = 0;
    let messageCount = 0, model = 'unknown';
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

// Find the JSONL transcript file for a given session ID.
export async function findJSONLForSession(sessionId) {
  try {
    const dirs = await readdir(PROJECTS_DIR);
    for (const dir of dirs) {
      const p = join(PROJECTS_DIR, dir, `${sessionId}.jsonl`);
      try { await stat(p); return p; } catch { /* not here */ }
    }
  } catch { /* no projects dir */ }
  return null;
}

// Read cached daily stats.
export async function readStatsCache() {
  try { return JSON.parse(await readFile(STATS_CACHE, 'utf-8')); }
  catch { return null; }
}

// Collect full agent data from local processes + sessions + transcripts.
export async function collectAgentData() {
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

    const contextWindow = 200000;
    let contextWindowPct = 0;
    if (tokens?.lastTurnContext) {
      contextWindowPct = Math.min(100, Math.round((tokens.lastTurnContext / contextWindow) * 100 * 10) / 10);
    }

    const status = proc.cpuPercent > 0.5 ? 'active' : 'idle';

    // Carry forward last known values when current reading is 0/null
    const lastMetric = getLastMetric(proc.agentId);
    const activityCount = tokens?.messageCount || lastMetric?.activityCount || 0;
    const effectiveCtxPct = contextWindowPct || lastMetric?.contextWindowPct || 0;
    const effectiveTokens = tokens
      ? { input: tokens.input, output: tokens.output, cache: tokens.cache, total: tokens.total }
      : lastMetric?.tokens || { input: 0, output: 0, cache: 0, total: 0 };

    agents.push({
      id: proc.agentId,
      name, status,
      tokens: effectiveTokens,
      contextWindowPct: effectiveCtxPct,
      activityCount,
      model: proc.model,
      runtime: proc.runtime || 'claude',
      pid: proc.pid,
      cpuPercent: proc.cpuPercent,
      memMB: proc.memMB,
      uptimeSec,
      sessionId: session?.sessionId || null,
    });

    pushMetric(proc.agentId, {
      ts: Date.now(),
      activityCount,
      contextWindowPct: effectiveCtxPct,
      tokens: effectiveTokens,
    });
  }

  return agents;
}
