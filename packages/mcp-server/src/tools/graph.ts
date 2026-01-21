/**
 * Graph Tool Handlers
 * Implements cv_graph_query, cv_graph_stats, cv_graph_inspect, and advanced graph analysis tools
 */

import { GraphQueryArgs, ToolResult, GraphResult } from '../types.js';
import { successResult, errorResult, formatGraphResults } from '../utils.js';
import { configManager, createGraphManager, createGraphService, loadCodebaseSummary } from '@cv-git/core';
import { findRepoRoot } from '@cv-git/shared';

/**
 * Handle cv_graph_query tool call
 */
export async function handleGraphQuery(args: GraphQueryArgs): Promise<ToolResult> {
  try {
    const { queryType, target, language, file } = args;

    // Find repository root
    const repoRoot = await findRepoRoot();
    if (!repoRoot) {
      return errorResult('Not in a CV-Git repository. Run `cv init` first.');
    }

    // Load configuration
    const config = await configManager.load(repoRoot);

    // Initialize graph manager
    const graph = createGraphManager(config.graph.url, config.graph.database);
    await graph.connect();

    let result: GraphResult;

    switch (queryType) {
      case 'calls':
        if (!target) {
          return errorResult('Target required for "calls" query');
        }
        const callees = await graph.getCallees(target);
        result = {
          nodes: callees.map((c: any, i: number) => ({
            id: `node-${i}`,
            type: c.kind || 'function',
            name: c.name,
            file: c.file,
            line: c.startLine,
          })),
          edges: callees.map((c: any, i: number) => ({
            from: target,
            to: c.name,
            type: 'calls',
          })),
        };
        break;

      case 'called-by':
        if (!target) {
          return errorResult('Target required for "called-by" query');
        }
        const callers = await graph.getCallers(target);
        result = {
          nodes: callers.map((c: any, i: number) => ({
            id: `node-${i}`,
            type: c.kind || 'function',
            name: c.name,
            file: c.file,
            line: c.startLine,
          })),
          edges: callers.map((c: any, i: number) => ({
            from: c.name,
            to: target,
            type: 'calls',
          })),
        };
        break;

      case 'imports':
        if (!target) {
          return errorResult('Target required for "imports" query');
        }
        const dependencies = await graph.getFileDependencies(target);
        result = {
          nodes: dependencies.map((dep: string, idx: number) => ({
            id: `node-${idx}`,
            type: 'file',
            name: dep,
            file: dep,
          })),
          edges: dependencies.map((dep: string, idx: number) => ({
            from: target,
            to: dep,
            type: 'imports',
          })),
        };
        break;

      case 'exports':
        if (!target) {
          return errorResult('Target required for "exports" query');
        }
        const exports = await graph.getFileSymbols(target);
        result = {
          nodes: exports.map((e: any, i: number) => ({
            id: `node-${i}`,
            type: e.kind || 'symbol',
            name: e.name,
            file: target,
            line: e.startLine,
          })),
          edges: [],
        };
        break;

      case 'functions':
        let functionQuery = 'MATCH (s:Symbol {kind: "function"})';
        if (language) functionQuery += ` MATCH (f:File {language: $language})-[:DEFINES]->(s)`;
        if (file) functionQuery += ` WHERE s.file = $file`;
        functionQuery += ' RETURN s';
        const functions = await graph.query(functionQuery, { language, file });
        result = {
          nodes: functions.map((row: any, i: number) => ({
            id: `node-${i}`,
            type: 'function',
            name: row.s.name,
            file: row.s.file,
            line: row.s.startLine,
          })),
          edges: [],
        };
        break;

      case 'classes':
        let classQuery = 'MATCH (s:Symbol {kind: "class"})';
        if (language) classQuery += ` MATCH (f:File {language: $language})-[:DEFINES]->(s)`;
        if (file) classQuery += ` WHERE s.file = $file`;
        classQuery += ' RETURN s';
        const classes = await graph.query(classQuery, { language, file });
        result = {
          nodes: classes.map((row: any, i: number) => ({
            id: `node-${i}`,
            type: 'class',
            name: row.s.name,
            file: row.s.file,
            line: row.s.startLine,
          })),
          edges: [],
        };
        break;

      case 'files':
        let fileQuery = 'MATCH (f:File)';
        if (language) fileQuery += ' WHERE f.language = $language';
        fileQuery += ' RETURN f';
        const files = await graph.query(fileQuery, { language });
        result = {
          nodes: files.map((row: any, i: number) => ({
            id: `node-${i}`,
            type: 'file',
            name: row.f.path,
            file: row.f.path,
          })),
          edges: [],
        };
        break;

      default:
        await graph.close();
        return errorResult(`Unknown query type: ${queryType}`);
    }

    await graph.close();

    const formattedResult = formatGraphResults(result);
    return successResult(formattedResult);
  } catch (error: any) {
    return errorResult('Graph query failed', error);
  }
}

