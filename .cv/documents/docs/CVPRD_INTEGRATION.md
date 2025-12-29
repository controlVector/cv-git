# cvPRD + cv-git Integration Design

## Vision

Create a bidirectional link between requirements (cvPRD) and code intelligence (cv-git) to enable:
1. **Requirements → Code**: AI uses PRD context when generating code
2. **Code → Requirements**: Code changes update PRD implementation status

```
┌─────────────┐                    ┌─────────────┐
│   cvPRD     │ ←── bidirectional ───→ │   cv-git    │
│ (FastAPI)   │      sync          │   (CLI)     │
│ port 8000   │                    │             │
└──────┬──────┘                    └──────┬──────┘
       │                                  │
       ↓                                  ↓
┌─────────────┐                    ┌─────────────┐
│  Qdrant     │                    │  Qdrant     │
│  Neo4j      │                    │  FalkorDB   │
│  PostgreSQL │                    │             │
└─────────────┘                    └─────────────┘
```

## Integration Points

### 1. Requirements Context for Code Generation

**Use Case**: `cv do "implement PRD-123 authentication"`

**Flow**:
```
1. Parse PRD reference from task description
2. Query cvPRD API: GET /api/v1/chunks/{chunk_id}/context
3. Receive context package (requirement + dependencies + constraints)
4. Inject into cv-git's AI context builder
5. Generate code with full requirements context
6. Link generated code back to requirement
```

**cv-git Changes**:
```typescript
// packages/core/src/ai/context.ts
interface ContextSource {
  type: 'code' | 'prd';
  data: any;
}

async function gatherContext(task: string): Promise<AIContext> {
  const codeContext = await gatherCodeContext(task);
  const prdContext = await gatherPRDContext(task); // NEW
  return mergeContexts(codeContext, prdContext);
}

async function gatherPRDContext(task: string): Promise<PRDContext | null> {
  // Extract PRD references (PRD-123, req-456)
  const prdRefs = extractPRDReferences(task);
  if (!prdRefs.length) return null;

  // Query cvPRD API
  const cvprdClient = new CVPRDClient(config.cvprd.url);
  return await cvprdClient.getContext(prdRefs);
}
```

### 2. Bidirectional Status Sync

**Use Case**: Mark requirements as implemented when code is committed

**Flow**:
```
1. On git commit, extract requirement references from message
2. Query cv-git graph for symbols in committed files
3. Create IMPLEMENTS relationships in cvPRD
4. Update chunk status: approved → implemented
```

**Implementation**:
```typescript
// packages/core/src/sync/prd-sync.ts
export class PRDSyncEngine {
  async onCommit(commit: GitCommit): Promise<void> {
    // 1. Extract PRD references from commit message
    const refs = this.extractPRDRefs(commit.message);
    if (!refs.length) return;

    // 2. Get symbols from committed files
    const symbols = await this.graph.getSymbolsInFiles(commit.files);

    // 3. Update cvPRD
    for (const ref of refs) {
      await this.cvprd.updateChunkStatus(ref, 'implemented');
      await this.cvprd.linkImplementation(ref, {
        commit: commit.sha,
        symbols: symbols.map(s => s.qualifiedName),
        files: commit.files
      });
    }
  }

  private extractPRDRefs(message: string): string[] {
    // Match patterns: PRD-123, req-456, FEAT-789
    const pattern = /(PRD|REQ|FEAT)-\d+/gi;
    return message.match(pattern) || [];
  }
}
```

### 3. CLI Commands

**New Commands**:
```bash
# Link code to requirement
cv link PRD-123 src/auth/login.ts

# Show requirements for current code
cv reqs src/auth/

# Show implementation status
cv prd status PRD-123

# Generate code from requirement
cv do --prd PRD-123 "implement this requirement"
```

### 4. MCP Tools for Combined Context

