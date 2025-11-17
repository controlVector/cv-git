# CV-Git ↔ cvPRD Integration Strategy

**Date:** 2025-11-17
**Vision:** Seamless requirements-to-code workflow powered by AI

---

## The Big Picture

```
┌──────────────────────────────────────────────────────────────┐
│                    AI Agent (Claude)                          │
│  - Understands requirements from cvPRD                       │
│  - Generates/modifies code via CV-Git                        │
│  - Validates implementation against requirements             │
└────────┬─────────────────────────────┬───────────────────────┘
         │                             │
         │ MCP                         │ MCP
         │                             │
┌────────▼────────────┐      ┌─────────▼─────────┐
│      cvPRD          │◄────►│      CV-Git        │
│                     │      │                     │
│ Requirements        │      │ Code Repository    │
│ Vector DB (Qdrant) │      │ Knowledge Graph    │
│ Graph (Neo4j)      │      │ (FalkorDB)         │
│ Docs (PostgreSQL)  │      │ Vector Search      │
└─────────────────────┘      │ (Qdrant)           │
                             └─────────────────────┘
```

### The Workflow

1. **Requirements Created** (in cvPRD)
   - PM writes PRD in cvPRD
   - System chunks requirements into semantic units
   - Stores in vector DB + knowledge graph

2. **AI Agent Receives Task**
   - Accesses cvPRD via MCP to understand requirements
   - Accesses CV-Git via MCP to understand codebase
   - Generates implementation plan

3. **Code Generated** (via CV-Git)
   - AI agent uses `cv do` to implement features
   - Code synced to CV-Git knowledge graph
   - Links code to requirements

4. **Validation & Tracking**
   - CV-Git validates code against requirements
   - Updates implementation status in cvPRD
   - Tracks coverage: which requirements have code

---

## Integration Points

### 1. Shared MCP Server Approach

**Why:** Both systems expose their capabilities via MCP, AI agent orchestrates

```typescript
// AI Agent's perspective
async function implementFeature(requirementId: string) {
  // 1. Get requirements from cvPRD
  const requirements = await cvPRD.getRequirement(requirementId);
  const context = await cvPRD.getRelatedContext(requirementId);

  // 2. Get codebase context from CV-Git
  const relevantCode = await cvGit.find(requirements.searchQuery);
  const architecture = await cvGit.graph.query(requirements.architectureQuery);

  // 3. Generate implementation
  const implementation = await generateCode(requirements, relevantCode, architecture);

  // 4. Execute via CV-Git
  await cvGit.do({
    task: implementation.task,
    context: implementation.context
  });

  // 5. Link back to requirements
  await cvPRD.updateImplementationStatus(requirementId, {
    status: 'implemented',
    codeLocation: implementation.files,
    cvGitCommit: implementation.commitHash
  });
}
```

### 2. Data Synchronization

**Requirement → Code Linkage:**

```javascript
// In CV-Git knowledge graph
{
  type: "Implementation",
  requirementId: "cvprd://req-123",  // Link to cvPRD
  file: "src/auth/login.ts",
  function: "authenticateUser",
  status: "implemented",
  coverage: 0.95  // 95% of requirement covered
}

// In cvPRD graph
{
  type: "Requirement",
  id: "req-123",
  title: "User Authentication",
  implementationStatus: {
    cvGitRepo: "cv-git://repo-xyz",
    files: ["src/auth/login.ts"],
    coverage: 0.95,
    lastSync: "2025-11-17T12:00:00Z"
  }
}
```

### 3. Webhook Events

**cvPRD → CV-Git:**
- `requirement.created` - New requirement added
- `requirement.updated` - Requirement changed
- `requirement.deleted` - Requirement removed

**CV-Git → cvPRD:**
- `code.committed` - New code added
- `code.synced` - Knowledge graph updated
- `implementation.completed` - Feature implemented

---

## Technical Implementation

### Phase 1: MCP Servers (Both Systems)

#### CV-Git MCP Server
**Package:** `packages/mcp-server/`

**Exposed Tools:**
```typescript
{
  // Code understanding
  "cv_find": "Semantic code search",
  "cv_explain": "Explain code/concepts",
  "cv_graph_query": "Query knowledge graph",

  // Code modification
  "cv_do": "Execute task (generate/modify code)",
  "cv_review": "Review code changes",

  // Repository operations
  "cv_sync": "Sync repo to knowledge graph",
  "cv_pr_create": "Create pull request",
  "cv_commit": "Commit changes",

  // Requirements linkage
  "cv_link_requirement": "Link code to requirement",
  "cv_get_implementation": "Get implementation for requirement"
}
```

#### cvPRD MCP Server
**Location:** `/home/jwscho/cvPRD/mcp-server/` (to be created)

**Exposed Tools:**
```typescript
{
  // Requirements retrieval
  "prd_get_requirement": "Get requirement by ID",
  "prd_search": "Semantic search for requirements",
  "prd_get_context": "Get full context for requirement",

  // Requirements analysis
  "prd_get_dependencies": "Get requirement dependencies",
  "prd_get_acceptance_criteria": "Get acceptance criteria",
  "prd_get_technical_specs": "Get technical specifications",

  // Implementation tracking
  "prd_update_status": "Update implementation status",
  "prd_link_code": "Link code to requirement",
  "prd_get_coverage": "Get implementation coverage"
}
```

### Phase 2: Integration Package

**New Package:** `packages/prd-integration/`

**Purpose:** Bridge between CV-Git and cvPRD

**Features:**
- Bidirectional sync
- Requirement → Code mapping
- Implementation status tracking
- Coverage calculation
- Conflict resolution

