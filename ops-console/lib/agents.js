// Agent identity mapping and name resolution.
// Uses auto-discovery: agents register on first appearance.
// ALIASES provides optional display name overrides.

const ALIASES = {
  '3e6e492d-70d8-40d8-96bd-ea2e127b7be4': 'Tim',
  'f3a88464-ae05-438a-8fd7-3389aa42f9ff': 'Zeus',
  '9cb54521-9825-467f-858e-f83fefa0ab32': 'QA',
  'c5d68c4e-8289-4d5e-b1aa-ef3351b54d34': 'Alice',
  'c187affb-5637-43a6-b9f2-1e8170479e6f': 'Bob',
  'd49b593d-c83b-4f4e-badb-ecc68f3fcc7c': 'Bob-old',
  '2a137135-5c9c-4c51-8698-fdfb9f8b0d23': 'clone',
  '3127feda-98af-4b1f-ac82-bafc24a4377e': 'Alice',
  '9cc76965-29f9-49a6-a959-87da8d9a544c': 'Hela',
  '0b87758a-3bab-4753-b452-7376841e6a54': 'fe-helper',
};

// Auto-discovered agents: id -> { name, firstSeen }
const discovered = new Map();

export function resolveAgentName(agentId, session) {
  // 1. Check explicit alias
  if (ALIASES[agentId]) return ALIASES[agentId];

  // 2. Check if already discovered
  if (discovered.has(agentId)) return discovered.get(agentId).name;

  // 3. Auto-discover: derive name from session cwd or agent ID
  let name;
  if (session?.cwd) {
    const m = session.cwd.match(/agents\/([^/]+)/);
    name = m ? m[1].substring(0, 16) : agentId.substring(0, 12);
  } else {
    name = agentId.substring(0, 12);
  }

  discovered.set(agentId, { name, firstSeen: Date.now() });
  console.log(`Auto-discovered agent: ${agentId} → ${name}`);
  return name;
}

// Register a name for an agent (e.g., from remote push data).
export function registerAgent(agentId, name) {
  if (!ALIASES[agentId] && name) {
    discovered.set(agentId, { name, firstSeen: Date.now() });
  }
}

// Backward compat export
export const KNOWN_AGENTS = ALIASES;
