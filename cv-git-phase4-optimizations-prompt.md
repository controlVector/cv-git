# CV-Git Phase 4: Optimizations & Polish

## For Claude Code

**Project**: CV-Git (https://github.com/controlVector/cv-git)
**Goal**: Add performance optimizations, new MCP tools, watch mode, diff analysis, and documentation

## Context

Phases 1-3 complete:
- RLM Router with recursive reasoning (15 tests)
- Codebase Summary generation (13 tests)
- Advanced Graph Queries (26 tests)
- **Total: 50+ tests passing**

Phase 4 adds polish and production-readiness across 5 areas.

---

## Part A: Performance Optimizations

### A1: Query Result Caching

**Create**: `packages/core/src/services/cache-service.ts`

```typescript
import { LRUCache } from 'lru-cache';

export interface CacheOptions {
  maxSize?: number;      // Max items
  ttlMs?: number;        // Time to live in ms
  updateOnGet?: boolean; // Reset TTL on access
}

export interface CacheStats {
  hits: number;
  misses: number;
  size: number;
  hitRate: number;
}

export class CacheService {
  private cache: LRUCache<string, any>;
  private hits = 0;
  private misses = 0;

  constructor(options: CacheOptions = {}) {
    this.cache = new LRUCache({
      max: options.maxSize ?? 1000,
      ttl: options.ttlMs ?? 5 * 60 * 1000, // 5 min default
      updateAgeOnGet: options.updateOnGet ?? true
    });
  }

  /**
   * Get or compute a value
   */
  async getOrCompute<T>(
    key: string,
    compute: () => Promise<T>,
    ttlMs?: number
  ): Promise<T> {
    const cached = this.cache.get(key);
    if (cached !== undefined) {
      this.hits++;
      return cached as T;
    }

    this.misses++;
    const value = await compute();
    this.cache.set(key, value, { ttl: ttlMs });
    return value;
  }

  /**
   * Generate cache key from function name and args
   */
  static key(fn: string, ...args: any[]): string {
    return `${fn}:${JSON.stringify(args)}`;
  }

  get(key: string): any | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) this.hits++;
    else this.misses++;
    return value;
  }

  set(key: string, value: any, ttlMs?: number): void {
    this.cache.set(key, value, { ttl: ttlMs });
  }

  invalidate(pattern?: string): number {
    if (!pattern) {
      const size = this.cache.size;
      this.cache.clear();
      return size;
    }
    
    let count = 0;
    for (const key of this.cache.keys()) {
      if (key.includes(pattern)) {
        this.cache.delete(key);
        count++;
      }
    }
    return count;
  }

  getStats(): CacheStats {
    const total = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      size: this.cache.size,
      hitRate: total > 0 ? this.hits / total : 0
    };
  }

  resetStats(): void {
    this.hits = 0;
    this.misses = 0;
  }
}

// Singleton for graph queries
export const graphCache = new CacheService({ 
  maxSize: 500, 
  ttlMs: 10 * 60 * 1000  // 10 min for graph queries
});

// Singleton for vector searches  
export const vectorCache = new CacheService({ 
  maxSize: 200, 
  ttlMs: 5 * 60 * 1000   // 5 min for vector searches
});

// Singleton for AI responses
export const aiCache = new CacheService({ 
  maxSize: 100, 
  ttlMs: 30 * 60 * 1000  // 30 min for AI responses
});
```

### A2: Add Caching to GraphService

**Modify**: `packages/core/src/services/graph-service.ts`

```typescript
import { graphCache, CacheService } from './cache-service';

export class GraphService {
  private cache: CacheService;

  constructor(/* existing params */, cache?: CacheService) {
    this.cache = cache ?? graphCache;
  }

  async findPath(from: string, to: string, options?: PathOptions): Promise<PathResult> {
    const cacheKey = CacheService.key('findPath', from, to, options);
    
    return this.cache.getOrCompute(cacheKey, async () => {
      // existing implementation
    });
  }

  async getNeighborhood(symbol: string, options?: NeighborhoodOptions): Promise<Neighborhood> {
    const cacheKey = CacheService.key('getNeighborhood', symbol, options);
    
    return this.cache.getOrCompute(cacheKey, async () => {
      // existing implementation
    });
  }

  async getImpactAnalysis(symbol: string, options?: ImpactOptions): Promise<ImpactAnalysis> {
    const cacheKey = CacheService.key('getImpactAnalysis', symbol, options);
    
    return this.cache.getOrCompute(cacheKey, async () => {
      // existing implementation
    });
  }

  // Add method to invalidate cache (called after sync)
  invalidateCache(): void {
    this.cache.invalidate();
  }
}
```

### A3: Parallel Task Execution in RLM Router

**Modify**: `packages/core/src/services/rlm-router.ts`

```typescript
export class RLMRouter {
  /**
   * Execute independent tasks in parallel
   */
  private async executeTasks(tasks: RLMTask[], ctx: RLMContext): Promise<void> {
    // Group tasks by dependency
    const independent: RLMTask[] = [];
    const dependent: RLMTask[] = [];

    for (const task of tasks) {
      if (this.isIndependent(task, tasks)) {
        independent.push(task);
      } else {
        dependent.push(task);
      }
    }

    // Execute independent tasks in parallel
    if (independent.length > 0) {
      const results = await Promise.all(
        independent.map(async (task) => {
          try {
            const result = await this.executeTask(task, ctx);
            return { task, result, error: null };
          } catch (error) {
            return { task, result: null, error };
          }
        })
      );

      // Store results
      for (const { task, result, error } of results) {
        if (error) {
          ctx.trace.push({
            action: task.type,
            input: task,
            output: { error: error.message },
            reasoning: `Failed: ${error.message}`
          });
        } else {
          ctx.buffers.set(task.id, result);
          ctx.trace.push({
            action: task.type,
            input: task,
            output: result,
            reasoning: task.reasoning
          });
        }
      }
    }

    // Execute dependent tasks sequentially
    for (const task of dependent) {
      try {
        const result = await this.executeTask(task, ctx);
        ctx.buffers.set(task.id, result);
        ctx.trace.push({
          action: task.type,
          input: task,
          output: result,
          reasoning: task.reasoning
        });
      } catch (error) {
        ctx.trace.push({
          action: task.type,
          input: task,
          output: { error: error.message },
          reasoning: `Failed: ${error.message}`
        });
      }
    }
  }

  /**
   * Check if a task is independent (doesn't depend on other tasks' results)
   */
  private isIndependent(task: RLMTask, allTasks: RLMTask[]): boolean {
    // Recurse tasks are never independent
    if (task.type === 'recurse') return false;
    
    // Check if task references other task IDs
    const taskJson = JSON.stringify(task);
    for (const other of allTasks) {
      if (other.id !== task.id && taskJson.includes(other.id)) {
        return false;
      }
    }
    return true;
  }
}
```

### A4: Add Cache Stats CLI Command

**Create**: `packages/cli/src/commands/cache.ts`

```typescript
import { Command } from 'commander';
import { graphCache, vectorCache, aiCache } from '@cv-git/core';

export const cacheCommand = new Command('cache')
  .description('Manage query cache');

cacheCommand
  .command('stats')
  .description('Show cache statistics')
  .action(() => {
    console.log('\n📊 Cache Statistics\n');
    
    const graphStats = graphCache.getStats();
    console.log('Graph Cache:');
    console.log(`  Size: ${graphStats.size} items`);
    console.log(`  Hit Rate: ${(graphStats.hitRate * 100).toFixed(1)}%`);
    console.log(`  Hits/Misses: ${graphStats.hits}/${graphStats.misses}`);
    
    const vectorStats = vectorCache.getStats();
    console.log('\nVector Cache:');
    console.log(`  Size: ${vectorStats.size} items`);
    console.log(`  Hit Rate: ${(vectorStats.hitRate * 100).toFixed(1)}%`);
    console.log(`  Hits/Misses: ${vectorStats.hits}/${vectorStats.misses}`);
    
    const aiStats = aiCache.getStats();
    console.log('\nAI Cache:');
    console.log(`  Size: ${aiStats.size} items`);
    console.log(`  Hit Rate: ${(aiStats.hitRate * 100).toFixed(1)}%`);
    console.log(`  Hits/Misses: ${aiStats.hits}/${aiStats.misses}`);
  });

cacheCommand
  .command('clear')
  .description('Clear all caches')
  .option('--graph', 'Clear only graph cache')
  .option('--vector', 'Clear only vector cache')
  .option('--ai', 'Clear only AI cache')
  .action((options) => {
    if (options.graph || (!options.vector && !options.ai)) {
      const count = graphCache.invalidate();
      console.log(`Cleared ${count} graph cache entries`);
    }
    if (options.vector || (!options.graph && !options.ai)) {
      const count = vectorCache.invalidate();
      console.log(`Cleared ${count} vector cache entries`);
    }
    if (options.ai || (!options.graph && !options.vector)) {
      const count = aiCache.invalidate();
      console.log(`Cleared ${count} AI cache entries`);
    }
  });
```

---

## Part B: New MCP Tools

**Modify**: `packages/mcp-server/src/index.ts`

Add tools for the new graph commands:

```typescript
// Add to tools array

// Tool: cv_graph_path
{
  name: 'cv_graph_path',
  description: 'Find the call/dependency path between two symbols in the codebase',
  inputSchema: {
    type: 'object',
    properties: {
      from: {
        type: 'string',
        description: 'Starting symbol name'
      },
      to: {
        type: 'string',
        description: 'Target symbol name'
      },
      maxDepth: {
        type: 'number',
        description: 'Maximum path length (default: 10)',
        default: 10
      }
    },
    required: ['from', 'to']
  }
},

// Tool: cv_graph_neighborhood
{
  name: 'cv_graph_neighborhood',
  description: 'Explore symbols connected to a given symbol in the code graph',
  inputSchema: {
    type: 'object',
    properties: {
      symbol: {
        type: 'string',
        description: 'Center symbol to explore around'
      },
      depth: {
        type: 'number',
        description: 'How many hops to explore (default: 2)',
        default: 2
      },
      direction: {
        type: 'string',
        enum: ['incoming', 'outgoing', 'both'],
        description: 'Direction to explore (default: both)',
        default: 'both'
      }
    },
    required: ['symbol']
  }
},

// Tool: cv_graph_impact
{
  name: 'cv_graph_impact',
  description: 'Analyze the impact of changing a symbol - what would be affected',
  inputSchema: {
    type: 'object',
    properties: {
      symbol: {
        type: 'string',
        description: 'Symbol to analyze impact for'
      },
      depth: {
        type: 'number',
        description: 'Analysis depth (default: 3)',
        default: 3
      }
    },
    required: ['symbol']
  }
},

// Tool: cv_graph_bridge
{
  name: 'cv_graph_bridge',
  description: 'Find how two concepts or symbols are connected in the codebase',
  inputSchema: {
    type: 'object',
    properties: {
      conceptA: {
        type: 'string',
        description: 'First concept or symbol'
      },
      conceptB: {
        type: 'string',
        description: 'Second concept or symbol'
      }
    },
    required: ['conceptA', 'conceptB']
  }
},

// Tool: cv_summary_view
{
  name: 'cv_summary_view',
  description: 'Get the codebase summary including architecture, conventions, and key abstractions',
  inputSchema: {
    type: 'object',
    properties: {
      section: {
        type: 'string',
        enum: ['all', 'stats', 'architecture', 'conventions', 'abstractions', 'dependencies'],
        description: 'Which section to return (default: all)',
        default: 'all'
      }
    }
  }
}
```

**Add handlers** in `packages/mcp-server/src/handlers/`:

```typescript
// graph-handlers.ts

import { GraphService, SemanticGraphService } from '@cv-git/core';

export async function handleGraphPath(params: {
  from: string;
  to: string;
  maxDepth?: number;
}): Promise<any> {
  const graph = await getGraphService();
  const result = await graph.findPath(params.from, params.to, {
    maxDepth: params.maxDepth ?? 10
  });
  
  return {
    found: result.found,
    path: result.path,
    length: result.length,
    explanation: result.explanation
  };
}

export async function handleGraphNeighborhood(params: {
  symbol: string;
  depth?: number;
  direction?: 'incoming' | 'outgoing' | 'both';
}): Promise<any> {
  const graph = await getGraphService();
  const result = await graph.getNeighborhood(params.symbol, {
    depth: params.depth ?? 2,
    direction: params.direction ?? 'both'
  });
  
  return {
    center: result.center,
    nodes: result.nodes,
    summary: result.summary
  };
}

export async function handleGraphImpact(params: {
  symbol: string;
  depth?: number;
}): Promise<any> {
  const graph = await getGraphService();
  return graph.getImpactAnalysis(params.symbol, {
    depth: params.depth ?? 3
  });
}

export async function handleGraphBridge(params: {
  conceptA: string;
  conceptB: string;
}): Promise<any> {
  const semanticGraph = await getSemanticGraphService();
  return semanticGraph.findSemanticBridge(params.conceptA, params.conceptB);
}

export async function handleSummaryView(params: {
  section?: string;
}): Promise<any> {
  const summaryPath = path.join(process.cwd(), '.cv-git', 'summary.json');
  
  if (!await fs.pathExists(summaryPath)) {
    return { error: 'No summary found. Run cv sync first.' };
  }
  
  const summary = await fs.readJson(summaryPath);
  
  if (params.section && params.section !== 'all') {
    return { [params.section]: summary[params.section] };
  }
  
  return summary;
}
```

---

## Part C: Watch Mode

**Create**: `packages/cli/src/commands/watch.ts`

```typescript
import { Command } from 'commander';
import * as chokidar from 'chokidar';
import * as path from 'path';
import { debounce } from 'lodash';

export const watchCommand = new Command('watch')
  .description('Watch for file changes and auto-sync')
  .option('--debounce <ms>', 'Debounce delay in milliseconds', '2000')
  .option('--no-summary', 'Skip summary regeneration on sync')
  .option('--verbose', 'Show all file change events')
  .action(async (options) => {
    const debounceMs = parseInt(options.debounce);
    const repoPath = process.cwd();
    
    console.log('👀 Watching for changes...');
    console.log(`   Debounce: ${debounceMs}ms`);
    console.log('   Press Ctrl+C to stop\n');

    // Track changed files
    const changedFiles = new Set<string>();
    let syncing = false;

    // Debounced sync function
    const performSync = debounce(async () => {
      if (syncing) return;
      syncing = true;

      const files = Array.from(changedFiles);
      changedFiles.clear();

      console.log(`\n🔄 Syncing ${files.length} changed files...`);
      
      try {
        // Import sync logic
        const { incrementalSync } = await import('@cv-git/core');
        
        await incrementalSync(files, {
          updateSummary: !options.noSummary
        });
        
        console.log('✅ Sync complete\n');
      } catch (error) {
        console.error('❌ Sync failed:', error.message);
      } finally {
        syncing = false;
      }
    }, debounceMs);

    // File patterns to watch
    const patterns = [
      '**/*.ts',
      '**/*.tsx',
      '**/*.js',
      '**/*.jsx',
      '**/*.py',
      '**/*.go',
      '**/*.rs',
      '**/*.java'
    ];

    // Ignore patterns
    const ignored = [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.git/**',
      '**/coverage/**',
      '**/*.test.*',
      '**/*.spec.*'
    ];

    // Create watcher
    const watcher = chokidar.watch(patterns, {
      cwd: repoPath,
      ignored,
      persistent: true,
      ignoreInitial: true
    });

    watcher
      .on('add', (filePath) => {
        if (options.verbose) console.log(`  + ${filePath}`);
        changedFiles.add(path.join(repoPath, filePath));
        performSync();
      })
      .on('change', (filePath) => {
        if (options.verbose) console.log(`  ~ ${filePath}`);
        changedFiles.add(path.join(repoPath, filePath));
        performSync();
      })
      .on('unlink', (filePath) => {
        if (options.verbose) console.log(`  - ${filePath}`);
        changedFiles.add(path.join(repoPath, filePath));
        performSync();
      })
      .on('error', (error) => {
        console.error('Watcher error:', error);
      });

    // Handle graceful shutdown
    process.on('SIGINT', () => {
      console.log('\n\n👋 Stopping watch mode...');
      watcher.close();
      process.exit(0);
    });
  });
```

**Add incremental sync support**:

**Create**: `packages/core/src/services/incremental-sync.ts`

```typescript
import { GraphService } from './graph-service';
import { VectorService } from './vector-service';
import { CodebaseSummaryService } from './codebase-summary';
import { parseFile } from '../parsers';

export interface IncrementalSyncOptions {
  updateSummary?: boolean;
}

export interface IncrementalSyncResult {
  filesProcessed: number;
  symbolsAdded: number;
  symbolsRemoved: number;
  duration: number;
}

export async function incrementalSync(
  changedFiles: string[],
  options: IncrementalSyncOptions = {}
): Promise<IncrementalSyncResult> {
  const startTime = Date.now();
  const graph = await getGraphService();
  const vector = await getVectorService();
  
  let symbolsAdded = 0;
  let symbolsRemoved = 0;

  for (const filePath of changedFiles) {
    try {
      // Check if file exists (might be deleted)
      const exists = await fs.pathExists(filePath);
      
      if (!exists) {
        // Remove symbols from this file
        const removed = await graph.removeSymbolsFromFile(filePath);
        await vector.removeByFile(filePath);
        symbolsRemoved += removed;
        continue;
      }

      // Parse the file
      const symbols = await parseFile(filePath);
      
      // Remove old symbols for this file
      const removed = await graph.removeSymbolsFromFile(filePath);
      symbolsRemoved += removed;
      
      // Add new symbols
      for (const symbol of symbols) {
        await graph.addSymbol(symbol);
        await vector.upsert({
          id: symbol.id,
          vector: await vector.embed(symbol.code || symbol.name),
          payload: {
            name: symbol.name,
            type: symbol.type,
            file: symbol.file,
            language: symbol.language
          }
        });
        symbolsAdded++;
      }
    } catch (error) {
      console.warn(`Warning: Could not process ${filePath}: ${error.message}`);
    }
  }

  // Invalidate caches
  graph.invalidateCache();

  // Optionally update summary
  if (options.updateSummary && changedFiles.length > 10) {
    // Only regenerate summary for significant changes
    const summaryService = await getSummaryService();
    await summaryService.generate(process.cwd());
  }

  return {
    filesProcessed: changedFiles.length,
    symbolsAdded,
    symbolsRemoved,
    duration: Date.now() - startTime
  };
}
```

---

## Part D: Diff Analysis

**Create**: `packages/cli/src/commands/diff.ts`

```typescript
import { Command } from 'commander';
import { execSync } from 'child_process';
import { AIService, GraphService } from '@cv-git/core';

export const diffCommand = new Command('diff')
  .description('Analyze code changes with AI');

diffCommand
  .command('explain')
  .description('Get AI explanation of current changes')
  .option('--staged', 'Only explain staged changes')
  .option('--commit <ref>', 'Explain changes in a specific commit')
  .option('--impact', 'Include impact analysis')
  .action(async (options) => {
    const ai = await getAIService();
    const graph = await getGraphService();
    
    // Get the diff
    let diff: string;
    let description: string;
    
    if (options.commit) {
      diff = execSync(`git show ${options.commit} --format="" --patch`, { encoding: 'utf-8' });
      description = `commit ${options.commit}`;
    } else if (options.staged) {
      diff = execSync('git diff --cached', { encoding: 'utf-8' });
      description = 'staged changes';
    } else {
      diff = execSync('git diff', { encoding: 'utf-8' });
      description = 'unstaged changes';
    }
    
    if (!diff.trim()) {
      console.log(`No ${description} found.`);
      return;
    }

    // Parse changed files and symbols
    const changedFiles = parseDiffFiles(diff);
    
    console.log(`\n📝 Analyzing ${description}...\n`);
    console.log(`Changed files: ${changedFiles.length}`);
    changedFiles.forEach(f => console.log(`  - ${f.file} (+${f.additions}/-${f.deletions})`));
    
    // Get AI explanation
    const explanation = await ai.complete(`
Analyze this code diff and explain:
1. What changed and why it might have been changed
2. The purpose of the changes
3. Any potential issues or concerns
4. Suggestions for improvement

\`\`\`diff
${diff.slice(0, 10000)}  // Limit size
\`\`\`

Provide a clear, concise explanation.
`);

    console.log('\n💡 Explanation:\n');
    console.log(explanation);

    // Impact analysis if requested
    if (options.impact) {
      console.log('\n⚡ Impact Analysis:\n');
      
      // Find modified symbols
      const modifiedSymbols = await findModifiedSymbols(changedFiles, graph);
      
      for (const symbol of modifiedSymbols.slice(0, 5)) {
        const impact = await graph.getImpactAnalysis(symbol);
        console.log(`${symbol}:`);
        console.log(`  Risk: ${impact.riskLevel}`);
        console.log(`  Direct callers: ${impact.directCallers.length}`);
        console.log(`  Total impact: ${impact.totalImpact} symbols`);
      }
    }
  });

