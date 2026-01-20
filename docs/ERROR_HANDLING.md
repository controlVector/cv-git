# Error Handling Guide

This document describes error handling patterns, error codes, and troubleshooting guidance for CV-Git.

## Table of Contents

- [Error Classes](#error-classes)
- [Error Codes](#error-codes)
- [Service Errors](#service-errors)
- [CLI Error Output](#cli-error-output)
- [MCP Server Errors](#mcp-server-errors)
- [Troubleshooting](#troubleshooting)
- [Environment Variables](#environment-variables)

---

## Error Classes

CV-Git uses a hierarchy of typed errors for categorization:

```typescript
// Base error class
class CVError extends Error {
  code: string;      // Error code (e.g., 'GRAPH_ERROR')
  details?: any;     // Additional context
}

// Specialized errors
class GitError extends CVError { }      // Git operations
class GraphError extends CVError { }    // FalkorDB/graph operations
class VectorError extends CVError { }   // Qdrant/embedding operations
class AIError extends CVError { }       // AI provider operations
class ConfigError extends CVError { }   // Configuration issues
```

### Usage Example

```typescript
import { GraphError, VectorError } from '@cv-git/shared';

try {
  await graphManager.query('MATCH (n) RETURN n');
} catch (error) {
  if (error instanceof GraphError) {
    console.error(`Graph error [${error.code}]: ${error.message}`);
  }
}
```

---

## Error Codes

Standardized error codes for programmatic handling:

### General Errors

| Code | Description |
|------|-------------|
| `UNKNOWN` | Unclassified error |
| `INVALID_INPUT` | Invalid user input or arguments |
| `OPERATION_FAILED` | Generic operation failure |

### Git Errors

| Code | Description |
|------|-------------|
| `NOT_GIT_REPO` | Current directory is not a git repository |
| `GIT_ERROR` | Git command failed |

### CV-Git Errors

| Code | Description |
|------|-------------|
| `NOT_INITIALIZED` | Repository not initialized with `cv init` |
| `SYNC_REQUIRED` | Knowledge graph needs sync (`cv sync`) |
| `CONFIG_ERROR` | Configuration file error |

### Service Errors

| Code | Description |
|------|-------------|
| `SERVICE_UNAVAILABLE` | Required service not running |
| `FALKORDB_ERROR` | FalkorDB connection or query error |
| `QDRANT_ERROR` | Qdrant vector database error |

### Credential Errors

| Code | Description |
|------|-------------|
| `NO_CREDENTIALS` | Required credentials not configured |
| `INVALID_CREDENTIALS` | Credentials rejected by service |
| `AUTH_FAILED` | Authentication flow failed |

### Platform Errors

| Code | Description |
|------|-------------|
| `PLATFORM_ERROR` | GitHub/GitLab/Bitbucket API error |
| `API_ERROR` | External API call failed |
| `NETWORK_ERROR` | Network connectivity issue |

---

## Service Errors

### FalkorDB (Graph Database)

**Connection Errors:**
```
Error: Failed to connect to FalkorDB: ECONNREFUSED
```

**Resolution:**
```bash
# Start FalkorDB with Docker
docker run -d --name cv-git-falkordb -p 6379:6379 falkordb/falkordb:latest

# Or let CV-Git auto-start it
cv sync  # Will attempt to start FalkorDB automatically
```

**Query Errors:**
```
Error: Query failed: ERR Invalid Cypher syntax
```

This indicates a bug in CV-Git. Please report it with the query that failed.

### Qdrant (Vector Database)

**Connection Errors:**
```
Error: Could not connect to Qdrant: ECONNREFUSED
```

**Resolution:**
```bash
# Start Qdrant with Docker
docker run -d --name cv-git-qdrant -p 6333:6333 qdrant/qdrant

# CV-Git can continue without Qdrant (semantic search disabled)
```

**Note:** Qdrant is optional. If unavailable, CV-Git continues with graph-only functionality.

### Embedding Providers

**No API Key:**
```
Error: No embedding API key provided.
Run: cv auth setup openrouter (recommended)
Or:  cv auth setup openai
Or:  Start Ollama for local embeddings
```

**Ollama Not Running:**
```
Error: Ollama not running. Start with: ollama serve
Or install: curl -fsSL https://ollama.com/install.sh | sh
```

**Resolution:**
```bash
# Option 1: Use OpenRouter (recommended)
cv auth setup openrouter

# Option 2: Use OpenAI
cv auth setup openai

# Option 3: Use local Ollama
ollama serve
cv config set ai.embeddings.provider ollama
```

---

## CLI Error Output

### Standard Error Format

```
✗ Error message here
```

With verbose mode (`-v` or `--verbose`):
```
✗ Error message here
  at functionName (/path/to/file.ts:123:45)
  at anotherFunction (/path/to/other.ts:67:12)
```

### JSON Error Format

With `--json` flag:
```json
{
  "success": false,
  "error": "Error message here",
  "code": "ERROR_CODE",
  "details": "Additional context if available"
}
```

### Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | Error (any type) |

---

## MCP Server Errors

When used as an MCP server, errors are returned in the tool result format:

```json
{
  "content": [
    {
      "type": "text",
      "text": "Error: Error message\nAdditional details..."
    }
  ],
  "isError": true
}
```

### Common MCP Errors

**Not in Repository:**
```
Error: Not in a CV-Git repository. Run `cv init` first.
```

**Tool Execution Failed:**
```
Error: Failed to execute cv_find
Search query failed: No vector index available
```

---

## Troubleshooting

### "Not initialized" Errors

```
Error: CV-Git not initialized in /path/to/repo. Run 'cv init' first.
```

**Fix:**
```bash
cd /path/to/repo
cv init
cv sync
```

### "Service unavailable" Errors

**Check service status:**
```bash
cv doctor
```

**Expected output:**
```
CV-Git Doctor

  Git Repository     ✓ Initialized
  CV-Git             ✓ Initialized (.cv/ exists)
  FalkorDB           ✓ Running (localhost:6379)
  Qdrant             ✓ Running (localhost:6333)
  Embedding API      ✓ Configured (openrouter)
```

**Start missing services:**
```bash
# FalkorDB
docker start cv-git-falkordb
# or
docker run -d --name cv-git-falkordb -p 6379:6379 falkordb/falkordb:latest

# Qdrant
docker start cv-git-qdrant
# or
docker run -d --name cv-git-qdrant -p 6333:6333 qdrant/qdrant
```

### Parser Errors

```
[Parser] Tree-sitter unavailable: Cannot find module
[Parser] Falling back to simple regex-based parsing
```

This is a warning, not an error. CV-Git will use regex-based parsing which works but extracts less detail.

**To enable tree-sitter:**
```bash
pnpm install  # Ensure optional dependencies are installed
```

### Sync Failures

**Partial sync failure:**
```
✗ Sync failed
Error: Failed to process file: src/complex.ts
```

Check the sync report for details:
```bash
cat .cv/sync-report.json
```

**Report structure:**
```json
{
  "success": false,
  "stats": {
    "filesProcessed": 45,
    "filesFailed": 1
  },
  "errors": [
    {
      "file": "src/complex.ts",
      "error": "Parse error: Unexpected token",
      "phase": "parse",
      "timestamp": 1705678901234
    }
  ]
}
```

### Credential Issues

**Check stored credentials:**
```bash
cv auth status
```

**Re-authenticate:**
```bash
cv auth setup <provider>  # github, gitlab, openrouter, etc.
```

**Clear and reconfigure:**
```bash
cv auth logout <provider>
cv auth setup <provider>
```

---

## Environment Variables

### Debug and Logging

| Variable | Description | Values |
|----------|-------------|--------|
| `CV_DEBUG` | Enable debug mode | `1`, `true` |
| `CV_LOG_LEVEL` | Minimum log level | `error`, `warn`, `info`, `debug` |
| `CV_LOG_JSON` | JSON log format | `1`, `true` |

### Service Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `FALKORDB_URL` | FalkorDB connection URL | `redis://localhost:6379` |
| `QDRANT_URL` | Qdrant connection URL | `http://localhost:6333` |
| `OLLAMA_HOST` | Ollama API host | `http://localhost:11434` |

### Example Debug Session

```bash
# Enable debug output
export CV_DEBUG=1
export CV_LOG_LEVEL=debug

# Run command with full output
cv sync

# Or inline
CV_DEBUG=1 cv sync
```

---

## Graceful Degradation

CV-Git is designed to work with reduced functionality when services are unavailable:

| Service | When Unavailable |
|---------|-----------------|
| FalkorDB | **Required for sync** - Most write commands will fail, but read commands may use cached data |
| Qdrant | Falls back to local `.cv/vectors/` cache for semantic search |
| Ollama/OpenAI | Cannot generate new embeddings, but cached embeddings still searchable |
| Tree-sitter | Falls back to regex parsing (less accurate) |
| Docker | Cannot auto-start services, must start manually |

### Local Vector Cache Fallback

When Qdrant is unavailable, CV-Git automatically falls back to searching the local vector cache stored in `.cv/vectors/code_chunks.jsonl`. This enables:

- **Semantic search** using pre-computed embeddings
- **MCP tools** (`cv_find`, `cv_context`) continue working
- **Offline operation** after initial sync

The fallback is transparent - you'll see a notice like:
```
(Using local cache - Qdrant unavailable)
```

**Requirements for local fallback:**
1. Run `cv sync` at least once while Qdrant is available to populate the cache
2. Have API keys configured for query embedding generation

**Performance note:** Local search is slower than Qdrant (brute-force vs. HNSW index) but functional for most use cases.

### Checking Available Features

```bash
cv doctor --json
```

```json
{
  "services": {
    "falkordb": { "status": "running", "url": "redis://localhost:6379" },
    "qdrant": { "status": "not_running" },
    "ollama": { "status": "running", "models": ["nomic-embed-text"] }
  },
  "features": {
    "graphQueries": true,
    "semanticSearch": false,
    "codeCompletion": true
  }
}
```

---

## Reporting Bugs

When reporting errors, please include:

1. **Command that failed:**
   ```bash
   cv sync --verbose
   ```

2. **Full error output** (with `CV_DEBUG=1`)

3. **Doctor output:**
   ```bash
   cv doctor
   ```

4. **Sync report** (if applicable):
   ```bash
   cat .cv/sync-report.json
   ```

5. **Environment info:**
   ```bash
   cv --version
   node --version
   docker --version
   ```

File issues at: https://github.com/controlVector/cv-git/issues
