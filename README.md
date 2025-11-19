# CV-Git 🚀

**AI-Native Version Control Layer with Knowledge Graph & Semantic Search**

CV-Git is an intelligent wrapper around Git that adds a knowledge graph, semantic search, and AI-powered code understanding to your development workflow. Think of it as "Git with a brain" - it understands your codebase structure, relationships, and context to provide powerful AI-assisted development features.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)

---

## ✨ Features

### 🧠 Knowledge Graph
- **AST-based parsing** using Tree-sitter for 5+ languages
- **Multi-language support**: TypeScript, JavaScript, Python, Go, Rust, Java
- **FalkorDB graph database** with advanced query capabilities
- **Call graph extraction** - understand function dependencies
- **Symbol relationships** - imports, exports, inheritance, implementations
- **Advanced analysis**: path finding, dead code detection, complexity analysis

### 🔍 Semantic Search
- **Vector embeddings** with OpenAI for natural language search
- **Qdrant vector database** for fast similarity search
- **Natural language queries** - find code by describing what it does
- **Context-aware results** with relevance scoring
- **Full-text search** across all code entities

### 🤖 AI-Powered Commands
- **`cv explain`** - Get natural language explanations of code
- **`cv do`** - Generate code from task descriptions
- **`cv review`** - AI code review with multi-aspect analysis
- **`cv find`** - Semantic code search across all languages

### 📊 Advanced Code Intelligence
- **`cv graph`** - Query and visualize code relationships
- **Call path analysis** - Find execution paths between functions
- **Dead code detection** - Identify unreachable code
- **Complexity analysis** - Find high-complexity functions needing refactoring
- **Circular dependency detection** - Identify architectural issues
- **Hot spot analysis** - Find most-called functions for optimization

### 🔌 MCP Server Integration
- **20 MCP tools** for AI agents (Claude Desktop, etc.)
- **Code understanding**: semantic search, explain, graph queries
- **Code modification**: task execution, code review, sync
- **Platform integration**: GitHub PRs, releases
- **System operations**: diagnostics, configuration, status
- **Advanced analysis**: path finding, complexity, dead code, cycles, hotspots

### 🛠️ Developer Experience
- **`cv sync`** - Build/update knowledge graph and embeddings
- **Git passthrough** - All standard git commands work seamlessly
- **Incremental updates** - Fast syncing of only changed files
- **Production-ready** - Zero compilation errors, comprehensive error handling

---

## 🎯 Quick Start

### Prerequisites

