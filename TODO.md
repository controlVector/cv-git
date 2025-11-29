# CV-Git TODO

## Next Up - v0.3.6: Knowledge Graph Sync Strategy

### Development Workflow Integration
The knowledge graph needs to stay in sync as code changes during development. Proposed strategy:

```
┌─────────────────────────────────────────────────────────────────┐
│  cv code (edit session)                                         │
│    ↓                                                            │
│  Make changes → Apply edits → Test                              │
│    ↓                                                            │
│  git commit (when feature/fix complete)                         │
│    ↓                                                            │
│  cv sync --incremental (update knowledge graph)                 │
│    ↓                                                            │
│  Continue with next task...                                     │
└─────────────────────────────────────────────────────────────────┘
```

### Planned Implementation
- [ ] **Add `/sync` command to `cv code`** - manual mid-session sync
- [ ] **Add `cv hooks install`** - install git post-commit hook for auto-sync
- [ ] **Auto-sync on quit** - optionally sync changed files when exiting `cv code`

---

## v0.3.5 - CLI Polish & Bug Fixes (Current)

### Completed

- [x] **Fix interactive edit prompts** - CLI was exiting instead of waiting for input
  - Switched to raw stdin with `setRawMode(true)` for single-keypress capture
  - Works independently of readline interface used by main REPL

- [x] **Hide duplicate edit blocks in output**
  - AI response was showing raw SEARCH/REPLACE blocks AND formatted diff
  - Now filters out raw edit blocks, shows only `[edit block - see formatted diff below]`
  - Formatted colorized diff shown once after response completes

---

## v0.3.4 - CLI UX Improvements

### Completed

- [x] **Improve CLI UX: Add thinking/progress formatting like Claude Code**
  - Added visual spinner with status messages during AI processing
  - Shows "Searching codebase...", "Thinking...", "Generating response...", "Parsing edits..." states
  - Uses ora for animated spinners with phase-aware text updates

- [x] **Improve CLI UX: Add visual separation between tasks/sections**
  - Added horizontal dividers between sections
  - Edit proposals shown in colored boxes with type indicators (CREATE/MODIFY/DELETE)
  - Colorized diff output (green for additions, red for removals, cyan for hunks)
  - Clear visual hierarchy with labeled dividers

- [x] **Improve CLI UX: Add interactive selection (y/n/a) instead of typing /apply**
  - After edits are proposed, prompts: `[y]es / [n]o / [a]ll / [d]iff / [s]kip / [q]uit`
  - Single keypress selection (no Enter required)
  - Shows edit summary after completion

- [x] **Fix context search** - vector search threshold was filtering all results
  - Lowered minScore from 0.5 to 0.2
  - Added fallback file loading for general queries
  - Added `loadKeyProjectFiles()` for README, main entry points

---

## Backlog

### Medium Priority

- [ ] **Fix workspace file paths - absolutePath not being returned from graph query**
  - Graph query returns `file` but not `absolutePath` from joined File node
  - Files being created at workspace root instead of repo subdirectories
  - Need to verify OPTIONAL MATCH is working correctly in Cypher query

### Low Priority

- [ ] **Improve edit parsing robustness**
  - Handle edge cases in SEARCH/REPLACE block parsing
  - Better error messages when edits fail to apply

---

## Completed Releases

### v0.3.2
- [x] User Preferences System - Pick preferred git platform, AI provider, and embedding provider during init
- [x] `cv preferences` command to view/update preferences
- [x] Global credential detection - only prompts for missing credentials during init
- [x] Preference-aware `cv auth setup`
- [x] FalkorDB fixes - String escaping for newlines/special chars, reserved keyword conflicts
- [x] Improved glob matching - Fixed `**` patterns for deep path matching
- [x] Expanded exclude patterns - site-packages, virtualenvs, vendor dirs, minified JS
- [x] Default embedding provider changed to OpenRouter

### v0.3.1
- [x] `cv code` command with graph-based context
- [x] CodeAssistant with session management
- [x] ContextManager with keyword-based graph search
- [x] Interactive mode continues after initial instruction
- [x] Debug logging with `CV_DEBUG=1`
- [x] Graph connection state tracking with instance IDs
- [x] `isConnected()` checks for graceful failure handling

### v0.3.0
- [x] Workspace mode with multi-repo support
- [x] OpenRouter AI provider integration
- [x] Ollama local model support
- [x] `cv sync` for workspace indexing
- [x] FalkorDB auto-start infrastructure
