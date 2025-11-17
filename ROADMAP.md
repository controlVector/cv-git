# CV-Git Development Roadmap

This document outlines the implementation plan to reach a functional MVP.

## Current Status: Foundation Complete ✅

**Completed Components:**
- ✅ Architecture design (ARCHITECTURE.md)
- ✅ Data models (DATA_MODELS.md)
- ✅ Project scaffolding and monorepo setup
- ✅ TypeScript configuration and build system
- ✅ CLI framework with Commander.js
- ✅ Git compatibility layer (complete)
- ✅ Configuration management (complete)
- ✅ Shared types and utilities (complete)
- ✅ Command stubs for all CLI commands
- ✅ Comprehensive documentation

**Total Lines of Code:** ~2,500 lines
**Estimated MVP Completion:** 2-3 weeks of focused development

---

## Phase 2: Knowledge Graph Implementation [NEXT]

**Goal:** Build the core graph sync functionality

### 2.1 FalkorDB Integration

**File:** `packages/core/src/graph/index.ts`

**Tasks:**
1. Install FalkorDB client:
   ```bash
   cd packages/core
   pnpm add redis @redis/graph
   ```

2. Implement connection management:
   ```typescript
   - connect(): Promise<void>
   - disconnect(): Promise<void>
   - ping(): Promise<boolean>
   ```

3. Implement Cypher query execution:
   ```typescript
   - query(cypher: string, params?: any): Promise<any[]>
   - transaction(): Transaction
   ```

4. Implement node operations:
   ```typescript
   - upsertFileNode(file: FileNode): Promise<void>
   - upsertSymbolNode(symbol: SymbolNode): Promise<void>
   - upsertCommitNode(commit: CommitNode): Promise<void>
   ```

5. Implement relationship operations:
   ```typescript
   - createImportsEdge(from, to, props): Promise<void>
   - createCallsEdge(from, to, props): Promise<void>
   - createDefinesEdge(from, to, props): Promise<void>
   ```

6. Add indexes:
   ```cypher
   CREATE INDEX FOR (f:File) ON (f.path)
   CREATE INDEX FOR (s:Symbol) ON (s.name)
   CREATE INDEX FOR (s:Symbol) ON (s.qualifiedName)
   ```

**Estimated Time:** 2-3 days

**Test Plan:**
```typescript
// Test connection
const graph = new GraphManager('redis://localhost:6379', 'cv-git');
await graph.connect();
await graph.ping(); // Should return true

// Test node creation
await graph.upsertFileNode({
  path: 'src/index.ts',
  language: 'typescript',
  ...
});

// Test query
const files = await graph.query('MATCH (f:File) RETURN f LIMIT 5');
```

---

### 2.2 AST Parser Implementation

**File:** `packages/core/src/parser/index.ts`

**Tasks:**
1. Install tree-sitter:
   ```bash
   cd packages/core
   pnpm add tree-sitter tree-sitter-typescript tree-sitter-python tree-sitter-go
   ```

2. Set up parser for each language:
   ```typescript
   - createParser(language: string): Parser
   - loadGrammar(language: string): Language
   ```

3. Implement symbol extraction:
   ```typescript
   - extractFunctions(ast: Tree): SymbolNode[]
   - extractClasses(ast: Tree): SymbolNode[]
   - extractVariables(ast: Tree): SymbolNode[]
   - extractInterfaces(ast: Tree): SymbolNode[]
   ```

4. Implement import/export extraction:
   ```typescript
   - extractImports(ast: Tree): Import[]
   - extractExports(ast: Tree): Export[]
   ```

5. Implement call graph extraction:
   ```typescript
   - extractCalls(ast: Tree): CallsEdge[]
   ```

6. Implement code chunking:
   ```typescript
   - chunkBySymbol(symbols: SymbolNode[]): CodeChunk[]
   - chunkByLines(content: string, maxLines: 100): CodeChunk[]
   ```

**Language Support Priority:**
1. TypeScript (MVP)
2. JavaScript (MVP)
3. Python (MVP)
4. Go (Post-MVP)
5. Rust (Post-MVP)

**Estimated Time:** 4-5 days

