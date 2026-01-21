/**
 * Codebase Summary Service
 *
 * Generates "intuition" about a codebase by:
 * - Gathering statistics from the knowledge graph
 * - Detecting architecture patterns via AI
 * - Identifying conventions, abstractions, and hotspots
 * - Creating a natural language summary
 * - Generating a compressed embedding for context
 */

import Anthropic from '@anthropic-ai/sdk';
import { GraphManager } from '../graph/index.js';
import { VectorManager } from '../vector/index.js';
import * as fs from 'fs/promises';
import * as path from 'path';

// ========== Type Definitions ==========

/**
 * Summary of a module in the codebase
 */
export interface ModuleSummary {
  name: string;
  path: string;
  description: string;
  fileCount: number;
  symbolCount: number;
  primaryLanguage: string;
  keyExports: string[];
}

/**
 * Summary of an interface or type definition
 */
export interface InterfaceSummary {
  name: string;
  file: string;
  description: string;
  implementors: string[];
}

/**
 * Summary of a base class
 */
export interface ClassSummary {
  name: string;
  file: string;
  description: string;
  subclasses: string[];
}

/**
 * Summary of a utility function
 */
export interface FunctionSummary {
  name: string;
  file: string;
  description: string;
  callerCount: number;
}

/**
 * Complete codebase summary
 */
export interface CodebaseSummary {
  /** Schema version for forward compatibility */
  version: string;
  /** When this summary was generated */
  generatedAt: string;
  /** Basic statistics */
  stats: {
    totalFiles: number;
    totalSymbols: number;
    totalFunctions: number;
    totalClasses: number;
    languages: Record<string, number>;
    linesOfCode?: number;
  };
  /** Architectural analysis */
  architecture: {
    entryPoints: string[];
    coreModules: ModuleSummary[];
    patterns: string[];  // "Layered", "Repository pattern", etc.
    layers?: string[];   // e.g., ["presentation", "business", "data"]
  };
  /** Detected conventions */
  conventions: {
    naming: string[];
    fileStructure: string[];
    testing: string[];
  };
  /** Key abstractions */
  abstractions: {
    interfaces: InterfaceSummary[];
    baseClasses: ClassSummary[];
    utilities: FunctionSummary[];
  };
  /** Dependency analysis */
  dependencies: {
    external: string[];
    hotspots: string[];
    potentialIssues: string[];
    circularDeps?: string[][];
  };
  /** Natural language description */
  naturalLanguageSummary: string;
  /** Compressed embedding for context loading */
  embedding?: number[];
}

/**
 * Options for creating a CodebaseSummaryService
 */
export interface CodebaseSummaryServiceOptions {
  /** Anthropic API key */
  apiKey: string;
  /** Model to use (default: claude-sonnet-4-5-20250514) */
  model?: string;
  /** Maximum tokens for LLM calls */
  maxTokens?: number;
  /** Repository root path */
  repoRoot: string;
}

// ========== Constants ==========

const SUMMARY_VERSION = '1.0.0';
const SUMMARY_FILENAME = 'codebase-summary.json';

// ========== CodebaseSummaryService Implementation ==========

export class CodebaseSummaryService {
  private client: Anthropic;
  private model: string;
  private maxTokens: number;
  private repoRoot: string;

  constructor(
    private options: CodebaseSummaryServiceOptions,
    private graph: GraphManager,
    private vector?: VectorManager
  ) {
    this.client = new Anthropic({ apiKey: options.apiKey });
    this.model = options.model || 'claude-sonnet-4-5-20250514';
    this.maxTokens = options.maxTokens || 4096;
    this.repoRoot = options.repoRoot;
  }

