# CV-Git Data Models Specification

## 1. FalkorDB Graph Schema

### 1.1 Node Types

#### File Node
```cypher
CREATE (:File {
  path: STRING,              // Relative path from repo root
  absolutePath: STRING,      // Absolute filesystem path
  language: STRING,          // 'typescript' | 'python' | 'go' | etc.
  lastModified: TIMESTAMP,   // Unix timestamp
  size: INT,                 // File size in bytes
  gitHash: STRING,           // Git blob hash
  linesOfCode: INT,          // Physical lines of code
  complexity: FLOAT,         // Aggregate complexity score
  createdAt: TIMESTAMP,      // First seen in repo
  updatedAt: TIMESTAMP       // Last graph sync
})
```

**Indexes:**
```cypher
CREATE INDEX FOR (f:File) ON (f.path)
CREATE INDEX FOR (f:File) ON (f.language)
CREATE INDEX FOR (f:File) ON (f.gitHash)
```

---

#### Symbol Node
```cypher
CREATE (:Symbol {
  name: STRING,              // Function/class/variable name
  qualifiedName: STRING,     // Full path (e.g., "utils.auth.JWTService")
  kind: STRING,              // 'function' | 'class' | 'method' | 'variable' | 'interface' | 'type'
  file: STRING,              // Reference to File.path
  startLine: INT,
  endLine: INT,
  signature: STRING,         // Type signature or function params
  docstring: TEXT,           // JSDoc, Python docstring, etc.
  returnType: STRING,        // Return type (if applicable)
  parameters: JSON,          // Array of {name, type, default}
  visibility: STRING,        // 'public' | 'private' | 'protected'
  isAsync: BOOLEAN,
  isStatic: BOOLEAN,
  complexity: INT,           // Cyclomatic complexity
  vectorId: STRING,          // Reference to vector DB embedding
  createdAt: TIMESTAMP,
  updatedAt: TIMESTAMP
})
```

**Example:**
```json
{
  "name": "authenticateUser",
  "qualifiedName": "src.auth.service.AuthService.authenticateUser",
  "kind": "method",
  "file": "src/auth/service.ts",
  "startLine": 42,
  "endLine": 67,
  "signature": "(email: string, password: string): Promise<User>",
  "returnType": "Promise<User>",
  "parameters": [
    {"name": "email", "type": "string"},
    {"name": "password", "type": "string"}
  ],
  "visibility": "public",
  "isAsync": true,
  "complexity": 8
}
```

**Indexes:**
```cypher
CREATE INDEX FOR (s:Symbol) ON (s.name)
CREATE INDEX FOR (s:Symbol) ON (s.qualifiedName)
CREATE INDEX FOR (s:Symbol) ON (s.file)
CREATE INDEX FOR (s:Symbol) ON (s.kind)
CREATE FULLTEXT INDEX symbol_search FOR (s:Symbol) ON (s.name, s.docstring)
```

---

#### Module Node
```cypher
CREATE (:Module {
  name: STRING,              // Module/package name
  path: STRING,              // Directory path
  type: STRING,              // 'package' | 'namespace' | 'directory'
  language: STRING,          // Primary language
  description: TEXT,         // README or package.json description
  version: STRING,           // Semver (if package)
  fileCount: INT,
  symbolCount: INT,
  createdAt: TIMESTAMP,
  updatedAt: TIMESTAMP
})
```

**Indexes:**
```cypher
CREATE INDEX FOR (m:Module) ON (m.path)
CREATE INDEX FOR (m:Module) ON (m.name)
```

---

#### Commit Node
```cypher
CREATE (:Commit {
  sha: STRING,               // Git commit hash
  message: TEXT,             // Commit message
  author: STRING,            // Author name
  authorEmail: STRING,
  committer: STRING,
  timestamp: TIMESTAMP,
  branch: STRING,            // Branch name at time of commit
  filesChanged: INT,
  insertions: INT,
  deletions: INT,
  vectorId: STRING,          // Embedding of commit message
  createdAt: TIMESTAMP
})
```

**Indexes:**
```cypher
CREATE INDEX FOR (c:Commit) ON (c.sha)
CREATE INDEX FOR (c:Commit) ON (c.author)
CREATE INDEX FOR (c:Commit) ON (c.timestamp)
```

---

