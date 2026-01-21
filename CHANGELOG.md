# Changelog

All notable changes to CV-Git will be documented in this file.

## [0.5.0] - 2026-01-21

### Added

#### Privilege Configuration System
- **User/Root Mode Support** - CV-Git can now run in either root mode or user mode
  - `user` mode: Everything runs in user scope (rootless Docker, local installs, user services)
  - `root` mode: Full system access (Docker, global installs, system services)
  - `auto` mode: Automatically detects the appropriate mode based on environment
  - XDG Base Directory spec compliance on Linux for user mode paths

- **Global Configuration** - New `~/.config/cv-git/config.json` for system-wide settings
  - Configure privilege mode, container runtime, database connections
  - AI provider settings, credential storage preferences
  - `cv config global-init` - Interactive setup wizard

- **Credential Service** - Secure credential management with fallbacks
  - Keychain/keyring integration (via keytar)
  - Encrypted file storage fallback (AES-256-CBC)
  - Environment variable support
  - Priority: env vars > keychain > encrypted file

- **Container Service** - Docker/Podman container management
  - `getContainerService()` - Manage CV-Git containers (FalkorDB, Qdrant)
  - Rootless container support detection
  - Docker Compose v1/v2 compatibility
  - Auto-generate docker-compose.yml for user mode

#### Enhanced CLI Commands
- **`cv config privilege`** - Show privilege mode configuration
  - Displays configured vs detected mode
  - Shows data paths and container runtime status
  - Rootless detection and recommendations

- **`cv config global-init`** - Interactive global setup
  - Configure privilege mode
  - Select container runtime (Docker, Podman, external)
  - Choose credential storage method
  - Rootless container preferences

- **`cv doctor`** - New diagnostic checks
  - Privilege Mode check (configured vs detected, running as root warning)
  - Container Runtime check (status, rootless, recommendations)

#### Installation Improvements
- **Linux Install Script** - Updated `install.sh` with privilege mode support
  - Auto-detect user vs system mode
  - XDG Base Directory compliant paths for user mode
  - Docker/Podman detection with rootless preference
  - Global configuration creation

- **Mac Install Script** - New `scripts/install-mac.sh`
  - macOS-specific paths (Library/Application Support, Library/Caches)
  - LaunchAgent support for optional auto-start
  - Docker Desktop detection and setup

### Changed
- Version bump to 0.5.0 (major feature release)
- Install scripts now create global CV-Git configuration
- Doctor command includes privilege and container runtime checks

---

## [0.4.25] - 2026-01-21

### Added

#### Performance Enhancements
- **GraphService Caching** - All graph query methods now use LRU caching for improved performance
  - `findPath()`, `findAllPaths()`, `getNeighborhood()`, `getImpactAnalysis()`, `findBridge()` all cached
  - Cache uses the global CacheService with graph namespace
  - Significant speedup for repeated queries

- **In-Memory Cache Statistics** - New `cv cache memory` command
  - View hit/miss statistics for graph, vector, and AI caches
  - `--json` flag for programmatic access
  - `--clear` flag to reset all in-memory caches

#### New MCP Tools
- **`cv_graph_neighborhood`** - Explore the neighborhood of a symbol
  - Shows callers, callees, and related code within a configurable radius
  - Groups results by distance from the center symbol
  - Supports direction filtering (incoming, outgoing, both)

- **`cv_graph_impact`** - Analyze the impact of changing a symbol
  - Risk assessment (low/medium/high/critical) based on caller count
  - Lists direct and indirect callers, implementors, and extenders
  - Shows affected files and total impact count

- **`cv_graph_bridge`** - Find connections between two symbols
  - Discovers paths connecting distant parts of the codebase
  - Shows multiple connection paths with relationship types
  - Useful for understanding code dependencies

- **`cv_summary_view`** - Get high-level codebase summary
  - Multiple aspects: overview, architecture, patterns, statistics
  - Displays architecture patterns, conventions, and key abstractions
  - Requires `cv summary --regenerate` to generate initial summary