/**
 * Handle cv_graph_stats tool call
 */
export async function handleGraphStats(): Promise<ToolResult> {
  try {
    // Find repository root
    const repoRoot = await findRepoRoot();
    if (!repoRoot) {
      return errorResult('Not in a CV-Git repository. Run `cv init` first.');
    }

    // Load configuration
    const config = await configManager.load(repoRoot);

    // Initialize graph manager
    const graph = createGraphManager(config.graph.url, config.graph.database);
    await graph.connect();

    // Get statistics
    const stats = await graph.getStats();

    await graph.close();

    const text = `Knowledge Graph Statistics:

Files: ${stats.fileCount || 0}
Symbols: ${stats.symbolCount || 0}
Commits: ${stats.commitCount || 0}
Modules: ${stats.moduleCount || 0}
Relationships: ${stats.relationshipCount || 0}`;

    return successResult(text);
  } catch (error: any) {
    return errorResult('Failed to get graph statistics', error);
  }
}

/**
 * Handle cv_graph_inspect tool call
 */
export async function handleGraphInspect(args: { target: string }): Promise<ToolResult> {
  try {
    const { target } = args;

    // Find repository root
    const repoRoot = await findRepoRoot();
    if (!repoRoot) {
      return errorResult('Not in a CV-Git repository. Run `cv init` first.');
    }

    // Load configuration
    const config = await configManager.load(repoRoot);

    // Initialize graph manager
    const graph = createGraphManager(config.graph.url, config.graph.database);
    await graph.connect();

    // Try to find as a symbol first
    let symbol = await graph.getSymbolNode(target);

    if (!symbol) {
      // Try as a file
      const fileNode = await graph.getFileNode(target);
      if (!fileNode) {
        await graph.close();
        return errorResult(`Symbol or file not found: ${target}`);
      }

      // For files, show file symbols
      const fileSymbols = await graph.getFileSymbols(target);
      const dependencies = await graph.getFileDependencies(target);
      const dependents = await graph.getFileDependents(target);

      await graph.close();

      const text = `File: ${fileNode.path}
Language: ${fileNode.language}
Lines of Code: ${fileNode.linesOfCode || 0}

Symbols: ${fileSymbols.length}
${fileSymbols.slice(0, 10).map((s: any) => `  - ${s.kind}: ${s.name}`).join('\n')}
${fileSymbols.length > 10 ? `  ... and ${fileSymbols.length - 10} more` : ''}

Dependencies: ${dependencies.length}
${dependencies.slice(0, 10).map((d: string) => `  - ${d}`).join('\n')}
${dependencies.length > 10 ? `  ... and ${dependencies.length - 10} more` : ''}

Dependents: ${dependents.length}
${dependents.slice(0, 10).map((d: string) => `  - ${d}`).join('\n')}
${dependents.length > 10 ? `  ... and ${dependents.length - 10} more` : ''}`;

      return successResult(text);
    }

    // Get detailed information for symbol
    const callees = await graph.getCallees(symbol.qualifiedName);
    const callers = await graph.getCallers(symbol.qualifiedName);

    await graph.close();

    const text = `Symbol: ${symbol.name}
Type: ${symbol.kind}
Location: ${symbol.file}:${symbol.startLine}

${symbol.docstring ? `Description:\n${symbol.docstring}\n` : ''}
Calls: ${callees.length} symbols
${callees.slice(0, 10).map((c: any) => `  - ${c.name}`).join('\n')}
${callees.length > 10 ? `  ... and ${callees.length - 10} more` : ''}

Called By: ${callers.length} symbols
${callers.slice(0, 10).map((c: any) => `  - ${c.name}`).join('\n')}
${callers.length > 10 ? `  ... and ${callers.length - 10} more` : ''}`;

    return successResult(text);
  } catch (error: any) {
    return errorResult('Symbol inspection failed', error);
  }
}