diffCommand
  .command('review')
  .description('Get AI code review of changes')
  .option('--staged', 'Review staged changes')
  .option('--strict', 'Use stricter review criteria')
  .action(async (options) => {
    const ai = await getAIService();
    
    const diff = options.staged 
      ? execSync('git diff --cached', { encoding: 'utf-8' })
      : execSync('git diff', { encoding: 'utf-8' });
    
    if (!diff.trim()) {
      console.log('No changes to review.');
      return;
    }

    console.log('\n🔍 Reviewing changes...\n');

    const strictness = options.strict 
      ? 'Be thorough and strict. Flag any potential issues.'
      : 'Focus on significant issues. Minor style issues can be noted but are lower priority.';

    const review = await ai.complete(`
You are a senior code reviewer. Review this diff and provide feedback.

${strictness}

Categories to evaluate:
1. **Bugs & Logic Errors** - Potential bugs, edge cases, null handling
2. **Security** - Security vulnerabilities, data exposure
3. **Performance** - Performance issues, N+1 queries, unnecessary operations
4. **Maintainability** - Code clarity, complexity, naming
5. **Testing** - Test coverage concerns

\`\`\`diff
${diff.slice(0, 15000)}
\`\`\`

Format your review as:
## Summary
(Overall assessment)

## Issues Found
(List issues by category with severity: 🔴 Critical, 🟡 Warning, 🔵 Info)

## Suggestions
(Improvement suggestions)
`);

    console.log(review);
  });

