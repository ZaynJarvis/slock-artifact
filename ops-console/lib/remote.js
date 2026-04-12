// Remote agent data: push to other machines, receive from other machines.

import { hostname } from 'os';
import { pushMetric, getLastMetric } from './metrics.js';
import { registerAgent } from './agents.js';

let remoteAgents = [];
let remoteLastSeen = 0;
const REMOTE_TTL = 180_000; // expire after 3 min without update

// Push target: set PUSH_TARGET=http://<remote>:5939 to push local data there
const PUSH_TARGET = process.env.PUSH_TARGET || '';

export function getRemoteAgents() {
  return (Date.now() - remoteLastSeen < REMOTE_TTL) ? remoteAgents : [];
}

export function receiveRemoteAgents(machine, agents) {
  // Build lookup of previous remote agent data for carry-forward
  const prevByid = new Map(remoteAgents.map(a => [a.id, a]));
  remoteAgents = agents.map(a => {
    const prev = prevByid.get(a.id);
    return {
      ...a,
      machine: machine || 'unknown',
      // Carry forward tokens/activity if current push has 0
      tokens: (a.tokens && a.tokens.total > 0) ? a.tokens : (prev?.tokens || a.tokens),
      activityCount: a.activityCount || prev?.activityCount || 0,
      contextWindowPct: a.contextWindowPct || prev?.contextWindowPct || 0,
    };
  });
  remoteLastSeen = Date.now();
  for (const a of agents) {
    if (a.id && a.name) registerAgent(a.id, a.name);
    // Carry forward last known values when remote sends 0
    const lastMetric = getLastMetric(a.id);
    const activityCount = a.activityCount || lastMetric?.activityCount || 0;
    const contextWindowPct = a.contextWindowPct || lastMetric?.contextWindowPct || 0;
    const tokens = (a.tokens && a.tokens.total > 0) ? a.tokens : lastMetric?.tokens || a.tokens;
    pushMetric(a.id, {
      ts: Date.now(),
      activityCount,
      contextWindowPct,
      tokens,
    });
  }
}

export async function pushToRemote(agents) {
  if (!PUSH_TARGET) return;
  try {
    await fetch(`${PUSH_TARGET}/api/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ machine: hostname(), agents }),
    });
  } catch (err) {
    console.error(`Push to ${PUSH_TARGET} failed: ${err.message}`);
  }
}
