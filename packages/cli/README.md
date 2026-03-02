# @controlvector/cv-git

**AI-Native Version Control Layer with Knowledge Graph & Semantic Search**

CV-Git (`cv`) is an intelligent CLI wrapper around Git that adds a knowledge graph, semantic search, and AI-powered code understanding to your development workflow.

## Install

```bash
npm install -g @controlvector/cv-git
```

Requires Node.js >= 18.

## Quick Start

```bash
# Authenticate with your CV-Hub instance
cv auth login

# Initialize in a project
cd your-project
cv init -y

# Start Claude Code with full context
claude
```

## Key Commands

| Command | Description |
|---------|-------------|
| `cv init` | Initialize CV-Git in a repository |
| `cv auth login` | Authenticate with CV-Hub |
| `cv doctor` | Run diagnostics and health checks |
| `cv connect` | Link a Claude.ai conversation to this machine |
| `cv sync` | Synchronize the knowledge graph |
| `cv context <query>` | Generate AI context from the knowledge graph |
| `cv code [instruction]` | AI-powered code editing with graph context |
| `cv push` / `cv pull` | Git push/pull with automatic graph sync |
| `cv commit` | Commit with identity from stored credentials |
| `cv status` | Show CV-Git status |

Run `cv --help` for the full command list.

## What It Does

- **Knowledge Graph** — Builds a graph of your codebase (functions, classes, imports, call sites) for structural retrieval
- **Semantic Search** — Vector embeddings for natural-language code queries
- **Claude Code Integration** — Hooks into Claude Code sessions to provide rich codebase context automatically
- **Machine Registration** — Connects your dev machines to CV-Hub so Claude.ai can dispatch tasks to them

## Documentation

- [GitHub Repository](https://github.com/controlVector/cv-git)
- [CV-Hub](https://hub.controlvector.io)

## License

MIT