/**
 * Handle cv_graph_path tool call
 * Find execution paths between two functions
 */
export async function handleGraphPath(args: { from: string; to: string; maxDepth?: number }): Promise<ToolResult> {
  try {
    const { from, to, maxDepth = 10 } = args;

    // Find repository root
    const repoRoot = await findRepoRoot();
    if (!repoRoot) {
      return errorResult('Not in a CV-Git repository. Run `cv init` first.');
    }

    // Load configuration
    const config = await configManager.load(repoRoot);

    // Initialize graph manager
    const graph = createGraphManager(config.graph.url, config.graph.database);
    await graph.connect();

    // Find call paths
    const paths = await graph.findCallPaths(from, to, maxDepth);

    await graph.close();

    if (paths.length === 0) {
      return successResult(`No paths found from "${from}" to "${to}" (max depth: ${maxDepth})`);
    }

    const text = `Found ${paths.length} execution path${paths.length > 1 ? 's' : ''} from "${from}" to "${to}":

${paths.map((path, i) => `Path ${i + 1} (${path.length} steps):\n  ${path.join(' → ')}`).join('\n\n')}`;

    return successResult(text);
  } catch (error: any) {
    return errorResult('Path finding failed', error);
  }
}

/**
 * Handle cv_graph_dead_code tool call
 * Find unreachable or unused functions
 */
export async function handleGraphDeadCode(): Promise<ToolResult> {
  try {
    // Find repository root
    const repoRoot = await findRepoRoot();
    if (!repoRoot) {
      return errorResult('Not in a CV-Git repository. Run `cv init` first.');
    }

    // Load configuration
    const config = await configManager.load(repoRoot);

    // Initialize graph manager
    const graph = createGraphManager(config.graph.url, config.graph.database);
    await graph.connect();

    // Find dead code
    const deadCode = await graph.findDeadCode();

    await graph.close();

    if (deadCode.length === 0) {
      return successResult('No dead code detected! All functions appear to be reachable.');
    }

    const text = `Found ${deadCode.length} potentially unreachable function${deadCode.length > 1 ? 's' : ''}:

${deadCode.slice(0, 20).map((fn: any) =>
  `  - ${fn.name} (${fn.kind}) in ${fn.file}:${fn.startLine}`
).join('\n')}${deadCode.length > 20 ? `\n\n  ... and ${deadCode.length - 20} more` : ''}

Note: Functions may be called dynamically or from external code.`;

    return successResult(text);
  } catch (error: any) {
    return errorResult('Dead code detection failed', error);
  }
}

/**
 * Handle cv_graph_complexity tool call
 * Find high-complexity functions
 */
export async function handleGraphComplexity(args: { threshold?: number; limit?: number }): Promise<ToolResult> {
  try {
    const { threshold = 10, limit = 20 } = args;

    // Find repository root
    const repoRoot = await findRepoRoot();
    if (!repoRoot) {
      return errorResult('Not in a CV-Git repository. Run `cv init` first.');
    }

    // Load configuration
    const config = await configManager.load(repoRoot);

    // Initialize graph manager
    const graph = createGraphManager(config.graph.url, config.graph.database);
    await graph.connect();

    // Find complex functions
    const complexFunctions = await graph.findComplexFunctions(threshold);

    await graph.close();

    if (complexFunctions.length === 0) {
      return successResult(`No functions found with complexity >= ${threshold}`);
    }

    const displayCount = Math.min(complexFunctions.length, limit);
    const text = `Found ${complexFunctions.length} function${complexFunctions.length > 1 ? 's' : ''} with complexity >= ${threshold}:

${complexFunctions.slice(0, displayCount).map((fn: any) =>
  `  - ${fn.name} (complexity: ${fn.complexity}) in ${fn.file}:${fn.startLine}`
).join('\n')}${complexFunctions.length > displayCount ? `\n\n  ... and ${complexFunctions.length - displayCount} more` : ''}

Tip: Functions with high complexity may benefit from refactoring.`;

    return successResult(text);
  } catch (error: any) {
    return errorResult('Complexity analysis failed', error);
  }
}

