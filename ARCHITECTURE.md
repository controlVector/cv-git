# CV-Git Architecture Design

## 1. System Overview

CV-Git is a layered architecture that combines:
- **Git Core**: Traditional version control (via libgit2 bindings)
- **Knowledge Graph**: FalkorDB for code relationships and semantic structure
- **Vector Layer**: Embeddings for semantic search and AI context
- **AI Orchestration**: LLM-powered command interpretation and code generation
- **CLI Interface**: `cv` command as the primary user-facing interface

### Architecture Principles
1. **Git-First**: All changes flow through Git; the graph/vector layer is queryable metadata
2. **Incremental Sync**: Graph updates triggered by git hooks and explicit `cv sync`
3. **Stateless CLI**: Each `cv` command is independent; state lives in Git + FalkorDB + local config
4. **AI as Orchestrator**: AI doesn't write code directly; it generates plans → diffs → commits

---

## 2. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        cv CLI                                │
│  (Commander.js / oclif / Cobra - single binary)             │
└────────────┬────────────────────────────────────────────────┘
             │
     ┌───────┴───────┐
     │               │
┌────▼─────┐   ┌────▼──────────────────────────────────────┐
│   Git    │   │        Core Orchestrator                   │
│ Compat   │   │  (Command Router + Context Manager)        │
│  Layer   │   └────┬───────────────────────────────────────┘
└──────────┘        │
                    │
        ┌───────────┼───────────┬─────────────┐
        │           │           │             │
   ┌────▼────┐ ┌───▼─────┐ ┌───▼──────┐ ┌───▼─────────┐
   │  Graph  │ │ Vector  │ │   AST    │ │     AI      │
   │  Sync   │ │ Manager │ │  Parser  │ │ Orchestrator│
   │ Engine  │ │         │ │          │ │             │
   └────┬────┘ └───┬─────┘ └───┬──────┘ └───┬─────────┘
        │          │           │            │
   ┌────▼──────────▼───────────▼────────────▼──────────┐
   │           Storage & Data Layer                     │
   │  ┌──────────┐  ┌───────────┐  ┌─────────────┐    │
   │  │ FalkorDB │  │  Vector   │  │  Git Repo   │    │
   │  │  (Graph) │  │    DB     │  │   (.git)    │    │
   │  │          │  │ (Qdrant/  │  │             │    │
   │  │          │  │  Chroma)  │  │             │    │
   │  └──────────┘  └───────────┘  └─────────────┘    │
   └────────────────────────────────────────────────────┘
```

---

## 3. Core Components

### 3.1 CLI Layer (`cv`)

**Responsibilities:**
- Parse user commands
- Route to appropriate handlers
- Manage interactive flows (TUI, prompts, streaming)
- Output formatting (syntax highlighting, markdown, diffs)

**Key Commands:**
```bash
cv init                    # Initialize CV-Git in repo
cv sync                    # Rebuild knowledge graph
cv do "<task>"             # AI-driven feature implementation
cv chat                    # Interactive AI session
cv explain "<target>"      # Semantic explanation
cv refactor "<intent>"     # AI-guided refactoring
cv find "<query>"          # Semantic search
cv graph <subcommand>      # Graph queries
cv git <args>              # Git passthrough
```

**Tech Stack Options:**
- **Node.js**: `oclif` (Salesforce CLI framework) or `commander.js`
- **Go**: `cobra` (kubectl-style CLI)
- **Rust**: `clap` (high-performance, single binary)
- **Python**: `click` or `typer`

**MVP Choice**: **Node.js + oclif** (fastest prototyping, good LLM integration libraries)

---

### 3.2 Git Compatibility Layer

**Responsibilities:**
- Wrap Git operations via libgit2 bindings (or shell out to `git`)
- Trigger graph sync on commits/pulls/merges
- Manage `.cv/` directory for metadata

**Implementation:**
- **Node.js**: `nodegit` or `isomorphic-git`
- **Go**: `go-git`
- **Rust**: `git2-rs`

**Key Operations:**
```typescript
interface GitCompat {
  init(path: string): void
  getCurrentBranch(): string
  getFileHistory(path: string): Commit[]
  onCommit(callback: (commit: Commit) => void): void
  createBranch(name: string): void
  diff(commitA: string, commitB: string): Diff
}
```

**Git Hooks Integration:**
```bash
.git/hooks/post-commit    → cv sync --incremental
.git/hooks/post-merge     → cv sync --incremental
.git/hooks/post-checkout  → cv sync --incremental
```

---

### 3.3 AST Parser & Code Analysis

**Responsibilities:**
- Parse source files into ASTs
- Extract symbols (functions, classes, variables)
- Build dependency graphs (imports, calls, inheritance)
- Compute embeddings for code chunks

**Tech Stack:**
- **Tree-sitter**: Universal parser (supports 40+ languages)
- **Language-specific parsers**:
  - TypeScript/JavaScript: `@typescript-eslint/parser`
  - Python: `ast` module
  - Go: `go/parser`
  - Rust: `syn`

**Output:**
```typescript
interface ParsedFile {
  path: string
  language: string
  symbols: Symbol[]        // functions, classes, vars
  imports: Import[]
  exports: Export[]
  chunks: CodeChunk[]      // for embedding
}

