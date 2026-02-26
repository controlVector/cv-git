#!/usr/bin/env bash
# Claude Code hook: Stop (context engine turn — egress + pull)
# Fires after each response cycle. Pushes session knowledge to the graph
# and pulls relevant context for the next turn.
set -euo pipefail

if [[ -z "${CV_SESSION_ID:-}" ]]; then
  exit 0
fi

# Read hook input from stdin
input=$(cat)

# ── Turn counter ──────────────────────────────────────────────────────
turn_file="/tmp/cv-turn-${CV_SESSION_ID}"
if [[ -f "$turn_file" ]]; then
  turn_number=$(( $(cat "$turn_file") + 1 ))
else
  turn_number=1
fi
echo "$turn_number" > "$turn_file"

# ── Extract last assistant message from hook input ────────────────────
transcript_segment=""
if command -v python3 >/dev/null 2>&1; then
  transcript_segment=$(python3 -c "
import sys, json
try:
    d = json.loads(sys.stdin.read())
    msg = d.get('last_assistant_message', '')
    print(msg[:2000])
except:
    print('')
" <<< "$input" 2>/dev/null || true)
fi

# ── Extract files touched from recent git changes ────────────────────
files_csv=""
if git rev-parse --git-dir >/dev/null 2>&1; then
  changed=$(git diff --name-only HEAD 2>/dev/null | head -20 | tr '\n' ',' || true)
  changed="${changed%,}"
  if [[ -n "$changed" ]]; then
    files_csv="$changed"
  fi
fi

# ── Push: write session knowledge to graph ────────────────────────────
if [[ -n "$transcript_segment" ]]; then
  cv knowledge egress \
    --session-id "$CV_SESSION_ID" \
    --turn "$turn_number" \
    --transcript "$transcript_segment" \
    ${files_csv:+--files "$files_csv"} \
    --concern "codebase" \
    >/dev/null 2>&1 &
fi

# ── Pull: query prior knowledge for context injection ────────────────
if [[ -n "$files_csv" ]]; then
  cv knowledge query \
    --files "$files_csv" \
    --exclude-session "$CV_SESSION_ID" \
    --limit 3 \
    2>/dev/null || true
fi
