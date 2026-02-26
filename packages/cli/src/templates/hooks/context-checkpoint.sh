#!/usr/bin/env bash
# Claude Code hook: PreCompact
# Saves a checkpoint of session knowledge before context compaction.
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

# Read hook input from stdin
input=$(cat)

# Extract summary from compaction input
summary=""
if command -v python3 >/dev/null 2>&1; then
  summary=$(python3 -c "
import sys, json
try:
    d = json.loads(sys.stdin.read())
    print(d.get('summary', '')[:5000])
except:
    print('')
" <<< "$input" 2>/dev/null || true)
fi

# Gather files currently in context
files_csv=""
if git rev-parse --git-dir >/dev/null 2>&1; then
  changed=$(git diff --name-only HEAD 2>/dev/null || true)
  staged=$(git diff --name-only --cached 2>/dev/null || true)
  all_files=$(echo -e "${changed}\n${staged}" | sort -u | head -30 | tr '\n' ',' || true)
  all_files="${all_files%,}"
  if [[ -n "$all_files" ]]; then
    files_csv="$all_files"
  fi
fi

# Use a special turn number (9999) to mark checkpoint entries
if [[ -n "$summary" ]]; then
  cv knowledge egress \
    --session-id "$CV_SESSION_ID" \
    --turn 9999 \
    --transcript "$summary" \
    ${files_csv:+--files "$files_csv"} \
    --concern "checkpoint" \
    >/dev/null 2>&1 || true
fi
