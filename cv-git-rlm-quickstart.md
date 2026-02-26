# CV-Git RLM Integration - Quick Start Prompt

## For Claude Code

Copy this prompt to start implementation:

---

**Project**: CV-Git (https://github.com/controlVector/cv-git)
**Goal**: Add Recursive Language Model (RLM) reasoning capability

## Context

CV-Git is an AI-native version control layer with:
- FalkorDB knowledge graph (code relationships, call graphs)
- Qdrant vector store (semantic search)
- CLI commands: `cv find`, `cv explain`, `cv do`, `cv review`
- MCP server with 20 tools for AI agents

## Task

Implement an RLM Router that enables recursive reasoning over the codebase:

1. **Create `packages/core/src/services/rlm-router.ts`**:
   - Accept natural language query
   - Decompose into sub-tasks via LLM
   - Execute tasks against graph/vector services
   - Recursively call self for sub-problems
   - Aggregate results into final answer

2. **Integrate into CLI**:
   - Add `--deep` flag to `cv explain` for RLM-powered explanations
   - Show reasoning trace with `--trace`

3. **Add MCP tool**:
   - `cv_reason` tool for deep codebase reasoning

## Key Pattern

```typescript
interface RLMContext {
  originalQuery: string;
  depth: number;
  maxDepth: number;
  buffers: Map<string, any>;  // Results from sub-queries
  trace: RLMStep[];
}

async reason(query: string, ctx: RLMContext): Promise<RLMResult> {
  // 1. Decompose query into tasks
  const plan = await this.decompose(query, ctx);
  
  // 2. Execute each task
  for (const task of plan.tasks) {
    const result = await this.executeTask(task, ctx);
    ctx.buffers.set(task.id, result);
  }
  
  // 3. Check if can answer or need to recurse
  if (plan.canAnswer) return this.aggregate(ctx);
  
  ctx.depth++;
  return this.reason(plan.refinedQuery, ctx);
}
```

## Task Types

- `graph_query`: calls, called_by, path, imports, complexity
- `vector_search`: semantic code search
- `llm_explain`: get explanation of specific code
- `recurse`: ask a sub-question

## Example Usage

```bash
# Simple (existing)
cv explain authenticateUser

# Deep reasoning (new)
cv explain "How does authentication flow from login to token validation?" --deep --trace
```

## Start Here

1. Clone the repo and review existing services:
   - `packages/core/src/services/graph-service.ts`
   - `packages/core/src/services/vector-service.ts`
   - `packages/core/src/services/ai-service.ts`

2. Create the RLM Router service

3. Add CLI integration

4. Add tests in `tests/rlm-router.test.ts`

## Reference

Full implementation spec: See `cv-git-rlm-integration-prompt.md` for complete code examples, types, and testing requirements.

---

## Research Papers Referenced

1. **Recursive Language Models** (arXiv:2512.24601)
   - Treats context as external REPL environment
   - LLM writes code to decompose and recurse
   - Handles 10M+ tokens via recursive sub-queries

2. **TTT-E2E** (arXiv:2512.23675)
   - Compresses context into model weights
   - Constant latency regardless of context length
   - "Brain vs notepad" - intuition vs retrieval

Both papers solve: How to give AI deep understanding of large codebases without context window limits. CV-Git already has the external environment (graph + vectors) - RLM provides the reasoning scaffold.