#### Import Node (Dependency)
```cypher
CREATE (:Import {
  source: STRING,            // Importing file
  target: STRING,            // Imported module/file
  importedSymbols: [STRING], // Specific symbols imported
  importType: STRING,        // 'default' | 'named' | 'namespace' | 'side-effect'
  isExternal: BOOLEAN,       // True if npm/pip package
  packageName: STRING,       // If external, the package name
  version: STRING            // If external, resolved version
})
```

---

### 1.2 Edge Types

#### IMPORTS
```cypher
(:File)-[:IMPORTS {
  line: INT,                 // Line number of import statement
  importedSymbols: [STRING], // Specific symbols
  alias: STRING              // Alias (e.g., "import { foo as bar }")
}]->(:File)
```

**Example Query:**
```cypher
// Find all files that import 'AuthService'
MATCH (f:File)-[i:IMPORTS]->(target:File)
WHERE target.path CONTAINS 'auth/service'
RETURN f.path, i.importedSymbols
```

---

#### DEFINES
```cypher
(:File)-[:DEFINES {
  line: INT                  // Line where symbol is defined
}]->(:Symbol)
```

---

#### CALLS
```cypher
(:Symbol)-[:CALLS {
  line: INT,                 // Line number of call site
  callCount: INT,            // Number of times called in this symbol
  isConditional: BOOLEAN     // Called inside if/try block
}]->(:Symbol)
```

**Example Query:**
```cypher
// Find all functions called by 'authenticateUser'
MATCH (caller:Symbol {name: 'authenticateUser'})-[c:CALLS]->(callee:Symbol)
RETURN callee.name, c.line, c.callCount
ORDER BY c.callCount DESC
```

---

#### INHERITS
```cypher
(:Symbol)-[:INHERITS {
  type: STRING               // 'extends' | 'implements'
}]->(:Symbol)
```

---

#### REFERENCES
```cypher
(:Symbol)-[:REFERENCES {
  line: INT,
  referenceType: STRING      // 'read' | 'write' | 'call'
}]->(:Symbol)
```

---

#### BELONGS_TO
```cypher
(:File)-[:BELONGS_TO]->(:Module)
(:Symbol)-[:BELONGS_TO]->(:Module)
```

---

#### MODIFIES
```cypher
(:Commit)-[:MODIFIES {
  changeType: STRING,        // 'added' | 'modified' | 'deleted' | 'renamed'
  insertions: INT,
  deletions: INT
}]->(:File)
```

---

#### TOUCHES
```cypher
(:Commit)-[:TOUCHES {
  changeType: STRING,        // 'added' | 'modified' | 'deleted'
  lineDelta: INT             // Net change in lines
}]->(:Symbol)
```

---

#### PARENT
```cypher
(:Commit)-[:PARENT]->(:Commit)
```

---

### 1.3 Common Graph Queries

#### 1. Find All Callers of a Function
```cypher
MATCH (caller:Symbol)-[:CALLS]->(callee:Symbol {name: $functionName})
RETURN caller.name, caller.file, caller.startLine
```

#### 2. Get File Dependency Tree
```cypher
MATCH path = (root:File {path: $filePath})-[:IMPORTS*1..3]->(dep:File)
RETURN path
```

#### 3. Find Highly Coupled Modules
```cypher
MATCH (m1:Module)-[:IMPORTS]-(m2:Module)
WITH m1, m2, count(*) as couplingScore
WHERE couplingScore > 5
RETURN m1.name, m2.name, couplingScore
ORDER BY couplingScore DESC
```

#### 4. Find Orphaned Symbols (Never Called)
```cypher
MATCH (s:Symbol)
WHERE NOT (:Symbol)-[:CALLS]->(s)
  AND s.kind = 'function'
  AND s.visibility = 'public'
RETURN s.name, s.file
```

#### 5. Get Recent Changes to a Symbol
```cypher
MATCH (c:Commit)-[:TOUCHES]->(s:Symbol {name: $symbolName})
RETURN c.sha, c.message, c.timestamp
ORDER BY c.timestamp DESC
LIMIT 10
```

#### 6. Find All Entry Points (Functions Not Called Internally)
```cypher
MATCH (s:Symbol)
WHERE s.kind IN ['function', 'method']
  AND NOT (:Symbol {file: s.file})-[:CALLS]->(s)
RETURN s.name, s.file
```

---

## 2. Vector Database Schema (Qdrant)

### 2.1 Collections