diffCommand
  .command('summary')
  .description('Generate a commit message from changes')
  .option('--staged', 'Use staged changes')
  .option('--conventional', 'Use conventional commit format')
  .action(async (options) => {
    const ai = await getAIService();
    
    const diff = options.staged
      ? execSync('git diff --cached', { encoding: 'utf-8' })
      : execSync('git diff', { encoding: 'utf-8' });
    
    if (!diff.trim()) {
      console.log('No changes found.');
      return;
    }

    const format = options.conventional
      ? 'Use conventional commit format: type(scope): description'
      : 'Use a clear, concise format';

    const message = await ai.complete(`
Generate a commit message for this diff.
${format}

Guidelines:
- First line: 50 chars max, imperative mood ("Add" not "Added")
- Leave blank line after first line
- Body: Explain what and why (not how)

\`\`\`diff
${diff.slice(0, 8000)}
\`\`\`

Output ONLY the commit message, nothing else.
`);

    console.log('\n📝 Suggested commit message:\n');
    console.log('---');
    console.log(message.trim());
    console.log('---');
    console.log('\nCopy with: cv diff summary --staged | pbcopy');
  });

// Helper functions
function parseDiffFiles(diff: string): Array<{file: string; additions: number; deletions: number}> {
  const files: Array<{file: string; additions: number; deletions: number}> = [];
  const fileRegex = /diff --git a\/(.*) b\/(.*)/g;
  const statRegex = /^@@.*@@/gm;
  
  let match;
  while ((match = fileRegex.exec(diff)) !== null) {
    const file = match[2];
    // Count +/- lines (simplified)
    const fileSection = diff.slice(match.index, fileRegex.lastIndex + 5000);
    const additions = (fileSection.match(/^\+[^+]/gm) || []).length;
    const deletions = (fileSection.match(/^-[^-]/gm) || []).length;
    files.push({ file, additions, deletions });
  }
  
  return files;
}

