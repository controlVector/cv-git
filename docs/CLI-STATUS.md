# CV-Git CLI Implementation Status

> Last Updated: January 2026

This document provides a comprehensive overview of CV-Git CLI commands, their implementation status, and usage instructions.

## Quick Start

```bash
# Install CV-Git
npm install -g @controlvector/cv-git

# Initialize in your repository
cv init

# Sync the knowledge graph
cv sync

# Search your codebase
cv find "authentication logic"

# Verify your installation
cv verify --quick
```

## Command Reference

### Fully Implemented Commands

#### Core Workflow

| Command | Description | Example |
|---------|-------------|---------|
| `cv init` | Initialize CV-Git in repository | `cv init --yes` |
| `cv sync` | Sync knowledge graph with repo | `cv sync --delta` |
| `cv find <query>` | Semantic code search | `cv find "error handling"` |
| `cv explain <target>` | AI code explanation | `cv explain src/auth.ts` |
| `cv do <task>` | Execute task with AI | `cv do "add logging"` |
| `cv status` | Show CV-Git status | `cv status --json` |
| `cv doctor` | Run health diagnostics | `cv doctor --fix` |
| `cv verify` | Verify CLI commands work | `cv verify --quick` |

#### Configuration

| Command | Description | Example |
|---------|-------------|---------|
| `cv config list` | List all configuration | `cv config list --json` |
| `cv config get <key>` | Get config value | `cv config get ai.model` |
| `cv config set <key> <value>` | Set config value | `cv config set ai.model claude-3-opus` |
| `cv config path` | Show config file path | `cv config path` |
| `cv config reset` | Reset to defaults | `cv config reset` |

#### Authentication & Credentials

| Command | Description | Example |
|---------|-------------|---------|
| `cv auth setup` | Interactive credential setup | `cv auth setup` |
| `cv auth setup <category>` | Setup by category | `cv auth setup dns` |
| `cv auth setup <provider>` | Setup specific provider | `cv auth setup cloudflare` |
| `cv auth list` | List stored credentials | `cv auth list` |
| `cv auth test <service>` | Test credential validity | `cv auth test github` |
| `cv auth remove <type> <name>` | Remove credentials | `cv auth remove git_platform_token github-user` |

**Auth Categories:**
- `git/` - GitHub, GitLab, Bitbucket
- `ai/` - Anthropic, OpenAI, OpenRouter
- `dns/` - Cloudflare
- `devops/` - AWS, DigitalOcean (token, spaces, app)

**Examples:**
```bash
cv auth setup                    # Interactive category selection
cv auth setup dns                # Setup all DNS providers
cv auth setup dns/cloudflare     # Setup Cloudflare only
cv auth setup devops/aws         # Setup AWS IAM credentials
cv auth setup devops/digitalocean # Setup DigitalOcean ecosystem
cv auth test cloudflare          # Test Cloudflare token
cv auth test aws                 # Test AWS credentials
```

#### Git Platform Integration

| Command | Description | Example |
|---------|-------------|---------|
| `cv pr create` | Create pull request | `cv pr create --draft` |
| `cv pr list` | List pull requests | `cv pr list --state open` |
| `cv pr view <number>` | View PR details | `cv pr view 123` |
| `cv pr merge <number>` | Merge pull request | `cv pr merge 123` |
| `cv release create` | Create release | `cv release create v1.0.0` |
| `cv release list` | List releases | `cv release list` |
| `cv clone <url>` | Clone with CV-Git init | `cv clone https://github.com/org/repo` |
| `cv clone-group <url>` | Clone GitLab group | `cv clone-group https://gitlab.com/group` |

#### AI Features

| Command | Description | Example |
|---------|-------------|---------|
| `cv context <query>` | Generate AI context | `cv context "auth flow" --format xml` |
| `cv chat [question]` | Interactive AI chat | `cv chat "how does auth work?"` |
| `cv code [instruction]` | AI-powered editing | `cv code "add error handling"` |
| `cv review [ref]` | AI code review | `cv review --staged` |

#### Knowledge Graph

| Command | Description | Example |
|---------|-------------|---------|
| `cv graph stats` | Graph statistics | `cv graph stats` |
| `cv graph files` | List indexed files | `cv graph files --sort complexity` |
| `cv graph symbols` | List symbols | `cv graph symbols --kind function` |
| `cv graph calls <symbol>` | Show call graph | `cv graph calls handleAuth` |

#### Git Integration

| Command | Description | Example |
|---------|-------------|---------|
| `cv push` | Push with auto-sync | `cv push origin main` |
| `cv pull` | Pull with auto-sync | `cv pull --rebase` |
| `cv commit` | Commit with AI message | `cv commit --generate` |
| `cv git <command>` | Git passthrough | `cv git log --oneline` |

#### Documentation & Cache

| Command | Description | Example |
|---------|-------------|---------|
| `cv docs list` | List indexed docs | `cv docs list` |
| `cv docs search <query>` | Search documentation | `cv docs search "API design"` |
| `cv cache stats` | Embedding cache stats | `cv cache stats` |
| `cv cache clear` | Clear embedding cache | `cv cache clear` |