/**
 * Handle cv_graph_cycles tool call
 * Find circular dependencies in the call graph
 */
export async function handleGraphCycles(args: { maxDepth?: number }): Promise<ToolResult> {
  try {
    const { maxDepth = 5 } = args;

    // Find repository root
    const repoRoot = await findRepoRoot();
    if (!repoRoot) {
      return errorResult('Not in a CV-Git repository. Run `cv init` first.');
    }

    // Load configuration
    const config = await configManager.load(repoRoot);

    // Initialize graph manager
    const graph = createGraphManager(config.graph.url, config.graph.database);
    await graph.connect();

    // Find circular dependencies
    const cycles = await graph.findCircularDependencies(maxDepth);

    await graph.close();

    if (cycles.length === 0) {
      return successResult(`No circular dependencies detected (max depth: ${maxDepth})`);
    }

    const text = `Found ${cycles.length} circular ${cycles.length > 1 ? 'dependencies' : 'dependency'}:

${cycles.slice(0, 10).map((cycle, i) =>
  `Cycle ${i + 1} (${cycle.length} functions):\n  ${cycle.join(' → ')}`
).join('\n\n')}${cycles.length > 10 ? `\n\n  ... and ${cycles.length - 10} more cycles` : ''}

Warning: Circular dependencies can make code harder to understand and maintain.`;

    return successResult(text);
  } catch (error: any) {
    return errorResult('Cycle detection failed', error);
  }
}

/**
 * Handle cv_graph_hotspots tool call
 * Find most-called functions (hot spots)
 */
export async function handleGraphHotspots(args: { limit?: number }): Promise<ToolResult> {
  try {
    const { limit = 20 } = args;

    // Find repository root
    const repoRoot = await findRepoRoot();
    if (!repoRoot) {
      return errorResult('Not in a CV-Git repository. Run `cv init` first.');
    }

    // Load configuration
    const config = await configManager.load(repoRoot);

    // Initialize graph manager
    const graph = createGraphManager(config.graph.url, config.graph.database);
    await graph.connect();

    // Find hot spots
    const hotspots = await graph.findHotSpots(limit);

    await graph.close();

    if (hotspots.length === 0) {
      return successResult('No hot spots found. Graph may be empty or lacks call relationships.');
    }

    const text = `Top ${hotspots.length} most-called functions:

${hotspots.map((hs: any, i: number) =>
  `${i + 1}. ${hs.function.name} (called ${hs.callerCount} times) in ${hs.function.file}:${hs.function.startLine}`
).join('\n')}

Hot spots are frequently called functions that may benefit from optimization.`;

    return successResult(text);
  } catch (error: any) {
    return errorResult('Hot spot analysis failed', error);
  }
}

/**
 * Handle cv_graph_neighborhood tool call
 * Explore the neighborhood of a symbol
 */
