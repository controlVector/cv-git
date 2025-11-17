# CV-Git MCP Server

Model Context Protocol (MCP) server for CV-Git, enabling AI assistants like Claude to interact with your codebase knowledge graph.

## What is MCP?

[Model Context Protocol](https://modelcontextprotocol.io/) is Anthropic's open protocol for connecting AI assistants to external tools and data sources. This MCP server exposes CV-Git's powerful code analysis capabilities as tools that Claude and other AI assistants can use.

## Available Tools

### Code Understanding

**cv_find** - Semantic code search
- Search your codebase using natural language queries
- Uses vector embeddings for intelligent matching
- Returns relevant code chunks with context

**cv_explain** - AI-powered code explanation
- Get detailed explanations of functions, classes, or concepts
- Includes context from knowledge graph
- Shows dependencies and relationships

**cv_graph_query** - Query the knowledge graph
- Query types: `calls`, `called-by`, `imports`, `exports`, `functions`, `classes`, `files`
- Explore code relationships and dependencies
- Filter by language or file

**cv_graph_stats** - Knowledge graph statistics
- View counts of files, symbols, commits, modules
- See total relationships tracked
- Understand your codebase size

**cv_graph_inspect** - Inspect symbols and files
- Deep dive into specific symbols or files
- See all relationships and dependencies
- View callers and callees

### Code Modification

**cv_do** - AI-powered task execution
- Generate execution plans for coding tasks
- Create code changes with AI assistance
- Supports `planOnly` mode for review

**cv_review** - AI code review
- Review staged changes or commits
- Get feedback on potential bugs, security, performance
- Includes suggestions for improvement

**cv_sync** - Synchronize knowledge graph
- Update the knowledge graph with latest code changes
- Supports incremental and full sync modes
- Maintains vector embeddings

## Installation

### 1. Build the MCP Server

```bash
# From the CV-Git root directory
pnpm install
pnpm build
```

### 2. Configure Claude Desktop

Add the MCP server to your Claude Desktop configuration:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`

**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "cv-git": {
      "command": "node",
      "args": [
        "/absolute/path/to/cv-git/packages/mcp-server/dist/index.js"
      ],
      "env": {
        "ANTHROPIC_API_KEY": "your-anthropic-api-key",
        "OPENAI_API_KEY": "your-openai-api-key"
      }
    }
  }
}
```

### 3. Restart Claude Desktop

After updating the configuration, restart Claude Desktop to load the MCP server.

## Usage

### Initialize Your Repository

Before using the MCP server, initialize and sync your repository:

```bash
cd your-project
cv init
cv sync
```

### Using with Claude Desktop

Once configured, Claude can automatically use CV-Git tools. Examples:

**Search for code:**
> "Find all authentication-related functions in the codebase"

**Explain code:**
> "Explain how the user authentication flow works"

**Query relationships:**
> "Show me all functions that call the `handleLogin` function"

**Review changes:**
> "Review my staged changes and provide feedback"

**Generate code:**
> "Create a new API endpoint for user profile updates"

## Requirements

- **Node.js** 18+ (for MCP server)
- **FalkorDB** (Redis with graph support) - for knowledge graph
- **Qdrant** (optional) - for semantic search
- **Anthropic API key** - for AI-powered features
- **OpenAI API key** (optional) - for vector embeddings

## Environment Variables

- `ANTHROPIC_API_KEY` - Required for AI features (explain, do, review)
- `OPENAI_API_KEY` - Optional, for semantic search with cv_find

## Troubleshooting

### Server won't start

1. Check that the MCP server is built: `pnpm --filter @cv-git/mcp-server build`
2. Verify the path in `claude_desktop_config.json` is absolute and correct
3. Check Claude Desktop logs: **Help → Developer → Show Logs**

### Tools not appearing in Claude

1. Restart Claude Desktop after configuration changes
2. Verify the config file is valid JSON
3. Check that FalkorDB is running: `docker ps`

### "Not in a CV-Git repository" errors

Run `cv init` and `cv sync` in your project directory first.

### API key errors

Ensure your API keys are set in the MCP server environment configuration.

## Architecture

```
┌─────────────────┐
│  Claude Desktop │
└────────┬────────┘
         │ MCP Protocol (stdio)
         │
┌────────▼────────┐
│   MCP Server    │
│  (Node.js)      │
└────────┬────────┘
         │
         ├──────────────┐
         │              │
    ┌────▼────┐    ┌───▼────┐
    │ FalkorDB│    │ Qdrant │
    │ (Graph) │    │(Vector)│
    └─────────┘    └────────┘
```

## Development

### Adding New Tools

1. Define types in `src/types.ts`
2. Create handler in `src/tools/`
3. Register tool in `src/index.ts`
4. Add formatter in `src/utils.ts` (if needed)

### Testing

```bash
# Build the server
pnpm --filter @cv-git/mcp-server build

# Test with a simple repository
cd test-repo
cv init
cv sync

# Configure in Claude Desktop and test
```

## License

MIT - See LICENSE file in repository root
