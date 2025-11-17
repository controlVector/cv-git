# CV-Git Roadmap to Production

**Current Version:** 0.2.0
**Target Version:** 1.0.0 (Production Ready)
**Timeline:** 4 weeks
**Focus:** CLI Excellence + MCP Integration + cvPRD Connectivity

---

## Vision

Build a production-ready CLI that:
1. **Works flawlessly** for developers (comprehensive, tested, documented)
2. **Empowers AI agents** via MCP (programmatic access to all features)
3. **Integrates with cvPRD** (requirements → code workflow)

---

## Current State ✅

### What's Working
- ✅ All 5 packages built successfully
- ✅ Core features implemented:
  - Credential management (@cv-git/credentials)
  - Platform adapters (@cv-git/platform)
  - Knowledge graph (FalkorDB integration)
  - Vector search (Qdrant integration)
  - AI features (Claude integration)
  - 13 CLI commands
- ✅ Testing infrastructure:
  - 20 integration tests (100% passing)
  - 10 unit tests (100% passing)
  - Test runner and framework
  - Comprehensive documentation

### What's Missing for Production
- ⏳ Configuration management (`cv config`)
- ⏳ Health diagnostics (`cv doctor`)
- ⏳ Consistent error handling
- ⏳ `--json` output for automation
- ⏳ Service dependency checks
- ⏳ Comprehensive CLI documentation

### What's Needed for AI Integration
- ⏳ MCP server for CV-Git
- ⏳ MCP server for cvPRD
- ⏳ Integration package for bidirectional sync

---

## 4-Week Roadmap

### Week 1: CLI Production Polish 🎯

**Goal:** Make CLI production-ready for developers

**Tasks:**

1. **Configuration Management**
   ```bash
   cv config get platform.type
   cv config set ai.model claude-3-5-sonnet
   cv config list
   cv config reset
   cv config edit
   ```
   - File: `packages/cli/src/commands/config.ts`
   - Support project-level + user-level config
   - Environment variable overrides
   - Config validation and migration

2. **Health & Diagnostics**
   ```bash
   cv status              # Show CV-Git status
   cv doctor              # Health check
   ```
   - Check services (FalkorDB, Qdrant)
   - Validate credentials
   - Check for updates
   - Suggest fixes for issues

3. **Output Standardization**
   - Add `--json` flag to all commands
   - Add `--quiet` flag (silent mode)
   - Add `--verbose` flag (debug output)
   - Consistent table formatting
   - Color support with NO_COLOR

4. **Error Handling**
   - Consistent error format
   - Error codes for automation
   - Helpful error messages
   - Stack traces only in debug mode
   - Graceful service failures

**Deliverable:** CV-Git CLI v0.3.0 - Feature Complete

---

### Week 2: MCP Server for CV-Git 🤖

**Goal:** Enable AI agents to use CV-Git programmatically

**Package:** `packages/mcp-server/`

**Architecture:**
```
Claude Desktop/API
       ↓ (MCP Protocol)
CV-Git MCP Server
       ↓
CV-Git Core/CLI
```

**Tools to Expose:**

1. **Code Understanding** (Read Operations)
   - `cv_find` - Semantic code search
   - `cv_explain` - Explain code/concepts
   - `cv_graph_query` - Query knowledge graph
   - `cv_graph_stats` - Get graph statistics
   - `cv_graph_inspect` - Inspect symbol details

2. **Code Modification** (Write Operations)
   - `cv_do` - Execute task (generate/modify code)
   - `cv_review` - Review code changes
   - `cv_sync` - Sync repository

3. **Repository Operations**
   - `cv_pr_create` - Create pull request
   - `cv_pr_list` - List pull requests
   - `cv_release_create` - Create release

4. **Requirements Integration**
   - `cv_link_requirement` - Link code to requirement
   - `cv_get_implementation` - Get implementation status

**Implementation:**
```typescript
// packages/mcp-server/src/index.ts
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const server = new Server({
  name: 'cv-git',
  version: '1.0.0',
}, {
  capabilities: { tools: {} },
});

// Register 10-15 tools
// Handle tool calls
// Format responses for LLM consumption

const transport = new StdioServerTransport();
await server.connect(transport);
```

**Testing:**
- Test with Claude Desktop
- Test each tool individually
- Test error handling
- Test with real repositories

**Documentation:**
- Installation guide
- Claude Desktop configuration
- Tool reference
- Usage examples