export async function handleGraphNeighborhood(args: { symbol: string; depth?: number; direction?: string }): Promise<ToolResult> {
  try {
    const { symbol, depth = 2, direction = 'both' } = args;

    // Find repository root
    const repoRoot = await findRepoRoot();
    if (!repoRoot) {
      return errorResult('Not in a CV-Git repository. Run `cv init` first.');
    }

    // Load configuration
    const config = await configManager.load(repoRoot);

    // Initialize graph manager and service
    const graph = createGraphManager(config.graph.url, config.graph.database);
    await graph.connect();

    const graphService = createGraphService(graph);
    const neighborhood = await graphService.getNeighborhood(symbol, {
      depth,
      direction: direction as 'incoming' | 'outgoing' | 'both'
    });

    await graph.close();

    if (neighborhood.nodes.length === 0) {
      return successResult(`Symbol "${symbol}" has no neighbors within depth ${depth}.`);
    }

    // Format the result
    const lines: string[] = [];
    lines.push(`Neighborhood of "${neighborhood.center.name}" (${neighborhood.center.type}):`);
    lines.push(`  Location: ${neighborhood.center.file}:${neighborhood.center.line || '?'}`);
    if (neighborhood.center.docstring) {
      lines.push(`  Description: ${neighborhood.center.docstring.split('\n')[0]}`);
    }
    lines.push('');

    // Group by distance
    const byDistance: Record<number, typeof neighborhood.nodes> = {};
    for (const node of neighborhood.nodes) {
      if (!byDistance[node.distance]) byDistance[node.distance] = [];
      byDistance[node.distance].push(node);
    }

    for (const dist of Object.keys(byDistance).sort((a, b) => Number(a) - Number(b))) {
      const nodes = byDistance[Number(dist)];
      lines.push(`Distance ${dist} (${nodes.length} symbols):`);
      for (const node of nodes.slice(0, 15)) {
        const arrow = node.direction === 'incoming' ? '←' : node.direction === 'outgoing' ? '→' : '↔';
        lines.push(`  ${arrow} ${node.name} (${node.type}) via ${node.relationship}`);
        lines.push(`    ${node.file}:${node.line || '?'}`);
      }
      if (nodes.length > 15) {
        lines.push(`  ... and ${nodes.length - 15} more`);
      }
      lines.push('');
    }

    // Summary
    lines.push(`Summary: ${neighborhood.summary.totalNodes} symbols in neighborhood`);
    lines.push(`  By type: ${Object.entries(neighborhood.summary.byType).map(([t, c]) => `${t}(${c})`).join(', ')}`);
    lines.push(`  By relationship: ${Object.entries(neighborhood.summary.byRelationship).map(([r, c]) => `${r}(${c})`).join(', ')}`);

    return successResult(lines.join('\n'));
  } catch (error: any) {
    return errorResult('Neighborhood exploration failed', error);
  }
}

/**
 * Handle cv_graph_impact tool call
 * Analyze the impact of changing a symbol
 */
export async function handleGraphImpact(args: { symbol: string; depth?: number }): Promise<ToolResult> {
  try {
    const { symbol, depth = 3 } = args;

    // Find repository root
    const repoRoot = await findRepoRoot();
    if (!repoRoot) {
      return errorResult('Not in a CV-Git repository. Run `cv init` first.');
    }

    // Load configuration
    const config = await configManager.load(repoRoot);

    // Initialize graph manager and service
    const graph = createGraphManager(config.graph.url, config.graph.database);
    await graph.connect();

    const graphService = createGraphService(graph);
    const impact = await graphService.getImpactAnalysis(symbol, { maxDepth: depth });

    await graph.close();

    // Format the result
    const lines: string[] = [];
    lines.push(`Impact Analysis for "${impact.target.name}" (${impact.target.type}):`);
    lines.push(`  Location: ${impact.target.file}`);
    lines.push('');

    // Risk assessment
    const riskColors: Record<string, string> = {
      low: '🟢',
      medium: '🟡',
      high: '🟠',
      critical: '🔴'
    };
    lines.push(`Risk Level: ${riskColors[impact.riskLevel] || ''} ${impact.riskLevel.toUpperCase()}`);
    lines.push(`  ${impact.riskExplanation}`);
    lines.push('');

    // Direct callers
    if (impact.directCallers.length > 0) {
      lines.push(`Direct Callers (${impact.directCallers.length}):`);
      for (const caller of impact.directCallers.slice(0, 10)) {
        lines.push(`  - ${caller.name} (${caller.kind}) in ${caller.file}`);
      }
      if (impact.directCallers.length > 10) {
        lines.push(`  ... and ${impact.directCallers.length - 10} more`);
      }
      lines.push('');
    }

    // Indirect callers
    if (impact.indirectCallers.length > 0) {
      lines.push(`Indirect Callers (${impact.indirectCallers.length}):`);
      for (const caller of impact.indirectCallers.slice(0, 10)) {
        lines.push(`  - ${caller.name} (depth ${caller.depth}) in ${caller.file}`);
      }
      if (impact.indirectCallers.length > 10) {
        lines.push(`  ... and ${impact.indirectCallers.length - 10} more`);
      }
      lines.push('');
    }

    // Implementors and extenders
    if (impact.implementors.length > 0) {
      lines.push(`Implementors: ${impact.implementors.join(', ')}`);
    }
    if (impact.extenders.length > 0) {
      lines.push(`Extenders: ${impact.extenders.join(', ')}`);
    }

    // Affected files
    if (impact.affectedFiles.length > 0) {
      lines.push('');
      lines.push(`Affected Files (${impact.affectedFiles.length}):`);
      for (const file of impact.affectedFiles.slice(0, 10)) {
        lines.push(`  - ${file}`);
      }
      if (impact.affectedFiles.length > 10) {
        lines.push(`  ... and ${impact.affectedFiles.length - 10} more`);
      }
    }

    lines.push('');
    lines.push(`Total Impact: ${impact.totalImpact} symbols may be affected`);

    return successResult(lines.join('\n'));
  } catch (error: any) {
    return errorResult('Impact analysis failed', error);
  }
}