**New MCP Tools**:
```typescript
// cv_prd_context - Get PRD context for code generation
{
  name: 'cv_prd_context',
  description: 'Get requirement context from cvPRD',
  parameters: {
    chunk_ids: string[],  // PRD references
    depth: number         // Dependency traversal depth
  }
}

// cv_prd_link - Link code to requirements
{
  name: 'cv_prd_link',
  description: 'Link code symbols to PRD requirements',
  parameters: {
    chunk_id: string,
    symbols: string[],
    files: string[]
  }
}

// cv_prd_status - Update implementation status
{
  name: 'cv_prd_status',
  description: 'Update requirement implementation status',
  parameters: {
    chunk_id: string,
    status: 'implemented' | 'in_progress'
  }
}
```

## Cost Reduction Strategy

### Problem
Current cv-git uses OpenAI for embeddings ($) and Claude for AI features ($$$)

### Solutions

1. **Local Embeddings** (saves $50-100/month)
   ```typescript
   // Use sentence-transformers (same as cvPRD)
   // or nomic-embed via Ollama
   const embedding = await localEmbed(text); // FREE
   ```

2. **Shared Embeddings with cvPRD**
   - cvPRD already generates embeddings for requirements
   - cv-git can query cvPRD's Qdrant directly
   - No duplicate embedding costs

3. **Local LLM for Simple Tasks**
   ```typescript
   // Use Ollama for simple operations
   if (task.complexity === 'simple') {
     return await ollama.generate(task);
   }
   // Only use Claude for complex reasoning
   return await claude.generate(task);
   ```

4. **Aggressive Caching**
   ```typescript
   // Cache explanations, embeddings, context
   const cache = new LRUCache({ maxSize: 1000 });

   async function explain(symbol: string) {
     const cached = cache.get(`explain:${symbol}`);
     if (cached) return cached;

     const result = await ai.explain(symbol);
     cache.set(`explain:${symbol}`, result);
     return result;
   }
   ```

5. **Token Budget Awareness**
   - cvPRD already has `AIContext.max_tokens`
   - Build context within budget
   - Summarize when exceeding limit

## Implementation Phases

### Phase 1: cvPRD Client (Week 1)
- [ ] Create `@cv-git/prd-client` package
- [ ] Implement API client for cvPRD
- [ ] Add configuration for cvPRD URL

### Phase 2: Context Integration (Week 2)
- [ ] Modify `cv do` to fetch PRD context
- [ ] Merge PRD context into AI prompt
- [ ] Test with real requirements

### Phase 3: Bidirectional Sync (Week 3)
- [ ] Implement commit hook for PRD refs
- [ ] Create `cv link` command
- [ ] Add status sync to cvPRD

### Phase 4: MCP Tools (Week 4)
- [ ] Add MCP tools for PRD operations
- [ ] Test with Claude Desktop

### Phase 5: Cost Optimization (Week 5)
- [ ] Integrate local embeddings
- [ ] Add caching layer
- [ ] Implement Ollama for simple tasks

## Configuration

```json
// .cv/config.json
{
  "cvprd": {
    "enabled": true,
    "url": "http://localhost:8000",
    "apiKey": "optional-api-key"
  },
  "ai": {
    "embeddings": {
      "provider": "local",  // "local" | "openai"
      "model": "all-MiniLM-L6-v2"
    },
    "llm": {
      "simple": "ollama:llama3",
      "complex": "claude-3-sonnet"
    }
  },
  "cache": {
    "enabled": true,
    "maxSize": 1000,
    "ttl": 3600
  }
}
```

## API Compatibility

cv-git will call cvPRD's existing API:

```bash
# Get chunk with context
GET /api/v1/chunks/{chunk_id}
GET /api/v1/graph/chunks/{chunk_id}/dependencies?depth=3

# Update status
PATCH /api/v1/chunks/{chunk_id}
{ "metadata": { "status": "implemented" } }

# Create implementation link
POST /api/v1/graph/relationships
{
  "source_chunk_id": "req-uuid",
  "target_chunk_id": "code-reference",
  "relationship_type": "IMPLEMENTS"
}
```

## Success Metrics

1. **Context Quality**: AI generates better code with PRD context
2. **Traceability**: 100% of requirements linked to code
3. **Cost Reduction**: 50%+ reduction in API costs
4. **Developer Experience**: Single CLI for reqs + code