#### Enhanced Diff Command
- **`cv diff --explain`** - AI-powered explanation of changes
  - Generates human-readable explanation of what the changes do
  - Works with `--impact` to include change impact analysis

- **`cv diff --review`** - AI-powered code review
  - Analyzes changes for bugs, security issues, and code quality
  - `--strict` flag for more thorough review

- **`cv diff --conventional`** - Generate conventional commit message
  - Creates commit message in conventional format (feat/fix/refactor/etc.)
  - Scopes automatically detected from changed files

### Changed
- `cv cache stats` now focuses on embedding cache (use `cv cache memory` for in-memory stats)
- `cv diff --analyze` is now basic analysis (no AI required)

---

## [0.4.23] - 2026-01-14

### Added

#### Repository Isolation for Multi-Repo Support
- **GraphRAG Database Isolation** - Each repository now gets its own isolated FalkorDB and Qdrant storage
  - FalkorDB: Databases named `cv_{repoId}` (e.g., `cv_d8cb6fc6bb1b`)
  - Qdrant: Collections prefixed with `{repoId}_` (e.g., `abc123_code_chunks`)
  - Prevents cross-contamination when using cv-git across multiple repositories
  - Repository ID generated from git remote URL or path (stable, deterministic 12-char hex)

#### Native Dependency Analysis (`cv deps`)
- **`cv deps analyze`** - Detect build systems and extract dependencies for C/C++ projects
- **`cv deps check`** - Verify system availability via pkg-config, headers, and libraries
- **`cv deps install`** - Generate installation commands for missing dependencies
- Supports: CMake, Meson, SCons, and Autotools build systems

#### Tree-sitter Improvements
- **Node 24+ Support** - Using `@keqingmoe/tree-sitter` fork for Node.js 24 compatibility
- **Optional Tree-sitter** - Falls back to simple regex-based parser if tree-sitter unavailable
- Removed 32KB file size limit by upgrading to tree-sitter 0.25.0

#### Test Coverage
- Added 42 unit tests for repository isolation feature
- Tests cover repo-id generation, GraphManager, and VectorManager isolation

### Fixed
- **Cypher Query Parameter Corruption** - Fixed bug where `$author` corrupted `$authorEmail` in queries
- **Unicode Quote Escaping** - Expanded Cypher string escaping for Unicode and control characters

---

## [0.4.20] - 2026-01-10

### Added

#### Ollama Local Embeddings (Default)
- **Ollama as Default Provider** - Local embeddings using `nomic-embed-text` model
- No API keys required for basic functionality
- Falls back to OpenRouter/OpenAI if Ollama unavailable

#### Sync Error Reporting
- **`sync-report.json`** - Detailed sync error reports saved to `.cv/` directory
- Helps diagnose parsing and sync failures

### Fixed
- **Node.js Version Requirements** - Documented support for Node 18-22 (not 24+)
- **cv context Embeddings** - Fixed to use Ollama for embeddings

---

## [0.4.14] - 2026-01-08

### Added

#### Authentication Improvements
- **npm Token Support** - New 'publish' auth category for npm registry tokens
- **Auth Setup URLs** - Fixed npm settings URL in auth setup instructions

#### Modern VCS Features
- **`cv absorb`** - Automatically absorb uncommitted changes into relevant commits
- **`cv undo`** - Undo last commit while preserving changes
- **`cv stack`** - Manage stacked branches for incremental reviews
- **`cv split`** - Split a commit into multiple smaller commits
- **`cv smart-log`** - Enhanced git log with graph visualization

#### Bug Reporting
- **`cv bug`** - Submit bug reports with system diagnostics

### Fixed
- **Cypher String Escaping** - Enhanced escaping for Unicode and control characters
- **Windows Build** - Removed glob patterns in esbuild externals for Windows compatibility

