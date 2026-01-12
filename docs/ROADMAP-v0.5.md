---
type: design_spec
status: approved
tags: [roadmap, mcp, context, versioning, architecture]
relates_to: [packages/mcp-server, packages/cli, packages/core]
version: "0.5.0"
created: 2025-12-29
---

# CV-Git v0.5 Roadmap: Closing the Gaps

## Executive Summary

This roadmap addresses five key gaps preventing cv-git from being a complete replacement for raw git usage and enabling AI assistants to leverage the knowledge graph automatically.

## Identified Gaps

| Gap | Problem | Impact |
|-----|---------|--------|
| **Stale Graph** | Knowledge graph requires manual `cv sync` | AI sees outdated code relationships |
| **Raw Git Usage** | Users still run `git commit` directly | Graph not updated on commits |
| **When to Use CV** | No clear guidance on cv vs built-in tools | AI doesn't leverage cv tools effectively |
| **Version-Aware Queries** | Can't query graph at specific versions | No historical code analysis |
| **No Proactive Context** | Must explicitly call cv tools | AI doesn't automatically get graph context |

## Research Findings

### File Watching
- **Recommendation**: chokidar (battle-tested, cross-platform, used by webpack/vite)
- **Strategy**: Optional `cv watch` command, not always-on daemon
- **Integration**: Git-aware filtering, respects .gitignore, debounced sync (500ms)

### Git Wrapper
- **Current State**: cv commit/push already exist with passthrough args
- **Recommendation**: Enhance wrappers, keep hooks as fallback
- **Fix Needed**: Remove `shell: true` from git.ts, add `passThroughOptions()`

### Version-Aware Queries
- **Recommendation**: Hybrid approach (snapshots + deltas + git rebuild)
- **Snapshots**: Automatic at Git tags (cv-git:v0.4.0)
- **Deltas**: Log changes in .cv/history/ for reconstruction
- **Fallback**: Rebuild from Git for arbitrary commits

### Context Injection
- **Pattern**: MCP Resources with subscriptions
- **New Tool**: `cv_auto_context` for proactive context retrieval
- **Format**: XML/Markdown for system prompt injection

---

## Phase 1: Foundation Fixes
**Priority: Critical | Effort: 2-3 days**

### 1.1 Fix Git Wrapper UX
```typescript
// packages/cli/src/commands/git.ts
// Remove shell: true (causes argument parsing bugs)
const git = spawn('git', args, {
  stdio: 'inherit',
  // shell: true  <- REMOVE THIS
});
```

- Add `passThroughOptions()` to Commander for `--` handling
- Add `cv pull` command (mirrors cv push/commit pattern)
- Standardize error handling across git wrappers

### 1.2 Add cv_auto_context Tool
New MCP tool for proactive context retrieval:

```typescript
{
  name: 'cv_auto_context',
  description: 'Call FIRST to get relevant knowledge graph context for any coding task. Returns symbols, relationships, and requirements related to the query.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'User query or current task' },
      currentFile: { type: 'string', description: 'Path to active file' },
      format: { type: 'string', enum: ['xml', 'markdown', 'json'], default: 'xml' },
      budget: { type: 'number', default: 20000, description: 'Token budget' }
    },
    required: ['query']
  }
}
```

---

## Phase 2: Graph Freshness
**Priority: High | Effort: 1 week**

### 2.1 cv watch Command

```bash
cv watch                 # Foreground mode
cv watch --daemon        # Background daemon
cv watch --stop          # Stop daemon
cv watch --status        # Check if running
```

Implementation using chokidar:
```typescript
// packages/cli/src/commands/watch.ts
import chokidar from 'chokidar';

const watcher = chokidar.watch(repoRoot, {
  ignored: [/node_modules/, /\.git/, /dist/],
  ignoreInitial: true,
  awaitWriteFinish: { stabilityThreshold: 300 }
});

watcher.on('all', debounce(async (event, path) => {
  if (await git.isTracked(path)) {
    await syncEngine.incrementalSync([path]);
  }
}, 500));
```

### 2.2 Enhanced Git Hooks
- Keep as opt-in fallback (`cv hooks install`)
- Background sync already implemented (uses `&`)
- Add `cv hooks verify` to check hook health

---

## Phase 3: MCP Resources
**Priority: High | Effort: 1 week**

### 3.1 Resource Handlers

```typescript
// packages/mcp-server/src/index.ts

// List available resources
server.setRequestHandler(ListResourcesSchema, async () => ({
  resources: [
    {
      uri: 'cv://context/auto',
      name: 'Automatic Context',
      mimeType: 'application/json',
      annotations: { audience: ['assistant'], priority: 1.0 }
    },
    {
      uri: 'cv://graph/summary',
      name: 'Graph Summary',
      mimeType: 'application/json'
    }
  ]
}));

// Read resource content
server.setRequestHandler(ReadResourceSchema, async (request) => {
  if (request.params.uri === 'cv://context/auto') {
    const context = await contextAssembler.assemble({ maxTokens: 20000 });
    return { contents: [{ uri: request.params.uri, text: JSON.stringify(context) }] };
  }
});
```

