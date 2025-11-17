# Week 2 Plan: CV-Git MCP Server

**Status:** Starting
**Date:** 2025-11-17
**Goal:** Enable AI agents (Claude Desktop/API) to use CV-Git programmatically

---

## Overview

Create an MCP (Model Context Protocol) server that exposes CV-Git functionality as tools that Claude and other AI agents can use.

**Architecture:**
```
Claude Desktop/API
       ↓ (MCP Protocol - stdio)
CV-Git MCP Server (Node.js)
       ↓ (Function calls)
CV-Git Core/CLI
       ↓
Knowledge Graph + Vector DB
```

---

## Phase 1: Package Setup (2 hours)

### 1.1 Create Package Structure

```bash
packages/mcp-server/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts          # Main MCP server
│   ├── tools/            # Tool implementations
│   │   ├── search.ts     # cv_find, cv_graph_query
│   │   ├── explain.ts    # cv_explain
│   │   ├── modify.ts     # cv_do, cv_review
│   │   ├── sync.ts       # cv_sync
│   │   └── platform.ts   # cv_pr_*, cv_release_*
│   ├── types.ts          # TypeScript types
│   └── utils.ts          # Helper functions
├── dist/                 # Compiled output
└── README.md             # Installation & usage
```

### 1.2 Dependencies

```json
{
  "name": "@cv-git/mcp-server",
  "version": "1.0.0",
  "type": "module",
  "bin": {
    "cv-mcp": "./dist/index.js"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^0.5.0",
    "@cv-git/core": "workspace:*",
    "@cv-git/cli": "workspace:*"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "typescript": "^5.3.0"
  }
}
```

---

## Phase 2: MCP Server Implementation (4 hours)

### 2.1 Core Server (`src/index.ts`)

```typescript
#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';

const server = new Server(
  {
    name: 'cv-git',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Tool definitions
const tools: Tool[] = [
  {
    name: 'cv_find',
    description: 'Search for code using natural language. Returns relevant code snippets.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query in natural language',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results',
          default: 10,
        },
        minScore: {
          type: 'number',
          description: 'Minimum similarity score (0-1)',
          default: 0.5,
        },
      },
      required: ['query'],
    },
  },
  // ... more tools
];

// List tools handler
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools };
});

// Call tool handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'cv_find':
        return await handleFind(args);
      case 'cv_explain':
        return await handleExplain(args);
      // ... more handlers
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error.message}`,
        },
      ],
      isError: true,
    };
  }
});