interface Symbol {
  name: string
  kind: 'function' | 'class' | 'variable' | 'interface'
  range: Range
  docstring?: string
  signature?: string
}
```

---

### 3.4 Graph Sync Engine

**Responsibilities:**
- Translate AST → FalkorDB graph
- Maintain node/edge mappings
- Handle incremental updates
- Compute graph metrics (PageRank, centrality)

**Graph Schema** (see Section 4)

**Sync Modes:**
1. **Full Sync** (`cv sync`): Rebuild entire graph
2. **Incremental Sync** (post-commit hook): Update only changed files
3. **Delta Sync**: Diff-based updates

**Pseudocode:**
```typescript
async function syncToGraph(files: ParsedFile[]) {
  const tx = await falkor.beginTransaction()

  for (const file of files) {
    // Create/update File node
    const fileNode = await tx.merge('File', { path: file.path })

    for (const symbol of file.symbols) {
      // Create Symbol node
      const symNode = await tx.merge('Symbol', {
        name: symbol.name,
        kind: symbol.kind,
        file: file.path,
        range: symbol.range
      })

      // Create DEFINES edge
      await tx.merge('DEFINES', fileNode, symNode)
    }

    for (const imp of file.imports) {
      // Create IMPORTS edge
      await tx.merge('IMPORTS', fileNode, { path: imp.source })
    }
  }

  await tx.commit()
}
```

---

### 3.5 Vector Database Manager

**Responsibilities:**
- Generate embeddings for code chunks, docstrings, commit messages
- Store in vector DB (Qdrant, Chroma, or Pinecone)
- Provide semantic search API
- Sync embeddings with graph updates

**Vector DB Choice (MVP):**
- **Qdrant** (local + cloud, good Rust SDK)
- **Chroma** (local-first, Python-native)
- **pgvector** (if using PostgreSQL for other state)

**Embedding Model:**
- **OpenAI `text-embedding-3-small`** (1536 dims, fast, cheap)
- **CodeBERT** / **StarCoder Embeddings** (code-specific)
- **voyage-code-2** (specialized for code)

**Collections:**
```typescript
interface VectorCollections {
  codeChunks: {
    id: string           // file:line_start:line_end
    text: string         // actual code
    embedding: number[]
    metadata: {
      file: string
      language: string
      symbolName?: string
      symbolKind?: string
    }
  }

  docstrings: {
    id: string
    text: string
    embedding: number[]
    metadata: {
      symbolName: string
      file: string
    }
  }

  commits: {
    id: string           // commit SHA
    message: string
    embedding: number[]
    metadata: {
      author: string
      date: string
      files: string[]
    }
  }
}
```

---

### 3.6 AI Orchestrator

**Responsibilities:**
- Interpret natural language commands
- Retrieve context from graph + vectors
- Generate execution plans
- Stream diffs and explanations
- Manage LLM conversations (chat sessions)

**Architecture:**
```typescript
interface AIOrchestrator {
  // Command interpretation
  interpretCommand(command: string, type: CommandType): Plan

  // Context retrieval
  getRelevantContext(query: string): Context

  // Plan generation
  generatePlan(task: string, context: Context): Plan

  // Code generation
  generateDiff(plan: Plan, context: Context): Diff[]