/**
 * Handle cv_graph_bridge tool call
 * Find how two symbols are connected
 */
export async function handleGraphBridge(args: { source: string; target: string; maxDepth?: number }): Promise<ToolResult> {
  try {
    const { source, target, maxDepth = 5 } = args;

    // Find repository root
    const repoRoot = await findRepoRoot();
    if (!repoRoot) {
      return errorResult('Not in a CV-Git repository. Run `cv init` first.');
    }

    // Load configuration
    const config = await configManager.load(repoRoot);

    // Initialize graph manager and service
    const graph = createGraphManager(config.graph.url, config.graph.database);
    await graph.connect();

    const graphService = createGraphService(graph);
    const bridge = await graphService.findBridge(source, target, { maxDepth });

    await graph.close();

    // Format the result
    const lines: string[] = [];
    lines.push(`Bridge Analysis: "${bridge.source.name}" ↔ "${bridge.target.name}"`);
    lines.push('');
    lines.push(`Source: ${bridge.source.name} (${bridge.source.kind}) in ${bridge.source.file}`);
    lines.push(`Target: ${bridge.target.name} (${bridge.target.kind}) in ${bridge.target.file}`);
    lines.push('');

    if (bridge.directConnection) {
      lines.push('✓ Direct connection exists');
    } else {
      lines.push('✗ No direct connection');
    }

    if (bridge.connections.length === 0) {
      lines.push('');
      lines.push(`No paths found between "${source}" and "${target}" within depth ${maxDepth}.`);
    } else {
      lines.push('');
      lines.push(`Found ${bridge.connections.length} connection path(s):`);
      lines.push('');

      for (let i = 0; i < Math.min(bridge.connections.length, 5); i++) {
        const conn = bridge.connections[i];
        lines.push(`Path ${i + 1} (${conn.length} steps):`);
        lines.push(`  ${conn.path.join(' → ')}`);
        lines.push(`  Relationships: ${conn.relationshipTypes.join(' → ')}`);
        lines.push('');
      }

      if (bridge.connections.length > 5) {
        lines.push(`... and ${bridge.connections.length - 5} more paths`);
      }
    }

    lines.push('');
    lines.push(bridge.explanation);

    return successResult(lines.join('\n'));
  } catch (error: any) {
    return errorResult('Bridge detection failed', error);
  }
}

/**
 * Handle cv_summary_view tool call
 * Get a high-level summary of the codebase
 */