- **Node.js 18+**
- **pnpm** (required for workspace dependencies)
- **Docker** (for FalkorDB and Qdrant)
- **API Keys:**
  - [Anthropic API key](https://console.anthropic.com/) (for AI features)
  - [OpenAI API key](https://platform.openai.com/) (for embeddings)

### Installation

```bash
# Install pnpm if you haven't already
npm install -g pnpm

# Clone the repository
git clone https://github.com/controlVector/cv-git.git
cd cv-git

# Install dependencies (pnpm required for monorepo)
pnpm install

# Build the project
pnpm build

# Link CLI globally
pnpm link --global
```

> **Note:** This project uses pnpm workspaces. npm and yarn are not currently supported.

### Start Required Services

```bash
# Start FalkorDB (knowledge graph)
docker run -d --name falkordb -p 6379:6379 falkordb/falkordb

# Start Qdrant (vector database)
docker run -d --name qdrant -p 6333:6333 qdrant/qdrant
```

### Configure API Keys

```bash
# Set environment variables
export ANTHROPIC_API_KEY=sk-ant-...
export OPENAI_API_KEY=sk-...

# Or create .env file in your project
cat > .env << EOF
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
EOF
```

### Initialize Your Repository

```bash
# Navigate to your project
cd /path/to/your/project

# Initialize CV-Git
cv init

# Sync your codebase
cv sync
```

---

## 🌍 Multi-Language Support

CV-Git understands and analyzes code in multiple languages:

| Language | Extensions | Features Supported |
|----------|-----------|-------------------|
| **TypeScript** | `.ts`, `.tsx` | Functions, classes, interfaces, types, imports/exports |
| **JavaScript** | `.js`, `.jsx`, `.mjs`, `.cjs` | Functions, classes, imports/exports |
| **Python** | `.py`, `.pyi`, `.pyw` | Functions, classes, methods, decorators, `__all__` exports |
| **Go** | `.go` | Functions, methods, structs, interfaces, exported names |
| **Rust** | `.rs` | Functions, structs, enums, traits, impl blocks, pub items |
| **Java** | `.java` | Classes, interfaces, enums, methods, constructors |

All languages support:
- ✅ Symbol extraction (functions, classes, methods)
- ✅ Call graph analysis
- ✅ Import/export tracking
- ✅ Complexity calculation
- ✅ Semantic search
- ✅ AI-powered explanations

---

## 📖 Usage Examples

### Semantic Search (Works Across All Languages)

```bash
# Find authentication code in any language
cv find "authentication logic"

# Search specific language
cv find "database connection" --language python

# Search in specific directory
cv find "validation" --file src/api
```

### AI Explanation

```bash
# Explain a function
cv explain "authenticateUser"

# Explain a concept
cv explain "how does error handling work?"

# Explain a file
cv explain "src/auth/service.py"
```

### AI Code Generation

```bash
# Generate code
cv do "add logging to all API endpoints"

# Preview plan without executing
cv do "refactor auth to use OAuth2" --plan-only

# Auto-approve execution
cv do "add input validation" --auto-approve
```

### AI Code Review

```bash
# Review staged changes
cv review --staged

# Review specific commit
cv review HEAD

# Review with context
cv review abc1234 --context
```

### Graph Queries

```bash
# Get graph statistics
cv graph stats

# Find what a function calls
cv graph calls authenticateUser

# Find what calls a function
cv graph called-by processPayment

# View file dependencies
cv graph imports src/auth/service.ts

# List all functions in Python
cv graph functions --language python
```

### Advanced Analysis

```bash
# Find execution path between functions
cv graph path --from main --to processPayment

# Detect dead code
cv graph dead-code

# Find complex functions (complexity > 10)
cv graph complexity --threshold 10

# Detect circular dependencies
cv graph cycles

# Find hot spots (most-called functions)
cv graph hotspots --limit 20
```

For detailed usage, see the [full documentation](docs/).

---

## 🔌 MCP Server for Claude Desktop

CV-Git includes a Model Context Protocol (MCP) server that exposes all functionality to AI agents like Claude Desktop.

### Setup

1. **Build the MCP server**:
```bash
cd cv-git
pnpm build
```

2. **Configure Claude Desktop**:

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

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

3. **Restart Claude Desktop**

### Available MCP Tools (20 total)

**Code Understanding (8 tools)**
- `cv_find` - Semantic code search
- `cv_explain` - AI-powered code explanation
- `cv_graph_query` - Query code relationships
- `cv_graph_stats` - Graph statistics
- `cv_graph_inspect` - Inspect symbols and files
- `cv_graph_path` - Find execution paths
- `cv_graph_complexity` - Find complex functions
- `cv_graph_hotspots` - Find most-called functions

**Code Analysis (3 tools)**
- `cv_graph_dead_code` - Detect unreachable code
- `cv_graph_cycles` - Find circular dependencies
- `cv_graph_search` - Full-text entity search

**Code Modification (3 tools)**
- `cv_do` - AI task execution
- `cv_review` - AI code review
- `cv_sync` - Update knowledge graph

**Platform Integration (4 tools)**
- `cv_pr_create` - Create GitHub PRs
- `cv_pr_list` - List PRs
- `cv_pr_review` - Review PR details
- `cv_release_create` - Create releases

**System Operations (2 tools)**
- `cv_config_get` - Get configuration
- `cv_status` - Repository status
- `cv_doctor` - Run diagnostics

See [packages/mcp-server/README.md](packages/mcp-server/README.md) for detailed tool documentation.

---

## 💰 Cost Estimates

- **OpenAI Embeddings:** ~$0.50/month (1,000 functions)
- **Claude API:** ~$20-30/month (regular usage)
- **Total:** ~$25-35/month for active development

---

## 🤝 Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for details.

---

## 📄 License

MIT License - see [LICENSE](LICENSE) for details.

---

## 📚 Documentation

- [Architecture Overview](ARCHITECTURE.md)
- [Graph Commands](GRAPH_COMMANDS.md)
- [Vector Search](VECTOR_SEARCH_COMPLETE.md)
- [AI Features](AI_FEATURES_COMPLETE.md)

---

**Built with ❤️ for the open source community**
