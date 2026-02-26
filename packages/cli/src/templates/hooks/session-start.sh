#!/usr/bin/env bash
# Claude Code hook: SessionStart
# Queries the CV-Git knowledge graph for prior session knowledge
# related to files in the current working directory.
set -euo pipefail

# Read hook input from stdin
input=$(cat)
session_id=$(echo "$input" | grep -o '"session_id":"[^"]*"' | head -1 | cut -d'"' -f4 || true)

# Write session ID to env file for downstream hooks
if [[ -n "$session_id" && -n "${CLAUDE_ENV_FILE:-}" ]]; then
  echo "CV_SESSION_ID=${session_id}" >> "$CLAUDE_ENV_FILE"
fi

# Detect recently changed files for context query
files_csv=""
if git rev-parse --git-dir >/dev/null 2>&1; then
  changed=$(git diff --name-only HEAD 2>/dev/null | head -10 | tr '\n' ',' || true)
  changed="${changed%,}"  # strip trailing comma
  if [[ -n "$changed" ]]; then
    files_csv="$changed"
  fi
fi

# Query prior session knowledge (non-fatal)
if [[ -n "$files_csv" ]]; then
  cv knowledge query --files "$files_csv" --exclude-session "${session_id:-}" --limit 5 2>/dev/null || true
fi