**Deliverable:** CV-Git MCP Server v1.0.0

---

### Week 3: cvPRD MCP Server + API 🔗

**Goal:** Enable AI agents to access requirements from cvPRD

**Location:** `/home/jwscho/cvPRD/mcp-server/`

**Tools to Expose:**

1. **Requirements Retrieval**
   - `prd_get_requirement` - Get requirement by ID
   - `prd_search` - Semantic search
   - `prd_get_context` - Full context for requirement

2. **Requirements Analysis**
   - `prd_get_dependencies` - Get dependencies
   - `prd_get_acceptance_criteria` - Get AC
   - `prd_get_technical_specs` - Get specs

3. **Implementation Tracking**
   - `prd_update_status` - Update implementation status
   - `prd_link_code` - Link code to requirement
   - `prd_get_coverage` - Get coverage metrics

**REST API Additions:**
Add endpoints to cvPRD backend for CV-Git integration:

```python
# /home/jwscho/cvPRD/backend/app/api/v1/integration.py

@router.post("/requirements/{req_id}/implementation")
async def update_implementation_status(
    req_id: str,
    status: ImplementationStatus
):
    """Update implementation status from CV-Git"""
    pass

@router.get("/requirements/{req_id}/implementation")
async def get_implementation_status(req_id: str):
    """Get implementation status for a requirement"""
    pass
```

**Database Schema:**
Add to cvPRD PostgreSQL:
```sql
CREATE TABLE requirement_implementations (
  id UUID PRIMARY KEY,
  requirement_id UUID REFERENCES requirements(id),
  cv_git_repo VARCHAR(255),
  files JSONB,           -- Array of file paths
  symbols JSONB,         -- Array of function/class names
  coverage FLOAT,        -- 0.0 to 1.0
  status VARCHAR(50),    -- 'not_started', 'in_progress', 'implemented'
  commit_hash VARCHAR(40),
  last_sync TIMESTAMP,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);
```

**Deliverable:** cvPRD MCP Server v1.0.0 + Integration API

---

### Week 4: Integration Package + Testing 🔄

**Goal:** Bidirectional sync between CV-Git and cvPRD

**Package:** `packages/prd-integration/`

**Structure:**
```
packages/prd-integration/
├── src/
│   ├── index.ts
│   ├── client.ts          # cvPRD REST client
│   ├── sync.ts            # Bidirectional sync
│   ├── mapping.ts         # Requirement → Code mapping
│   ├── coverage.ts        # Coverage calculation
│   └── types.ts
└── README.md
```

**Features:**

1. **Requirement Linking**
   ```typescript
   await integration.linkRequirement('req-123', {
     files: ['src/auth/login.ts'],
     symbols: ['authenticateUser'],
     coverage: 0.95
   });
   ```

2. **Status Syncing**
   ```typescript
   await integration.syncStatus('req-123', {
     status: 'implemented',
     commit: 'abc1234'
   });
   ```

3. **Coverage Calculation**
   ```typescript
   const coverage = await integration.calculateCoverage('req-123');
   // Returns: { total: 10, implemented: 9, coverage: 0.9 }
   ```

4. **Bidirectional Updates**
   - CV-Git → cvPRD: Code changes update requirement status
   - cvPRD → CV-Git: Requirement changes trigger code review

**CLI Commands:**
```bash
cv prd link <requirement-id>          # Link current work to requirement
cv prd status <requirement-id>        # Show implementation status
cv prd sync                           # Sync with cvPRD
cv prd validate <requirement-id>      # Validate implementation
```

**End-to-End Testing:**
1. Create requirement in cvPRD
2. AI agent reads requirement via MCP
3. AI agent generates code via CV-Git MCP
4. CV-Git links code to requirement
5. cvPRD shows implementation status
6. Coverage metrics update automatically

**Deliverable:** Full integration working end-to-end

---

## Week-by-Week Checklist

### Week 1: CLI Polish
- [ ] `cv config` command implemented
- [ ] `cv status` command implemented
- [ ] `cv doctor` command implemented
- [ ] `--json`, `--quiet`, `--verbose` flags on all commands
- [ ] Error handling improved across all commands
- [ ] Service dependency checks
- [ ] CLI documentation updated
- [ ] All CLI tests passing
- [ ] Release v0.3.0