async function findModifiedSymbols(
  changedFiles: Array<{file: string}>,
  graph: GraphService
): Promise<string[]> {
  const symbols: string[] = [];
  
  for (const { file } of changedFiles) {
    try {
      const fileSymbols = await graph.getSymbolsInFile(file);
      symbols.push(...fileSymbols.map(s => s.name));
    } catch (e) {
      // File might not be in graph yet
    }
  }
  
  return [...new Set(symbols)];
}
```

---

## Part E: Documentation

### E1: Update README.md

**Modify**: `README.md`

Add sections for new features:

```markdown
## 🚀 New in v0.4.0

### Deep Reasoning (RLM)
CV-Git now includes recursive language model reasoning for complex codebase questions:

\`\`\`bash
# Simple explanation
cv explain UserService

# Deep reasoning with trace
cv explain "how does authentication flow through the system" --deep --trace
\`\`\`

### Codebase Summary
Automatically generated during sync - captures architecture, conventions, and key abstractions:

\`\`\`bash
cv sync      # Generates summary
cv summary   # View summary
\`\`\`

### Advanced Graph Queries
New commands for exploring code relationships:

\`\`\`bash
cv graph path --from handleRequest --to saveToDb
cv graph neighborhood UserService --depth 2
cv graph impact CoreValidator
cv graph bridge AuthService PaymentGateway
cv graph hubs
\`\`\`

### Watch Mode
Auto-sync on file changes:

\`\`\`bash
cv watch --verbose
\`\`\`

### Diff Analysis
AI-powered diff explanation and review:

\`\`\`bash
cv diff explain --staged --impact
cv diff review --strict
cv diff summary --conventional
\`\`\`

### Performance
- Query result caching (10x faster repeated queries)
- Parallel task execution in RLM
- Incremental sync for watch mode

## 📊 MCP Tools (26 total)

### Code Understanding
- `cv_find` - Semantic search
- `cv_explain` - AI explanation
- `cv_reason` - Deep reasoning (RLM)
- `cv_graph_path` - Find execution paths
- `cv_graph_neighborhood` - Explore connections
- `cv_graph_impact` - Change impact analysis
- `cv_graph_bridge` - Find connecting code
- `cv_summary_view` - Codebase summary

### Code Analysis
- `cv_graph_stats` - Graph statistics
- `cv_graph_dead_code` - Find unreachable code
- `cv_graph_cycles` - Circular dependencies
- `cv_graph_complexity` - Complex functions
- `cv_graph_hotspots` - Most-called functions

... (rest of tools)
```

