# Troubleshooting Guide

## Common Issues

### Installation Issues

#### `cv` command not found
```bash
# Check if pnpm global bin is in PATH
pnpm bin -g

# Add to PATH
export PATH="$(pnpm bin -g):$PATH"

# Make permanent (add to ~/.bashrc or ~/.zshrc)
echo 'export PATH="$(pnpm bin -g):$PATH"' >> ~/.bashrc
source ~/.bashrc
```

#### Build fails with TypeScript errors
```bash
# Clean and rebuild
pnpm clean
pnpm install
pnpm build
```

#### Missing tree-sitter native modules
```bash
# Approve native builds
pnpm approve-builds
pnpm install
```

### Service Issues

#### FalkorDB connection failed
```bash
# Check if running
docker ps | grep falkordb

# Start if not running
docker start falkordb

# Or create new container
docker run -d --name falkordb -p 6379:6379 falkordb/falkordb
```

#### Qdrant connection failed
```bash
# Check if running
docker ps | grep qdrant

# Start if not running
docker start qdrant

# Or create new container
docker run -d --name qdrant -p 6333:6333 qdrant/qdrant
```

#### Port already in use
```bash
# Find what's using port 6379
lsof -i :6379

# Use different port
docker run -d --name falkordb -p 6380:6379 falkordb/falkordb
```

### API Key Issues

#### "API key not found" error
```bash
# Set environment variables
export ANTHROPIC_API_KEY=sk-ant-...
export OPENAI_API_KEY=sk-...

# Or use .env file in project root
echo "ANTHROPIC_API_KEY=sk-ant-..." >> .env
echo "OPENAI_API_KEY=sk-..." >> .env
```

#### Credential storage errors
```bash
# Check credential status
cv doctor

# Credentials are stored in:
# - OS keychain (macOS/Windows/Linux with libsecret)
# - ~/.cv-git/credentials.json (fallback, chmod 600)
```

### Sync Issues

#### "Not in a CV-Git repository"
```bash
# Initialize CV-Git first
cv init
cv sync
```

#### Sync takes too long
- Large repositories take longer on first sync
- Subsequent syncs are incremental and faster
- Try excluding directories: `cv sync --exclude "test/**"`

#### Parse errors for specific files
- Check the file is valid syntax
- Some languages require native tree-sitter builds
- Python and TypeScript are fully supported

### Search Issues

#### Vector search returns no results
```bash
# Check if Qdrant is running
cv doctor

# Check if embeddings exist
cv graph stats
```

#### Graph queries return empty
```bash
# Ensure sync completed
cv sync

# Check graph statistics
cv graph stats
```

### MCP Server Issues

#### Tools not appearing in Claude Desktop
1. Verify config path is absolute in `claude_desktop_config.json`
2. Restart Claude Desktop
3. Check logs: Help → Developer → Show Logs

#### "Cannot find module" errors
```bash
# Rebuild MCP server
pnpm --filter @cv-git/mcp-server build
```

## Diagnostic Commands

### Full System Check
```bash
cv doctor
cv doctor --json  # Machine-readable output
```

### Check Configuration
```bash
cv config list
cv config path
```

### Check Service Status
```bash
cv status
cv status --json
```

### View Sync State
```bash
cat .cv/sync_state.json
```

## Getting Help

### Collect Debug Info
```bash
# Run diagnostics
cv doctor --json > doctor-output.json

# Check versions
node --version
pnpm --version
docker --version
```

### Report Issues
Include in bug reports:
1. Output of `cv doctor --json`
2. Node.js version
3. Operating system
4. Steps to reproduce
5. Error messages

File issues at: https://github.com/controlVector/cv-git/issues
