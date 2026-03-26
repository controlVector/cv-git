# CV-Git

**AI-native version control with a code knowledge graph, semantic search, and deploy orchestration.**

[![npm](https://img.shields.io/npm/v/@controlvector/cv-git)](https://www.npmjs.com/package/@controlvector/cv-git)
[![CI](https://github.com/controlVector/cv-git/actions/workflows/ci.yml/badge.svg)](https://github.com/controlVector/cv-git/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)

CV-Git wraps Git with a code knowledge graph, vector search, and AI commands so you can search, explain, review, and generate code from natural language. It also serves as an MCP server for Claude Desktop and Claude Code.

---

## Platform Support

| Platform | Status | Graph Backend | Server Required? |
|---|---|---|---|
| Linux x64 | Supported | FalkorDB (embedded via falkordblite) | No |
| macOS arm64 | Supported | FalkorDB (embedded via falkordblite) | No |
| Windows 10/11 x64 | Supported | LadybugDB (embedded) | No |
| CV-Hub server | Supported | FalkorDB (remote) | Yes (Docker) |

> **Windows** uses LadybugDB as a fully embedded graph database — no Docker, no server process, no configuration required. When FalkorDB ships native Windows binaries, CV-Git will migrate automatically with no user-facing changes.

---

## Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| Node.js | >= 20 | Runtime |
| Ollama | Optional | Local embeddings with `nomic-embed-text` (no API key needed) |
| Anthropic API key | Optional | Powers `cv explain`, `cv do`, `cv review` |

No Docker is required for local development on any platform. The graph database runs embedded.

---

## Installation

```bash
# Global install (recommended)
npm install -g @controlvector/cv-git

# Or run without installing
npx @controlvector/cv-git --help
```

### Uninstall

```bash
npm uninstall -g @controlvector/cv-git
```

---

## Quick Start

```bash
# Verify installation
cv --version

# Check system health
cv doctor

# Initialize CV-Git in your project
cd your-project
cv init

# Build the knowledge graph
cv sync

# Search your codebase with natural language
cv find "authentication logic"

# Explain a file or symbol
cv explain src/auth/login.ts
```

---

## Backend Configuration

The graph backend is auto-detected based on your platform. Override with the `CV_GIT_GRAPH_BACKEND` environment variable:

| Value | When to Use |
|---|---|
| *(unset)* | Auto-detect (recommended) |
| `falkordblite` | Force embedded FalkorDB (Linux/macOS) |
| `ladybugdb` | Force LadybugDB (Windows) |
| `redis` | Remote FalkorDB server (CV-Hub, Docker) |

---

## Commands

### AI-powered

| Command | Description |
|---|---|
| `cv find <query>` | Semantic code search across all languages |
| `cv explain <target>` | Natural language explanation of a file, function, or concept |
| `cv do <task>` | Generate code from a task description (`--plan-only` to preview) |
| `cv review [ref]` | AI code review with security, quality, and style analysis |
| `cv chat [question]` | Interactive AI chat with codebase context |
| `cv context <query>` | Generate context snippets for AI coding assistants |

### Knowledge graph

| Command | Description |
|---|---|
| `cv sync` | Build or update the knowledge graph from your repo |
| `cv graph stats` | Knowledge graph statistics |
| `cv graph calls <fn>` | What does this function call? |
| `cv graph called-by <fn>` | What calls this function? |
| `cv graph path --from A --to B` | Find execution paths between symbols |
| `cv graph dead-code` | Detect unreachable code |
| `cv graph cycles` | Find circular dependencies |
| `cv graph complexity` | Find high-complexity functions |

### Git wrappers

CV-Git wraps common Git commands and adds knowledge graph sync on operations that change the working tree:

`cv add`, `cv commit`, `cv push`, `cv pull`, `cv checkout`, `cv switch`, `cv merge`, `cv branch`, `cv stash`, `cv diff`, `cv log`, `cv fetch`, `cv remote`, `cv reset`, `cv revert`, `cv tag`

### Advanced Git

| Command | Description |
|---|---|
| `cv absorb` | Absorb staged changes into the appropriate prior commits |
| `cv undo [target]` | Undo the last operation using reflog |
| `cv stack` | Manage stacked branches for incremental reviews |
| `cv split [commit]` | Split a commit into smaller commits |

### Deploy orchestration

| Command | Description |
|---|---|
| `cv deploy init <target>` | Generate a deploy config template |
| `cv deploy push <target>` | Deploy through the full lifecycle |
| `cv deploy status <target>` | Show health status |
| `cv deploy rollback <target>` | Rollback to previous version |
| `cv deploy list` | List all deploy targets |
| `cv deploy report` | Generate deploy status report |

Supported providers: DigitalOcean Kubernetes (DOKS), SSH, Fly.io, Docker Compose.

### Other

| Command | Description |
|---|---|
| `cv doctor` | Diagnostics and health checks (`--fix` to auto-repair) |
| `cv init` | Initialize CV-Git in the current repo |
| `cv auth` | Credential management (`setup`, `list`, `login`, `status`) |
| `cv pr` | Pull request management |
| `cv release` | Release management |
| `cv deps` | Native dependency analysis (C/C++ build systems) |
| `cv docs` | Documentation management and search |
| `cv agent` | Listen for CV-Hub task dispatch and execute with Claude Code |
| `cv connect` | Show instructions for linking Claude Code to this machine |

Run `cv --help` for the full list. Every subcommand supports `--help`.

---

## MCP Server

CV-Git includes an MCP server for Claude Desktop and Claude Code.

### Setup (Claude Desktop)

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `~/.config/claude/claude_desktop_config.json` (Linux):

```json
{
  "mcpServers": {
    "cv-git": {
      "command": "node",
      "args": ["/path/to/cv-git/packages/mcp-server/dist/index.js"],
      "env": {
        "ANTHROPIC_API_KEY": "your-key"
      }
    }
  }
}
```

### MCP Tools

| Tool | Purpose |
|---|---|
| `cv_find` | Semantic code search |
| `cv_explain` | Code explanations |
| `cv_do` | AI code generation |
| `cv_review` | Code review |
| `cv_graph_path` | Find paths between symbols |
| `cv_graph_neighborhood` | Explore symbol relationships |
| `cv_graph_impact` | Analyze change impact |
| `cv_traverse_context` | Traversal-aware dynamic context |
| `cv_context` | Generate AI context for a query |
| `cv_auto_context` | Automatic context assembly |
| `cv_status` | Repository and graph status |
| `cv_sync` | Trigger knowledge graph sync |

See [packages/mcp-server/](packages/mcp-server/) for full documentation.

---

## Language Support

| Language | Extensions | Parsed Symbols |
|---|---|---|
| TypeScript | `.ts`, `.tsx` | Functions, classes, interfaces, types |
| JavaScript | `.js`, `.jsx`, `.mjs` | Functions, classes, imports/exports |
| Python | `.py` | Functions, classes, methods, decorators |
| Go | `.go` | Functions, methods, structs, interfaces |
| Rust | `.rs` | Functions, structs, enums, traits, impl blocks |
| Java | `.java` | Classes, interfaces, enums, methods |

---

## Configure Credentials

```bash
# Local embeddings (recommended, no API key needed)
ollama pull nomic-embed-text

# AI features need an Anthropic key:
export ANTHROPIC_API_KEY=sk-ant-...
# or
cv auth setup anthropic

# Optional: OpenAI/OpenRouter for embeddings if you don't use Ollama
cv auth setup openai
```

---

## Contributing

```bash
git clone https://github.com/controlVector/cv-git.git
cd cv-git
npm install -g pnpm   # if you don't have pnpm
pnpm install && pnpm build
pnpm test
```

System dependencies for building native modules on Linux:

```bash
sudo apt install -y libsecret-1-dev build-essential
```

The CI matrix tests on both `ubuntu-latest` (falkordblite backend) and `windows-latest` (LadybugDB backend).

---

## Troubleshooting

```bash
# First step for any issue
cv doctor

# cv command not found after npm install?
npm config get prefix   # shows /usr/local or ~/.npm-global
export PATH="$(npm config get prefix)/bin:$PATH"
```

---

## Related Projects

- [CV-Hub](https://hub.controlvector.io) — AI-native Git platform (web app)
- [CV-Agent](https://www.npmjs.com/package/@controlvector/cv-agent) (`cva`) — Remote task dispatch daemon for CV-Hub

---

## License

MIT — see [LICENSE](LICENSE).