// Start server
const transport = new StdioServerTransport();
await server.connect(transport);
```

---

## Phase 3: Tool Implementations (6 hours)

### 3.1 Code Understanding Tools

**cv_find** - Semantic code search
```typescript
async function handleFind(args: any) {
  const { query, limit = 10, minScore = 0.5 } = args;

  // Call CV-Git find command
  const results = await findCode(query, { limit, minScore });

  return {
    content: [
      {
        type: 'text',
        text: formatSearchResults(results),
      },
    ],
  };
}
```

**cv_explain** - Explain code/concepts
```typescript
async function handleExplain(args: any) {
  const { target } = args;

  // Call CV-Git explain command
  const explanation = await explainCode(target);

  return {
    content: [
      {
        type: 'text',
        text: explanation,
      },
    ],
  };
}
```

**cv_graph_query** - Query knowledge graph
```typescript
async function handleGraphQuery(args: any) {
  const { queryType, target } = args;

  // Call CV-Git graph command
  const results = await queryGraph(queryType, target);

  return {
    content: [
      {
        type: 'text',
        text: formatGraphResults(results),
      },
    ],
  };
}
```

### 3.2 Code Modification Tools

**cv_do** - Execute task
```typescript
async function handleDo(args: any) {
  const { task, planOnly = false, autoApprove = false } = args;

  // Call CV-Git do command
  const result = await executeTask(task, { planOnly, autoApprove });

  return {
    content: [
      {
        type: 'text',
        text: formatTaskResult(result),
      },
    ],
  };
}
```

**cv_review** - Review code
```typescript
async function handleReview(args: any) {
  const { ref = 'HEAD', staged = false } = args;

  // Call CV-Git review command
  const review = await reviewCode(ref, { staged });

  return {
    content: [
      {
        type: 'text',
        text: formatReview(review),
      },
    ],
  };
}
```

### 3.3 Repository Operations

**cv_sync** - Sync repository
```typescript
async function handleSync(args: any) {
  const { incremental = false, force = false } = args;

  // Call CV-Git sync command
  const result = await syncRepository({ incremental, force });

  return {
    content: [
      {
        type: 'text',
        text: formatSyncResult(result),
      },
    ],
  };
}
```

---

## Phase 4: Tool Catalog (All 15 Tools)

### Code Understanding (5 tools)
1. ✅ `cv_find` - Semantic code search
2. ✅ `cv_explain` - Explain code/concepts
3. ✅ `cv_graph_query` - Query knowledge graph
   - Subtypes: calls, called-by, imports, exports
4. ✅ `cv_graph_stats` - Get graph statistics
5. ✅ `cv_graph_inspect` - Inspect symbol details

### Code Modification (3 tools)
6. ✅ `cv_do` - Execute task (generate/modify code)
7. ✅ `cv_review` - Review code changes
8. ✅ `cv_sync` - Sync repository

### Repository Operations (4 tools)
9. ✅ `cv_pr_create` - Create pull request
10. ✅ `cv_pr_list` - List pull requests
11. ✅ `cv_pr_review` - Review pull request
12. ✅ `cv_release_create` - Create release

### System Operations (3 tools)
13. ✅ `cv_config_get` - Get configuration value
14. ✅ `cv_status` - Get CV-Git status
15. ✅ `cv_doctor` - Run diagnostics

---

## Phase 5: Testing (3 hours)

### 5.1 Claude Desktop Configuration

Create `~/Library/Application Support/Claude/claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "cv-git": {
      "command": "node",
      "args": [
        "/home/jwscho/cv-git/packages/mcp-server/dist/index.js"
      ]
    }
  }
}
```

### 5.2 Test Scenarios

**Test 1: Code Search**
```
User: Find authentication logic in this repository
Claude: [Uses cv_find tool]
Expected: Returns relevant auth-related code
```

**Test 2: Code Explanation**
```
User: Explain how the config command works
Claude: [Uses cv_explain + cv_graph_query tools]
Expected: Detailed explanation with context
```

**Test 3: Code Modification**
```
User: Add logging to all error handlers
Claude: [Uses cv_find + cv_do tools]
Expected: Generates plan, applies changes
```

**Test 4: Repository Operations**
```
User: Create a PR for my changes
Claude: [Uses cv_pr_create tool]
Expected: PR created with AI-generated description
```

---

## Phase 6: Documentation (2 hours)

### 6.1 README.md

```markdown
# CV-Git MCP Server

Model Context Protocol server for CV-Git.

## Installation

### With Claude Desktop

1. Build the MCP server:
   ```bash
   cd packages/mcp-server
   pnpm install
   pnpm build
   ```

2. Configure Claude Desktop:
   Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:
   ```json
   {
     "mcpServers": {
       "cv-git": {
         "command": "node",
         "args": ["/path/to/cv-git/packages/mcp-server/dist/index.js"]
       }
     }
   }
   ```

3. Restart Claude Desktop

## Available Tools

### Code Understanding
- `cv_find` - Semantic code search
- `cv_explain` - Explain code/concepts
- `cv_graph_query` - Query knowledge graph

### Code Modification
- `cv_do` - Execute tasks with AI
- `cv_review` - AI code review

### Repository Operations
- `cv_pr_create` - Create pull requests
- `cv_sync` - Sync knowledge graph

[Full tool reference...]

## Usage Examples

**Search for code:**
```
User: Find the authentication logic
Claude: [Uses cv_find tool automatically]
```

**Modify code:**
```
User: Add error handling to the API endpoints
Claude: [Uses cv_find to locate, cv_do to modify]
```
```

---

## Success Criteria

- [ ] MCP server package created and builds successfully
- [ ] All 15 tools implemented and tested
- [ ] Works with Claude Desktop
- [ ] Documentation complete
- [ ] Error handling robust
- [ ] Tested on real repository

---

## Timeline

**Day 1 (4 hours):**
- ✅ Package setup
- ✅ Core server implementation
- ✅ First 3 tools (find, explain, graph_query)

**Day 2 (4 hours):**
- ✅ Remaining 12 tools
- ✅ Error handling
- ✅ Testing infrastructure

**Day 3 (3 hours):**
- ✅ Claude Desktop integration
- ✅ End-to-end testing
- ✅ Bug fixes

**Day 4 (2 hours):**
- ✅ Documentation
- ✅ Polish and review
- ✅ Release v1.0.0

**Total:** ~13 hours over 4 days

---

## Next Steps

1. Create package structure
2. Set up dependencies
3. Implement core MCP server
4. Add first 3 tools
5. Test with Claude Desktop

Ready to begin! 🚀