### 3.2 Subscription System
- Handle `resources/subscribe` for real-time updates
- Push `notifications/resources/updated` when graph changes
- Integrate with `cv watch` for automatic notifications

---

## Phase 4: Version-Aware Queries
**Priority: Medium | Effort: 2-3 weeks**

### 4.1 Delta Tracking

```typescript
// packages/core/src/version/delta-tracker.ts
interface GraphDelta {
  fromCommit: string;
  toCommit: string;
  timestamp: number;
  changes: {
    nodesAdded: NodeChange[];
    nodesRemoved: NodeChange[];
    nodesModified: NodeChange[];
    edgesAdded: EdgeChange[];
    edgesRemoved: EdgeChange[];
  };
}

// Store in .cv/history/{from}_{to}.json
```

### 4.2 Automatic Snapshots at Tags

```typescript
// During cv sync, detect new tags
const currentTags = await git.getTags();
const syncedTags = await loadSyncedTags();
const newTags = currentTags.filter(t => !syncedTags.includes(t));

for (const tag of newTags) {
  await snapshotManager.create(tag);  // Creates cv-git:{tag}
}
```

### 4.3 Version Query CLI

```bash
cv graph calls myFunction --at v0.3.0
cv graph diff v0.3.0 v0.4.0
cv history symbol MyClass.myMethod
cv snapshot list
cv snapshot create v0.5.0
```

---

## Phase 5: Integration Guidance
**Priority: Medium | Effort: 3-5 days**

### 5.1 Updated Tool Descriptions

```typescript
// Enhance tool descriptions with usage guidance
const tools = [
  {
    name: 'cv_find',
    description: `Semantic code search using natural language.
    
USE WHEN: Searching for concepts ("authentication logic", "error handling")
PREFER OVER: grep for conceptual queries
USE grep FOR: exact string matches, regex patterns

Examples:
- "functions that handle user input" → cv_find
- "TODO:" → grep`
  },
  // ... other tools with guidance
];
```

### 5.2 cv_when_to_use Tool

```typescript
{
  name: 'cv_when_to_use',
  description: 'Returns guidance on which cv tool is best for a specific task',
  inputSchema: {
    type: 'object',
    properties: {
      task: { type: 'string', description: 'What you want to accomplish' }
    },
    required: ['task']
  }
}
```

---

## Implementation Timeline

| Week | Phase | Deliverables |
|------|-------|-------------|
| 1 | Foundation | Git wrapper fixes, cv_auto_context tool |
| 2 | Graph Freshness | cv watch command, hook enhancements |
| 3 | MCP Resources | Resource handlers, subscription system |
| 4-5 | Version Queries | Delta tracking, snapshots, CLI |
| 6 | Polish | Tool descriptions, guidance |

---

## Success Criteria

### Can use cv instead of git?
- [ ] `cv commit` feels native (exit codes, colors, args)
- [ ] `cv watch` keeps graph fresh during development
- [ ] Hooks work for native `git` users

### Can AI leverage knowledge graph automatically?
- [ ] `cv_auto_context` provides rich context without explicit calls
- [ ] MCP Resources enable proactive context injection
- [ ] Tool descriptions guide AI to use cv tools appropriately

### Can query historical state?
- [ ] `--at v0.3.0` works for graph queries
- [ ] `cv graph diff` shows changes between versions
- [ ] Snapshots auto-created at releases

---

## Decision Log

| Decision | Choice | Rationale |
|----------|--------|-----------|
| File watcher library | chokidar | Battle-tested, cross-platform, webpack/vite use it |
| Watch mode default | Foreground | Simpler, daemon adds complexity |
| Version storage | Hybrid | Balance of storage vs query speed |
| Context format | XML | Best for system prompt injection |
| Snapshot retention | All tags | Tags are deliberate, worth keeping |

---

## Files to Create/Modify

### New Files
- `packages/cli/src/commands/watch.ts` - File watcher command
- `packages/cli/src/commands/pull.ts` - Git pull wrapper
- `packages/core/src/version/delta-tracker.ts` - Change tracking
- `packages/core/src/version/snapshot-manager.ts` - FalkorDB snapshots
- `packages/mcp-server/src/tools/auto-context.ts` - Proactive context

### Modified Files
- `packages/cli/src/commands/git.ts` - Remove shell:true
- `packages/mcp-server/src/index.ts` - Add resources, subscriptions
- `packages/mcp-server/src/tools/*.ts` - Enhanced descriptions

---

## Future Features (Post v0.5)

### Multilingual Code Comment Normalization
**Design Doc**: [FEATURE-i18n-comments.md](./FEATURE-i18n-comments.md)

Addresses the three-way language barrier in modern development:
1. **AI-Human**: AI generates comments in various languages
2. **Human-Human**: International teams write in native languages
3. **Mixed Sources**: Codebases accumulate multilingual comments

Key capabilities:
- Per-user language preferences for viewing/writing
- Automatic language detection and storage
- On-demand translation with caching
- Cross-language semantic search
- Source language preserved in knowledge graph

See design doc for full technical specification.