### E2: Create CHANGELOG.md Entry

**Modify**: `CHANGELOG.md`

```markdown
## [0.4.0] - 2025-01-21

### Added
- **RLM Router**: Recursive Language Model reasoning for complex queries
  - `cv explain --deep` for multi-step reasoning
  - `--trace` flag to show reasoning steps
  - 10 task types for graph, vector, and AI operations

- **Codebase Summary**: Auto-generated during sync
  - Architecture pattern detection
  - Convention analysis
  - Key abstraction identification
  - Hotspot detection
  - Natural language summary

- **Advanced Graph Queries**:
  - `cv graph path` - Find call paths between symbols
  - `cv graph neighborhood` - Explore symbol connections
  - `cv graph impact` - Change impact analysis
  - `cv graph bridge` - Find code connecting concepts
  - `cv graph hubs` - Find most connected functions

- **Watch Mode**: `cv watch` for auto-sync on file changes

- **Diff Analysis**:
  - `cv diff explain` - AI explanation of changes
  - `cv diff review` - AI code review
  - `cv diff summary` - Generate commit messages

- **New MCP Tools**: 6 new tools for graph operations and summary

### Improved
- Query performance with LRU caching
- Parallel task execution in RLM Router
- Incremental sync for faster updates

### Fixed
- Various graph query edge cases
```