  // Explanation
  explain(target: string, context: Context): string

  // Chat session
  chat(message: string, session: Session): Response
}
```

**LLM Integration:**
- **Primary**: Anthropic Claude (Sonnet 3.5/4) via API
- **Fallback**: OpenAI GPT-4
- **Local**: Ollama + DeepSeek Coder / CodeLlama

**Context Assembly:**
```typescript
async function getContextForTask(task: string): Context {
  // 1. Semantic search in vector DB
  const relevantChunks = await vectorDB.search(task, k=10)

  // 2. Graph query for related symbols
  const relatedSymbols = await graph.query(`
    MATCH (s:Symbol)
    WHERE s.name CONTAINS $keyword
    RETURN s
  `, { keyword: extractKeyword(task) })

  // 3. Get file history if task mentions specific files
  const history = await git.getRecentCommits(limit=5)

  return {
    chunks: relevantChunks,
    symbols: relatedSymbols,
    history: history,
    workingTree: await git.status()
  }
}
```

---

## 4. Data Models

### 4.1 FalkorDB Graph Schema

**Node Types:**

```cypher
// File nodes
(:File {
  path: STRING,
  language: STRING,
  lastModified: TIMESTAMP,
  size: INT,
  hash: STRING  // git blob hash
})

// Symbol nodes (functions, classes, etc.)
(:Symbol {
  name: STRING,
  kind: STRING,  // 'function' | 'class' | 'variable' | 'interface'
  file: STRING,
  line: INT,
  signature: STRING,
  docstring: STRING,
  complexity: INT,  // cyclomatic complexity
  vectorId: STRING  // reference to vector DB
})

// Module nodes (directories, packages)
(:Module {
  name: STRING,
  path: STRING,
  type: STRING  // 'package' | 'namespace' | 'directory'
})

// Commit nodes
(:Commit {
  sha: STRING,
  message: STRING,
  author: STRING,
  timestamp: TIMESTAMP,
  vectorId: STRING
})
```

**Edge Types:**

```cypher
// File relationships
(:File)-[:IMPORTS]->(:File)
(:File)-[:DEFINES]->(:Symbol)
(:File)-[:BELONGS_TO]->(:Module)

// Symbol relationships
(:Symbol)-[:CALLS]->(:Symbol)
(:Symbol)-[:INHERITS]->(:Symbol)
(:Symbol)-[:IMPLEMENTS]->(:Symbol)
(:Symbol)-[:REFERENCES]->(:Symbol)
(:Symbol)-[:DEFINED_IN]->(:File)

// Commit relationships
(:Commit)-[:MODIFIES]->(:File)
(:Commit)-[:PARENT]->(:Commit)
(:Commit)-[:TOUCHES]->(:Symbol)
```

### 4.2 Local Metadata Store

**Location**: `.cv/` directory (git-ignored)

```
.cv/
├── config.json           # User preferences, API keys
├── graph.db/             # Local FalkorDB storage (if embedded)
├── vectors.db/           # Local vector DB storage
├── cache/                # Query cache
└── sessions/             # AI chat session history
    └── <session-id>.json
```

**Config Schema:**
```json
{
  "version": "0.1.0",
  "llm": {
    "provider": "anthropic",
    "model": "claude-sonnet-4",
    "apiKey": "sk-ant-..."
  },
  "graph": {
    "url": "localhost:6379",
    "embedded": true
  },
  "vector": {
    "provider": "qdrant",
    "url": "localhost:6333",
    "embeddingModel": "text-embedding-3-small"
  },
  "git": {
    "autoSync": true,
    "syncOnCommit": true
  }
}
```

---

## 5. Component Interactions

### 5.1 Flow: `cv do "Add JWT authentication"`

```
1. CLI receives command
   ↓
2. AI Orchestrator interprets task
   ↓
3. Context Manager queries:
   - Vector DB: semantic search("JWT authentication")
   - Graph: MATCH (s:Symbol)-[:CALLS]->(auth) WHERE auth.name CONTAINS "auth"
   - Git: recent commits touching auth files
   ↓
4. AI generates plan:
   - "Create JWTService class in src/auth/jwt.ts"
   - "Update AuthController to use JWTService"
   - "Add refresh token endpoint"
   ↓
5. User approves plan
   ↓
