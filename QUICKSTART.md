# CV-Git Quick Start Guide

This guide will help you get CV-Git running in development mode and test the MVP as it's being built.

## 🚀 Setup

### 1. Install Dependencies

```bash
# Ensure you have the right tools
node --version  # Should be >= 18.0.0
pnpm --version  # Should be >= 8.0.0

# If you don't have pnpm:
npm install -g pnpm

# Clone and install
git clone <your-repo-url>
cd cv-git
pnpm install
```

### 2. Build the Project

```bash
# Build all packages
pnpm build
```

### 3. Link the CLI Globally (Optional)

```bash
cd packages/cli
npm link
cd ../..
```

Or use it directly:
```bash
# From project root
node packages/cli/dist/index.js --help
```

### 4. Set Up API Keys

Create a `.env` file or export environment variables:

```bash
export CV_ANTHROPIC_KEY="sk-ant-api03-your-key-here"
export CV_OPENAI_KEY="sk-your-openai-key-here"
```

### 5. Set Up Services

#### Option A: Docker (Recommended)

```bash
# FalkorDB
docker run -d --name falkordb -p 6379:6379 falkordb/falkordb:latest

# Qdrant
docker run -d --name qdrant -p 6333:6333 qdrant/qdrant:latest
```

#### Option B: Local Installation

