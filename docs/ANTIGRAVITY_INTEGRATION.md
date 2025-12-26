# Google Anti-Gravity IDE Integration

Google Anti-Gravity is an agentic development platform built on VS Code, powered by Gemini 3 Pro. It has native support for the Model Context Protocol (MCP), making cv-git integration straightforward.

## Overview

cv-git provides a comprehensive MCP server that exposes 24 tools for code understanding, graph queries, code modification, and PRD traceability. Anti-Gravity's AI agents can use these tools to gain deep codebase understanding.

## Configuration

### Option 1: Local Installation

Add to Anti-Gravity's MCP configuration (typically in settings or `mcp.json`):

```json
{
  "mcpServers": {
    "cv-git": {
      "command": "node",
      "args": ["/path/to/cv-git/packages/mcp-server/dist/index.js"],
      "env": {}
    }
  }
}
```

### Option 2: NPM Package (Once Published)

```json
{
  "mcpServers": {
    "cv-git": {
      "command": "npx",
      "args": ["@controlvector/cv-git-mcp"]
    }
  }
}
```

### Option 3: Global CLI

If cv-git is installed globally:

```json
{
  "mcpServers": {
    "cv-git": {
      "command": "cv",
      "args": ["mcp", "serve"]
    }
  }
}
```

## Available MCP Tools

### Code Understanding

| Tool | Description |
|------|-------------|
| `cv_find` | Semantic search for code using natural language |
| `cv_context` | Generate rich context about codebase for AI assistants |
| `cv_explain` | AI-powered explanation of code, symbols, or concepts |

### Knowledge Graph Queries

| Tool | Description |
|------|-------------|
| `cv_graph_query` | Query relationships (calls, imports, exports) |
| `cv_graph_stats` | Get graph statistics (files, symbols, relationships) |
| `cv_graph_inspect` | Inspect detailed info about a symbol or file |
| `cv_graph_path` | Find execution paths between functions |
| `cv_graph_dead_code` | Find potentially unused functions |
| `cv_graph_complexity` | Find high-complexity functions |
| `cv_graph_cycles` | Detect circular dependencies |
| `cv_graph_hotspots` | Find most-called functions |

### Code Modification

| Tool | Description |
|------|-------------|
| `cv_do` | Execute tasks with AI assistance |
| `cv_review` | AI-powered code review |
| `cv_sync` | Synchronize knowledge graph with repository |

### Platform Integration

| Tool | Description |
|------|-------------|
| `cv_pr_create` | Create pull requests on GitHub |
| `cv_pr_list` | List pull requests |
| `cv_pr_review` | Get PR details and review info |
| `cv_release_create` | Create GitHub releases |

### PRD Integration

| Tool | Description |
|------|-------------|
| `cv_prd_context` | Get unified PRD context (requirements, tests, docs) |
| `cv_requirement_trace` | Full traceability for a requirement |
| `cv_test_coverage` | Test coverage metrics for a PRD |
| `cv_doc_coverage` | Documentation coverage metrics |

### System Operations

| Tool | Description |
|------|-------------|
| `cv_config_get` | Get configuration values |
| `cv_status` | Get CV-Git repository status |
| `cv_doctor` | Run diagnostic checks |

## Example Workflows

### Understanding Code Before Changes

```
User: "I need to modify the authentication flow"

Anti-Gravity AI uses:
1. cv_context { query: "authentication flow" }
   → Gets relevant code, relationships, and file contents

2. cv_graph_query { queryType: "calls", target: "AuthService" }
   → Understands what AuthService calls

3. cv_graph_query { queryType: "called-by", target: "AuthService" }
   → Understands what depends on AuthService
```

### Finding Code Issues

```
User: "Find potential problems in the codebase"

Anti-Gravity AI uses:
1. cv_graph_cycles {}
   → Detects circular dependencies

2. cv_graph_dead_code {}
   → Finds unused functions

3. cv_graph_complexity { threshold: 15 }
   → Finds overly complex functions
```

### Reviewing Changes

```
User: "Review my staged changes"

Anti-Gravity AI uses:
1. cv_review { staged: true, context: true }
   → Gets AI-powered review with codebase context
```

### Tracing Requirements

```
User: "What code implements requirement REQ-123?"

Anti-Gravity AI uses:
1. cv_requirement_trace { chunkId: "REQ-123" }
   → Gets full traceability: tests, docs, code implementations
```

## Prerequisites

Before using cv-git with Anti-Gravity:

1. **Initialize cv-git in your repository**:
   ```bash
   cv init
   ```

2. **Run initial sync**:
   ```bash
   cv sync
   ```

3. **Ensure infrastructure is running** (FalkorDB, optionally Qdrant):
   ```bash
   cv doctor
   ```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Google Anti-Gravity                       │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │                    Gemini 3 Pro                          │ │
│  │              (AI Agent / Mission Control)                │ │
│  └─────────────────────┬───────────────────────────────────┘ │
│                        │ MCP Protocol                        │
│  ┌─────────────────────▼───────────────────────────────────┐ │
│  │                  MCP Server Manager                      │ │
│  └─────────────────────┬───────────────────────────────────┘ │
└────────────────────────┼────────────────────────────────────┘
                         │ stdio
┌────────────────────────▼────────────────────────────────────┐
│                    cv-git MCP Server                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐     │
│  │  Search  │  │  Graph   │  │  Modify  │  │   PRD    │     │
│  │  Tools   │  │  Tools   │  │  Tools   │  │  Tools   │     │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘     │
└───────┼─────────────┼─────────────┼─────────────┼───────────┘
        │             │             │             │
┌───────▼─────────────▼─────────────▼─────────────▼───────────┐
│                      cv-git Core                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐          │
│  │  FalkorDB   │  │   Qdrant    │  │  .cv/ Store │          │
│  │   (Graph)   │  │  (Vectors)  │  │  (Portable) │          │
│  └─────────────┘  └─────────────┘  └─────────────┘          │
└─────────────────────────────────────────────────────────────┘
```

## Troubleshooting

### MCP Server Not Connecting

1. Check the server runs manually:
   ```bash
   node packages/mcp-server/dist/index.js
   ```

2. Verify cv-git is initialized:
   ```bash
   cv status
   ```

3. Run diagnostics:
   ```bash
   cv doctor
   ```

### Tools Returning Errors

1. Ensure sync has been run:
   ```bash
   cv sync
   ```

2. Check graph database is running:
   ```bash
   docker ps | grep falkordb
   ```

3. For vector search issues, ensure embedding API key is configured:
   ```bash
   cv auth setup openrouter
   ```

## References

- [Google Anti-Gravity Documentation](https://antigravity.google/docs)
- [Model Context Protocol Specification](https://modelcontextprotocol.io)
- [cv-git MCP Server Source](../packages/mcp-server/)
