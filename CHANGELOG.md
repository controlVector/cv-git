# Changelog

All notable changes to CV-Git will be documented in this file.

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
| 0.2.0 | 2024-11-21 | Feature complete, production ready |
| 0.1.0 | 2024-11-01 | Initial development release |