**Test Plan:**
```typescript
const parser = new Parser();
const code = `
function hello(name: string): string {
  return \`Hello, \${name}!\`;
}
`;

const parsed = await parser.parseFile('test.ts', code, 'typescript');
// Should extract:
// - 1 function symbol
// - Signature: (name: string): string
// - 1 code chunk
```

---

### 2.3 Sync Engine Implementation

**File:** `packages/core/src/sync/index.ts`

**Tasks:**
1. Implement full sync workflow:
   ```typescript
   async fullSync(): Promise<SyncState> {
     // 1. Get all tracked files from git
     const files = await this.git.getTrackedFiles();

     // 2. Filter files to sync
     const filesToSync = files.filter(shouldSyncFile);

     // 3. Parse each file
     const parsedFiles = await Promise.all(
       filesToSync.map(f => this.parser.parseFile(f))
     );

     // 4. Update graph
     await this.updateGraph(parsedFiles);

     // 5. Update vectors (Phase 3)

     // 6. Save sync state
     return syncState;
   }
   ```

2. Implement incremental sync:
   ```typescript
   async incrementalSync(changedFiles: string[]): Promise<SyncState>
   ```

3. Implement graph update logic:
   ```typescript
   private async updateGraph(files: ParsedFile[]): Promise<void> {
     for (const file of files) {
       // Create file node
       await this.graph.upsertFileNode(file);

       // Create symbol nodes
       for (const symbol of file.symbols) {
         await this.graph.upsertSymbolNode(symbol);
         await this.graph.createDefinesEdge(file, symbol);
       }

       // Create import edges
       for (const imp of file.imports) {
         await this.graph.createImportsEdge(file, imp.source);
       }
     }
   }
   ```

4. Implement sync state persistence:
   ```typescript
   - loadSyncState(): Promise<SyncState>
   - saveSyncState(state: SyncState): Promise<void>
   ```

**Estimated Time:** 3-4 days

---

### 2.4 Wire Up `cv sync` Command

**File:** `packages/cli/src/commands/sync.ts`

**Tasks:**
1. Load configuration
2. Initialize components (git, parser, graph)
3. Create sync engine
4. Execute sync with progress indicators
5. Display results

```typescript
import { configManager, createGitManager, createParser,
         createGraphManager, createSyncEngine } from '@cv-git/core';

const config = await configManager.load(repoRoot);
const git = createGitManager(repoRoot);
const parser = createParser();
const graph = createGraphManager(config.graph.url, config.graph.database);
const sync = createSyncEngine(repoRoot, parser, graph, null);

const state = await sync.fullSync();

console.log(`Synced ${state.fileCount} files`);
console.log(`Created ${state.symbolCount} symbols`);
```

**Estimated Time:** 1 day

---

## Phase 3: Vector Database Implementation

**Goal:** Enable semantic search

### 3.1 Qdrant Integration

**File:** `packages/core/src/vector/index.ts`

**Tasks:**
1. Install Qdrant client:
   ```bash
   pnpm add @qdrant/js-client-rest
   ```

2. Implement connection:
   ```typescript
   - connect(): Promise<void>
   - ensureCollection(name, vectorSize): Promise<void>
   ```

3. Implement embedding generation (OpenAI):
   ```typescript
   async embed(text: string): Promise<number[]> {
     const response = await openai.embeddings.create({
       model: 'text-embedding-3-small',
       input: text
     });
     return response.data[0].embedding;
   }
   ```

4. Implement vector operations:
   ```typescript
   - upsert(collection, id, vector, payload): Promise<void>
   - search(collection, query, limit): Promise<SearchResult[]>
   - delete(collection, id): Promise<void>
   ```

**Estimated Time:** 2-3 days

---

### 3.2 Update Sync Engine for Vectors

**File:** `packages/core/src/sync/index.ts`

**Tasks:**
1. Add vector updates to sync workflow:
   ```typescript
   // After updating graph
   for (const chunk of file.chunks) {
     const embedding = await this.vector.embed(chunk.text);
     await this.vector.upsert('code_chunks', chunk.id, embedding, {
       file: chunk.file,
       symbolName: chunk.symbolName,
       text: chunk.text
     });
   }
   ```

**Estimated Time:** 1 day

---

### 3.3 Implement `cv find` Command

**File:** `packages/cli/src/commands/find.ts`

**Tasks:**
1. Load config and initialize vector manager
2. Search vectors by query
3. Enrich results with graph data
4. Format and display results

```typescript
const results = await vector.search('code_chunks', query, limit);

// Enrich with graph data
for (const result of results) {
  const symbol = await graph.query(
    'MATCH (s:Symbol {name: $name, file: $file}) RETURN s',
    { name: result.payload.symbolName, file: result.payload.file }
  );
  result.graphData = symbol;
}

// Display with syntax highlighting
console.log(formatSearchResults(results));
```

**Estimated Time:** 2 days

---

## Phase 4: AI Orchestration

**Goal:** Enable AI-powered commands

### 4.1 Claude API Integration

**File:** `packages/core/src/ai/index.ts`

**Tasks:**
1. Install Anthropic SDK:
   ```bash
   pnpm add @anthropic-ai/sdk
   ```

2. Implement context assembly:
   ```typescript
   async getRelevantContext(query: string): Promise<Context> {
     // Search vectors
     const chunks = await this.vector.search('code_chunks', query);

     // Query graph
     const symbols = await this.graph.query(`
       MATCH (s:Symbol)
       WHERE s.name CONTAINS $keyword
       RETURN s LIMIT 10
     `, { keyword: extractKeyword(query) });

     return { chunks, symbols, files: [] };
   }
   ```

3. Implement plan generation:
   ```typescript
   async generatePlan(task: string, context: Context): Promise<Plan> {
     const prompt = this.buildPrompt(task, context);

     const response = await this.anthropic.messages.create({
       model: this.model,
       max_tokens: this.maxTokens,
       messages: [{ role: 'user', content: prompt }]
     });

     return this.parsePlan(response.content);
   }
   ```

**Estimated Time:** 3-4 days

---

### 4.2 Implement `cv explain` Command

**File:** `packages/cli/src/commands/explain.ts`

**Tasks:**
1. Parse target (file, symbol, or concept)
2. Get relevant context
3. Generate explanation with AI
4. Format and display with markdown

```typescript
const context = await ai.getRelevantContext(target);
const explanation = await ai.explain(target, context);

// Render markdown
console.log(marked(explanation));
```

**Estimated Time:** 2 days

---

### 4.3 Implement `cv do` Command (Basic)

**File:** `packages/cli/src/commands/do.ts`

**Tasks:**
1. Get context for task
2. Generate plan
3. Display plan to user
4. Get approval
5. (MVP: Manual implementation)
6. (Post-MVP: Generate diffs and apply)

```typescript
const context = await ai.getRelevantContext(task);
const plan = await ai.generatePlan(task, context);

// Display plan
console.log(chalk.bold('Plan:'));
plan.steps.forEach((step, i) => {
  console.log(`  ${i+1}. ${step.description}`);
});

// Get approval
const approved = await inquirer.confirm('Execute this plan?');
if (approved) {
  console.log('Please implement the plan manually for MVP');
  console.log('Automatic code generation coming in Phase 5');
}
```

**Estimated Time:** 2-3 days

---

## Phase 5: MVP Polish

### 5.1 Git Hooks

**Tasks:**
1. Create hook scripts in `.git/hooks/`
2. Trigger `cv sync --incremental` on:
   - post-commit
   - post-merge
   - post-checkout

**Estimated Time:** 1 day

---

### 5.2 Error Handling & Logging

**Tasks:**
1. Add comprehensive error handling
2. Add debug logging with `debug` package
3. Add progress indicators with `ora`
4. Add user-friendly error messages

**Estimated Time:** 2 days

---

### 5.3 Testing

**Tasks:**
1. Set up Vitest
2. Write unit tests for core components
3. Write integration tests for sync workflow
4. Write E2E tests for CLI commands

**Estimated Time:** 3-4 days

---

### 5.4 Documentation

**Tasks:**
1. Add JSDoc comments to all public APIs
2. Create API documentation
3. Create user guide with examples
4. Create contributing guide

**Estimated Time:** 2 days

---

## Timeline Summary

| Phase | Tasks | Estimated Time | Status |
|-------|-------|---------------|--------|
| **Phase 1: Foundation** | Architecture, scaffolding, CLI, Git, Config | 3-4 days | ✅ **Complete** |
| **Phase 2: Knowledge Graph** | FalkorDB, Parser, Sync Engine, `cv sync` | 10-13 days | 🎯 **Next** |
| **Phase 3: Vector Layer** | Qdrant, Embeddings, `cv find` | 5-6 days | 📋 Planned |
| **Phase 4: AI Orchestration** | Claude API, `cv explain`, `cv do` | 7-9 days | 📋 Planned |
| **Phase 5: MVP Polish** | Hooks, Testing, Error Handling, Docs | 8-9 days | 📋 Planned |

**Total Estimated Time:** 33-41 days (~6-8 weeks)

**Current Progress:** ~12% complete (Foundation)

---

## Success Criteria for MVP

**Must Have:**
- [ ] `cv init` creates working configuration
- [ ] `cv sync` parses TypeScript files and builds graph
- [ ] `cv find` returns semantically relevant code
- [ ] `cv explain` provides accurate explanations
- [ ] `cv do` generates actionable plans
- [ ] Graph contains files, symbols, and relationships
- [ ] Vector search works for code chunks
- [ ] Git integration is stable

**Should Have:**
- [ ] Support for TypeScript, JavaScript, Python
- [ ] Incremental sync on git hooks
- [ ] Progress indicators and error messages
- [ ] Basic unit tests
- [ ] User documentation

**Nice to Have:**
- [ ] TUI mode
- [ ] Chat sessions
- [ ] Automatic code generation
- [ ] Multi-repo support

---

## Next Actions (Immediate)

1. **Set up FalkorDB locally**
   ```bash
   docker run -d --name falkordb -p 6379:6379 falkordb/falkordb:latest
   ```

2. **Start implementing GraphManager**
   ```bash
   cd packages/core
   pnpm add redis @redis/graph
   vim src/graph/index.ts
   ```

3. **Test FalkorDB connection**
   ```typescript
   // Write a simple test script
   const graph = new GraphManager('redis://localhost:6379', 'test');
   await graph.connect();
   console.log('Connected!');
   ```

4. **Implement basic Cypher queries**
   ```cypher
   CREATE (:File {path: 'test.ts', language: 'typescript'})
   MATCH (f:File) RETURN f
   ```

---

## Resources

- [FalkorDB Documentation](https://docs.falkordb.com/)
- [Tree-sitter Documentation](https://tree-sitter.github.io/)
- [Qdrant Documentation](https://qdrant.tech/documentation/)
- [Anthropic API Reference](https://docs.anthropic.com/)
- [OpenAI Embeddings Guide](https://platform.openai.com/docs/guides/embeddings)

---

**Let's build the future of AI-native development tools!** 🚀
