# CV-Git Phase 2: Codebase Summary Generation

## For Claude Code

**Project**: CV-Git (https://github.com/controlVector/cv-git)
**Goal**: Generate compressed codebase "intuition" at sync time (TTT-E2E inspired)

## Context

Phase 1 (complete) added the RLM Router for recursive reasoning. Phase 2 adds codebase summary generation that:
- Runs during `cv sync`
- Captures architecture patterns, conventions, hotspots
- Generates a compressed embedding of the entire codebase
- Provides context to RLM Router for faster, smarter reasoning

## Why This Matters

From TTT-E2E research: RAG (vector search) is like a "notepad" - good for exact retrieval. But humans also have "intuition" - compressed understanding that doesn't require lookup. The codebase summary gives CV-Git this intuition layer.

## Implementation Tasks

### Task 1: Create CodebaseSummaryService

**File**: `packages/core/src/services/codebase-summary.ts`

```typescript
import { GraphService } from './graph-service';
import { VectorService } from './vector-service';
import { AIService } from './ai-service';

// ============ Interfaces ============

export interface ModuleSummary {
  name: string;
  path: string;
  purpose: string;
  symbolCount: number;
  complexity: number;
  dependencies: string[];
}

export interface InterfaceSummary {
  name: string;
  file: string;
  methods: string[];
  implementedBy: string[];
}

export interface ClassSummary {
  name: string;
  file: string;
  methods: string[];
  extends?: string;
  implements: string[];
}

export interface FunctionSummary {
  name: string;
  file: string;
  signature: string;
  calledBy: number;  // How many functions call this
}

export interface ModuleDependency {
  from: string;
  to: string;
  importCount: number;
}

export interface CodebaseSummary {
  version: string;
  generatedAt: string;
  repoPath: string;
  
  // Statistics
  stats: {
    totalFiles: number;
    totalSymbols: number;
    totalFunctions: number;
    totalClasses: number;
    languages: Record<string, number>;  // language -> file count
  };
  
  // High-level architecture
  architecture: {
    entryPoints: string[];
    coreModules: ModuleSummary[];
    patterns: string[];  // e.g., "Repository pattern", "Event-driven", "Layered"
    layers?: string[];   // If layered architecture detected
  };
  
  // Conventions detected
  conventions: {
    naming: string[];         // e.g., "camelCase functions", "PascalCase classes"
    fileStructure: string[];  // e.g., "feature-based folders", "type-based folders"
    errorHandling: string[];  // e.g., "try-catch with custom errors", "Result types"
    testing: string[];        // e.g., "vitest", "jest", "co-located tests"
  };
  
  // Key abstractions
  abstractions: {
    interfaces: InterfaceSummary[];
    baseClasses: ClassSummary[];
    utilities: FunctionSummary[];
  };
  
  // Dependency analysis
  dependencies: {
    external: string[];           // npm packages, etc.
    internalGraph: ModuleDependency[];
    hotspots: string[];           // Most imported/called symbols
    potentialIssues: string[];    // Circular deps, orphaned code
  };
  
  // Natural language summary
  naturalLanguageSummary: string;
  
  // Compressed embedding of entire codebase
  embedding: number[];
}

// ============ Service ============

export class CodebaseSummaryService {
  constructor(
    private graph: GraphService,
    private vector: VectorService,
    private ai: AIService
  ) {}

  /**
   * Generate comprehensive codebase summary
   */
  async generate(repoPath: string): Promise<CodebaseSummary> {
    console.log('Analyzing codebase structure...');
    
    // 1. Gather statistics from graph
    const stats = await this.gatherStats();
    
    // 2. Identify architecture patterns
    console.log('Detecting architecture patterns...');
    const architecture = await this.analyzeArchitecture();
    
    // 3. Detect conventions via sampling + LLM
    console.log('Analyzing conventions...');
    const conventions = await this.detectConventions();
    
    // 4. Extract key abstractions
    console.log('Extracting key abstractions...');
    const abstractions = await this.extractAbstractions();
    
    // 5. Analyze dependencies
    console.log('Analyzing dependencies...');
    const dependencies = await this.analyzeDependencies();
    
    // 6. Generate natural language summary
    console.log('Generating summary...');
    const naturalLanguageSummary = await this.generateNaturalLanguageSummary({
      stats,
      architecture,
      conventions,
      abstractions,
      dependencies
    });
    
    // 7. Generate compressed embedding
    console.log('Generating embedding...');
    const embedding = await this.generateCodebaseEmbedding({
      stats,
      architecture,
      conventions,
      abstractions,
      dependencies,
      naturalLanguageSummary
    });
    
    return {
      version: '1.0',
      generatedAt: new Date().toISOString(),
      repoPath,
      stats,
      architecture,
      conventions,
      abstractions,
      dependencies,
      naturalLanguageSummary,
      embedding
    };
  }

  /**
   * Gather basic statistics from the graph
   */
  private async gatherStats(): Promise<CodebaseSummary['stats']> {
    // Query graph for counts
    const symbolCounts = await this.graph.query(`
      MATCH (s:Symbol)
      RETURN s.type as type, count(s) as count
    `);
    
    const fileCounts = await this.graph.query(`
      MATCH (f:File)
      RETURN f.language as language, count(f) as count
    `);
    
    const languages: Record<string, number> = {};
    let totalFiles = 0;
    for (const row of fileCounts) {
      languages[row.language] = row.count;
      totalFiles += row.count;
    }
    
    let totalSymbols = 0;
    let totalFunctions = 0;
    let totalClasses = 0;
    for (const row of symbolCounts) {
      totalSymbols += row.count;
      if (row.type === 'function' || row.type === 'method') {
        totalFunctions += row.count;
      }
      if (row.type === 'class') {
        totalClasses += row.count;
      }
    }
    
    return {
      totalFiles,
      totalSymbols,
      totalFunctions,
      totalClasses,
      languages
    };
  }

  /**
   * Analyze architecture patterns
   */
  private async analyzeArchitecture(): Promise<CodebaseSummary['architecture']> {
    // Find entry points (files with main, index, app, etc.)
    const entryPointCandidates = await this.graph.query(`
      MATCH (f:File)
      WHERE f.path =~ '(?i).*(main|index|app|server|cli)\\.(ts|js|py|go|rs)$'
      RETURN f.path as path
      LIMIT 10
    `);
    
    // Find core modules (directories with most symbols)
    const moduleCounts = await this.graph.query(`
      MATCH (s:Symbol)
      WITH split(s.file, '/') as parts, s
      WITH parts[size(parts)-2] as module, count(s) as symbolCount, 
           avg(s.complexity) as avgComplexity
      WHERE module IS NOT NULL
      RETURN module, symbolCount, avgComplexity
      ORDER BY symbolCount DESC
      LIMIT 10
    `);
    
    // Sample code to detect patterns
    const sampleSymbols = await this.graph.query(`
      MATCH (s:Symbol)
      WHERE s.type IN ['class', 'interface', 'function']
      RETURN s.name as name, s.type as type, s.file as file
      ORDER BY rand()
      LIMIT 20
    `);
    
    // Use AI to detect patterns
    const patternAnalysis = await this.ai.complete(`
Analyze these code symbols and detect architectural patterns:

Symbols:
${sampleSymbols.map(s => `- ${s.type}: ${s.name} (${s.file})`).join('\n')}

Core modules by size:
${moduleCounts.map(m => `- ${m.module}: ${m.symbolCount} symbols`).join('\n')}

Identify:
1. Architecture patterns (e.g., "Layered", "Microservices", "Monolith", "Event-driven", "Repository pattern")
2. If layered, what are the layers?

Respond in JSON:
{
  "patterns": ["pattern1", "pattern2"],
  "layers": ["layer1", "layer2"] // or null if not layered
}
`, { responseFormat: 'json' });

    const parsed = JSON.parse(patternAnalysis);
    
    return {
      entryPoints: entryPointCandidates.map(e => e.path),
      coreModules: moduleCounts.map(m => ({
        name: m.module,
        path: m.module,
        purpose: '', // Will be filled by further analysis if needed
        symbolCount: m.symbolCount,
        complexity: m.avgComplexity || 0,
        dependencies: []
      })),
      patterns: parsed.patterns || [],
      layers: parsed.layers
    };
  }

  /**
   * Detect coding conventions
   */
  private async detectConventions(): Promise<CodebaseSummary['conventions']> {
    // Sample symbol names
    const symbolNames = await this.graph.query(`
      MATCH (s:Symbol)
      RETURN s.name as name, s.type as type
      ORDER BY rand()
      LIMIT 30
    `);
    
    // Sample file paths
    const filePaths = await this.graph.query(`
      MATCH (f:File)
      RETURN f.path as path
      ORDER BY rand()
      LIMIT 20
    `);
    
    // Check for test files
    const testFiles = await this.graph.query(`
      MATCH (f:File)
      WHERE f.path =~ '(?i).*(test|spec).*'
      RETURN f.path as path
      LIMIT 10
    `);
    
    const conventionAnalysis = await this.ai.complete(`
Analyze these code samples to detect conventions:

Symbol names:
${symbolNames.map(s => `- ${s.type}: ${s.name}`).join('\n')}

File paths:
${filePaths.map(f => `- ${f.path}`).join('\n')}

Test files found:
${testFiles.map(t => `- ${t.path}`).join('\n')}

Identify conventions for:
1. Naming (e.g., "camelCase for functions", "PascalCase for classes", "snake_case for files")
2. File structure (e.g., "feature-based folders", "type-based folders", "flat structure")
3. Error handling patterns you can infer
4. Testing patterns (e.g., "co-located tests", "separate __tests__ folder", "vitest/jest")

Respond in JSON:
{
  "naming": ["convention1", "convention2"],
  "fileStructure": ["pattern1"],
  "errorHandling": ["pattern1"],
  "testing": ["pattern1"]
}
`, { responseFormat: 'json' });

    return JSON.parse(conventionAnalysis);
  }

  /**
   * Extract key abstractions (interfaces, base classes, utilities)
   */
  private async extractAbstractions(): Promise<CodebaseSummary['abstractions']> {
    // Find interfaces
    const interfaces = await this.graph.query(`
      MATCH (s:Symbol)
      WHERE s.type = 'interface'
      OPTIONAL MATCH (impl:Symbol)-[:IMPLEMENTS]->(s)
      RETURN s.name as name, s.file as file, collect(impl.name) as implementedBy
      LIMIT 15
    `);
    
    // Find base classes (classes that are extended)
    const baseClasses = await this.graph.query(`
      MATCH (child:Symbol)-[:EXTENDS]->(parent:Symbol)
      WHERE parent.type = 'class'
      RETURN DISTINCT parent.name as name, parent.file as file, 
             collect(child.name) as extendedBy
      LIMIT 10
    `);
    
    // Find utility functions (called by many)
    const utilities = await this.graph.query(`
      MATCH (caller:Symbol)-[:CALLS]->(util:Symbol)
      WHERE util.type IN ['function', 'method']
      WITH util, count(DISTINCT caller) as callerCount
      WHERE callerCount > 3
      RETURN util.name as name, util.file as file, callerCount
      ORDER BY callerCount DESC
      LIMIT 15
    `);
    
    return {
      interfaces: interfaces.map(i => ({
        name: i.name,
        file: i.file,
        methods: [], // Could be extracted with more detailed parsing
        implementedBy: i.implementedBy || []
      })),
      baseClasses: baseClasses.map(c => ({
        name: c.name,
        file: c.file,
        methods: [],
        implements: [],
        extends: undefined
      })),
      utilities: utilities.map(u => ({
        name: u.name,
        file: u.file,
        signature: '',
        calledBy: u.callerCount
      }))
    };
  }

  /**
   * Analyze dependencies
   */
  private async analyzeDependencies(): Promise<CodebaseSummary['dependencies']> {
    // External dependencies (from package.json, go.mod, etc.)
    // This is a simplified version - could be enhanced
    const externalImports = await this.graph.query(`
      MATCH (s:Symbol)-[:IMPORTS]->(ext:External)
      RETURN DISTINCT ext.name as name
      LIMIT 50
    `);
    
    // Internal module dependencies
    const internalDeps = await this.graph.query(`
      MATCH (f1:File)-[:IMPORTS]->(f2:File)
      WITH split(f1.path, '/') as fromParts, split(f2.path, '/') as toParts, count(*) as importCount
      WITH fromParts[size(fromParts)-2] as fromModule, 
           toParts[size(toParts)-2] as toModule, 
           importCount
      WHERE fromModule IS NOT NULL AND toModule IS NOT NULL AND fromModule <> toModule
      RETURN fromModule as fromMod, toModule as toMod, sum(importCount) as totalImports
      ORDER BY totalImports DESC
      LIMIT 20
    `);
    
    // Hotspots (most called/imported symbols)
    const hotspots = await this.graph.query(`
      MATCH (caller:Symbol)-[:CALLS]->(callee:Symbol)
      WITH callee, count(DISTINCT caller) as callerCount
      ORDER BY callerCount DESC
      LIMIT 10
      RETURN callee.name as name, callerCount
    `);
    
    // Detect circular dependencies
    const cycles = await this.graph.query(`
      MATCH path = (a:File)-[:IMPORTS*2..5]->(a)
      RETURN [node in nodes(path) | node.path] as cycle
      LIMIT 5
    `);
    
    // Detect orphaned code (no callers)
    const orphaned = await this.graph.query(`
      MATCH (s:Symbol)
      WHERE s.type IN ['function', 'method'] 
        AND NOT (s)<-[:CALLS]-()
        AND NOT s.name =~ '(?i)(main|test|spec|init|setup).*'
      RETURN s.name as name, s.file as file
      LIMIT 10
    `);
    
    const potentialIssues: string[] = [];
    if (cycles.length > 0) {
      potentialIssues.push(`${cycles.length} circular dependencies detected`);
    }
    if (orphaned.length > 5) {
      potentialIssues.push(`${orphaned.length}+ potentially orphaned functions`);
    }
    
    return {
      external: externalImports.map(e => e.name),
      internalGraph: internalDeps.map(d => ({
        from: d.fromMod,
        to: d.toMod,
        importCount: d.totalImports
      })),
      hotspots: hotspots.map(h => `${h.name} (called by ${h.callerCount})`),
      potentialIssues
    };
  }

  /**
   * Generate natural language summary using AI
   */
  private async generateNaturalLanguageSummary(data: Partial<CodebaseSummary>): Promise<string> {
    const prompt = `
Generate a concise natural language summary of this codebase:

Statistics:
- ${data.stats?.totalFiles} files, ${data.stats?.totalSymbols} symbols
- Languages: ${Object.entries(data.stats?.languages || {}).map(([l, c]) => `${l}: ${c}`).join(', ')}

Architecture:
- Patterns: ${data.architecture?.patterns.join(', ')}
- Entry points: ${data.architecture?.entryPoints.slice(0, 3).join(', ')}
- Core modules: ${data.architecture?.coreModules.slice(0, 5).map(m => m.name).join(', ')}

Conventions:
- Naming: ${data.conventions?.naming.join(', ')}
- Testing: ${data.conventions?.testing.join(', ')}

Key Abstractions:
- Interfaces: ${data.abstractions?.interfaces.slice(0, 5).map(i => i.name).join(', ')}
- Base classes: ${data.abstractions?.baseClasses.slice(0, 3).map(c => c.name).join(', ')}
- Utilities: ${data.abstractions?.utilities.slice(0, 5).map(u => u.name).join(', ')}

Dependencies:
- External: ${data.dependencies?.external.slice(0, 10).join(', ')}
- Hotspots: ${data.dependencies?.hotspots.slice(0, 5).join(', ')}
- Issues: ${data.dependencies?.potentialIssues.join(', ') || 'None detected'}

Write a 2-3 paragraph summary that a developer could read to quickly understand:
1. What this codebase does (infer from names and structure)
2. How it's organized
3. Key patterns and conventions used
`;

    return this.ai.complete(prompt);
  }

  /**
   * Generate compressed embedding for the entire codebase
   */
  private async generateCodebaseEmbedding(summary: Partial<CodebaseSummary>): Promise<number[]> {
    // Create structured text representation for embedding
    const text = `
# Codebase Summary

## Overview
${summary.naturalLanguageSummary}

## Architecture
Patterns: ${summary.architecture?.patterns.join(', ')}
Entry points: ${summary.architecture?.entryPoints.join(', ')}
Core modules: ${summary.architecture?.coreModules.map(m => m.name).join(', ')}
${summary.architecture?.layers ? `Layers: ${summary.architecture.layers.join(' -> ')}` : ''}

## Conventions
Naming: ${summary.conventions?.naming.join('; ')}
File structure: ${summary.conventions?.fileStructure.join('; ')}
Error handling: ${summary.conventions?.errorHandling.join('; ')}
Testing: ${summary.conventions?.testing.join('; ')}

## Key Abstractions
Interfaces: ${summary.abstractions?.interfaces.map(i => i.name).join(', ')}
Base classes: ${summary.abstractions?.baseClasses.map(c => c.name).join(', ')}
Utilities: ${summary.abstractions?.utilities.map(u => u.name).join(', ')}

## Dependencies
External: ${summary.dependencies?.external.join(', ')}
Hotspots: ${summary.dependencies?.hotspots.join(', ')}
`;

    return this.vector.embed(text);
  }
}

// Factory function
export function createCodebaseSummaryService(
  graph: GraphService,
  vector: VectorService,
  ai: AIService
): CodebaseSummaryService {
  return new CodebaseSummaryService(graph, vector, ai);
}
```

### Task 2: Integrate into Sync Command

**Modify**: `packages/cli/src/commands/sync.ts`

Add codebase summary generation after graph/vector sync:

```typescript
import { CodebaseSummaryService } from '@cv-git/core';
import * as fs from 'fs-extra';
import * as path from 'path';

// In the sync command action, after existing sync logic:

// Add option
.option('--no-summary', 'Skip codebase summary generation')
.option('--summary-only', 'Only regenerate the codebase summary')

// In action handler:
if (!options.noSummary) {
  console.log('\n📊 Generating codebase summary...');
  
  const summaryService = createCodebaseSummaryService(
    graphService,
    vectorService,
    aiService
  );
  
  try {
    const summary = await summaryService.generate(process.cwd());
    
    // Ensure .cv-git directory exists
    const cvGitDir = path.join(process.cwd(), '.cv-git');
    await fs.ensureDir(cvGitDir);
    
    // Write summary to file
    const summaryPath = path.join(cvGitDir, 'summary.json');
    await fs.writeJson(summaryPath, summary, { spaces: 2 });
    
    // Store embedding in Qdrant for similarity matching
    await vectorService.upsert({
      id: 'codebase-summary',
      vector: summary.embedding,
      payload: {
        type: 'codebase-summary',
        generatedAt: summary.generatedAt,
        stats: summary.stats,
        patterns: summary.architecture.patterns
      }
    });
    
    console.log('✅ Codebase summary generated');
    console.log(`   📁 ${summary.stats.totalFiles} files, ${summary.stats.totalSymbols} symbols`);
    console.log(`   🏗️  Patterns: ${summary.architecture.patterns.join(', ') || 'None detected'}`);
    console.log(`   🔥 Hotspots: ${summary.dependencies.hotspots.slice(0, 3).join(', ')}`);
    
    if (summary.dependencies.potentialIssues.length > 0) {
      console.log(`   ⚠️  Issues: ${summary.dependencies.potentialIssues.join(', ')}`);
    }
  } catch (error) {
    console.warn('⚠️  Could not generate codebase summary:', error.message);
  }
}
```

### Task 3: Connect Summary to RLM Router

**Modify**: `packages/core/src/services/rlm-router.ts`

Load and use the summary for context:

```typescript
import * as fs from 'fs-extra';
import * as path from 'path';
import { CodebaseSummary } from './codebase-summary';

export class RLMRouter {
  private summary: CodebaseSummary | null = null;

  /**
   * Load codebase summary if available
   */
  async loadSummary(repoPath: string = process.cwd()): Promise<void> {
    const summaryPath = path.join(repoPath, '.cv-git', 'summary.json');
    try {
      if (await fs.pathExists(summaryPath)) {
        this.summary = await fs.readJson(summaryPath);
      }
    } catch (error) {
      // Summary not available, continue without it
      this.summary = null;
    }
  }

  /**
   * Get codebase context for prompts
   */
  private getCodebaseContext(): string {
    if (!this.summary) {
      return '';
    }

    return `
CODEBASE CONTEXT (from analysis):
- Size: ${this.summary.stats.totalFiles} files, ${this.summary.stats.totalSymbols} symbols
- Languages: ${Object.keys(this.summary.stats.languages).join(', ')}
- Architecture patterns: ${this.summary.architecture.patterns.join(', ')}
- Entry points: ${this.summary.architecture.entryPoints.slice(0, 3).join(', ')}
- Core modules: ${this.summary.architecture.coreModules.slice(0, 5).map(m => m.name).join(', ')}
- Key interfaces: ${this.summary.abstractions.interfaces.slice(0, 5).map(i => i.name).join(', ')}
- Hotspots: ${this.summary.dependencies.hotspots.slice(0, 5).join(', ')}
- Conventions: ${this.summary.conventions.naming.join('; ')}

Summary: ${this.summary.naturalLanguageSummary.slice(0, 500)}...
`;
  }

  // Update buildDecompositionPrompt to include codebase context
  private buildDecompositionPrompt(query: string, ctx: RLMContext): string {
    const codebaseContext = this.getCodebaseContext();

    return `
You are an AI reasoning about a codebase. You have access to tools and context.
${codebaseContext}

AVAILABLE TOOLS:
... (rest of existing prompt)
`;
  }
}
```

### Task 4: Add Summary CLI Command

**Create**: `packages/cli/src/commands/summary.ts`

```typescript
import { Command } from 'commander';
import * as fs from 'fs-extra';
import * as path from 'path';
import { CodebaseSummary } from '@cv-git/core';

export const summaryCommand = new Command('summary')
  .description('View or regenerate codebase summary')
  .option('--json', 'Output as JSON')
  .option('--regenerate', 'Force regenerate the summary')
  .action(async (options) => {
    const summaryPath = path.join(process.cwd(), '.cv-git', 'summary.json');
    
    if (options.regenerate) {
      // Trigger sync with summary-only
      console.log('Regenerating summary...');
      // Call sync logic or summary service directly
      return;
    }
    
    if (!await fs.pathExists(summaryPath)) {
      console.log('No codebase summary found. Run `cv sync` to generate one.');
      return;
    }
    
    const summary: CodebaseSummary = await fs.readJson(summaryPath);
    
    if (options.json) {
      console.log(JSON.stringify(summary, null, 2));
      return;
    }
    
    // Pretty print
    console.log('\n📊 Codebase Summary');
    console.log('═'.repeat(50));
    console.log(`Generated: ${new Date(summary.generatedAt).toLocaleString()}`);
    console.log();
    
    console.log('📈 Statistics');
    console.log(`   Files: ${summary.stats.totalFiles}`);
    console.log(`   Symbols: ${summary.stats.totalSymbols}`);
    console.log(`   Functions: ${summary.stats.totalFunctions}`);
    console.log(`   Classes: ${summary.stats.totalClasses}`);
    console.log(`   Languages: ${Object.entries(summary.stats.languages).map(([l, c]) => `${l}(${c})`).join(', ')}`);
    console.log();
    
    console.log('🏗️  Architecture');
    console.log(`   Patterns: ${summary.architecture.patterns.join(', ') || 'None detected'}`);
    console.log(`   Entry points: ${summary.architecture.entryPoints.slice(0, 3).join(', ')}`);
    console.log(`   Core modules: ${summary.architecture.coreModules.slice(0, 5).map(m => m.name).join(', ')}`);
    if (summary.architecture.layers) {
      console.log(`   Layers: ${summary.architecture.layers.join(' → ')}`);
    }
    console.log();
    
    console.log('📐 Conventions');
    console.log(`   Naming: ${summary.conventions.naming.join(', ')}`);
    console.log(`   Structure: ${summary.conventions.fileStructure.join(', ')}`);
    console.log(`   Testing: ${summary.conventions.testing.join(', ')}`);
    console.log();
    
    console.log('🔧 Key Abstractions');
    console.log(`   Interfaces: ${summary.abstractions.interfaces.map(i => i.name).join(', ')}`);
    console.log(`   Base classes: ${summary.abstractions.baseClasses.map(c => c.name).join(', ')}`);
    console.log(`   Utilities: ${summary.abstractions.utilities.slice(0, 5).map(u => u.name).join(', ')}`);
    console.log();
    
    console.log('🔥 Hotspots');
    summary.dependencies.hotspots.forEach(h => console.log(`   - ${h}`));
    console.log();
    
    if (summary.dependencies.potentialIssues.length > 0) {
      console.log('⚠️  Potential Issues');
      summary.dependencies.potentialIssues.forEach(i => console.log(`   - ${i}`));
      console.log();
    }
    
    console.log('📝 Summary');
    console.log(summary.naturalLanguageSummary);
  });
```

### Task 5: Add Tests

**Create**: `packages/core/src/services/codebase-summary.test.ts`

```typescript
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { CodebaseSummaryService } from './codebase-summary';

describe('CodebaseSummaryService', () => {
  let service: CodebaseSummaryService;
  let mockGraph: any;
  let mockVector: any;
  let mockAI: any;

  beforeAll(() => {
    mockGraph = {
      query: vi.fn()
    };
    mockVector = {
      embed: vi.fn().mockResolvedValue(new Array(1536).fill(0))
    };
    mockAI = {
      complete: vi.fn().mockResolvedValue('{"patterns": ["Layered"], "layers": null}')
    };
    
    service = new CodebaseSummaryService(mockGraph, mockVector, mockAI);
  });

  it('should gather statistics from graph', async () => {
    mockGraph.query
      .mockResolvedValueOnce([
        { type: 'function', count: 100 },
        { type: 'class', count: 20 }
      ])
      .mockResolvedValueOnce([
        { language: 'typescript', count: 50 },
        { language: 'javascript', count: 10 }
      ]);

    const stats = await service['gatherStats']();
    
    expect(stats.totalFiles).toBe(60);
    expect(stats.totalSymbols).toBe(120);
    expect(stats.languages.typescript).toBe(50);
  });

  it('should detect architecture patterns', async () => {
    mockGraph.query
      .mockResolvedValueOnce([{ path: 'src/index.ts' }])
      .mockResolvedValueOnce([{ module: 'services', symbolCount: 50 }])
      .mockResolvedValueOnce([{ name: 'UserService', type: 'class', file: 'services/user.ts' }]);
    
    mockAI.complete.mockResolvedValueOnce('{"patterns": ["Repository pattern", "Layered"], "layers": ["controllers", "services", "repositories"]}');

    const arch = await service['analyzeArchitecture']();
    
    expect(arch.patterns).toContain('Repository pattern');
    expect(arch.entryPoints).toContain('src/index.ts');
  });

  it('should generate embedding', async () => {
    const summary = {
      naturalLanguageSummary: 'Test summary',
      architecture: { patterns: ['MVC'], coreModules: [], entryPoints: [], layers: [] },
      conventions: { naming: [], fileStructure: [], errorHandling: [], testing: [] },
      abstractions: { interfaces: [], baseClasses: [], utilities: [] },
      dependencies: { external: [], hotspots: [] }
    };

    const embedding = await service['generateCodebaseEmbedding'](summary);
    
    expect(embedding).toHaveLength(1536);
    expect(mockVector.embed).toHaveBeenCalled();
  });

  it('should generate full summary', async () => {
    // Setup all mocks for full generate call
    mockGraph.query.mockResolvedValue([]);
    mockAI.complete.mockResolvedValue('{"patterns": [], "layers": null}');
    
    const summary = await service.generate('/test/repo');
    
    expect(summary.version).toBe('1.0');
    expect(summary.repoPath).toBe('/test/repo');
    expect(summary.embedding).toBeDefined();
  });
});
```

### Task 6: Export from Core Package

**Modify**: `packages/core/src/services/index.ts`

```typescript
export * from './codebase-summary';
```

**Modify**: `packages/core/src/index.ts`

Ensure services are exported.

---

## Verification Steps

After implementation:

```bash
# 1. Build
pnpm build

# 2. Run tests
pnpm test

# 3. Test sync with summary
cd /path/to/test/repo
cv sync

# 4. View generated summary
cv summary

# 5. Test RLM with summary context
cv explain "what is the overall architecture" --deep

# 6. Check summary file
cat .cv-git/summary.json | jq '.architecture.patterns'
```

## Success Criteria

1. `cv sync` generates `.cv-git/summary.json`
2. Summary includes stats, architecture, conventions, abstractions, dependencies
3. Natural language summary is coherent and accurate
4. Embedding is stored in Qdrant
5. RLM Router loads and uses summary for context
6. `cv summary` command displays formatted summary
7. All tests pass

## Notes

- Graph queries may need adjustment based on actual schema
- AI prompts may need tuning for accuracy
- Consider caching partial results for large repos
- Summary generation should complete in < 60s for medium repos