#### codeChunks Collection
```json
{
  "collection_name": "codeChunks",
  "vector_size": 1536,
  "distance": "Cosine",
  "payload_schema": {
    "id": "string",               // Format: "file:startLine:endLine"
    "file": "string",             // File path
    "language": "string",
    "symbolName": "string?",      // If chunk is a complete function/class
    "symbolKind": "string?",
    "startLine": "integer",
    "endLine": "integer",
    "text": "string",             // Raw code text
    "summary": "string?",         // AI-generated summary
    "docstring": "string?",
    "imports": ["string"],        // Imported modules in this chunk
    "complexity": "integer?",
    "lastModified": "integer"     // Unix timestamp
  }
}
```

**Chunking Strategy:**
- **Function/Class Level**: Each symbol is a chunk
- **File Level**: If file < 100 lines, entire file is one chunk
- **Sliding Window**: For large files without symbols, use 50-line chunks with 10-line overlap

**Example Entry:**
```json
{
  "id": "src/auth/service.ts:42:67",
  "vector": [0.123, -0.456, ...],
  "payload": {
    "file": "src/auth/service.ts",
    "language": "typescript",
    "symbolName": "authenticateUser",
    "symbolKind": "method",
    "startLine": 42,
    "endLine": 67,
    "text": "async authenticateUser(email: string, password: string): Promise<User> { ... }",
    "summary": "Authenticates a user by email and password, returns User object or throws AuthError",
    "docstring": "Validates credentials and returns authenticated user",
    "complexity": 8,
    "lastModified": 1699920000
  }
}
```

---

#### docstrings Collection
```json
{
  "collection_name": "docstrings",
  "vector_size": 1536,
  "distance": "Cosine",
  "payload_schema": {
    "id": "string",               // Format: "file:symbolName"
    "symbolName": "string",
    "symbolKind": "string",
    "file": "string",
    "text": "string",             // Docstring content
    "signature": "string?",
    "parameters": ["object"]      // [{name, type, description}]
  }
}
```

---

#### commits Collection
```json
{
  "collection_name": "commits",
  "vector_size": 1536,
  "distance": "Cosine",
  "payload_schema": {
    "id": "string",               // Commit SHA
    "message": "string",
    "author": "string",
    "timestamp": "integer",
    "filesChanged": ["string"],
    "symbolsChanged": ["string"]
  }
}
```

**Use Case**: Semantic search over commit history ("when was JWT auth added?")

---

### 2.2 Embedding Pipeline

```typescript
interface EmbeddingPipeline {
  // Generate embedding for code chunk
  async embedCode(code: string, language: string): Promise<number[]>

  // Generate embedding for documentation
  async embedDocstring(text: string): Promise<number[]>

  // Generate embedding for commit message
  async embedCommit(message: string): Promise<number[]>

  // Batch embeddings for efficiency
  async embedBatch(texts: string[]): Promise<number[][]>
}
```

**Preprocessing:**
1. **Code**:
   - Remove comments (optional, keep docstrings)
   - Normalize whitespace
   - Prepend language identifier: `// TypeScript\n${code}`

2. **Docstrings**:
   - Extract from comments/decorators
   - Include function signature as context

3. **Commits**:
   - Include first line (summary) + full message

---

## 3. Local Storage (.cv/ Directory)

### 3.1 config.json
```json
{
  "version": "0.1.0",
  "repository": {
    "root": "/path/to/repo",
    "name": "my-project",
    "initDate": "2025-11-17T10:00:00Z"
  },
  "llm": {
    "provider": "anthropic",
    "model": "claude-sonnet-4",
    "apiKey": "${CV_ANTHROPIC_KEY}",
    "maxTokens": 4096,
    "temperature": 0.2
  },
  "embedding": {
    "provider": "openai",
    "model": "text-embedding-3-small",
    "apiKey": "${CV_OPENAI_KEY}",
    "dimensions": 1536
  },
  "graph": {
    "provider": "falkordb",
    "url": "redis://localhost:6379",
    "embedded": true,
    "database": "cv-git"
  },
  "vector": {
    "provider": "qdrant",
    "url": "http://localhost:6333",
    "embedded": true,
    "collections": {
      "codeChunks": "code_chunks",
      "docstrings": "docstrings",
      "commits": "commits"
    }
  },
  "sync": {
    "autoSync": true,
    "syncOnCommit": true,
    "excludePatterns": ["node_modules/**", "*.test.ts", "dist/**"],
    "includeLanguages": ["typescript", "python", "go", "rust"]
  },
  "features": {
    "enableChat": true,
    "enableAutoCommit": false,
    "enableTelemetry": false
  }
}
```