6. AI generates diffs for each file
   ↓
7. Git Compat Layer applies changes
   ↓
8. Trigger `cv sync --incremental`
   ↓
9. Graph Sync updates:
   - New Symbol nodes for JWTService
   - New CALLS edges
   - Update vector embeddings
```

### 5.2 Flow: `cv find "all API endpoints that mutate user data"`

```
1. CLI receives query
   ↓
2. Vector Manager:
   - Embed query
   - Search codeChunks collection
   ↓
3. Graph Manager:
   - Parse query intent → "find routes + database writes"
   - Cypher query:
     MATCH (s:Symbol)-[:CALLS]->(db:Symbol)
     WHERE s.kind = 'function' AND db.name CONTAINS 'update'
     RETURN s.file, s.name, s.line
   ↓
4. Merge results (vector + graph)
   ↓
5. Rank by relevance
   ↓
6. CLI outputs:
   - src/routes/users.ts:42 - updateUserProfile()
   - src/routes/admin.ts:89 - deleteUser()
```

### 5.3 Flow: `cv sync` (Full Rebuild)

```
1. CLI triggers full sync
   ↓
2. Git Compat: get all tracked files
   ↓
3. AST Parser:
   - For each file → parse → extract symbols
   ↓
4. Graph Sync:
   - Clear existing graph
   - Create File/Symbol/Module nodes
   - Create IMPORTS/CALLS/DEFINES edges
   ↓
5. Vector Manager:
   - Chunk code into 100-500 line segments
   - Generate embeddings
   - Upsert to vector DB
   ↓
