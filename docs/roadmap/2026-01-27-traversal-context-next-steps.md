# CV-Git: Traversal-Aware Context for Claude Code - Next Steps

**Date:** January 27, 2026
**Status:** Phase 1-3 Implementation Complete
**Commit:** `99831ad` - feat: Add traversal-aware dynamic context for Claude Code

---

## Summary

This document outlines the next steps for replacing Claude Code's default context mechanism with CV-Git's traversal-aware dynamic context system. The goal is to provide Claude Code with intelligent, position-aware context that scales appropriately based on where the user is working in the codebase.

---

## What Was Completed

### Phase 1: Graph-Vector Linking
- Added `vectorIds` field to `SymbolNode` for multi-chunk linking
- Implemented bidirectional lookup between FalkorDB graph and Qdrant vectors
- Modified sync engine to build symbol→chunk mapping during indexing
- Added `getVectorsForSymbol()` to GraphService

### Phase 2: Hierarchical Embeddings
- Created `HierarchicalSummaryService` for multi-level summary generation
- Implemented 5-level hierarchy:
  - Level 0: Code chunks (raw code)
  - Level 1: Symbol summaries (function/class)
  - Level 2: File summaries (aggregated symbols)
  - Level 3: Directory summaries (aggregated files)
  - Level 4: Repository summary (codebase overview)
- Added `summaries` collection to VectorManager
- Implemented level-aware search methods
- Content-addressed caching (skip unchanged content)

### Phase 3: Traversal-Aware MCP Tool
- Created `cv_traverse_context` MCP tool
- Implemented `TraversalService` for navigation logic
- Implemented `SessionService` for stateful session management
- Support for navigation directions: `jump`, `in`, `out`, `lateral`, `stay`
- Output formats: XML (optimized for Claude), Markdown, JSON
- Token budget control for context sizing

---

## Next Steps

### 1. Testing & Validation (High Priority)

#### 1.1 Unit Tests
- [x] Write tests for `HierarchicalSummaryService` (32 tests)
- [x] Write tests for `TraversalService` (41 tests)
- [x] Write tests for `SessionService` (21 tests)
- [x] Write tests for graph-vector linking methods (22 tests)
- [x] Write tests for level-aware search (8 tests)
- [x] Write tests for `getVectorsForSymbol` (4 tests)

#### 1.2 Integration Tests
- [x] Create integration test suite for `cv_traverse_context` tool (12 tests)
- [x] Run integration tests with infrastructure (all 12 pass)
- [ ] Test full sync with hierarchical summary generation
- [ ] Test session persistence and recovery
- [ ] Test with real codebases of varying sizes

#### 1.3 MCP Tool Testing
- [ ] Test `cv_traverse_context` via Claude Desktop
- [ ] Test `cv_traverse_context` via Claude Code CLI
- [ ] Validate XML output parsing by Claude
- [ ] Test session state across multiple tool calls

### 2. Performance Optimization (Medium Priority)

#### 2.1 Summary Generation
- [x] Implement parallel summary generation for large codebases
- [x] Add progress reporting during sync
- [x] Add `concurrency` and `onProgress` options to `generateAllSummaries()`
- [ ] Optimize LLM calls with batching
- [x] Add summary caching to avoid regeneration (content-addressed)

#### 2.2 Context Retrieval
- [x] Add caching layer for frequently accessed contexts
- [x] Implement `ContextCache` with TTL and LRU eviction
- [x] Cache modules, files, symbols, summaries, callers/callees
- [ ] Profile and optimize traversal queries
- [ ] Optimize token budget allocation

### 3. Claude Code Integration (High Priority)

#### 3.1 MCP Configuration
- [x] Document optimal MCP server configuration for Claude Code
- [x] Create example `.mcp.json` configurations
- [ ] Test with various project types (monorepo, single package, etc.)