export async function handleSummaryView(args: { aspect?: string }): Promise<ToolResult> {
  try {
    const { aspect = 'overview' } = args;

    // Find repository root
    const repoRoot = await findRepoRoot();
    if (!repoRoot) {
      return errorResult('Not in a CV-Git repository. Run `cv init` first.');
    }

    // Try to load existing summary
    const summary = await loadCodebaseSummary(repoRoot);

    if (!summary) {
      return errorResult('No codebase summary found. Run `cv summary --regenerate` to generate one.');
    }

    // Format based on aspect
    const lines: string[] = [];

    switch (aspect) {
      case 'overview':
        lines.push('📊 Codebase Overview');
        lines.push('═'.repeat(50));
        lines.push('');
        lines.push(summary.naturalLanguageSummary);
        lines.push('');
        lines.push(`Files: ${summary.stats.totalFiles} | Symbols: ${summary.stats.totalSymbols} | Functions: ${summary.stats.totalFunctions} | Classes: ${summary.stats.totalClasses}`);
        if (summary.architecture.patterns.length > 0) {
          lines.push(`Patterns: ${summary.architecture.patterns.join(', ')}`);
        }
        break;

      case 'architecture':
        lines.push('🏗️ Architecture');
        lines.push('═'.repeat(50));
        lines.push('');
        if (summary.architecture.patterns.length > 0) {
          lines.push(`Patterns: ${summary.architecture.patterns.join(', ')}`);
        }
        if (summary.architecture.layers && summary.architecture.layers.length > 0) {
          lines.push(`Layers: ${summary.architecture.layers.join(' → ')}`);
        }
        lines.push('');
        lines.push('Entry Points:');
        for (const entry of summary.architecture.entryPoints.slice(0, 5)) {
          lines.push(`  - ${entry}`);
        }
        lines.push('');
        lines.push('Core Modules:');
        for (const mod of summary.architecture.coreModules.slice(0, 8)) {
          lines.push(`  - ${mod.name} (${mod.path})`);
          lines.push(`    ${mod.fileCount} files, ${mod.symbolCount} symbols`);
          if (mod.keyExports.length > 0) {
            lines.push(`    Exports: ${mod.keyExports.slice(0, 5).join(', ')}`);
          }
        }
        break;

      case 'patterns':
        lines.push('📝 Patterns & Conventions');
        lines.push('═'.repeat(50));
        lines.push('');
        lines.push('Architecture Patterns:');
        for (const pattern of summary.architecture.patterns) {
          lines.push(`  - ${pattern}`);
        }
        lines.push('');
        if (summary.conventions.naming.length > 0) {
          lines.push('Naming Conventions:');
          for (const conv of summary.conventions.naming) {
            lines.push(`  - ${conv}`);
          }
        }
        if (summary.conventions.fileStructure.length > 0) {
          lines.push('');
          lines.push('File Structure:');
          for (const conv of summary.conventions.fileStructure) {
            lines.push(`  - ${conv}`);
          }
        }
        if (summary.conventions.testing.length > 0) {
          lines.push('');
          lines.push('Testing Patterns:');
          for (const conv of summary.conventions.testing) {
            lines.push(`  - ${conv}`);
          }
        }
        lines.push('');
        lines.push('Key Abstractions:');
        if (summary.abstractions.interfaces.length > 0) {
          lines.push(`  Interfaces: ${summary.abstractions.interfaces.slice(0, 5).map(i => i.name).join(', ')}`);
        }
        if (summary.abstractions.baseClasses.length > 0) {
          lines.push(`  Base Classes: ${summary.abstractions.baseClasses.slice(0, 5).map(c => c.name).join(', ')}`);
        }
        break;

      case 'statistics':
        lines.push('📈 Statistics');
        lines.push('═'.repeat(50));
        lines.push('');
        lines.push(`Total Files: ${summary.stats.totalFiles}`);
        lines.push(`Total Symbols: ${summary.stats.totalSymbols}`);
        lines.push(`Total Functions: ${summary.stats.totalFunctions}`);
        lines.push(`Total Classes: ${summary.stats.totalClasses}`);
        if (summary.stats.linesOfCode) {
          lines.push(`Lines of Code: ${summary.stats.linesOfCode.toLocaleString()}`);
        }
        lines.push('');
        lines.push('Languages:');
        const sortedLangs = Object.entries(summary.stats.languages)
          .sort((a, b) => (b[1] as number) - (a[1] as number));
        for (const [lang, count] of sortedLangs) {
          lines.push(`  - ${lang}: ${count} files`);
        }
        lines.push('');
        lines.push('Hotspots (most called):');
        for (const hs of summary.dependencies.hotspots.slice(0, 10)) {
          lines.push(`  - ${hs}`);
        }
        if (summary.dependencies.potentialIssues.length > 0) {
          lines.push('');
          lines.push('Potential Issues:');
          for (const issue of summary.dependencies.potentialIssues) {
            lines.push(`  ⚠ ${issue}`);
          }
        }
        break;

      default:
        return errorResult(`Unknown aspect: ${aspect}. Valid options: overview, architecture, patterns, statistics`);
    }

    lines.push('');
    lines.push(`Generated: ${new Date(summary.generatedAt).toLocaleString()}`);

    return successResult(lines.join('\n'));
  } catch (error: any) {
    return errorResult('Summary view failed', error);
  }
}
