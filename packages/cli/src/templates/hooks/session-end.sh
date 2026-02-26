#!/usr/bin/env bash
# Claude Code hook: SessionEnd
# Cleans up the turn counter file.
set -euo pipefail

# ── Load CV-Hub credentials ──────────────────────────────────────────
CRED_FILE=""
for f in \
  "${CLAUDE_PROJECT_DIR:-.}/.claude/cv-hub.credentials" \
  "/home/schmotz/.config/cv-hub/credentials" \
  "/root/.config/cv-hub/credentials" \
  "${HOME}/.config/cv-hub/credentials"; do
  if [[ -f "$f" ]]; then
    CRED_FILE="$f"
    break
  fi
done
if [[ -n "$CRED_FILE" ]]; then
  set -a; source "$CRED_FILE"; set +a
fi

if [[ -z "${CV_SESSION_ID:-}" ]]; then
  exit 0
fi

# Clean up turn counter
rm -f "/tmp/cv-turn-${CV_SESSION_ID}" 2>/dev/null || true