#### 3.2 Prompt Engineering
- [x] Design system prompts that leverage `cv_traverse_context`
- [x] Create guidance for Claude on when to use traversal vs other tools
- [x] Document best practices for navigation patterns
- See: `docs/claude-code-integration.md`

#### 3.3 Auto-Context Integration
- [x] Document hybrid approach (auto-context + traversal)
- [ ] Consider deeper integration with existing `cv_auto_context` tool
- [ ] Implement "context budget" allocation between tools

### 4. Enhanced Navigation Features (Future)

#### 4.1 Smart Navigation Hints
- [x] Improve hint generation based on graph analysis
  - Shows public symbols, functions, classes at file level
  - Shows entry point files (index.ts, main.ts) at module level
  - Shows callers/callees count at symbol level
- [x] Add "related symbols" suggestions from semantic similarity
  - New `includeRelated` option in `cv_traverse_context`
  - Uses vector search to find semantically similar symbols
  - Configurable via `maxRelatedSymbols` option
- [ ] Add "recently visited" tracking for quick jumps

#### 4.2 Bookmark System
- [ ] Allow users to bookmark positions
- [ ] Persist bookmarks across sessions
- [ ] Add bookmark navigation commands

#### 4.3 History Navigation
- [ ] Implement forward/back navigation (browser-style)
- [ ] Add "go to definition" style jumps
- [ ] Track navigation patterns for optimization

### 5. Documentation & Examples (Medium Priority)

- [ ] Create video walkthrough of traversal workflow
- [ ] Add more examples to MCP server README
- [ ] Create troubleshooting guide
- [ ] Document common navigation patterns

---

## Architecture Notes

### Current Data Flow

```
User Request
     │
     ▼
┌─────────────────┐
│ cv_traverse_    │
│ context (MCP)   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ TraversalService│──────┐
└────────┬────────┘      │
         │               │
         ▼               ▼
┌─────────────────┐  ┌─────────────────┐
│ SessionService  │  │ GraphService    │
│ (state mgmt)    │  │ (relationships) │
└─────────────────┘  └────────┬────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
       ┌──────────┐    ┌──────────┐    ┌──────────┐
       │ FalkorDB │    │  Qdrant  │    │ Summaries│
       │ (graph)  │    │ (vectors)│    │ (Qdrant) │
       └──────────┘    └──────────┘    └──────────┘
```

### Key Design Decisions

1. **XML as Default Output** - Optimized for Claude's parsing
2. **Session Persistence** - Enables long-running navigation sessions
3. **Token Budget** - Prevents context overflow
4. **Hierarchical Levels** - Matches natural code organization
5. **Direction-Based Navigation** - Intuitive for developers

---

## Open Questions

1. **Should traversal context replace or complement auto_context?**
   - Current thinking: Complement - traversal for navigation, auto for initial context

2. **How to handle very large files?**
   - May need chunking at file level too
   - Consider "focus area" within large files

3. **Multi-repo support?**
   - Current: Single repo per session
   - Future: Consider cross-repo navigation

4. **Real-time sync during navigation?**
   - Currently relies on periodic `cv sync`
   - Consider incremental updates as user navigates

---

## Verification Commands

```bash
# Verify sync with hierarchical summaries
cv sync --verbose

# Check summary counts (once implemented)
cv stats --summaries

# Test MCP tool via Claude Code
# In Claude Code, ask: "Show me context for src/auth/oauth.ts"

# Verify graph-vector linking
cv graph-query "MATCH (s:Symbol) WHERE s.vectorIds IS NOT NULL RETURN count(s)"
```

---

## Resources

- **Plan File:** `.claude/plans/snug-leaping-cerf.md`
- **API Documentation:** `docs/API.md`
- **MCP Server README:** `packages/mcp-server/README.md`
- **Main README:** `README.md`

---

## Contact

For questions about this implementation, refer to the commit history starting from `99831ad` or the conversation context in Claude Code sessions.
