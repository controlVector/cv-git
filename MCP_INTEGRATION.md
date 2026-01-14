# CV-Git MCP Integration Guide

**Version:** 0.4.23
**Last Updated:** 2026-01-14

This guide explains how to integrate CV-Git with AI coding assistants like Claude Code via the Model Context Protocol (MCP).

---

## Overview

CV-Git provides an MCP server that exposes the knowledge graph to AI coding assistants, enabling them to:

- Search code semantically with `cv_find`
- Get rich context with `cv_context` and `cv_auto_context`
- Query code relationships with `cv_graph_*` tools
- Track code evolution with `cv_commits`, `cv_file_history`, `cv_blame`
- Access real-time status via MCP Resources

### Repository Isolation (v0.4.23+)

Each repository now gets its own isolated GraphRAG storage:

- **FalkorDB**: Databases named `cv_{repoId}` (e.g., `cv_d8cb6fc6bb1b`)
- **Qdrant**: Collections prefixed with `{repoId}_` (e.g., `abc123_code_chunks`)

This prevents cross-contamination when using CV-Git across multiple repositories. The repository ID is a deterministic 12-character hex string generated from the git remote URL or path.

---

## Quick Setup

### 1. Start Required Services

```bash
# Start FalkorDB (knowledge graph)
docker run -d --name falkordb -p 6379:6379 falkordb/falkordb:latest

# Start Qdrant (vector search)
docker run -d --name qdrant -p 6333:6333 qdrant/qdrant:latest
```

### 2. Initialize Your Repository

```bash
cd your-project
cv init
cv auth setup  # Configure API keys
cv sync        # Build knowledge graph
```

### 3. Configure Claude Code

Add to your `~/.claude/mcp.json` or project `.mcp.json`:

```json
{
  "mcpServers": {
    "cv-git": {
      "command": "npx",
      "args": ["-y", "@controlvector/cv-git-mcp"]
    }
  }
}
```

Or if running from local development:

```json
{
  "mcpServers": {
    "cv-git": {
      "command": "node",
      "args": ["/path/to/cv-git/packages/mcp-server/dist/index.js"]
    }
  }
}
```

---

## MCP Resources

CV-Git exposes real-time context as MCP Resources that update dynamically:

| Resource URI | Description |
|--------------|-------------|
| `cv://status` | Repository status including git state and sync info |
| `cv://stats` | Knowledge graph statistics (files, symbols, commits) |
| `cv://recent-commits` | Last 10 commits with metadata |
| `cv://modified-files` | Currently modified files in working tree |
| `cv://hotspots` | Most-called functions in the codebase |

Resources auto-update based on TTL and are great for AI agents to maintain situational awareness.

---

## MCP Tools

### Code Understanding

#### cv_auto_context
**Recommended first call for any coding task.**

```json
{
  "query": "authentication flow",
  "currentFile": "src/auth/login.ts",
  "format": "xml",
  "budget": 20000
}
```

Returns structured context including:
- Semantically relevant code
- Call graph relationships
- Related documentation

#### cv_find
Semantic code search.

```json
{
  "query": "error handling",
  "limit": 10,
  "minScore": 0.5,
  "language": "typescript"
}
```

#### cv_context
Rich context generation for understanding code.

```json
{
  "query": "database queries",
  "includeGraph": true,
  "includeFiles": true,
  "depth": 2
}
```

#### cv_explain
AI-powered code explanation.

```json
{
  "target": "authenticateUser"
}
```

---

### Version-Aware Tools (Code Evolution)

These tools use the commit history synced to the knowledge graph.

#### cv_commits
List recent commits with optional filters.

```json
{
  "limit": 20,
  "file": "src/auth/login.ts",
  "author": "john"
}
```

Output:
```
Recent Commits (5):

2d719ede 2025-12-30 John Schmotzer
  feat: Add logging infrastructure

80d813da 2025-12-30 John Schmotzer
  feat: Add MCP Resources
```

#### cv_file_history
Get modification history for a specific file.

```json
{
  "file": "packages/core/src/sync/index.ts",
  "limit": 10
}
```

Output:
```
File History: packages/core/src/sync/index.ts

2996afa2 2025-12-30 John Schmotzer +200/-10
  feat: Add commit sync to knowledge graph

2d719ede 2025-12-30 John Schmotzer +50/-5
  feat: Add logging infrastructure
```

#### cv_blame
Show commit attribution for code.

For files - shows which commit last modified each symbol:
```json
{
  "target": "packages/mcp-server/src/logger.ts"
}
```

For symbols - shows commits that changed files containing the symbol:
```json
{
  "target": "createLogger"
}
```

---

### Graph Queries

#### cv_graph_query
Query code relationships.

```json
{
  "queryType": "calls",
  "target": "authenticateUser"
}
```

Query types:
- `calls` - What does this function call?
- `called-by` - What calls this function?
- `imports` - What does this file import?
- `exports` - What does this file export?
- `functions` - List all functions
- `classes` - List all classes
- `files` - List all files

#### cv_graph_stats
Get knowledge graph statistics.

```json
{}
```

Returns counts of files, symbols, commits, relationships.

#### cv_graph_path
Find execution paths between functions.

```json
{
  "from": "handleRequest",
  "to": "saveToDatabase",
  "maxDepth": 10
}
```

#### cv_graph_hotspots
Find most-called functions.

```json
{
  "limit": 20
}
```

#### cv_graph_dead_code
Find potentially unreachable functions.

#### cv_graph_complexity
Find high-complexity functions.

```json
{
  "threshold": 10,
  "limit": 20
}
```

#### cv_graph_cycles
Find circular dependencies.