### Week 2: CV-Git MCP
- [ ] `packages/mcp-server/` created
- [ ] MCP SDK integrated
- [ ] 10+ tools exposed
- [ ] Stdio transport working
- [ ] Claude Desktop configuration documented
- [ ] All tools tested
- [ ] MCP server documentation complete
- [ ] Release MCP Server v1.0.0

### Week 3: cvPRD MCP + API
- [ ] `/home/jwscho/cvPRD/mcp-server/` created
- [ ] cvPRD MCP tools exposed
- [ ] Integration API endpoints added to cvPRD
- [ ] Database schema updated
- [ ] Both MCP servers working together
- [ ] Documentation complete
- [ ] Release cvPRD MCP v1.0.0

### Week 4: Integration
- [ ] `packages/prd-integration/` created
- [ ] cvPRD REST client implemented
- [ ] Bidirectional sync working
- [ ] Coverage calculation accurate
- [ ] CLI commands for PRD integration
- [ ] End-to-end workflow tested
- [ ] Integration documentation
- [ ] Release CV-Git v1.0.0 🎉

---

## Success Criteria

### Production Ready CLI ✓
- [ ] All commands functional with real services
- [ ] 90%+ test coverage
- [ ] Comprehensive error handling
- [ ] `--json` output everywhere
- [ ] Detailed documentation
- [ ] Performance optimized
- [ ] Security hardened

### MCP Integration ✓
- [ ] Claude can execute all CV-Git commands
- [ ] Response time < 2s average
- [ ] Error messages clear for LLM context
- [ ] Tool discovery working
- [ ] Documentation with examples

### cvPRD Integration ✓
- [ ] Requirements link to code
- [ ] Implementation status syncs
- [ ] Coverage calculated automatically
- [ ] Bidirectional updates < 1s
- [ ] Conflict resolution strategy defined

---

## File Structure After Completion

```
cv-git/
├── packages/
│   ├── cli/                  ✅ Enhanced with config, status, doctor
│   ├── core/                 ✅ Existing
│   ├── credentials/          ✅ Existing
│   ├── platform/             ✅ Existing
│   ├── shared/               ✅ Existing
│   ├── mcp-server/           🆕 NEW - AI agent interface
│   └── prd-integration/      🆕 NEW - cvPRD connectivity
├── tests/
│   ├── integration/          ✅ 20 tests passing
│   ├── unit/                 ✅ 10 tests passing
│   └── e2e/                  🆕 NEW - End-to-end tests
├── CLI_PRODUCTION_READINESS.md  ✅ Created
├── INTEGRATION_STRATEGY.md      ✅ Created
├── ROADMAP_TO_PRODUCTION.md     ✅ This file
└── MCP_GUIDE.md                 🆕 NEW - MCP usage guide

cvPRD/
└── mcp-server/               🆕 NEW - Requirements interface
```

---

## Resources & References

### MCP (Model Context Protocol)
- **Specification:** https://spec.modelcontextprotocol.io/
- **SDK:** https://github.com/modelcontextprotocol/typescript-sdk
- **Examples:** https://github.com/modelcontextprotocol/servers

### Development Tools
- **Claude Desktop:** For testing MCP integration
- **FalkorDB:** `docker run -d -p 6379:6379 falkordb/falkordb`
- **Qdrant:** `docker run -d -p 6333:6333 qdrant/qdrant`

---

## Next Immediate Actions

1. **Review this roadmap** - Confirm priorities and timeline
2. **Start Week 1** - Begin with `cv config` command
3. **Research MCP SDK** - Familiarize with protocol
4. **Audit cvPRD** - Understand data models for integration
5. **Set up dev environment** - Ensure all services running

---

## The End Goal

**4 weeks from now:**

```bash
# Developer workflow
cv config set prd.url http://localhost:8000
cv prd link req-123
cv do "implement requirement req-123"
# CV-Git generates code, links to requirement
# cvPRD shows implementation status

# AI Agent workflow (via Claude Desktop)
> "Read requirement req-123 from cvPRD and implement it"

Claude:
1. Calls prd_get_requirement(req-123)
2. Calls cv_graph_query to understand codebase
3. Calls cv_do to generate implementation
4. Calls cv_link_requirement to track
5. Calls prd_update_status to sync

Result: Fully automated requirement → code flow! 🚀
```

---

**Let's build the future of AI-native development!**

The CLI will be rock-solid, AI agents will have full access via MCP, and requirements will flow seamlessly into code through cvPRD integration.

Ready to start Week 1?