---

## [0.4.7] - 2026-01-05

### Added

#### Cross-Platform Support
- **Windows Builds** - Native `.exe` executables for Windows x64
- **macOS Universal** - Support for both Intel (x64) and Apple Silicon (ARM64)
- **Improved Release Workflow** - Automated builds for Linux, Windows, and macOS

#### Git Integration Enhancements
- **Auto-Initialize Git** - `cv init` now automatically initializes git repository if needed
- **Initial Commit Creation** - Creates initial commit when auto-initializing

#### Auth Categories
- New credential type system with categories (ai, platform, publish)
- Improved CLI for credential management

### Fixed
- **Word-Boundary Regex** - Fixed Cypher parameter replacement to use word boundaries
- **Default Model ID** - Use valid model ID in default configuration

---

## [0.4.0] - 2025-12-30

### Added

#### AI Context Integration (Phase 1-5)

**cv_auto_context MCP Tool**
- New recommended first-call tool for AI coding assistants
- Provides optimized context for system prompts
- Includes semantic code matches, call graph relationships, and documentation
- Token budget control for efficient context usage

**cv watch Command**
- Real-time file watching with automatic knowledge graph sync
- Configurable debounce (default 1000ms)
- Desktop notifications support (`--notify`)
- Supports `.cvignore` patterns

**MCP Resources**
- `cv://status` - Repository status (TTL: 30s)
- `cv://stats` - Knowledge graph statistics (TTL: 60s)
- `cv://recent-commits` - Last 10 commits (TTL: 30s)
- `cv://modified-files` - Modified files list (TTL: 10s)
- `cv://hotspots` - Most-called functions (TTL: 300s)

**Version-Aware Tools**
- `cv_commits` - List commits, filter by file/author
- `cv_file_history` - File modification history with diff stats
- `cv_blame` - Commit attribution for files and symbols

**Commit Sync**
- Commits now synced to knowledge graph during `cv sync`
- MODIFIES edges link commits to files they changed
- Tracks insertions/deletions per file modification
- Configurable depth (default: 50 commits)

**Documentation Tools**
- `cv_docs_search` - Semantic search across documentation
- `cv_docs_ingest` - Add documents to knowledge graph
- `cv_docs_list` - List documents with filtering

#### Infrastructure

**Structured Logging**
- Configurable log levels via `CV_LOG_LEVEL` (error, warn, info, debug)
- JSON output mode via `CV_LOG_JSON=true`
- Debug mode via `CV_DEBUG=true`
- Timing instrumentation for performance analysis

**Test Suite**
- 201 vitest unit tests covering core functionality
- MCP integration tests for tool validation
- Logger, resources, auto-context test coverage

### Changed

- Delta sync now includes commit history sync
- `cv sync --incremental` uses proper deltaSync with commits
- Improved FalkorDB query parameter handling (prefix collision fix)

### Fixed

- FalkorDB parameter replacement bug where `$author` corrupted `$authorEmail`
- `git.getCommit()` now properly retrieves commits by SHA
- Logger test TypeScript type compatibility
- MCP Resources error handling for edge cases

---

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
| 0.4.25 | 2026-01-21 | Performance caching, new MCP tools, enhanced diff |
| 0.4.23 | 2026-01-14 | Repository isolation, cv deps, tree-sitter improvements |
| 0.4.20 | 2026-01-10 | Ollama local embeddings, sync error reporting |
| 0.4.14 | 2026-01-08 | Modern VCS features, npm auth, bug reporting |
| 0.4.7 | 2026-01-05 | Cross-platform builds, auto-init git |
| 0.4.0 | 2025-12-30 | AI context integration, version-aware tools |
| 0.3.0 | 2025-11-25 | AI chat, auto-sync, design-first scaffolding |
| 0.2.0 | 2024-11-21 | Feature complete, production ready |
| 0.1.0 | 2024-11-01 | Initial development release |
