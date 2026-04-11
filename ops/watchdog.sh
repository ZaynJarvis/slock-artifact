#!/bin/bash
# Watchdog script for toy-slock server + slock-daemon
# Run via cron: * * * * * /path/to/watchdog.sh
#
# Checks if processes are running. If not, restarts them and logs + notifies.

set -euo pipefail

LOG_FILE="${HOME}/code/c/watchdog.log"
TOYSLOCK_DIR="${HOME}/code/c/toy-slock"
DAEMON_DIR="${HOME}/code/c/toy-slock-daemon"
DAEMON_SERVER_URL="${DAEMON_SERVER_URL:-http://localhost:7777}"
DAEMON_API_KEY="${DAEMON_API_KEY:-test}"

# Slock notification config (optional)
SLOCK_NOTIFY_URL="${SLOCK_NOTIFY_URL:-}"  # e.g. http://localhost:7777
SLOCK_NOTIFY_AGENT="${SLOCK_NOTIFY_AGENT:-watchdog}"
SLOCK_NOTIFY_CHANNEL="${SLOCK_NOTIFY_CHANNEL:-#slock-clone}"

log() {
  echo "$(date '+%Y-%m-%d %H:%M:%S') $1" >> "$LOG_FILE"
}

notify_slock() {
  local msg="$1"
  if [ -n "$SLOCK_NOTIFY_URL" ]; then
    curl -s -X POST "${SLOCK_NOTIFY_URL}/internal/agent/${SLOCK_NOTIFY_AGENT}/send" \
      -H 'Content-Type: application/json' \
      -d "{\"target\":\"${SLOCK_NOTIFY_CHANNEL}\",\"content\":\"[watchdog] ${msg}\"}" \
      >> "$LOG_FILE" 2>&1 || true
  fi
}

# Check toy-slock server (detect by listening port or process)
check_server() {
  curl -s --max-time 3 http://localhost:7777/api/agents > /dev/null 2>&1
}

if ! check_server; then
  log "[WARN] toy-slock server is down — restarting..."
  cd "$TOYSLOCK_DIR"
  PORT=7777 nohup node server/index.js >> "$LOG_FILE" 2>&1 &
  sleep 3
  if check_server; then
    log "[OK] toy-slock server restarted"
    notify_slock "toy-slock server was down, restarted successfully"
  else
    log "[ERROR] toy-slock server failed to restart"
    notify_slock "toy-slock server is down and failed to restart!"
  fi
else
  log "[OK] toy-slock server running"
fi

# Check slock-daemon (detect by process pattern — supports both npx and direct node)
check_daemon() {
  pgrep -f "slock-daemon" > /dev/null 2>&1
}

if ! check_daemon; then
  log "[WARN] slock-daemon is down — restarting..."
  cd "$DAEMON_DIR"
  nohup node dist/index.js --server-url "$DAEMON_SERVER_URL" --api-key "$DAEMON_API_KEY" >> "$LOG_FILE" 2>&1 &
  sleep 3
  if check_daemon; then
    log "[OK] slock-daemon restarted"
    notify_slock "slock-daemon was down, restarted successfully"
  else
    log "[ERROR] slock-daemon failed to restart"
    notify_slock "slock-daemon is down and failed to restart!"
  fi
else
  log "[OK] slock-daemon running"
fi
