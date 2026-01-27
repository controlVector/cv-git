# CV-Git Claude Code Integration Guide

This guide explains how to configure and use CV-Git's traversal-aware context system with Claude Code.

## Quick Setup

### 1. Configure MCP Server

Create or update `.mcp.json` in your project root:

```json
{
  "mcpServers": {
    "cv-git": {
      "command": "node",
      "args": ["/path/to/cv-git/packages/mcp-server/dist/index.js"],
      "env": {
        "ANTHROPIC_API_KEY": "${ANTHROPIC_API_KEY}",
        "OPENAI_API_KEY": "${OPENAI_API_KEY}",
        "OPENROUTER_API_KEY": "${OPENROUTER_API_KEY}"
      }
    }
  }
}
```

### 2. Initialize Your Repository

```bash
cd your-project
cv init
cv sync
```

### 3. Restart Claude Code

After configuration, restart Claude Code to load the MCP server.

---

## Using cv_traverse_context

The `cv_traverse_context` tool provides intelligent, position-aware context as you navigate your codebase.

### Basic Navigation

```
# Jump directly to a file
cv_traverse_context(file="src/auth/login.ts", direction="jump")

# Drill into a specific function
cv_traverse_context(symbol="validateUser", direction="in", sessionId="...")

# Zoom out to see the module
cv_traverse_context(direction="out", sessionId="...")

# Move to a sibling file
cv_traverse_context(direction="lateral", sessionId="...")
```

### Navigation Directions

| Direction | Action |
|-----------|--------|
| `jump` | Go directly to a target (file, symbol, or module) |
| `in` | Drill down: repo → module → file → symbol |
| `out` | Zoom out: symbol → file → module → repo |
| `lateral` | Move to sibling at same level |
| `stay` | Refresh context at current position |

### Session State

The tool maintains session state automatically. After the first call, include the `sessionId` in subsequent calls to maintain navigation context:

```
# First call - creates session
result = cv_traverse_context(file="src/api/routes.ts", direction="jump")
# sessionId returned: "abc123"

# Subsequent calls - use session
cv_traverse_context(symbol="handleRequest", direction="in", sessionId="abc123")
cv_traverse_context(direction="out", sessionId="abc123")
```

### Output Formats

```
# XML (default, optimized for Claude)
cv_traverse_context(file="src/index.ts", format="xml")

# Markdown (human-readable)
cv_traverse_context(file="src/index.ts", format="markdown")

# JSON (for programmatic use)
cv_traverse_context(file="src/index.ts", format="json")
```

---

## Recommended Workflow

### Initial Context Gathering

When starting work on a new task:

1. **Get overview** - Start at repo level
   ```
   cv_traverse_context(direction="jump")
   ```

2. **Navigate to relevant module**
   ```
   cv_traverse_context(module="src/auth", direction="jump")
   ```

3. **Drill into specific files**
   ```
   cv_traverse_context(file="src/auth/session.ts", direction="in")
   ```

4. **Focus on target functions**
   ```
   cv_traverse_context(symbol="createSession", direction="in", includeCallers=true, includeCallees=true)
   ```

### Understanding Call Flow

When tracing how code is connected:

```
# Start at the entry point
cv_traverse_context(symbol="handleLogin", direction="jump", includeCallees=true)

# Follow the call chain
cv_traverse_context(symbol="validateCredentials", direction="in", includeCallees=true)

# Check what calls this function
cv_traverse_context(includeCallers=true, direction="stay")
```

### Exploring Unknown Code

When you don't know where to start:

```
# Get repo overview first
cv_traverse_context(direction="jump")

# Navigate to interesting modules from hints
cv_traverse_context(module="src/services", direction="in")

# Drill into files
cv_traverse_context(direction="in")

# Explore symbols
cv_traverse_context(direction="in")

# Use lateral to explore siblings
cv_traverse_context(direction="lateral")
```

---

## Combining with Other Tools

### cv_traverse_context + cv_find

Use `cv_find` for semantic search, then `cv_traverse_context` for deeper exploration:

```
# Search for authentication code
cv_find("user authentication validation")
# Returns: src/auth/validate.ts:checkCredentials

# Navigate to that symbol with full context
cv_traverse_context(symbol="checkCredentials", file="src/auth/validate.ts", direction="jump", includeCallers=true)
```

### cv_traverse_context + cv_auto_context

- Use `cv_auto_context` for initial broad context about a topic
- Use `cv_traverse_context` for focused, navigational exploration

```
# Get broad context about authentication
cv_auto_context(query="authentication flow")

# Then navigate to specific areas
cv_traverse_context(file="src/auth/oauth.ts", direction="jump")
```

### cv_traverse_context + cv_graph_impact

For understanding change impact:

```
# Navigate to the function you want to modify
cv_traverse_context(symbol="updateUser", direction="jump")

# Analyze impact before making changes
cv_graph_impact(symbol="updateUser")
```

---

## Token Budget Control

Control context size with the `budget` parameter:

```
# Minimal context (quick overview)
cv_traverse_context(file="src/index.ts", budget=1000)

# Default context
cv_traverse_context(file="src/index.ts")  # 4000 tokens

# Extended context (detailed analysis)
cv_traverse_context(file="src/index.ts", budget=8000)
```

---

## Best Practices

### 1. Start Broad, Then Narrow

Begin at repo or module level, then drill down. This gives you context before focusing on details.

### 2. Use Sessions for Related Queries

Keep the same `sessionId` when exploring related code. This maintains history and enables back-navigation.

### 3. Leverage Navigation Hints

The tool returns hints suggesting next actions. Use these to discover relevant code paths.

### 4. Include Relationships When Needed

Use `includeCallers=true` and `includeCallees=true` when understanding call flow is important.

### 5. Match Budget to Task

- Quick lookups: `budget=1000`
- Normal exploration: `budget=4000` (default)
- Deep analysis: `budget=8000`

---

## Troubleshooting

### "Not in a CV-Git repository"

Run `cv init` and `cv sync` in your project directory.

### "FalkorDB unavailable"

Start the graph database:
```bash
docker run -d -p 6379:6379 falkordb/falkordb
```

### "Qdrant unavailable"

Start the vector database:
```bash
docker run -d -p 6333:6333 qdrant/qdrant
```

### Session not found

Sessions expire after 30 minutes of inactivity. Start a new session by omitting `sessionId`.

### Empty context returned

The codebase may not be synced. Run `cv sync` to update the knowledge graph.

---

## Example Prompts for Claude Code

When working with Claude Code, you can use natural language:

- "Show me the context for the authentication module"
- "Navigate to the validateToken function"
- "Zoom out to see what else is in this directory"
- "What functions call this one?"
- "Show me the file overview"
- "Move to the next file in this folder"

Claude Code will translate these into appropriate `cv_traverse_context` calls.