  /**
   * Generate a complete codebase summary
   */
  async generateSummary(): Promise<CodebaseSummary> {
    // 1. Gather statistics from the graph
    const stats = await this.gatherStats();

    // 2. Detect entry points
    const entryPoints = await this.findEntryPoints();

    // 3. Find hotspots (most-called functions)
    const hotspots = await this.findHotspots();

    // 4. Detect circular dependencies
    const circularDeps = await this.findCircularDependencies();

    // 5. Find core modules
    const coreModules = await this.identifyCoreModules();

    // 6. Find key abstractions
    const abstractions = await this.findAbstractions();

    // 7. Detect external dependencies
    const externalDeps = await this.findExternalDependencies();

    // 8. Use AI to analyze patterns and conventions
    const analysis = await this.analyzeWithAI({
      stats,
      entryPoints,
      hotspots,
      coreModules,
      abstractions,
      externalDeps,
      circularDeps
    });

    // 9. Generate embedding for the summary
    let embedding: number[] | undefined;
    if (this.vector) {
      try {
        embedding = await this.vector.embed(analysis.naturalLanguageSummary);
      } catch (error) {
        // Continue without embedding
      }
    }

    const summary: CodebaseSummary = {
      version: SUMMARY_VERSION,
      generatedAt: new Date().toISOString(),
      stats,
      architecture: {
        entryPoints,
        coreModules,
        patterns: analysis.patterns,
        layers: analysis.layers
      },
      conventions: analysis.conventions,
      abstractions,
      dependencies: {
        external: externalDeps,
        hotspots: hotspots.map(h => `${h.name} (${h.callerCount} callers)`),
        potentialIssues: analysis.potentialIssues,
        circularDeps: circularDeps.length > 0 ? circularDeps : undefined
      },
      naturalLanguageSummary: analysis.naturalLanguageSummary,
      embedding
    };

    return summary;
  }

  /**
   * Save summary to .cv directory
   */
  async saveSummary(summary: CodebaseSummary): Promise<string> {
    const cvDir = path.join(this.repoRoot, '.cv');
    await fs.mkdir(cvDir, { recursive: true });

    const summaryPath = path.join(cvDir, SUMMARY_FILENAME);
    await fs.writeFile(summaryPath, JSON.stringify(summary, null, 2));

    return summaryPath;
  }

  /**
   * Load summary from .cv directory
   */
  async loadSummary(): Promise<CodebaseSummary | null> {
    try {
      const summaryPath = path.join(this.repoRoot, '.cv', SUMMARY_FILENAME);
      const content = await fs.readFile(summaryPath, 'utf-8');
      return JSON.parse(content) as CodebaseSummary;
    } catch {
      return null;
    }
  }