### E3: Generate API Documentation

**Create**: `docs/API.md`

```markdown
# CV-Git API Documentation

## Core Services

### RLMRouter

Recursive Language Model router for deep reasoning.

\`\`\`typescript
import { createRLMRouter } from '@cv-git/core';

const rlm = createRLMRouter(graphService, vectorService, aiService, {
  maxDepth: 5
});

const result = await rlm.process("How does auth work?");
console.log(result.answer);
console.log(result.trace); // Reasoning steps
\`\`\`

### GraphService

Knowledge graph operations.

\`\`\`typescript
// Find path
const path = await graph.findPath('funcA', 'funcB');

// Get neighborhood
const hood = await graph.getNeighborhood('MyClass', { depth: 2 });

// Impact analysis
const impact = await graph.getImpactAnalysis('coreFunc');
// Returns: { riskLevel: 'high', directCallers: [...], ... }
\`\`\`

### SemanticGraphService

Combined semantic + graph queries.

\`\`\`typescript
// Find related symbols
const related = await semanticGraph.findRelatedSymbols('authentication');

// Find bridge between concepts
const bridge = await semanticGraph.findSemanticBridge('auth', 'payment');
\`\`\`

### CodebaseSummaryService

Generate codebase summary.

\`\`\`typescript
const summary = await summaryService.generate('/path/to/repo');
console.log(summary.architecture.patterns);
console.log(summary.naturalLanguageSummary);
\`\`\`

### CacheService

Query result caching.

\`\`\`typescript
import { graphCache, CacheService } from '@cv-git/core';

// Get or compute
const result = await graphCache.getOrCompute(
  CacheService.key('myQuery', arg1, arg2),
  async () => expensiveQuery()
);

// Stats
console.log(graphCache.getStats());

// Invalidate
graphCache.invalidate('pattern');
\`\`\`

## CLI Commands

| Command | Description |
|---------|-------------|
| `cv sync` | Sync repo with graph/vectors |
| `cv explain <target> [--deep]` | AI explanation |
| `cv find <query>` | Semantic search |
| `cv summary` | View codebase summary |
| `cv watch` | Auto-sync on changes |
| `cv diff explain` | Explain changes |
| `cv diff review` | Review changes |
| `cv graph path` | Find call paths |
| `cv graph neighborhood` | Explore connections |
| `cv graph impact` | Change impact |
| `cv graph bridge` | Find bridges |
| `cv cache stats` | Cache statistics |

## MCP Tools

All 26 tools available for Claude Desktop integration.
See `packages/mcp-server/README.md` for full documentation.
\`\`\`
```