```json
{
  "maxDepth": 5
}
```

---

### Documentation Tools

#### cv_docs_search
Search documentation semantically.

```json
{
  "query": "authentication design",
  "limit": 10,
  "type": "design_spec"
}
```

#### cv_docs_ingest
Add documentation to knowledge graph.

```json
{
  "path": "docs/DESIGN.md",
  "content": "# Design Document\n...",
  "archive": false
}
```

#### cv_docs_list
List documents in knowledge graph.

```json
{
  "type": "design_spec",
  "archived": false
}
```

---

### PRD & Requirements Tools

Track requirements, test coverage, and documentation for product requirements documents.

#### cv_prd_context
Get unified PRD context for AI including requirements, tests, and documentation.

```json
{
  "query": "user authentication requirements",
  "prdId": "PRD-001",
  "includeTypes": ["requirement", "test_case", "documentation"]
}
```

#### cv_requirement_trace
Get full traceability for a requirement.

```json
{
  "chunkId": "REQ-001-auth",
  "depth": 3
}
```

Returns: dependencies, tests, documentation, designs, and code implementations.

#### cv_test_coverage
Get test coverage metrics for a PRD.

```json
{
  "prdId": "PRD-001"
}
```

#### cv_doc_coverage
Get documentation coverage metrics for a PRD.

```json
{
  "prdId": "PRD-001"
}
```

---

### AI Commit Tools

Generate intelligent commit messages using knowledge graph context.

#### cv_commit_analyze
Analyze staged git changes using AI and knowledge graph.

```json
{}
```

Returns structured info about:
- Files changed
- Symbols added/modified/deleted
- Breaking changes detected
- Suggested commit type/scope

#### cv_commit_generate
Generate a conventional commit message from staged changes.

```json
{
  "type": "feat",
  "scope": "auth"
}
```

Returns a ready-to-use commit message in conventional commit format.

---

### Platform Integration

#### cv_pr_create
Create a GitHub pull request.

```json
{
  "title": "Add authentication",
  "body": "Implements JWT auth",
  "base": "main",
  "draft": false
}
```

#### cv_pr_list / cv_pr_review
List or review pull requests.

#### cv_release_create
Create a GitHub release.

---

### System Tools

#### cv_sync
Synchronize knowledge graph.

```json
{
  "incremental": true,
  "force": false
}
```

#### cv_status
Get repository status.

#### cv_doctor
Run diagnostics.

---

## Automatic File Watching

CV-Git can automatically keep the knowledge graph in sync:

```bash
# Start watching for file changes
cv watch

# With custom debounce (ms)
cv watch --debounce 2000

# With notifications
cv watch --notify
```

The watcher automatically syncs when files change, keeping the MCP context current.

---

## Logging and Debugging

### Enable Debug Logging

```bash
# Set log level
export CV_LOG_LEVEL=debug

# Or enable debug mode
export CV_DEBUG=true

# JSON output for structured logging
export CV_LOG_JSON=true
```

### Log Levels
- `error` - Only errors
- `warn` - Warnings and errors
- `info` - Standard logging (default)
- `debug` - Verbose debugging

---

## Best Practices for AI Assistants

### 1. Start with Context

Always call `cv_auto_context` first:
```
"I want to understand the authentication flow"
→ cv_auto_context { query: "authentication flow" }
```

### 2. Use Version-Aware Tools for History

When investigating bugs or understanding changes:
```
"Who last modified the login function?"
→ cv_blame { target: "login" }

"What changed in auth recently?"
→ cv_file_history { file: "src/auth/index.ts" }
```

### 3. Leverage Graph Relationships

For understanding code impact:
```
"What will be affected if I change this function?"
→ cv_graph_query { queryType: "called-by", target: "validateUser" }
```

### 4. Keep Sync Current

After making changes:
```bash
cv sync --incremental
```

Or use `cv watch` for automatic syncing.

---

## Troubleshooting

### "No commits found"

Run sync with commit depth:
```bash
cv sync  # Syncs last 50 commits by default
```

### "Connection refused"

Check services are running:
```bash
docker ps | grep -E "falkordb|qdrant"
```

### "Graph query failed"

Check FalkorDB connection:
```bash
cv doctor
```

### Stale Context

Force re-sync:
```bash
cv sync --force
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     AI Coding Assistant                      │
│                    (Claude Code, etc.)                       │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ MCP Protocol
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   CV-Git MCP Server                          │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────────────┐    │
│  │  Resources  │ │    Tools    │ │    Auto-Context     │    │
│  │  (status,   │ │  (find,     │ │    (optimized AI    │    │
│  │  commits)   │ │  graph,     │ │     context)        │    │
│  └─────────────┘ │  blame...)  │ └─────────────────────┘    │
│                  └─────────────┘                             │
└─────────────────────────────────────────────────────────────┘
                              │
            ┌─────────────────┼─────────────────┐
            ▼                 ▼                 ▼
    ┌───────────────┐ ┌───────────────┐ ┌───────────────┐
    │   FalkorDB    │ │    Qdrant     │ │   Git Repo    │
    │  (Knowledge   │ │   (Vector     │ │  (Source of   │
    │    Graph)     │ │   Search)     │ │    Truth)     │
    └───────────────┘ └───────────────┘ └───────────────┘
```

---

## Related Documentation

- [COMMANDS.md](./COMMANDS.md) - CLI command reference
- [ARCHITECTURE.md](./ARCHITECTURE.md) - System design
- [QUICKSTART.md](./QUICKSTART.md) - Getting started guide

---

**Last Updated:** 2026-01-14
**Version:** 0.4.23