  /**
   * Check if summary exists
   */
  async hasSummary(): Promise<boolean> {
    try {
      const summaryPath = path.join(this.repoRoot, '.cv', SUMMARY_FILENAME);
      await fs.access(summaryPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Gather basic statistics from the graph
   */
  private async gatherStats(): Promise<CodebaseSummary['stats']> {
    const graphStats = await this.graph.getStats();

    // Get language breakdown
    const languageResults = await this.graph.query(
      'MATCH (f:File) RETURN f.language as language, count(f) as count'
    );

    const languages: Record<string, number> = {};
    for (const row of languageResults) {
      if (row.language) {
        languages[row.language] = row.count || 0;
      }
    }

    // Try to get lines of code
    let linesOfCode: number | undefined;
    try {
      const locResult = await this.graph.query(
        'MATCH (f:File) RETURN sum(f.linesOfCode) as total'
      );
      linesOfCode = locResult[0]?.total || undefined;
    } catch {
      // linesOfCode not available
    }

    return {
      totalFiles: graphStats.fileCount,
      totalSymbols: graphStats.symbolCount,
      totalFunctions: graphStats.functionCount || 0,
      totalClasses: graphStats.classCount || 0,
      languages,
      linesOfCode
    };
  }

  /**
   * Find likely entry points
   */
  private async findEntryPoints(): Promise<string[]> {
    const entryPoints: string[] = [];

    // Look for common entry point patterns
    const patterns = [
      'main',
      'index',
      'app',
      'server',
      'cli',
      'bin'
    ];

    for (const pattern of patterns) {
      try {
        const results = await this.graph.query(`
          MATCH (f:File)
          WHERE f.path =~ '.*/${pattern}\\.(ts|js|py|go|rs|java)$'
             OR f.path =~ '.*${pattern}/index\\.(ts|js)$'
          RETURN f.path as path
          LIMIT 10
        `);

        for (const row of results) {
          if (row.path && !entryPoints.includes(row.path)) {
            entryPoints.push(row.path);
          }
        }
      } catch {
        // Pattern matching failed, skip
      }
    }

    // Also look for functions named main, init, etc.
    try {
      const mainFunctions = await this.graph.query(`
        MATCH (s:Symbol)
        WHERE s.name IN ['main', 'init', '__init__', 'run', 'start']
          AND s.kind IN ['function', 'method']
        RETURN s.file as file, s.name as name
        LIMIT 10
      `);

      for (const row of mainFunctions) {
        if (row.file && !entryPoints.includes(row.file)) {
          entryPoints.push(row.file);
        }
      }
    } catch {
      // Query failed, skip
    }

    return entryPoints.slice(0, 10);
  }

  /**
   * Find hotspots (most called functions)
   */
  private async findHotspots(): Promise<FunctionSummary[]> {
    try {
      const results = await this.graph.query(`
        MATCH (caller:Symbol)-[:CALLS]->(callee:Symbol)
        WITH callee, count(caller) as callerCount
        WHERE callerCount > 2
        RETURN callee.name as name, callee.file as file, callee.docstring as docstring, callerCount
        ORDER BY callerCount DESC
        LIMIT 15
      `);

      return results.map(row => ({
        name: row.name || 'unknown',
        file: row.file || '',
        description: row.docstring?.split('\n')[0] || '',
        callerCount: row.callerCount || 0
      }));
    } catch {
      return [];
    }
  }

  /**
   * Find circular dependencies
   */
  private async findCircularDependencies(): Promise<string[][]> {
    try {
      const results = await this.graph.query(`
        MATCH path = (f:File)-[:IMPORTS*2..4]->(f)
        RETURN [node in nodes(path) | node.path] as cycle
        LIMIT 10
      `);

      return results
        .map(row => row.cycle as string[])
        .filter(cycle => cycle && cycle.length > 0);
    } catch {
      return [];
    }
  }

  /**
   * Identify core modules
   */
  private async identifyCoreModules(): Promise<ModuleSummary[]> {
    const modules: ModuleSummary[] = [];

    try {
      // Group files by directory
      const dirResults = await this.graph.query(`
        MATCH (f:File)
        WITH split(f.path, '/') as parts, f
        WITH parts[0..size(parts)-1] as dirParts, f
        WITH reduce(s = '', part IN dirParts | s + '/' + part) as dir, f
        WITH dir, count(f) as fileCount, collect(f.language)[0] as primaryLang
        WHERE fileCount >= 3
        RETURN dir, fileCount, primaryLang
        ORDER BY fileCount DESC
        LIMIT 10
      `);

      for (const row of dirResults) {
        if (!row.dir || row.dir === '/' || row.dir === '') continue;

        // Get symbol count for this directory
        let symbolCount = 0;
        let keyExports: string[] = [];
        try {
          const symbolResults = await this.graph.query(`
            MATCH (f:File)-[:DEFINES]->(s:Symbol)
            WHERE f.path STARTS WITH $dir
            RETURN count(s) as count, collect(DISTINCT s.name)[0..5] as exports
          `, { dir: row.dir.substring(1) }); // Remove leading slash

          symbolCount = symbolResults[0]?.count || 0;
          keyExports = symbolResults[0]?.exports || [];
        } catch {
          // Query failed
        }

        modules.push({
          name: path.basename(row.dir),
          path: row.dir.substring(1), // Remove leading slash
          description: '', // Will be filled by AI
          fileCount: row.fileCount || 0,
          symbolCount,
          primaryLanguage: row.primaryLang || 'unknown',
          keyExports
        });
      }
    } catch {
      // Query failed
    }

    return modules.slice(0, 8);
  }

  /**
   * Find key abstractions (interfaces, base classes, utilities)
   */
  private async findAbstractions(): Promise<CodebaseSummary['abstractions']> {
    const abstractions: CodebaseSummary['abstractions'] = {
      interfaces: [],
      baseClasses: [],
      utilities: []
    };

    // Find interfaces
    try {
      const interfaceResults = await this.graph.query(`
        MATCH (s:Symbol)
        WHERE s.kind = 'interface' OR s.kind = 'type'
        OPTIONAL MATCH (impl:Symbol)-[:INHERITS]->(s)
        WITH s, collect(impl.name) as implementors
        RETURN s.name as name, s.file as file, s.docstring as docstring, implementors
        LIMIT 10
      `);

      abstractions.interfaces = interfaceResults.map(row => ({
        name: row.name || 'unknown',
        file: row.file || '',
        description: row.docstring?.split('\n')[0] || '',
        implementors: row.implementors?.filter((i: any) => i) || []
      }));
    } catch {
      // Query failed
    }

    // Find base classes
    try {
      const classResults = await this.graph.query(`
        MATCH (sub:Symbol)-[:INHERITS]->(base:Symbol)
        WHERE base.kind = 'class'
        WITH base, collect(sub.name) as subclasses
        WHERE size(subclasses) >= 1
        RETURN base.name as name, base.file as file, base.docstring as docstring, subclasses
        ORDER BY size(subclasses) DESC
        LIMIT 10
      `);

      abstractions.baseClasses = classResults.map(row => ({
        name: row.name || 'unknown',
        file: row.file || '',
        description: row.docstring?.split('\n')[0] || '',
        subclasses: row.subclasses?.filter((s: any) => s) || []
      }));
    } catch {
      // Query failed
    }

    // Find utility functions (widely called, simple names)
    try {
      const utilResults = await this.graph.query(`
        MATCH (caller:Symbol)-[:CALLS]->(util:Symbol)
        WHERE util.kind = 'function'
          AND util.name =~ '^(get|set|is|has|create|parse|format|validate|convert).*'
        WITH util, count(DISTINCT caller) as callerCount
        WHERE callerCount >= 3
        RETURN util.name as name, util.file as file, util.docstring as docstring, callerCount
        ORDER BY callerCount DESC
        LIMIT 10
      `);

      abstractions.utilities = utilResults.map(row => ({
        name: row.name || 'unknown',
        file: row.file || '',
        description: row.docstring?.split('\n')[0] || '',
        callerCount: row.callerCount || 0
      }));
    } catch {
      // Query failed
    }

    return abstractions;
  }

  /**
   * Find external dependencies
   */
  private async findExternalDependencies(): Promise<string[]> {
    // Try to read package.json or similar
    const deps: string[] = [];

    try {
      // Check package.json
      const packageJsonPath = path.join(this.repoRoot, 'package.json');
      const content = await fs.readFile(packageJsonPath, 'utf-8');
      const pkg = JSON.parse(content);

      if (pkg.dependencies) {
        deps.push(...Object.keys(pkg.dependencies));
      }
      if (pkg.devDependencies) {
        deps.push(...Object.keys(pkg.devDependencies));
      }
    } catch {
      // No package.json
    }

    try {
      // Check requirements.txt (Python)
      const reqPath = path.join(this.repoRoot, 'requirements.txt');
      const content = await fs.readFile(reqPath, 'utf-8');
      const lines = content.split('\n');
      for (const line of lines) {
        const match = line.match(/^([a-zA-Z0-9_-]+)/);
        if (match) {
          deps.push(match[1]);
        }
      }
    } catch {
      // No requirements.txt
    }

    try {
      // Check go.mod (Go)
      const goModPath = path.join(this.repoRoot, 'go.mod');
      const content = await fs.readFile(goModPath, 'utf-8');
      const matches = content.matchAll(/require\s+([^\s]+)/g);
      for (const match of matches) {
        deps.push(match[1]);
      }
    } catch {
      // No go.mod
    }

    return [...new Set(deps)].slice(0, 30);
  }

  /**
   * Use AI to analyze patterns and generate summary
   */
  private async analyzeWithAI(data: {
    stats: CodebaseSummary['stats'];
    entryPoints: string[];
    hotspots: FunctionSummary[];
    coreModules: ModuleSummary[];
    abstractions: CodebaseSummary['abstractions'];
    externalDeps: string[];
    circularDeps: string[][];
  }): Promise<{
    patterns: string[];
    layers?: string[];
    conventions: CodebaseSummary['conventions'];
    potentialIssues: string[];
    naturalLanguageSummary: string;
  }> {
    const prompt = `Analyze this codebase data and provide insights.

## Statistics
- Files: ${data.stats.totalFiles}
- Symbols: ${data.stats.totalSymbols}
- Functions: ${data.stats.totalFunctions}
- Classes: ${data.stats.totalClasses}
- Languages: ${JSON.stringify(data.stats.languages)}

## Entry Points
${data.entryPoints.map(e => `- ${e}`).join('\n') || 'None detected'}

## Core Modules
${data.coreModules.map(m => `- ${m.name} (${m.path}): ${m.fileCount} files, exports: ${m.keyExports.join(', ')}`).join('\n') || 'None detected'}

## Hotspots (Most Called)
${data.hotspots.slice(0, 10).map(h => `- ${h.name}: ${h.callerCount} callers`).join('\n') || 'None detected'}

## Key Interfaces
${data.abstractions.interfaces.slice(0, 5).map(i => `- ${i.name} (${i.implementors.length} implementors)`).join('\n') || 'None detected'}

## Base Classes
${data.abstractions.baseClasses.slice(0, 5).map(c => `- ${c.name} (${c.subclasses.length} subclasses)`).join('\n') || 'None detected'}

## External Dependencies
${data.externalDeps.slice(0, 20).join(', ') || 'None detected'}

## Circular Dependencies
${data.circularDeps.length > 0 ? data.circularDeps.map(c => c.join(' → ')).join('\n') : 'None detected'}

Return a JSON response with:
{
  "patterns": ["pattern1", "pattern2"],  // e.g., "Layered Architecture", "Repository Pattern", "MVC"
  "layers": ["layer1", "layer2"],  // if applicable, e.g., ["api", "services", "data"]
  "conventions": {
    "naming": ["convention1"],  // e.g., "camelCase for functions"
    "fileStructure": ["pattern1"],  // e.g., "feature-based folders"
    "testing": ["pattern1"]  // e.g., "colocated test files"
  },
  "potentialIssues": ["issue1"],  // e.g., "Circular dependency in auth module"
  "naturalLanguageSummary": "A 2-3 paragraph description of what this codebase does, its architecture, and key components."
}

Focus on actionable insights. Be specific about the patterns you detect.
Return ONLY valid JSON, no markdown formatting.`;

    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: this.maxTokens,
        temperature: 0.3,
        messages: [{ role: 'user', content: prompt }]
      });

      const text = response.content[0].type === 'text' ? response.content[0].text : '';

      // Parse JSON from response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          patterns: parsed.patterns || [],
          layers: parsed.layers,
          conventions: parsed.conventions || { naming: [], fileStructure: [], testing: [] },
          potentialIssues: parsed.potentialIssues || [],
          naturalLanguageSummary: parsed.naturalLanguageSummary || 'Unable to generate summary.'
        };
      }
    } catch (error: any) {
      console.error('AI analysis failed:', error.message);
    }

    // Fallback response
    return {
      patterns: this.detectBasicPatterns(data),
      conventions: { naming: [], fileStructure: [], testing: [] },
      potentialIssues: data.circularDeps.length > 0 ? ['Circular dependencies detected'] : [],
      naturalLanguageSummary: this.generateBasicSummary(data)
    };
  }

  /**
   * Basic pattern detection without AI
   */
  private detectBasicPatterns(data: {
    coreModules: ModuleSummary[];
    abstractions: CodebaseSummary['abstractions'];
  }): string[] {
    const patterns: string[] = [];

    const moduleNames = data.coreModules.map(m => m.name.toLowerCase());

    // Check for common patterns
    if (moduleNames.some(n => ['controllers', 'routes', 'api'].includes(n)) &&
        moduleNames.some(n => ['services', 'business'].includes(n)) &&
        moduleNames.some(n => ['models', 'data', 'db', 'repository'].includes(n))) {
      patterns.push('Layered Architecture');
    }

    if (moduleNames.some(n => n.includes('repository') || n.includes('repo'))) {
      patterns.push('Repository Pattern');
    }

    if (moduleNames.some(n => ['components', 'views'].includes(n))) {
      patterns.push('Component-Based UI');
    }

    if (data.abstractions.interfaces.length > 3) {
      patterns.push('Interface-Driven Design');
    }

    if (data.abstractions.baseClasses.length > 2) {
      patterns.push('Class Inheritance');
    }

    return patterns;
  }

  /**
   * Generate basic summary without AI
   */
  private generateBasicSummary(data: {
    stats: CodebaseSummary['stats'];
    entryPoints: string[];
    coreModules: ModuleSummary[];
  }): string {
    const primaryLang = Object.entries(data.stats.languages)
      .sort((a, b) => b[1] - a[1])[0]?.[0] || 'multiple languages';

    const moduleList = data.coreModules.slice(0, 5).map(m => m.name).join(', ');

    return `This is a ${primaryLang} codebase with ${data.stats.totalFiles} files and ${data.stats.totalSymbols} symbols. ` +
      `The main modules are: ${moduleList || 'various'}. ` +
      `Entry points include: ${data.entryPoints.slice(0, 3).join(', ') || 'standard entry points'}.`;
  }

  /**
   * Format summary for display
   */
  formatSummary(summary: CodebaseSummary): string {
    const lines: string[] = [];

    lines.push('📊 Codebase Summary');
    lines.push('═'.repeat(60));
    lines.push('');

    // Statistics
    lines.push('📈 Statistics');
    lines.push(`   Files: ${summary.stats.totalFiles}`);
    lines.push(`   Symbols: ${summary.stats.totalSymbols}`);
    lines.push(`   Functions: ${summary.stats.totalFunctions}`);
    lines.push(`   Classes: ${summary.stats.totalClasses}`);
    if (summary.stats.linesOfCode) {
      lines.push(`   Lines of Code: ${summary.stats.linesOfCode.toLocaleString()}`);
    }
    const langStr = Object.entries(summary.stats.languages)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([lang, count]) => `${lang}(${count})`)
      .join(', ');
    lines.push(`   Languages: ${langStr}`);
    lines.push('');

    // Architecture
    lines.push('🏗️  Architecture');
    if (summary.architecture.patterns.length > 0) {
      lines.push(`   Patterns: ${summary.architecture.patterns.join(', ')}`);
    }
    if (summary.architecture.entryPoints.length > 0) {
      lines.push(`   Entry points: ${summary.architecture.entryPoints.slice(0, 3).join(', ')}`);
    }
    if (summary.architecture.coreModules.length > 0) {
      lines.push(`   Core modules: ${summary.architecture.coreModules.map(m => m.name).join(', ')}`);
    }
    lines.push('');

    // Hotspots
    if (summary.dependencies.hotspots.length > 0) {
      lines.push('🔥 Hotspots');
      summary.dependencies.hotspots.slice(0, 5).forEach(h => {
        lines.push(`   ${h}`);
      });
      lines.push('');
    }

    // Conventions
    if (summary.conventions.naming.length > 0 ||
        summary.conventions.fileStructure.length > 0 ||
        summary.conventions.testing.length > 0) {
      lines.push('📝 Conventions');
      if (summary.conventions.naming.length > 0) {
        lines.push(`   Naming: ${summary.conventions.naming.join(', ')}`);
      }
      if (summary.conventions.fileStructure.length > 0) {
        lines.push(`   Structure: ${summary.conventions.fileStructure.join(', ')}`);
      }
      if (summary.conventions.testing.length > 0) {
        lines.push(`   Testing: ${summary.conventions.testing.join(', ')}`);
      }
      lines.push('');
    }

    // Issues
    if (summary.dependencies.potentialIssues.length > 0) {
      lines.push('⚠️  Potential Issues');
      summary.dependencies.potentialIssues.forEach(issue => {
        lines.push(`   • ${issue}`);
      });
      lines.push('');
    }

    // Summary
    lines.push('📖 Summary');
    lines.push('─'.repeat(60));
    lines.push(summary.naturalLanguageSummary);
    lines.push('');

    lines.push('═'.repeat(60));
    lines.push(`Generated: ${new Date(summary.generatedAt).toLocaleString()}`);

    return lines.join('\n');
  }
}

/**
 * Create a CodebaseSummaryService instance
 */
export function createCodebaseSummaryService(
  options: CodebaseSummaryServiceOptions,
  graph: GraphManager,
  vector?: VectorManager
): CodebaseSummaryService {
  return new CodebaseSummaryService(options, graph, vector);
}

/**
 * Load summary from .cv directory (standalone function)
 */
export async function loadCodebaseSummary(repoRoot: string): Promise<CodebaseSummary | null> {
  try {
    const summaryPath = path.join(repoRoot, '.cv', SUMMARY_FILENAME);
    const content = await fs.readFile(summaryPath, 'utf-8');
    return JSON.parse(content) as CodebaseSummary;
  } catch {
    return null;
  }
}