---

## Tests to Add

**Create**: `packages/core/src/services/cache-service.test.ts`

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { CacheService } from './cache-service';

describe('CacheService', () => {
  let cache: CacheService;

  beforeEach(() => {
    cache = new CacheService({ maxSize: 10, ttlMs: 1000 });
  });

  it('should cache and retrieve values', async () => {
    let computeCount = 0;
    const compute = async () => {
      computeCount++;
      return 'result';
    };

    const result1 = await cache.getOrCompute('key1', compute);
    const result2 = await cache.getOrCompute('key1', compute);

    expect(result1).toBe('result');
    expect(result2).toBe('result');
    expect(computeCount).toBe(1); // Only computed once
  });

  it('should track hit/miss stats', async () => {
    await cache.getOrCompute('key1', async () => 'a');
    await cache.getOrCompute('key1', async () => 'a');
    await cache.getOrCompute('key2', async () => 'b');

    const stats = cache.getStats();
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(2);
    expect(stats.hitRate).toBeCloseTo(0.333, 2);
  });

  it('should invalidate by pattern', () => {
    cache.set('user:1', 'a');
    cache.set('user:2', 'b');
    cache.set('post:1', 'c');

    const count = cache.invalidate('user');
    
    expect(count).toBe(2);
    expect(cache.get('user:1')).toBeUndefined();
    expect(cache.get('post:1')).toBe('c');
  });

  it('should generate consistent keys', () => {
    const key1 = CacheService.key('func', 'arg1', { nested: true });
    const key2 = CacheService.key('func', 'arg1', { nested: true });
    
    expect(key1).toBe(key2);
  });
});
```

---

## Verification Steps

```bash
# 1. Build
pnpm build