---

### 3.2 sync_state.json
```json
{
  "lastFullSync": "2025-11-17T10:30:00Z",
  "lastIncrementalSync": "2025-11-17T14:45:00Z",
  "lastCommitSynced": "abc123def456",
  "fileCount": 342,
  "symbolCount": 1205,
  "nodeCount": 1650,
  "edgeCount": 4230,
  "vectorCount": 1205,
  "languages": {
    "typescript": 280,
    "python": 45,
    "go": 17
  },
  "syncDuration": 42.5,
  "errors": []
}
```

---

### 3.3 sessions/ (Chat History)

**File**: `.cv/sessions/<session-id>.json`

```json
{
  "id": "sess_abc123",
  "createdAt": "2025-11-17T15:00:00Z",
  "updatedAt": "2025-11-17T15:30:00Z",
  "branch": "main",
  "commitAtStart": "abc123",
  "messages": [
    {
      "role": "user",
      "content": "How does authentication work in this codebase?",
      "timestamp": "2025-11-17T15:00:05Z"
    },
    {
      "role": "assistant",
      "content": "Based on the code, authentication is handled by...",
      "timestamp": "2025-11-17T15:00:12Z",
      "context": {
        "files": ["src/auth/service.ts", "src/middleware/auth.ts"],
        "symbols": ["AuthService.authenticateUser", "authMiddleware"],
        "vectorResults": 5,
        "graphQueries": ["MATCH (s:Symbol)-[:CALLS]->..."]
      }
    }
  ],
  "metadata": {
    "totalMessages": 12,
    "tokensUsed": 8450,
    "cost": 0.042
  }
}
```

---

### 3.4 cache/ (Query Cache)

**File**: `.cv/cache/query_<hash>.json`

```json
{
  "query": "find all API endpoints",
  "queryHash": "md5_hash_of_query",
  "result": [...],
  "timestamp": "2025-11-17T15:00:00Z",
  "ttl": 3600
}
```

**Cache Invalidation:**
- Invalidate on `cv sync`
- TTL-based expiration (1 hour default)

---

## 4. Inter-System References

### 4.1 Graph ↔ Vector Linking

**Symbol → Vector:**
- Symbol node has `vectorId` field
- Format: `code_chunk:<file>:<startLine>:<endLine>`

**Vector → Graph:**
- Vector payload has `file` and `symbolName`
- Can query graph: `MATCH (s:Symbol {name: $symbolName, file: $file})`

**Example Flow (Semantic Search):**
```typescript
async function semanticSearch(query: string): Promise<SearchResult[]> {
  // 1. Search vector DB
  const vectorResults = await qdrant.search('codeChunks', {
    query: await embed(query),
    limit: 20
  })

  // 2. Enrich with graph data
  const enriched = await Promise.all(
    vectorResults.map(async (result) => {
      const graphData = await falkordb.query(`
        MATCH (s:Symbol {name: $name, file: $file})
        OPTIONAL MATCH (s)-[:CALLS]->(callee:Symbol)
        RETURN s, collect(callee.name) as calls
      `, { name: result.payload.symbolName, file: result.payload.file })

      return {
        ...result,
        calls: graphData[0].calls,
        complexity: graphData[0].s.complexity
      }
    })
  )

  return enriched
}
```

---

## 5. Schema Migration Strategy

### Version: 0.1.0 (Initial)
- Basic File, Symbol, Commit nodes
- Core relationship types

### Version: 0.2.0 (Planned)
- Add Module nodes
- Add Import nodes
- Performance metrics (PageRank, centrality)

### Version: 0.3.0 (Future)
- Test coverage nodes
- CI/CD integration nodes

**Migration Process:**
```bash
cv migrate --from 0.1.0 --to 0.2.0
```

**Migration Script:**
```cypher
// Add new fields to existing nodes
MATCH (s:Symbol)
SET s.qualifiedName = s.file + '.' + s.name

// Create new node types
MATCH (f:File)
WITH f.path as path
CREATE (:Module {name: split(path, '/')[0], path: split(path, '/')[0]})
```

---

## Next Steps

1. Implement graph schema in FalkorDB
2. Set up Qdrant collections
3. Build AST → Graph mapper
4. Implement embedding pipeline
5. Create sync engine

---

**Last Updated**: 2025-11-17
