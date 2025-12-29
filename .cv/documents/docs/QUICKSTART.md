# CV-Git Quickstart Guide

Get up and running with CV-Git in 5 minutes.

## Prerequisites

- Node.js 18+
- pnpm 8+
- Docker
- Git

## Step 1: Install CV-Git

```bash
# Clone and build
git clone https://github.com/controlVector/cv-git.git
cd cv-git
pnpm install
pnpm build

# Make cv command available globally
pnpm link --global --dir packages/cli

# Verify installation
cv --version
```

If `cv` command is not found, add pnpm's global bin to your PATH:
```bash
export PATH="$(pnpm bin -g):$PATH"
```

## Step 2: Start Services

```bash
# Start FalkorDB (knowledge graph database)
docker run -d --name falkordb -p 6379:6379 falkordb/falkordb

# Start Qdrant (vector search database)
docker run -d --name qdrant -p 6333:6333 qdrant/qdrant
```

## Step 3: Configure API Keys

CV-Git uses AI for code understanding and semantic search.

```bash
# Set environment variables
export ANTHROPIC_API_KEY=sk-ant-your-key
export OPENAI_API_KEY=sk-your-key
```

Or create a `.env` file in your project:
```
ANTHROPIC_API_KEY=sk-ant-your-key
OPENAI_API_KEY=sk-your-key
```

## Step 4: Initialize Your Project

```bash
cd /path/to/your/project

# Initialize CV-Git
cv init

# Sync your codebase (builds knowledge graph)
cv sync
```

## Step 5: Start Using CV-Git

### Check Status
```bash
cv status
cv doctor  # Run diagnostics
```

### Search Code
```bash
cv find "authentication logic"
cv find "database connection" --language python
```

### Understand Code
```bash
cv explain "handleLogin"
cv explain "how does error handling work"
```

### Query Code Relationships
```bash
cv graph stats              # View statistics
cv graph calls myFunction   # What does myFunction call?
cv graph called-by myFunc   # What calls myFunc?
```

### Advanced Analysis
```bash
cv graph path --from main --to processPayment  # Execution paths
cv graph dead-code          # Find unused code
cv graph complexity         # Find complex functions
cv graph cycles             # Circular dependencies
cv graph hotspots           # Most-called functions
```

### AI Code Review
```bash
cv review --staged          # Review staged changes
cv review HEAD              # Review last commit
```

### Generate Code
```bash
cv do "add input validation to user registration"
cv do "refactor to use async/await" --plan-only  # Preview only
```

## Troubleshooting

### Services Not Running
```bash
# Check Docker containers
docker ps

# Restart services
docker start falkordb qdrant
```

### Command Not Found
```bash
# Add to PATH
export PATH="$(pnpm bin -g):$PATH"

# Or run directly
node /path/to/cv-git/packages/cli/dist/index.js --help
```

### Run Diagnostics
```bash
cv doctor
cv doctor --json  # JSON output
```

## Next Steps

- Read [README.md](../README.md) for full feature list
- See [COMMANDS.md](../COMMANDS.md) for all available commands
- Configure [MCP Server](../packages/mcp-server/README.md) for Claude Desktop
- Check [ARCHITECTURE.md](../ARCHITECTURE.md) for technical details

## Getting Help

- Issues: https://github.com/controlVector/cv-git/issues
- Run `cv --help` for command reference