# 2. Run all tests
pnpm test

# 3. Test caching
cv cache stats
cv graph path --from funcA --to funcB  # First call
cv graph path --from funcA --to funcB  # Second call (cached)
cv cache stats  # Should show hit

# 4. Test watch mode
cv watch --verbose
# Make a change to a file, watch it sync

# 5. Test diff analysis
git add .
cv diff explain --staged
cv diff review --staged
cv diff summary --staged --conventional

# 6. Verify MCP tools
# Check Claude Desktop can use new tools

# 7. Check documentation
cat README.md
cat CHANGELOG.md
cat docs/API.md
```

## Success Criteria

1. **Performance**
   - Cache hit rate > 50% for repeated queries
   - Parallel tasks execute simultaneously
   - `cv cache stats` works

2. **MCP Tools**
   - All 6 new tools registered
   - Tools return proper responses
   - Claude Desktop can use them

3. **Watch Mode**
   - Detects file changes
   - Debounces properly
   - Incremental sync works

4. **Diff Analysis**
   - `cv diff explain` gives good explanations
   - `cv diff review` provides useful feedback
   - `cv diff summary` generates commit messages

5. **Documentation**
   - README updated with new features
   - CHANGELOG has version entry
   - API docs cover all services

6. **Tests**
   - 60+ total tests passing
   - New cache tests pass
