#!/usr/bin/env bash
# Claude Code hook: SessionEnd
# Cleans up the turn counter file.
set -euo pipefail

if [[ -z "${CV_SESSION_ID:-}" ]]; then
  exit 0
fi

# Clean up turn counter
rm -f "/tmp/cv-turn-${CV_SESSION_ID}" 2>/dev/null || true
