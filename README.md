# CV-Git

**AI-Native Version Control Layer with Knowledge Graph & Semantic Search**

CV-Git is an intelligent wrapper around Git that adds a knowledge graph, semantic search, and AI-powered code understanding to your development workflow. Think of it as "Git with a brain" - it understands your codebase structure, relationships, and context.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![codecov](https://codecov.io/gh/controlVector/cv-git/graph/badge.svg)](https://codecov.io/gh/controlVector/cv-git)
[![CI](https://github.com/controlVector/cv-git/actions/workflows/ci.yml/badge.svg)](https://github.com/controlVector/cv-git/actions/workflows/ci.yml)

---

## Installation

### Option 1: APT (Debian/Ubuntu) - Recommended

```bash
# Add GPG key
curl -fsSL https://controlvector.github.io/cv-git/gpg.pub | sudo gpg --dearmor -o /usr/share/keyrings/cv-git.gpg

# Add repository
echo "deb [signed-by=/usr/share/keyrings/cv-git.gpg] https://controlvector.github.io/cv-git stable main" | sudo tee /etc/apt/sources.list.d/cv-git.list

# Install
sudo apt update
sudo apt install cv-git
```

### Option 2: Quick Install Script

```bash
curl -fsSL https://raw.githubusercontent.com/controlVector/cv-git/main/install.sh | bash
```

### Option 3: Download .deb directly

```bash
wget https://github.com/controlVector/cv-git/releases/latest/download/cv-git_0.4.23_amd64.deb
sudo dpkg -i cv-git_*.deb
```

### After Installation

```bash
# Verify installation
cv --version

# Check system health
cv doctor

# Start required services (if not running)
docker run -d --name falkordb -p 6379:6379 falkordb/falkordb
docker run -d --name qdrant -p 6333:6333 qdrant/qdrant

# Initialize in your project
cd your-project
cv init

# Build the knowledge graph
cv sync

# Start exploring!
cv find "authentication"
cv explain src/auth/login.ts
```

---

## Prerequisites

| Requirement | Version | Purpose |
|-------------|---------|---------|
| Node.js | 18-22 | Runtime |
| Docker | Any | FalkorDB & Qdrant databases |
| Ollama | Optional | Local embeddings (recommended) |
| Anthropic API Key | Optional | AI features (explain, do, review) |
| OpenAI API Key | Optional | Embeddings (fallback if no Ollama) |

### Configure API Keys

```bash
# Option 1: Local embeddings with Ollama (no API key needed!)
ollama pull nomic-embed-text

# Option 2: Environment variables (for AI features)
export ANTHROPIC_API_KEY=sk-ant-...
export OPENAI_API_KEY=sk-...  # Optional, Ollama is preferred

# Option 3: Use cv auth (stored securely in system keychain)
cv auth set anthropic sk-ant-...
cv auth set openai sk-...
```

---

## Features

### Knowledge Graph
- **AST-based parsing** using Tree-sitter for TypeScript, JavaScript, Python, Go, Rust, Java
- **FalkorDB graph database** for code relationships
- **Call graph extraction** - understand function dependencies
- **Symbol relationships** - imports, exports, inheritance

### Semantic Search
- **Vector embeddings** with OpenAI
- **Qdrant vector database** for fast similarity search
- **Natural language queries** - find code by describing what it does

### AI-Powered Commands
- **`cv explain`** - Get natural language explanations of code
- **`cv do`** - Generate code from task descriptions
- **`cv review`** - AI code review with multi-aspect analysis
- **`cv find`** - Semantic code search across all languages

### Graph Analysis
- **`cv graph stats`** - View knowledge graph statistics
- **`cv graph calls <function>`** - What does this function call?
- **`cv graph called-by <function>`** - What calls this function?
- **`cv graph path --from A --to B`** - Find execution paths
- **`cv graph dead-code`** - Detect unreachable code
- **`cv graph cycles`** - Find circular dependencies
- **`cv graph complexity`** - Find high-complexity functions

### Repository Isolation (Multi-Repo Support)
- **Isolated GraphRAG databases** per repository
- **No cross-contamination** between projects
- **Deterministic repo IDs** from git remote URL or path

### Modern VCS Features
- **`cv absorb`** - Automatically absorb uncommitted changes into relevant commits
- **`cv undo`** - Undo last commit while preserving changes
- **`cv stack`** - Manage stacked branches for incremental reviews
- **`cv split`** - Split a commit into multiple smaller commits
- **`cv smart-log`** - Enhanced git log with graph visualization

### Native Dependency Analysis (C/C++)
- **`cv deps analyze`** - Detect build systems and extract dependencies
- **`cv deps check`** - Verify system availability via pkg-config
- **`cv deps install`** - Generate installation commands for missing dependencies

### Local-First Embeddings
- **Ollama integration** - Local embeddings with `nomic-embed-text` (no API key required)
- **Automatic fallback** to OpenRouter/OpenAI if Ollama unavailable

---

## Usage Examples

### Semantic Search

```bash
# Find authentication code
cv find "authentication logic"

# Search specific language
cv find "database connection" --language python

# Search in directory
cv find "validation" --file src/api
```

### AI Explanation

```bash
# Explain a function
cv explain "authenticateUser"

# Explain a file
cv explain "src/auth/service.py"
```

### AI Code Generation

```bash
# Generate code
cv do "add logging to all API endpoints"

# Preview plan without executing
cv do "refactor auth to use OAuth2" --plan-only
```

### AI Code Review

```bash
# Review staged changes
cv review --staged

# Review specific commit
cv review HEAD
```

---

## Alternative Installation Methods

<details>
<summary><b>From Source (Development)</b></summary>

```bash
# Install pnpm if needed
npm install -g pnpm

# Clone and build
git clone https://github.com/controlVector/cv-git.git
cd cv-git
pnpm install
pnpm build

# Link globally
cd packages/cli && pnpm link --global
```

**System Dependencies (Linux/WSL):**
```bash
# Required for native modules
sudo apt install -y libsecret-1-dev build-essential python3
```

</details>

<details>
<summary><b>Uninstall</b></summary>

```bash
curl -fsSL https://raw.githubusercontent.com/controlVector/cv-git/main/install.sh | bash -s uninstall
```

Or manually:
```bash
sudo rm -rf /usr/local/lib/cv-git
sudo rm -f /usr/local/bin/cv
```

</details>

---

## MCP Server for Claude Desktop

CV-Git includes an MCP server for AI agents like Claude Desktop.

### Setup

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "cv-git": {
      "command": "node",
      "args": ["/path/to/cv-git/packages/mcp-server/dist/index.js"],
      "env": {
        "ANTHROPIC_API_KEY": "your-api-key",
        "OPENAI_API_KEY": "your-api-key"
      }
    }
  }
}
```

See [packages/mcp-server/README.md](packages/mcp-server/README.md) for available tools.

---

## Multi-Language Support

| Language | Extensions | Features |
|----------|-----------|----------|
| TypeScript | `.ts`, `.tsx` | Functions, classes, interfaces, types |
| JavaScript | `.js`, `.jsx`, `.mjs` | Functions, classes, imports/exports |
| Python | `.py` | Functions, classes, methods, decorators |
| Go | `.go` | Functions, methods, structs, interfaces |
| Rust | `.rs` | Functions, structs, enums, traits, impl blocks |
| Java | `.java` | Classes, interfaces, enums, methods |

---

## Troubleshooting

### `cv` command not found after install
```bash
# Add to PATH
export PATH="/usr/local/bin:$PATH"
```

### FalkorDB/Qdrant connection errors
```bash
# Check if containers are running
docker ps

# Start if needed
docker start falkordb qdrant
```

### Native module errors
```bash
# Rebuild native modules
cd /usr/local/lib/cv-git
sudo npm rebuild
```

### Check system health
```bash
cv doctor
```

---

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for details.

---

## License

MIT License - see [LICENSE](LICENSE) for details.

---

**Built with love for the open source community**