#### PRD Management

| Command | Description | Example |
|---------|-------------|---------|
| `cv prd list` | List PRDs | `cv prd list` |
| `cv prd show <id>` | Show PRD details | `cv prd show PRD-001` |
| `cv prd sync` | Sync with PRD server | `cv prd sync` |
| `cv import <path>` | Import PRD export | `cv import export.cvx` |

---

#### Git Hooks

| Command | Description | Example |
|---------|-------------|---------|
| `cv hooks install` | Install git hooks | `cv hooks install` |
| `cv hooks uninstall` | Remove git hooks | `cv hooks uninstall` |
| `cv hooks list` | List installed hooks | `cv hooks list --all` |
| `cv hooks status` | Show hooks status | `cv hooks status` |

#### User Preferences

| Command | Description | Example |
|---------|-------------|---------|
| `cv preferences list` | Show preferences | `cv prefs list` |
| `cv preferences get <key>` | Get preference value | `cv prefs get git-platform` |
| `cv preferences set <key> <value>` | Set preference | `cv prefs set ai-provider openrouter` |
| `cv preferences reset` | Reset preferences | `cv prefs reset` |
| `cv preferences path` | Show prefs file path | `cv prefs path` |

---

### Partial Implementation

These commands are functional but have limitations:

| Command | Status | Limitation |
|---------|--------|------------|
| `cv watch` | Works | Limited configuration options |
| `cv design` | Design Only | PRD integration incomplete |
| `cv services` | Partial | Service discovery incomplete |

---

### Global Options

All commands support these global options:

```bash
--json      # Output as JSON (for scripting)
--quiet     # Suppress output
--verbose   # Show debug information
--options   # Show available options for this command
--help      # Show help for command
```

**Example:**
```bash
cv sync --options          # Show sync command options
cv sync --options --json   # Options in JSON format
cv status --json           # Machine-readable status
cv doctor --verbose        # Detailed diagnostics
```

---

## Service Dependencies

CV-Git uses several backend services that are auto-provisioned via Docker:

### Required Services

| Service | Purpose | Auto-Start |
|---------|---------|------------|
| **FalkorDB** | Knowledge graph database | Yes (Docker) |
| **Qdrant** | Vector search database | Yes (Docker) |

### API Keys Required

| Provider | Purpose | Setup |
|----------|---------|-------|
| **OpenRouter** | AI chat, code editing | `cv auth setup ai/openrouter` |
| **Anthropic** | AI explanations (fallback) | `cv auth setup ai/anthropic` |
| **GitHub/GitLab** | Platform integration | `cv auth setup git` |
| **Cloudflare** | DNS management (optional) | `cv auth setup dns/cloudflare` |
| **AWS** | Cloud infrastructure (optional) | `cv auth setup devops/aws` |
| **DigitalOcean** | Cloud infrastructure (optional) | `cv auth setup devops/digitalocean` |

### Dependency Matrix

```
Command Category          FalkorDB    Qdrant    AI API    Platform
─────────────────────────────────────────────────────────────────
Basic (config, doctor)    -           -         -         -
Search (find)             Optional    Required  Required  -
AI (chat, code, explain)  Optional    Optional  Required  -
Graph (graph, sync)       Required    Optional  -         -
Platform (pr, release)    -           -         -         Required
```

---

## Verification

Run the built-in verification to check your installation:

```bash
# Quick verification (no service dependencies)
cv verify --quick

# Full verification (requires services)
cv verify --all

# JSON output for CI/CD
cv verify --json
```

**Expected Output:**
```
🔍 CV-Git Command Verification

✓ version
✓ config list
✓ doctor
✓ status
...

Summary:
  ✓ 12 passed

✅ All tests passed! (100% pass rate)
```

---

## Troubleshooting

### Common Issues

**Services not starting:**
```bash
cv doctor              # Check service health
cv services discover   # Find available services
```

**Credentials not working:**
```bash
cv auth list           # Check stored credentials
cv auth test github    # Test specific credential
cv auth setup          # Re-run setup
```

**Sync failures:**
```bash
cv sync --full         # Force full sync
cv sync --force        # Rebuild graph from scratch
cv cache clear         # Clear embedding cache
```

### Getting Help

```bash
cv --help              # General help
cv <command> --help    # Command-specific help
cv <command> --options # Show available options
```

---

## Roadmap

### Coming Soon

- **MCP Gateway**: Centralized MCP tool routing and management
- **AI Security Scanner**: SAST, secret detection, dependency scanning
- **Enhanced Design Command**: Full PRD integration

### Planned Improvements

1. Finish `design` command PRD integration
2. Enhanced `services` discovery
3. Expanded test coverage
4. Additional cloud provider integrations

---

## Contributing

Report issues or request features at:
https://github.com/anthropics/cv-git/issues

---

*Generated with CV-Git v0.4.6*