6. Save sync metadata (.cv/last_sync.json)
```

---

## 6. Technology Stack (MVP)

| Component | Technology | Rationale |
|-----------|------------|-----------|
| **CLI** | Node.js + oclif | Fast prototyping, good LLM libs |
| **Git** | nodegit / simple-git | Stable, well-documented |
| **AST Parser** | tree-sitter | Multi-language support |
| **Graph DB** | FalkorDB (Redis module) | Fast, Cypher queries, embeddable |
| **Vector DB** | Qdrant (local) | Free, local-first, good API |
| **Embeddings** | OpenAI text-embedding-3-small | Cheap, fast, good quality |
| **LLM** | Anthropic Claude Sonnet 4 | Best code understanding |
| **Language** | TypeScript | Type safety, Node ecosystem |

---

## 7. MVP Scope

### Phase 1: Core Infrastructure (Week 1-2)
- ✅ CLI skeleton (`cv init`, `cv git`, `cv sync`)
- ✅ Git integration (read commits, diff, status)
- ✅ FalkorDB connection + basic schema
- ✅ Tree-sitter integration for 2-3 languages (TS, Python, Go)
- ✅ Sync engine (full rebuild only)

### Phase 2: Knowledge Graph (Week 3-4)
- ✅ Complete graph schema (File, Symbol, Module nodes)
- ✅ Relationship extraction (IMPORTS, CALLS, DEFINES)
- ✅ Incremental sync on git hooks
- ✅ Basic graph queries (`cv graph calls`, `cv graph modules`)

### Phase 3: Vector Layer (Week 5)
- ✅ Qdrant setup (local)
- ✅ Code chunking strategy
- ✅ Embedding generation pipeline
- ✅ Semantic search (`cv find`)

### Phase 4: AI Orchestration (Week 6-7)
- ✅ Claude API integration
- ✅ Context assembly (graph + vector)
- ✅ `cv explain` command
- ✅ `cv do` command (plan generation only, no auto-commit)

### Phase 5: Polish (Week 8)
- ✅ Diff generation + streaming output
- ✅ Interactive approval workflow
- ✅ Error handling + logging
- ✅ Documentation

### Out of Scope (Post-MVP)
- ❌ `cv chat` (persistent sessions)
- ❌ `cv refactor` (complex code transformations)
- ❌ TUI mode (`cv ui`)
- ❌ Multi-repo support
- ❌ Cloud sync for graph/vectors
- ❌ Auth + teams

---

## 8. File Structure

```
cv-git/
├── packages/
│   ├── cli/                    # cv CLI binary
│   │   ├── src/
│   │   │   ├── commands/       # Command handlers
│   │   │   │   ├── init.ts
│   │   │   │   ├── sync.ts
│   │   │   │   ├── do.ts
│   │   │   │   ├── find.ts
│   │   │   │   ├── explain.ts
│   │   │   │   └── graph/
│   │   │   ├── index.ts        # CLI entry point
│   │   │   └── config.ts
│   │   └── package.json
│   │
│   ├── core/                   # Core business logic
│   │   ├── src/
│   │   │   ├── git/            # Git compatibility layer
│   │   │   ├── parser/         # AST parsing
│   │   │   ├── graph/          # FalkorDB integration
│   │   │   ├── vector/         # Vector DB manager
│   │   │   ├── ai/             # AI orchestrator
│   │   │   └── sync/           # Graph sync engine
│   │   └── package.json
│   │
│   └── shared/                 # Shared types + utils
│       ├── src/
│       │   ├── types/
│       │   └── utils/
│       └── package.json
│
├── docs/
│   ├── ARCHITECTURE.md         # This file
│   ├── API.md
│   └── CONTRIBUTING.md
│
├── scripts/
│   ├── setup-hooks.sh          # Install git hooks
│   └── init-db.sh              # Initialize FalkorDB
│
├── .cv/                        # Created on `cv init`
│   └── config.json
│
├── package.json                # Monorepo root
├── tsconfig.json
└── README.md
```

---

## 9. Key Design Decisions

### 9.1 Why FalkorDB?
- **Cypher queries**: Easy to express graph traversals
- **Redis-based**: Fast, embeddable, or remote
- **LLM-friendly**: Can generate Cypher from natural language

### 9.2 Why Qdrant for vectors?
- **Local-first**: No cloud dependency for MVP
- **Rust-based**: Fast, low memory
- **Simple API**: Easy to integrate

### 9.3 Why Node.js for CLI?
- **Fast prototyping**: Rich ecosystem (oclif, ink for TUI)
- **LLM SDKs**: Anthropic, OpenAI, LangChain all have Node clients
- **Easy distribution**: Single binary via `pkg` or `esbuild`

### 9.4 Why incremental sync instead of real-time?
- **Git-first philosophy**: Changes only matter when committed
- **Performance**: Real-time AST parsing is expensive
- **Simplicity**: Hooks are easier than file watchers

---

## 10. Security & Privacy

### 10.1 API Key Management
- Store in `.cv/config.json` (git-ignored)
- Support env vars (`CV_ANTHROPIC_KEY`)
- Warn on commit if keys detected

### 10.2 Data Privacy
- **Local-first**: Graph + vectors stored locally by default
- **Opt-in cloud**: User must explicitly enable cloud sync
- **Code sanitization**: Strip secrets before sending to LLM (via regex patterns)

### 10.3 LLM Safety
- **Prompt injection protection**: Sanitize user input
- **Code review**: Always show diffs before applying
- **Audit log**: Track all AI-generated changes in `.cv/audit.log`

---

## 11. Performance Targets (MVP)

| Operation | Target | Notes |
|-----------|--------|-------|
| `cv init` | < 5s | Initialize graph + vector DB |
| `cv sync` (1000 files) | < 60s | Full rebuild |
| `cv sync --incremental` | < 2s | Single file update |
| `cv find` | < 1s | Vector search + graph query |
| `cv do` (plan generation) | < 10s | LLM call + context retrieval |
| Graph query | < 100ms | Simple Cypher query |

---

## 12. Open Questions

1. **Code chunking strategy**: Fixed line count? Semantic blocks (functions/classes)?
2. **Graph persistence**: Embedded FalkorDB vs. Docker container?
3. **Offline mode**: How much functionality without LLM access?
4. **Multi-language priority**: Which languages to support first?
5. **Diff application**: Auto-apply or require manual review?

---

## Next Steps

1. ✅ Set up monorepo structure (`pnpm` + Turborepo)
2. ✅ Implement CLI skeleton (oclif)
3. ✅ Set up FalkorDB (Docker or embedded)
4. ✅ Implement basic AST parser (tree-sitter)
5. ✅ Build graph sync engine (File → Symbol → edges)
6. 🚧 Integrate Qdrant + embeddings
7. 🚧 Connect Claude API
8. 🚧 Implement `cv do` and `cv find`

---

**Last Updated**: 2025-11-17
