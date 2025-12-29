# Changelog

All notable changes to CV-Git will be documented in this file.

## [0.3.0] - 2025-11-25

### Added

#### AI-Native Chat Interface
- **`cv chat`** - Interactive AI chat with knowledge graph context
  - One-shot mode: `cv chat "how does auth work"`
  - Interactive REPL with `/commands` (`/help`, `/model`, `/clear`, `/quit`)
  - Model selection: `-m gpt-4o`, `-m llama-3.1-70b`, `-m deepseek-coder`
  - Auto-injects relevant code context from knowledge graph
  - Supports 15+ models via OpenRouter (Claude, GPT-4, Gemini, Llama, Mistral, DeepSeek)

#### Context Generation for AI Assistants
- **`cv context`** - Generate rich context for external AI tools
  - Outputs markdown, XML, or JSON formats
  - Includes code chunks, graph relationships, and file contents
  - Designed for Claude Code, Aider, Cursor, etc.
- **`cv_context` MCP tool** - Same functionality exposed via MCP protocol

#### Auto-Sync on Push
- **`cv push`** - Git push with automatic knowledge graph sync
  - Runs `git push` then `cv sync --incremental`
  - Options: `--skip-sync`, `--sync-only`, `--force`
- **`cv hooks`** - Git hook management for auto-sync
  - `cv hooks install` - Install post-commit/post-merge hooks
  - `cv hooks uninstall` - Remove hooks cleanly
  - `cv hooks status` - Show installed hooks
  - Preserves existing hooks when installing

#### Design-First Scaffolding
- **`cv design`** - Generate architecture from natural language
  - AI creates modules, types, functions, and relationships
  - Validates design (circular deps, type coherence)
  - Outputs: Mermaid diagrams, scaffold files, graph nodes
  - Interactive refinement mode (`--interactive`)
  - Supports all OpenRouter models (`--model`)

### Changed

#### Simplified Credential Storage
- Plain file fallback for systems without keychain (WSL, headless Linux)
- No longer requires `CV_MASTER_PASSWORD` environment variable
- Credentials stored in `~/.cv-git/credentials.json` (chmod 600)
- Follows pattern of aws, gh, gcloud CLIs

#### OpenRouter Integration
- Embedding support integrated into credential flow
- Configuration status display improvements
- Full model selection across all AI commands

### Fixed
- Credential storage UX on WSL and headless systems
- Master password prompt loop eliminated

---

## [0.2.0] - 2024-11-21

### Added

#### Core Features
- **Multi-language support**: TypeScript, JavaScript, Python, Go, Rust, Java
- **Knowledge graph** with FalkorDB for code relationship tracking
- **Semantic search** with Qdrant and OpenAI embeddings
- **AI-powered commands**: explain, do, review, find

#### CLI Commands
- `cv init` - Initialize CV-Git in a repository
- `cv sync` - Synchronize codebase with knowledge graph
- `cv find` - Semantic code search
- `cv explain` - AI-powered code explanations
- `cv do` - AI task execution and code generation
- `cv review` - AI code review
- `cv graph` - Query code relationships
  - `stats` - Graph statistics
  - `calls` / `called-by` - Function call relationships
  - `imports` / `exports` - Module dependencies
  - `path` - Execution path finding
  - `dead-code` - Unused code detection
  - `complexity` - High-complexity function detection
  - `cycles` - Circular dependency detection
  - `hotspots` - Most-called function identification
- `cv status` - Repository and service status
- `cv doctor` - System diagnostics
- `cv config` - Configuration management
  - `get` / `set` / `list` / `reset` / `edit` / `path`

#### MCP Server (20 tools)
- Code understanding: cv_find, cv_explain, cv_graph_query, cv_graph_stats, cv_graph_inspect
- Advanced analysis: cv_graph_path, cv_graph_dead_code, cv_graph_complexity, cv_graph_cycles, cv_graph_hotspots
- Code modification: cv_do, cv_review, cv_sync
- Platform integration: cv_pr_create, cv_pr_list, cv_pr_review, cv_release_create
- System operations: cv_config_get, cv_status, cv_doctor

#### Platform & Credentials
- Secure credential storage with OS keychain (macOS, Windows, Linux)
- Encrypted file fallback for environments without keychain
- GitHub platform adapter for PR and release management
- Platform-agnostic architecture

### Performance
- Parallel file parsing (10x concurrency)
- Symbol index for O(1) call resolution
- Incremental sync for changed files only
- Batch vector embedding generation

### Documentation
- Comprehensive README with usage examples
- Quickstart guide
- Troubleshooting guide
- Cross-platform testing guide
- Architecture documentation
- MCP server setup instructions

### Fixed
- FalkorDB compact format parsing
- Port detection and sync issues
- CLI module loading with ora spinner

## [0.1.0] - Initial Development

### Added
- Project structure and monorepo setup
- Basic CLI infrastructure
- Initial graph and vector database integration
- TypeScript parser implementation

---

## Version History

| Version | Date | Description |
|---------|------|-------------|
| 0.3.0 | 2025-11-25 | AI chat, auto-sync, design-first scaffolding |
| 0.2.0 | 2024-11-21 | Feature complete, production ready |
| 0.1.0 | 2024-11-01 | Initial development release |
