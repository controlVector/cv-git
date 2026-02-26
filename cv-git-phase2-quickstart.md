# CV-Git Phase 2: Codebase Summary - Quick Start

## For Claude Code

**Project**: CV-Git  
**Goal**: Generate codebase "intuition" at sync time

## What to Build

1. **`CodebaseSummaryService`** (`packages/core/src/services/codebase-summary.ts`)
   - Gathers stats from FalkorDB graph
   - Detects architecture patterns via AI
   - Identifies conventions, abstractions, hotspots
   - Generates natural language summary
   - Creates compressed embedding

2. **Integrate into `cv sync`** - Generate summary after graph/vector sync

3. **Connect to RLM Router** - Load summary for context in reasoning

4. **Add `cv summary` command** - View the generated summary

## Key Interface

```typescript
interface CodebaseSummary {
  version: string;
  generatedAt: string;
  stats: {
    totalFiles: number;
    totalSymbols: number;
    languages: Record<string, number>;
  };
  architecture: {
    entryPoints: string[];
    coreModules: ModuleSummary[];
    patterns: string[];  // "Layered", "Repository pattern", etc.
  };
  conventions: {
    naming: string[];
    fileStructure: string[];
    testing: string[];
  };
  abstractions: {
    interfaces: InterfaceSummary[];
    baseClasses: ClassSummary[];
    utilities: FunctionSummary[];
  };
  dependencies: {
    external: string[];
    hotspots: string[];
    potentialIssues: string[];
  };
  naturalLanguageSummary: string;
  embedding: number[];
}
```

## Graph Queries Needed

```cypher
# Stats
MATCH (s:Symbol) RETURN s.type, count(s)
MATCH (f:File) RETURN f.language, count(f)

# Entry points
MATCH (f:File) WHERE f.path =~ '.*(main|index|app).*' RETURN f.path

# Hotspots
MATCH (caller)-[:CALLS]->(callee) 
WITH callee, count(caller) as calls 
ORDER BY calls DESC LIMIT 10

# Circular deps
MATCH path = (a:File)-[:IMPORTS*2..5]->(a) RETURN path
```

## Files to Create/Modify

| File | Action |
|------|--------|
| `packages/core/src/services/codebase-summary.ts` | Create |
| `packages/core/src/services/index.ts` | Export |
| `packages/cli/src/commands/sync.ts` | Add summary generation |
| `packages/cli/src/commands/summary.ts` | Create |
| `packages/core/src/services/rlm-router.ts` | Add `loadSummary()` |
| `tests/codebase-summary.test.ts` | Create |

## Expected Output

```bash
$ cv sync
Syncing graph... ✅
Syncing vectors... ✅
📊 Generating codebase summary...
✅ Codebase summary generated
   📁 127 files, 1,432 symbols
   🏗️  Patterns: Layered, Repository pattern
   🔥 Hotspots: logger (47), validateInput (32)

$ cv summary
📊 Codebase Summary
══════════════════════════════════════════════════
📈 Statistics
   Files: 127
   Symbols: 1,432
   Languages: typescript(98), javascript(29)

🏗️  Architecture
   Patterns: Layered, Repository pattern
   Entry points: src/index.ts, src/cli/index.ts
   Core modules: services, commands, utils
...
```

## Reference

Full implementation spec with complete code: `cv-git-phase2-summary-prompt.md`
