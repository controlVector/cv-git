# CV-Git CLI Commands Reference

**Version:** 0.2.0
**Last Updated:** 2025-11-17

Complete reference guide for all CV-Git CLI commands.

---

## Table of Contents

- [Global Options](#global-options)
- [Setup Commands](#setup-commands)
  - [cv init](#cv-init)
  - [cv auth](#cv-auth)
  - [cv config](#cv-config)
- [Core Workflow](#core-workflow)
  - [cv sync](#cv-sync)
  - [cv status](#cv-status)
  - [cv doctor](#cv-doctor)
- [AI Features](#ai-features)
  - [cv find](#cv-find)
  - [cv do](#cv-do)
  - [cv explain](#cv-explain)
  - [cv review](#cv-review)
- [Platform Integration](#platform-integration)
  - [cv pr](#cv-pr)
  - [cv release](#cv-release)
- [Advanced](#advanced)
  - [cv graph](#cv-graph)
  - [cv git](#cv-git)

---

## Global Options

All commands support these global flags for consistent behavior:

| Flag | Description |
|------|-------------|
| `--json` | Output results as JSON for scripting/automation |
| `--quiet` | Suppress non-essential output |
| `--verbose` | Show detailed debug information |
| `--help` | Show help for the command |

**Examples:**
```bash
cv status --json                    # Machine-readable output
cv sync --quiet                     # Silent operation
cv doctor --verbose                 # Detailed diagnostics
```

---

## Setup Commands

### cv init

Initialize CV-Git in a repository.

**Usage:**
```bash
cv init [options]
```

**Options:**
| Option | Description | Default |
|--------|-------------|---------|
| `--name <name>` | Repository name | Directory name |
| `--json` | JSON output | false |
| `--quiet` | Suppress output | false |
| `--verbose` | Verbose output | false |

**Examples:**
```bash
# Initialize in current directory
cv init

# Initialize with custom name
cv init --name my-project

# Initialize with JSON output
cv init --json
```

**What it does:**
1. Creates `.cv/` directory
2. Initializes configuration
3. Sets up cache and session directories
4. Prepares repository for CV-Git

**Next steps after init:**
```bash
# 1. Set up credentials
cv auth setup

# 2. Sync your repository
cv sync

# 3. Start using AI features
cv find "authentication logic"
```

---

### cv auth

Manage credentials for AI services and platforms.

**Usage:**
```bash
cv auth <command> [options]
```

**Commands:**

#### cv auth setup
Interactive setup for credentials.

```bash
cv auth setup
```

Prompts for:
- Anthropic API key (Claude)
- OpenAI API key (GPT/embeddings)
- GitHub token (optional)

#### cv auth list
List all stored credentials.

```bash
cv auth list
cv auth list --json
```

#### cv auth get
Get a specific credential.

```bash
cv auth get <service>

# Examples:
cv auth get anthropic
cv auth get openai
cv auth get github
```

#### cv auth set
Set a credential value.

```bash
cv auth set <service> <key>

# Examples:
cv auth set anthropic sk-ant-...
cv auth set openai sk-...
cv auth set github ghp_...
```

#### cv auth remove
Remove a credential.

```bash
cv auth remove <service>

# Example:
cv auth remove github
```

**Security:**
- Credentials stored in system keychain (macOS/Linux)
- Encrypted file fallback if keychain unavailable
- Never logged or displayed in plain text

---

### cv config

Manage CV-Git configuration.

**Usage:**
```bash
cv config <command> [options]
```

**Commands:**

#### cv config list
Show all configuration settings.

```bash
cv config list
cv config list --json
```

**Output:**
```
📋 CV-Git Configuration

Version: 0.2.0
Platform: github

AI Configuration:
  Model: claude-3-5-sonnet-20241022
  Max Tokens: 4096

Graph Database (FalkorDB):
  URL: redis://localhost:6379
  Database: cv-git

Vector Database (Qdrant):
  URL: http://localhost:6333
  Collection: cv-code

Features:
  AI Commit Messages: true
  Auto Review: false
  Smart Merge: true
```

#### cv config get
Get a specific configuration value.

```bash
cv config get <key>

# Examples:
cv config get ai.model
cv config get platform.type
cv config get features.aiCommitMessages
```

Supports nested keys with dot notation.

#### cv config set
Set a configuration value.

```bash
cv config set <key> <value>

# Examples:
cv config set ai.model claude-3-opus-20240229
cv config set features.aiCommitMessages false
cv config set graph.url redis://localhost:6380
```

**Auto-type detection:**
- `true`/`false` → boolean
- Numbers → number
- Everything else → string

#### cv config reset
Reset configuration to defaults.

```bash
cv config reset
```

**Warning:** This will erase all custom settings. Prompts for confirmation.

#### cv config edit
Open configuration file in editor.

```bash
cv config edit
```

Uses `$VISUAL` or `$EDITOR` environment variable.

#### cv config path
Show configuration file location.

```bash
cv config path
```

**Output:**
```
~/.cv/config.json
```

**Configuration Structure:**
```json
{
  "version": "0.2.0",
  "platform": {
    "type": "github",
    "url": "https://api.github.com"
  },
  "ai": {
    "model": "claude-3-5-sonnet-20241022",
    "maxTokens": 4096
  },
  "graph": {
    "url": "redis://localhost:6379",
    "database": "cv-git"
  },
  "vector": {
    "url": "http://localhost:6333",
    "collections": "cv-code"
  },
  "features": {
    "aiCommitMessages": true,
    "autoReview": false,
    "smartMerge": true
  }
}
```

---

## Core Workflow

### cv sync

Synchronize the knowledge graph with your repository.

**Usage:**
```bash
cv sync [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--incremental` | Only sync changed files |
| `--force` | Force full rebuild of graph |
| `--json` | JSON output |
| `--quiet` | Suppress output |
| `--verbose` | Show detailed progress |

**Examples:**
```bash
# Full sync
cv sync

# Incremental sync (faster)
cv sync --incremental

# Force full rebuild
cv sync --force

# Silent sync for scripts
cv sync --quiet
```

**What it does:**
1. Parses source files
2. Extracts symbols (functions, classes, variables)
3. Builds knowledge graph in FalkorDB
4. Creates embeddings for semantic search (if OpenAI key configured)
5. Tracks relationships between code elements

**When to sync:**
- After initial `cv init`
- After major code changes
- Before using AI features
- Regularly in CI/CD

**Performance:**
- Initial sync: ~1-2 min for medium project
- Incremental: ~5-10 seconds
- Depends on: File count, languages, complexity

---

### cv status

Show CV-Git status and health.

**Usage:**
```bash
cv status [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--json` | JSON output |

**Examples:**
```bash
cv status
cv status --json
```

**Output:**
```
📊 CV-Git Status

Git Repository:
  Branch: main
  M 4 file(s) modified

CV-Git:
  Status: ✓ Initialized
  Last Sync: 2 hours ago
  Files: 142
  Symbols: 1,847
  Embeddings: 1,203

Services:
  ✓ FalkorDB: Running
  ✓ Qdrant: Running
```

**JSON Output:**
```json
{
  "git": {
    "branch": "main",
    "ahead": 0,
    "behind": 0,
    "modified": 4,
    "created": 0,
    "deleted": 0
  },
  "cvGit": {
    "initialized": true,
    "lastSync": "2024-11-17T20:00:00.000Z",
    "stats": {
      "files": 142,
      "symbols": 1847,
      "embeddings": 1203
    }
  },
  "services": {
    "FalkorDB": { "healthy": true },
    "Qdrant": { "healthy": true }
  }
}
```

---

### cv doctor

Run health diagnostics.

**Usage:**
```bash
cv doctor [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--json` | JSON output |
| `--fix` | Attempt automatic fixes (future) |

**Examples:**
```bash
cv doctor
cv doctor --json
```

**Checks:**
1. ✓ Git Installation
2. ✓ Git Repository
3. ✓ Node.js Version (>= 18)
4. ✓ pnpm Installation
5. ⚠ CV-Git Initialization
6. ✓ Configuration Validity
7. ⚠ Credentials Stored
8. ✓ FalkorDB Connectivity
9. ⚠ Qdrant Connectivity
10. ✓ Disk Space
11. ✓ Network Connectivity

**Output:**
```
🔍 Running CV-Git Diagnostics...

✓ Git Installation
  git version 2.43.0

✓ Node.js Version
  v18.19.1 (>= 18.0.0 required)

⚠ Qdrant (Vector Search)
  Not available
  → Fix: Start Qdrant: docker run -d --name qdrant -p 6333:6333 qdrant/qdrant

Summary:
  ✓ 8 passed
  ⚠ 3 warnings
```

**Exit Codes:**
- `0` - All checks passed or warnings only
- `1` - One or more checks failed

---

## AI Features

### cv find

Semantic search over your codebase.

**Usage:**
```bash
cv find <query> [options]
```

**Options:**
| Option | Description | Default |
|--------|-------------|---------|
| `-l, --limit <n>` | Max results | 10 |
| `--language <lang>` | Filter by language | all |
| `--file <path>` | Filter by file path | all |
| `--min-score <score>` | Minimum similarity (0-1) | 0.5 |
| `--json` | JSON output | false |
| `--quiet` | Suppress output | false |
| `--verbose` | Verbose output | false |

**Examples:**
```bash
# Basic search
cv find "authentication logic"

# Limit results
cv find "error handling" --limit 5

# Filter by language
cv find "database queries" --language typescript

# Filter by file path
cv find "API endpoints" --file "src/api"

# Lower threshold for more results
cv find "validation" --min-score 0.3

# JSON output for automation
cv find "test helpers" --json
```

**How it works:**
1. Converts query to embedding using OpenAI
2. Searches vector database for similar code
3. Ranks by semantic similarity
4. Returns relevant code chunks

**Requirements:**
- OpenAI API key configured
- Repository synced with `cv sync`
- Qdrant running

**Output:**
```
Search results for: "authentication logic"
────────────────────────────────────────────────────────────────────────────────

1. authenticateUser (85.3% match)
   src/auth/login.ts:45-67 • typescript
   Authenticates user credentials and returns session token

   │ async function authenticateUser(email: string, password: string) {
   │   const user = await db.users.findOne({ email });
   │   if (!user) throw new Error('User not found');
   │
   │   const valid = await bcrypt.compare(password, user.passwordHash);
   │   if (!valid) throw new Error('Invalid password');
   │   ...

2. validateToken (78.1% match)
   src/auth/middleware.ts:12-28 • typescript
   ...
```

---

### cv do

Execute tasks with AI assistance.

**Usage:**
```bash
cv do <task> [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--plan-only` | Generate plan without code |
| `--yes` | Skip approval prompts |

**Examples:**
```bash
# Generate and apply changes
cv do "add logging to error handlers"

# Plan only (no code generation)
cv do "refactor authentication module" --plan-only

# Auto-approve (use with caution)
cv do "fix typos in comments" --yes
```

**How it works:**
1. Analyzes task using AI
2. Searches codebase for relevant context
3. Generates execution plan
4. Shows plan for approval
5. Generates and applies code changes
6. Creates commit with changes

**Interactive Flow:**
```
🤖 Analyzing task: "add logging to error handlers"

📊 Found relevant context:
  - src/utils/errors.ts (error handling)
  - src/middleware/errorHandler.ts (middleware)
  - src/logger.ts (logging utility)

📋 Execution Plan:
  1. Import logger in errorHandler.ts
  2. Add log statements to each error handler
  3. Include error details and stack traces
  4. Update error response format

Approve this plan? [y/N]: y

✨ Generating code...
📝 Creating commit...

✅ Task completed!
```

**Best Practices:**
- Review plan carefully before approval
- Use `--plan-only` for complex changes
- Start with small, focused tasks
- Verify changes before committing

---

### cv explain

Get AI explanations of code.

**Usage:**
```bash
cv explain <symbol> [options]
```

**Arguments:**
- `<symbol>` - Function/class/variable name to explain

**Examples:**
```bash
# Explain a function
cv explain authenticateUser

# Explain a class
cv explain AuthService

# Explain a complex algorithm
cv explain calculateOptimalRoute
```

**Output:**
```
🔍 Explaining: authenticateUser

📍 Location: src/auth/login.ts:45-67

📖 Purpose:
Authenticates a user by validating their email and password against
the database. Returns a session token on successful authentication.

⚙️ How it works:
1. Looks up user by email in database
2. Compares provided password with stored hash using bcrypt
3. Generates and returns a JWT session token if valid
4. Throws descriptive errors for invalid credentials

🔗 Dependencies:
- db.users.findOne() - User lookup
- bcrypt.compare() - Password verification
- generateSessionToken() - Token creation

📞 Used by:
- loginHandler() in src/api/auth.ts
- refreshToken() in src/api/auth.ts

💡 Notes:
- Uses bcrypt for secure password hashing
- Throws errors that should be caught by error middleware
- Session tokens expire after 24 hours
```

---

### cv review

AI code review.

**Usage:**
```bash
cv review [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--staged` | Review staged changes only |
| `--commit <sha>` | Review specific commit |

**Examples:**
```bash
# Review current changes
cv review

# Review staged changes
cv review --staged

# Review specific commit
cv review --commit abc123
```

**What it reviews:**
- Code quality and style
- Potential bugs
- Security issues
- Performance concerns
- Best practices
- Documentation gaps

**Output:**
```
🔍 AI Code Review

📁 Files changed: 3

src/auth/login.ts
  ⚠️  Line 52: Password comparison should use constant-time comparison
      Consider using crypto.timingSafeEqual for security

  💡 Line 45: Consider adding input validation for email format

  ✅ Line 60: Good error handling

src/api/auth.ts
  🐛 Line 28: Potential null pointer - user might be undefined
      Add null check before accessing user.id

  📝 Line 15: Missing JSDoc comment for public API

Summary:
  ⚠️  2 warnings
  🐛 1 bug
  💡 1 suggestion
  📝 1 documentation
```

---

## Platform Integration

### cv pr

Manage pull requests.

**Usage:**
```bash
cv pr <command> [options]
```

**Commands:**

#### cv pr create
Create a pull request.

```bash
cv pr create [options]

# Options:
  --title <title>      PR title
  --body <body>        PR description
  --base <branch>      Base branch (default: main)
  --draft              Create as draft PR
```

**Examples:**
```bash
# Interactive creation
cv pr create

# With title and description
cv pr create --title "Add authentication" --body "Implements JWT auth"

# Create draft PR
cv pr create --draft
```

#### cv pr list
List pull requests.

```bash
cv pr list [options]

# Options:
  --state <state>      State: open, closed, all (default: open)
  --author <user>      Filter by author
  --limit <n>          Max results (default: 10)
```

#### cv pr view
View PR details.

```bash
cv pr view <number>

# Example:
cv pr view 42
```

#### cv pr review
Review a pull request.

```bash
cv pr review <number>

# Example:
cv pr review 42
```

Provides AI-powered code review of the PR.

---

### cv release

Manage releases.

**Usage:**
```bash
cv release <command> [options]
```

**Commands:**

#### cv release create
Create a new release.

```bash
cv release create <version> [options]

# Options:
  --title <title>      Release title
  --notes <notes>      Release notes
  --draft              Create as draft
  --prerelease         Mark as pre-release
```

**Examples:**
```bash
# Create release with auto-generated notes
cv release create v1.2.0

# Create with custom notes
cv release create v1.2.0 --notes "Bug fixes and improvements"

# Create draft release
cv release create v2.0.0 --draft
```

#### cv release list
List releases.

```bash
cv release list [--limit <n>]
```

---

## Advanced

### cv graph

Query the knowledge graph directly.

**Usage:**
```bash
cv graph <query> [options]
```

**Query Types:**

#### Relationship Queries
```bash
# Find what calls a function
cv graph calls authenticateUser

# Find what a function calls
cv graph called-by loginHandler

# Find what imports a module
cv graph imports ./utils/errors

# Find what a file exports
cv graph exports src/auth/login.ts
```

#### Structure Queries
```bash
# List all functions
cv graph functions

# List all classes
cv graph classes

# List files by language
cv graph files --language typescript
```

**Examples:**
```bash
cv graph calls handleRequest
cv graph imports lodash
cv graph functions --file src/api
```

---

### cv git

Execute git commands with CV-Git awareness.

**Usage:**
```bash
cv git <git-command> [args]
```

**Examples:**
```bash
# Standard git commands work
cv git status
cv git log
cv git diff

# CV-Git enhances certain commands
cv git commit    # AI-generated commit message
cv git merge     # Smart conflict resolution
```

**Enhanced Commands:**
- `commit` - AI-generated commit messages
- `merge` - AI-assisted conflict resolution
- `rebase` - Smart rebase with context

---

## Common Workflows

### Initial Setup
```bash
# 1. Initialize repository
cv init

# 2. Set up credentials
cv auth setup

# 3. Initial sync
cv sync

# 4. Verify everything works
cv doctor
```

### Daily Development
```bash
# Check status
cv status

# Find relevant code
cv find "feature I'm working on"

# Make changes with AI help
cv do "add validation to user input"

# Sync changes
cv sync --incremental
```

### Code Review
```bash
# Review your changes
cv review

# Create PR
cv pr create

# Review teammate's PR
cv pr review 123
```

### Troubleshooting
```bash
# Run diagnostics
cv doctor

# Check configuration
cv config list

# Verify services
cv status

# Full rebuild if needed
cv sync --force
```

---

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `ANTHROPIC_API_KEY` | Claude API key | - |
| `OPENAI_API_KEY` | OpenAI API key | - |
| `GITHUB_TOKEN` | GitHub personal access token | - |
| `CV_DEBUG` | Enable debug logging | false |
| `VISUAL` / `EDITOR` | Editor for `cv config edit` | vi |

**Example:**
```bash
export ANTHROPIC_API_KEY=sk-ant-...
export OPENAI_API_KEY=sk-...
export GITHUB_TOKEN=ghp_...
```

---

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | General error |
| 2 | Invalid arguments |
| 3 | Configuration error |
| 4 | Service unavailable |

---

## Getting Help

```bash
# General help
cv --help

# Command help
cv <command> --help

# Examples:
cv config --help
cv find --help
cv do --help
```

**Resources:**
- Documentation: https://github.com/controlVector/cv-git
- Issues: https://github.com/controlVector/cv-git/issues
- Discussions: https://github.com/controlVector/cv-git/discussions

---

**Last Updated:** 2025-11-17
**Version:** 0.2.0