- **FalkorDB**: Follow [FalkorDB installation guide](https://www.falkordb.com/docs/install/)
- **Qdrant**: Follow [Qdrant installation guide](https://qdrant.tech/documentation/quick-start/)

---

## 🧪 Testing the MVP

### Test 1: Initialize CV-Git

```bash
# Create a test repository
mkdir test-repo
cd test-repo
git init

# Create some sample files
echo "console.log('hello')" > index.js
git add . && git commit -m "initial commit"

# Initialize CV-Git
cv init

# Expected: Should create .cv/ directory with config.json
ls -la .cv/
cat .cv/config.json
```

### Test 2: Check Configuration

```bash
# Verify config was created
cat .cv/config.json

# Should see:
# - Repository info
# - LLM settings (Anthropic)
# - Embedding settings (OpenAI)
# - Graph settings (FalkorDB)
# - Vector settings (Qdrant)
```

### Test 3: Git Passthrough

```bash
# Test git passthrough
cv git status
cv git log

# Should work identically to regular git commands
```

### Test 4: Stub Commands

```bash
# These will show "not yet implemented" messages
cv sync
cv find "test query"
cv do "add a function"
cv explain "index.js"
cv graph calls
```

---

## 🔧 Development Workflow

### Making Changes

```bash
# 1. Make changes to source code
vim packages/core/src/git/index.ts

# 2. Rebuild
pnpm build

# 3. Test
cv init --name test
```

### Watch Mode

For faster iteration:

```bash
# Terminal 1: Watch mode for all packages
pnpm dev

# Terminal 2: Test commands
cv init
```

### Running Tests (when implemented)

```bash
pnpm test
```

---

## 📝 Next Steps for Development

### Phase 1: Complete Core Infrastructure ✅

Current status: **Complete**
- [x] CLI framework
- [x] Git integration
- [x] Config management

### Phase 2: Implement Graph Sync (Current Focus)

**Priority tasks:**

1. **Implement FalkorDB Connection** (`packages/core/src/graph/index.ts`)
   ```typescript
   import { createClient } from 'redis';
   // Connect to FalkorDB via Redis protocol
   // Implement Cypher query execution
   ```

2. **Implement Tree-sitter Parser** (`packages/core/src/parser/index.ts`)
   ```typescript
   import Parser from 'tree-sitter';
   import TypeScript from 'tree-sitter-typescript';
   // Parse files and extract symbols
   ```

3. **Implement Sync Engine** (`packages/core/src/sync/index.ts`)
   ```typescript
   // Orchestrate: Files → Parser → Graph → Vectors
   ```

4. **Connect Sync Command** (`packages/cli/src/commands/sync.ts`)
   ```typescript
   import { createSyncEngine } from '@cv-git/core';
   // Wire up to sync engine
   ```

### Phase 3: Implement Vector Search

1. **Qdrant Integration** (`packages/core/src/vector/index.ts`)
2. **OpenAI Embeddings**
3. **Semantic Search**
4. **Wire up `cv find` command**

### Phase 4: Implement AI Orchestration

1. **Claude API Integration** (`packages/core/src/ai/index.ts`)
2. **Context Assembly**
3. **Plan Generation**
4. **Wire up `cv do` and `cv explain`**

---

## 🐛 Troubleshooting

### "Command not found: cv"

```bash
# Option 1: Link globally
cd packages/cli && npm link

# Option 2: Use directly
node packages/cli/dist/index.js

# Option 3: Add to PATH
export PATH="$PATH:$(pwd)/packages/cli/dist"
```

### "Configuration not loaded"

```bash
# Make sure you're in a CV-Git initialized directory
cv init

# Or check if .cv/config.json exists
ls -la .cv/
```

### "Failed to connect to FalkorDB/Qdrant"

```bash
# Check if services are running
docker ps

# Start services if needed
docker start falkordb qdrant

# Or check connection settings in .cv/config.json
```

### Build Errors

```bash
# Clean and rebuild
pnpm clean
pnpm install
pnpm build
```

### TypeScript Errors

```bash
# Check TypeScript version
tsc --version  # Should be 5.3+

# Rebuild with verbose output
pnpm build --verbose
```

---

## 📚 Useful Commands

```bash
# Build everything
pnpm build

# Build in watch mode
pnpm dev

# Run tests
pnpm test

# Lint code
pnpm lint

# Clean build artifacts
pnpm clean

# Check package structure
tree -L 3 packages/

# View CLI help
cv --help
cv init --help
cv do --help
```

---

## 🧑‍💻 Development Tips

1. **Use TypeScript watch mode** for faster iteration:
   ```bash
   cd packages/core && pnpm dev
   ```

2. **Test in a separate directory** to avoid polluting your dev environment:
   ```bash
   mkdir ../test-cv-repo && cd ../test-cv-repo
   ../cv-git/packages/cli/dist/index.js init
   ```

3. **Enable debug logging** (when implemented):
   ```bash
   export CV_DEBUG=true
   cv sync
   ```

4. **Use a test repository** with known structure:
   ```bash
   git clone https://github.com/simple-example/repo test-repo
   cd test-repo
   cv init
   ```

---

## 🎯 Testing Checklist

As features are implemented, use this checklist:

### Core CLI
- [ ] `cv init` creates .cv/ directory
- [ ] `cv init` generates valid config.json
- [ ] `cv git` passes through to git correctly
- [ ] Commands show proper help text
- [ ] Errors are displayed with color and stack traces

### Graph Sync
- [ ] `cv sync` parses TypeScript files
- [ ] `cv sync` creates File nodes in FalkorDB
- [ ] `cv sync` creates Symbol nodes for functions/classes
- [ ] `cv sync` creates IMPORTS relationships
- [ ] `cv sync` creates CALLS relationships
- [ ] Incremental sync only processes changed files

### Vector Search
- [ ] Embeddings are generated for code chunks
- [ ] `cv find` returns relevant results
- [ ] Results are ranked by relevance
- [ ] Multiple languages are supported

### AI Features
- [ ] `cv explain` provides accurate explanations
- [ ] `cv do` generates reasonable plans
- [ ] Plans show affected files
- [ ] Diffs are syntactically correct
- [ ] User can approve/reject changes

---

## 📖 Additional Resources

- [ARCHITECTURE.md](./ARCHITECTURE.md) - System design
- [DATA_MODELS.md](./DATA_MODELS.md) - Graph schema
- [README.md](./README.md) - Main documentation

---

**Ready to build the future of AI-native version control!** 🚀
