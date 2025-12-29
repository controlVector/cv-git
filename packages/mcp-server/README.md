# CV-Git MCP Server

Model Context Protocol (MCP) server for CV-Git, enabling AI assistants like Claude to interact with your codebase knowledge graph.

## What is MCP?

[Model Context Protocol](https://modelcontextprotocol.io/) is Anthropic's open protocol for connecting AI assistants to external tools and data sources. This MCP server exposes CV-Git's powerful code analysis capabilities as tools that Claude and other AI assistants can use.

## Available Tools (23 total)

### Code Understanding (5 tools)

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

### Advanced Code Analysis (5 tools)

**cv_graph_path** - Find execution paths
- Find all execution paths between two functions
- Understand how functions are connected in the call graph
- Set maximum depth to control search scope
- Example: "Find all paths from `main` to `processPayment`"

**cv_graph_dead_code** - Detect unreachable code
- Identify functions with no callers (potential dead code)
- Helps find code that may be safe to remove
- Note: Some functions may be called dynamically or from external code
- Useful for cleanup and reducing codebase size

**cv_graph_complexity** - Find complex functions
- Find functions with high cyclomatic complexity
- Set threshold (default: 10) to control sensitivity
- Identify functions that may need refactoring
- Complexity > 10 often indicates need for simplification

**cv_graph_cycles** - Detect circular dependencies
- Find circular call chains in the codebase
- Identify potential architectural issues
- Set maximum depth to control search scope
- Warning: Circular dependencies make code harder to maintain

**cv_graph_hotspots** - Find most-called functions
- Identify the most frequently called functions
- Find optimization targets
- Set limit to control number of results
- Hot spots may benefit from performance optimization

### Code Modification (3 tools)

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

### Platform Integration (4 tools)

**cv_pr_create** - Create pull requests
- Create PRs on GitHub with title and description
- Supports draft PRs
- Requires GitHub CLI (gh)

**cv_pr_list** - List pull requests
- List open, closed, or all PRs
- Filter and limit results
- Requires GitHub CLI (gh)

**cv_pr_review** - Review pull request
- Get PR details and diff summary
- View author, state, and changes
- Requires GitHub CLI (gh)

**cv_release_create** - Create releases
- Create GitHub releases with version tags
- Auto-generate or provide custom release notes
- Support for draft and pre-releases
- Requires GitHub CLI (gh)

### Documentation Knowledge Graph (3 tools)

**cv_docs_search** - Search documentation
- Semantic search across all documentation (including archived)
- Find design docs, historical decisions, project documentation
- Filter by document type or archived status
- Example: "Find all design decisions about authentication"

**cv_docs_ingest** - Ingest documentation
- Add markdown documents to the knowledge graph
- Creates document nodes, relationships, and embeddings
- Supports optional archiving (store in .cv/ without cluttering repo)
- Auto-extracts frontmatter, headings, and links

**cv_docs_list** - List documents
- View all documents in the knowledge graph
- Filter by type (design_spec, readme, guide, etc.)
- See archived vs active status

### System Operations (3 tools)

**cv_config_get** - Get configuration values
- Retrieve CV-Git configuration
- Supports nested keys with dot notation (e.g., "ai.model")
- Returns JSON for complex values

**cv_status** - Repository status
- View git status and CV-Git initialization
- Check service health (FalkorDB, Qdrant)
- See repository information

**cv_doctor** - Run diagnostics
- Check all CV-Git dependencies
- Verify git, Node.js, services
- Get troubleshooting suggestions

## Installation

### 1. Build the MCP Server

```bash
# From the CV-Git root directory
pnpm install
pnpm build
```

### 2. Configure Claude Code (CLI)

For Claude Code (CLI), create a `.mcp.json` file in your project root:

```json
{
  "mcpServers": {
    "cv-git": {
      "command": "node",
      "args": [
        "/absolute/path/to/cv-git/packages/mcp-server/dist/index.js"
      ],
      "env": {
        "ANTHROPIC_API_KEY": "${ANTHROPIC_API_KEY}",
        "OPENAI_API_KEY": "${OPENAI_API_KEY}",
        "OPENROUTER_API_KEY": "${OPENROUTER_API_KEY}"
      }
    }
  }
}
```

Then restart Claude Code to load the MCP server.

### 3. Configure Claude Desktop (optional)

For Claude Desktop, add the MCP server to your configuration:

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

### 4. Restart Claude

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

**Advanced analysis:**
> "Find all execution paths from main() to processPayment()"
> "Detect any dead code in the codebase"
> "Find all functions with complexity greater than 15"
> "Check for circular dependencies"
> "Show me the top 10 most-called functions"

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
