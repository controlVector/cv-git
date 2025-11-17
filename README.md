# CV-Git 🚀

**AI-Native Version Control Layer with Knowledge Graph & Semantic Search**

CV-Git is an intelligent wrapper around Git that adds a knowledge graph, semantic search, and AI-powered code understanding to your development workflow. Think of it as "Git with a brain" - it understands your codebase structure, relationships, and context to provide powerful AI-assisted development features.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)

---

## ✨ Features

### 🧠 Knowledge Graph
- **AST-based parsing** using Tree-sitter
- **FalkorDB graph database** for code relationships
- **Call graph extraction** - understand function dependencies
- **Symbol relationships** - imports, exports, inheritance

### 🔍 Semantic Search
- **Vector embeddings** with OpenAI
- **Qdrant vector database** for similarity search
- **Natural language queries** - find code by describing what it does
- **Context-aware results** with relevance scoring

### 🤖 AI-Powered Commands
- **`cv explain`** - Get natural language explanations of code
- **`cv do`** - Generate code from task descriptions
- **`cv review`** - AI code review with multi-aspect analysis
- **`cv find`** - Semantic code search

### 📊 Code Intelligence
- **`cv graph`** - Query and visualize code relationships
- **`cv sync`** - Build/update knowledge graph and embeddings
- **Git passthrough** - All standard git commands work seamlessly

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

## 📖 Usage Examples

### Semantic Search

```bash
cv find "authentication logic"
cv find "database connection pooling"
cv find "validation" --language typescript --file src/api
```

### AI Explanation

```bash
cv explain "authenticateUser"
cv explain "how does error handling work?"
```

### AI Code Generation

```bash
cv do "add logging to all API endpoints"
cv do "refactor auth to use OAuth2" --plan-only
```

### AI Code Review

```bash
cv review --staged
cv review HEAD
cv review abc1234 --context
```

### Graph Queries

```bash
cv graph stats
cv graph calls authenticateUser
cv graph imports src/auth/service.ts --dependents
```

For detailed usage, see the [full documentation](docs/).

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
