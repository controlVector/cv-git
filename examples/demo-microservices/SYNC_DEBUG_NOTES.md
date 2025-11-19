# CV-Git Sync Debug Session - 2025-11-19

## Issues Encountered and Fixed

### 1. ✅ FIXED: Sync Command "Cannot read properties of undefined (reading 'length')" Error

**Root Cause:** Tree-sitter language parsers (Go, Rust, Java) require native module builds that weren't executed.

**Solution:** 
- Temporarily disabled Go, Rust, and Java parsers
- Modified `packages/core/src/parser/index.ts` to skip native parsers
- TypeScript and Python parsers work (pure JS implementations)

**To Re-enable:**
```bash
# Rebuild native modules
pnpm rebuild tree-sitter-go tree-sitter-java tree-sitter-rust
```

### 2. ✅ FIXED: Port Conflicts with FalkorDB

**Root Cause:** Port 6379 (Redis default) already in use by local Redis instance.

**Solution:** Created intelligent port detection system

**Files Created:**
- `docker-compose.yml` - Service definitions with environment variable ports
- `.env.example` - Port configuration template
- `scripts/setup-services.sh` - Auto-detects available ports and starts services

**Usage:**
```bash
./scripts/setup-services.sh
```

**Features:**
- Automatically finds available ports starting from defaults (6379, 6333, 6334)
- Updates .env file with detected ports
- Starts Docker services
- Updates CV-Git config
- Works across different environments

### 3. ⚠️ PARTIALLY FIXED: Graph Data Storage

**Status:** Data is being stored (51 nodes created) but properties aren't displaying correctly.

**Evidence:**
```bash
# Direct query shows nodes exist
docker exec cv-git-falkordb redis-cli GRAPH.QUERY cv-git "MATCH (n) RETURN count(n)"
# Returns: 51 nodes

# Node types detected:
- 2 Files
- 35 Functions
- 7 Constants
- 4 Variables
- 2 Classes
- 1 Interface
```

**Issue:** File properties (path, language, LOC) are blank in CLI output

**Needs Investigation:** Property setting/retrieval in GraphManager

## Current System Status

### Services Running
- FalkorDB: `localhost:6380` ✅
- Qdrant: `localhost:6333` ✅ (not tested yet)

### Parsers Working
- ✅ TypeScript (.ts, .tsx, .js, .jsx)
- ✅ Python (.py, .pyw, .pyi)
- ⏸️  Go (.go) - disabled, needs native build
- ⏸️  Rust (.rs) - disabled, needs native build
- ⏸️  Java (.java) - disabled, needs native build

### Example Project
- Location: `examples/demo-microservices/`
- Files: 5 source files (TypeScript, Python, Go, Rust, Java)
- Currently syncing: 2 files (TypeScript + Python)
- Graph nodes created: 51
- Sync time: 0.233s

## Next Steps

### High Priority
1. Fix property storage/retrieval bug in GraphManager
2. Build native tree-sitter modules for Go, Rust, Java
3. Remove debug console.log statements from parser

### Medium Priority
4. Test all graph query commands (calls, called-by, etc.)
5. Test semantic search (requires OpenAI API key)
6. Test MCP server integration

### Documentation
7. Update README with docker-compose setup instructions
8. Document port configuration options
9. Add troubleshooting guide

## Verification Commands

```bash
# Check services
docker ps | grep cv-git

# Check graph data
docker exec cv-git-falkordb redis-cli GRAPH.QUERY cv-git "MATCH (n) RETURN labels(n), count(n)"

# Test sync
cd examples/demo-microservices && cv sync

# Test graph queries
cv graph stats
cv graph files
cv graph symbols
```

## Files Modified

### Core Packages
- `packages/core/src/parser/index.ts` - Disabled native parsers temporarily
- `packages/cli/src/utils/output.ts` - Fixed ES module import

### Configuration
- `docker-compose.yml` - NEW: Service definitions
- `.env` - UPDATED: Added port configurations
- `.env.example` - NEW: Port configuration template
- `scripts/setup-services.sh` - NEW: Intelligent service setup

### Examples
- `examples/demo-microservices/` - NEW: Multi-language example project
  - TypeScript API Gateway
  - Python Data Processor  
  - Go Auth Service
  - Rust Compute Engine
  - Java Legacy Integration

## Key Learnings

1. **Tree-sitter native modules** require build steps - can't use them in CI/CD without proper build configuration
2. **Port conflicts** are common in development - automatic detection is essential for smooth onboarding
3. **Docker Compose** with environment variables provides flexibility across environments
4. **Direct FalkorDB queries** are useful for debugging when CLI commands fail
