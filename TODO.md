# CV-Git TODO

## v0.3.2 - CLI UX Improvements

### High Priority

- [ ] **Improve CLI UX: Add thinking/progress formatting like Claude Code**
  - Add visual spinner with status messages during AI processing
  - Show "Thinking...", "Searching codebase...", "Generating response..." states
  - Use chalk/ora for consistent styling

- [ ] **Improve CLI UX: Add visual separation between tasks/sections**
  - Add horizontal dividers between user input, AI response, and edit proposals
  - Use box drawing characters or color-coded sections
  - Clear visual hierarchy for proposed edits

- [ ] **Improve CLI UX: Add interactive selection (y/n/a) instead of typing /apply**
  - After edits are proposed, prompt with: `Apply changes? [y]es / [n]o / [a]ll / [d]iff / [q]uit`
  - Single keypress selection (no Enter required if possible)
  - Show edit summary before confirmation

### Medium Priority

- [ ] **Fix workspace file paths - absolutePath not being returned from graph query**
  - Graph query returns `file` but not `absolutePath` from joined File node
  - Files being created at workspace root instead of repo subdirectories (e.g., `src/file.js` instead of `RepoName/src/file.js`)
  - Need to verify OPTIONAL MATCH is working correctly in Cypher query

### Low Priority

- [ ] **Add `/add` command to explicitly include files in context**
  - Allow users to manually add files that weren't found by search
  - Persist across the session

- [ ] **Improve edit parsing robustness**
  - Handle edge cases in SEARCH/REPLACE block parsing
  - Better error messages when edits fail to apply

## Completed in v0.3.1

- [x] `cv code` command with graph-based context
- [x] CodeAssistant with session management
- [x] ContextManager with keyword-based graph search
- [x] Interactive mode continues after initial instruction
- [x] Debug logging with `CV_DEBUG=1`
- [x] Graph connection state tracking with instance IDs
- [x] `isConnected()` checks for graceful failure handling

## Completed in v0.3.0

- [x] Workspace mode with multi-repo support
- [x] OpenRouter AI provider integration
- [x] Ollama local model support
- [x] `cv sync` for workspace indexing
- [x] FalkorDB auto-start infrastructure