**Example Usage:**
```typescript
import { PRDIntegration } from '@cv-git/prd-integration';

const integration = new PRDIntegration({
  cvPrdUrl: 'http://localhost:8000',
  cvGitRepo: process.cwd()
});

// Sync requirement to code
await integration.linkRequirement('req-123', {
  files: ['src/auth/login.ts'],
  symbols: ['authenticateUser', 'validateToken'],
  coverage: 0.95
});

// Get requirements for file
const requirements = await integration.getRequirementsForFile('src/auth/login.ts');

// Validate implementation
const validation = await integration.validateImplementation('req-123');
```

### Phase 3: API Contracts

**REST API Endpoints:**

```yaml
# CV-Git → cvPRD
POST /api/v1/requirements/{id}/implementation
  body:
    status: "implemented" | "in_progress" | "not_started"
    files: string[]
    coverage: number
    commit: string

GET /api/v1/requirements/{id}/implementation
  response:
    status, files, coverage, commit

# cvPRD → CV-Git
POST /api/v1/code/link
  body:
    requirementId: string
    file: string
    symbols: string[]

GET /api/v1/code/requirements
  query: file=src/auth/login.ts
  response: Requirement[]
```

---

## MCP Server Implementation Guide

### 1. CV-Git MCP Server

**Create Package:**
```bash
mkdir -p packages/mcp-server
cd packages/mcp-server
```

**Structure:**
```
packages/mcp-server/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts              # MCP server entry
│   ├── server.ts             # MCP protocol implementation
│   ├── tools/
│   │   ├── find.ts          # cv find tool
│   │   ├── do.ts            # cv do tool
│   │   ├── graph.ts         # cv graph tool
│   │   └── ...
│   └── types.ts             # MCP type definitions
└── README.md
```

**Dependencies:**
```json
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "^0.4.0",
    "@cv-git/core": "workspace:*",
    "@cv-git/cli": "workspace:*"
  }
}
```

**Basic Server:**
```typescript
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const server = new Server({
  name: 'cv-git',
  version: '1.0.0',
}, {
  capabilities: {
    tools: {},
  },
});

// Register tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'cv_find',
        description: 'Search for code using natural language',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Natural language search query',
            },
            limit: {
              type: 'number',
              description: 'Maximum results',
              default: 10,
            },
          },
          required: ['query'],
        },
      },
      // More tools...
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case 'cv_find':
      return await handleFind(args);
    case 'cv_do':
      return await handleDo(args);
    // More handlers...
  }
});

// Start server
const transport = new StdioServerTransport();
await server.connect(transport);
```

### 2. cvPRD MCP Server

**Similar structure in cvPRD:**
```bash
cd /home/jwscho/cvPRD
mkdir -p mcp-server
```

**Tools for requirements:**
```typescript
{
  name: 'prd_get_requirement',
  description: 'Get a requirement by ID with full context',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      includeContext: { type: 'boolean', default: true },
      includeDependencies: { type: 'boolean', default: true }
    },
    required: ['id']
  }
}
```

### 3. Claude Desktop Configuration

**~/.config/claude-desktop/config.json:**
```json
{
  "mcpServers": {
    "cv-git": {
      "command": "node",
      "args": ["/path/to/cv-git/packages/mcp-server/dist/index.js"],
      "env": {
        "CV_REPO": "${workspaceFolder}"
      }
    },
    "cvprd": {
      "command": "node",
      "args": ["/path/to/cvPRD/mcp-server/dist/index.js"],
      "env": {
        "CVPRD_URL": "http://localhost:8000"
      }
    }
  }
}
```

---

## Implementation Roadmap

### Week 1: CV-Git CLI Production Readiness
- [ ] Add `cv config` command
- [ ] Add `cv status` command
- [ ] Add `cv doctor` command
- [ ] Improve error handling
- [ ] Add `--json` output everywhere
- [ ] Service dependency checks

### Week 2: CV-Git MCP Server
- [ ] Create `packages/mcp-server/`
- [ ] Implement MCP protocol (stdio)
- [ ] Expose 8-10 core tools
- [ ] Test with Claude Desktop
- [ ] Documentation

### Week 3: cvPRD MCP Server
- [ ] Create `cvPRD/mcp-server/`
- [ ] Implement MCP protocol
- [ ] Expose requirement tools
- [ ] Test integration
- [ ] Documentation

### Week 4: Integration Package
- [ ] Create `packages/prd-integration/`
- [ ] REST API client for cvPRD
- [ ] Bidirectional sync logic
- [ ] Coverage calculation
- [ ] Testing

---

## Success Metrics

### CLI Production Ready
- [ ] All commands functional
- [ ] 90%+ test coverage
- [ ] Error handling complete
- [ ] Documentation complete

### MCP Integration
- [ ] Claude can call all CV-Git commands
- [ ] Claude can access cvPRD requirements
- [ ] End-to-end: requirement → code flow works
- [ ] Response time < 2s for most operations

### cvPRD Integration
- [ ] Requirement → Code linkage works
- [ ] Implementation status syncs
- [ ] Coverage calculation accurate
- [ ] Bidirectional updates < 1s

---

## Next Actions

1. **Finalize CLI** (highest priority)
   - Add missing commands
   - Improve UX
   - Complete testing

2. **Build CV-Git MCP Server** (enables AI integration)
   - Follow MCP SDK docs
   - Test with Claude Desktop
   - Document for users

3. **Coordinate with cvPRD** (parallel track)
   - Add MCP server to cvPRD
   - Define API contracts
   - Build integration package

---

**This creates a powerful AI-native development workflow where requirements flow seamlessly into code, with full traceability and validation.** 🚀
