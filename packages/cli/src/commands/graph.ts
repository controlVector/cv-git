/**
 * cv graph command
 * Query and visualize the knowledge graph
 */

import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import ora from 'ora';
import {
  configManager,
  createGraphManager,
  createVectorManager,
  createGraphService,
  createSemanticGraphService,
  generateRepoId,
  GraphService,
  SemanticGraphService
} from '@cv-git/core';
import { findRepoRoot } from '@cv-git/shared';

export function graphCommand(): Command {
  const cmd = new Command('graph');

  cmd.description('Query and visualize the knowledge graph');

  // Subcommand: cv graph stats
  cmd
    .command('stats')
    .description('Show graph statistics')
    .action(async () => {
      await withGraph(async (graph) => {
        const stats = await graph.getStats();

        console.log();
        console.log(chalk.bold.cyan('Knowledge Graph Statistics'));
        console.log(chalk.gray('─'.repeat(50)));
        console.log(chalk.white('  Files:        '), chalk.yellow(stats.fileCount));
        console.log(chalk.white('  Symbols:      '), chalk.yellow(stats.symbolCount));
        console.log(chalk.white('  Modules:      '), chalk.yellow(stats.moduleCount));
        console.log(chalk.white('  Commits:      '), chalk.yellow(stats.commitCount));
        console.log(chalk.white('  Relationships:'), chalk.yellow(stats.relationshipCount));
        console.log(chalk.gray('─'.repeat(50)));
        console.log();
      });
    });

  // Subcommand: cv graph files
  cmd
    .command('files')
    .description('List files in the graph')
    .option('-l, --language <lang>', 'Filter by language')
    .option('--limit <n>', 'Limit results', '20')
    .option('--sort <field>', 'Sort by field (complexity, size, symbols)', 'path')
    .action(async (options) => {
      await withGraph(async (graph) => {
        let cypher = 'MATCH (f:File) ';

        if (options.language) {
          cypher += `WHERE f.language = '${options.language}' `;
        }

        cypher += 'RETURN f.path as path, f.language as language, ' +
                  'f.linesOfCode as loc, f.complexity as complexity ' +
                  `ORDER BY f.${options.sort} ` +
                  `LIMIT ${options.limit}`;

        const results = await graph.query(cypher);

        if (results.length === 0) {
          console.log(chalk.yellow('No files found'));
          return;
        }

        const table = new Table({
          head: [
            chalk.cyan('Path'),
            chalk.cyan('Language'),
            chalk.cyan('LOC'),
            chalk.cyan('Complexity')
          ],
          colWidths: [50, 15, 10, 12]
        });

        for (const row of results) {
          table.push([
            row.path,
            row.language,
            row.loc || 0,
            row.complexity || 0
          ]);
        }

        console.log();
        console.log(table.toString());
        console.log();
        console.log(chalk.gray(`Showing ${results.length} files`));
        console.log();
      });
    });

  // Subcommand: cv graph symbols
  cmd
    .command('symbols')
    .description('List symbols in the graph')
    .option('-k, --kind <kind>', 'Filter by symbol kind (function, class, method, etc.)')
    .option('-f, --file <path>', 'Filter by file path')
    .option('--limit <n>', 'Limit results', '50')
    .option('--sort <field>', 'Sort by field (name, complexity, line)', 'name')
    .action(async (options) => {
      await withGraph(async (graph) => {
        let cypher = 'MATCH (s:Symbol) WHERE 1=1 ';

        if (options.kind) {
          cypher += `AND s.kind = '${options.kind}' `;
        }

        if (options.file) {
          cypher += `AND s.file CONTAINS '${options.file}' `;
        }

        cypher += 'RETURN s.name as name, s.kind as kind, s.file as file, ' +
                  's.startLine as line, s.complexity as complexity ' +
                  `ORDER BY s.${options.sort} ` +
                  `LIMIT ${options.limit}`;

        const results = await graph.query(cypher);

        if (results.length === 0) {
          console.log(chalk.yellow('No symbols found'));
          return;
        }

        const table = new Table({
          head: [
            chalk.cyan('Name'),
            chalk.cyan('Kind'),
            chalk.cyan('File'),
            chalk.cyan('Line'),
            chalk.cyan('Complexity')
          ],
          colWidths: [25, 12, 40, 8, 12]
        });

        for (const row of results) {
          const kindColor = getKindColor(row.kind);
          table.push([
            row.name,
            kindColor(row.kind),
            truncate(row.file, 37),
            row.line || '-',
            row.complexity || 1
          ]);
        }

        console.log();
        console.log(table.toString());
        console.log();
        console.log(chalk.gray(`Showing ${results.length} symbols`));
        console.log();
      });
    });

  // Subcommand: cv graph calls
  cmd
    .command('calls [symbol]')
    .description('Show function call graph')
    .option('--callers', 'Show what calls this symbol')
    .option('--callees', 'Show what this symbol calls')
    .option('--depth <n>', 'Traversal depth', '1')
    .action(async (symbol, options) => {
      await withGraph(async (graph) => {
        if (!symbol) {
          // Show symbols with most calls
          const cypher = `
            MATCH (s:Symbol)-[c:CALLS]->()
            WITH s, count(c) as callCount
            RETURN s.name as name, s.kind as kind, s.file as file, callCount
            ORDER BY callCount DESC
            LIMIT 20
          `;

          const results = await graph.query(cypher);

          if (results.length === 0) {
            console.log(chalk.yellow('No call relationships found'));
            console.log(chalk.gray('Make sure you have run `cv sync` to build the graph'));
            return;
          }

          const table = new Table({
            head: [
              chalk.cyan('Symbol'),
              chalk.cyan('Kind'),
              chalk.cyan('File'),
              chalk.cyan('Calls')
            ]
          });

          for (const row of results) {
            table.push([
              row.name,
              row.kind,
              truncate(row.file, 40),
              row.callCount
            ]);
          }

          console.log();
          console.log(chalk.bold('Symbols with Most Calls'));
          console.log(table.toString());
          console.log();

          return;
        }

        // Show callers or callees for specific symbol
        if (options.callers) {
          const callers = await graph.getCallers(symbol);

          if (callers.length === 0) {
            console.log(chalk.yellow(`No callers found for: ${symbol}`));
            return;
          }

          console.log();
          console.log(chalk.bold(`Callers of ${chalk.cyan(symbol)}:`));
          console.log();

          for (const caller of callers) {
            console.log(chalk.white('  ▸'), chalk.yellow(caller.name));
            console.log(chalk.gray(`    ${caller.file}:${caller.startLine}`));
          }

          console.log();

        } else {
          const callees = await graph.getCallees(symbol);

          if (callees.length === 0) {
            console.log(chalk.yellow(`No callees found for: ${symbol}`));
            return;
          }

          console.log();
          console.log(chalk.bold(`${chalk.cyan(symbol)} calls:`));
          console.log();

          for (const callee of callees) {
            console.log(chalk.white('  ▸'), chalk.yellow(callee.name));
            console.log(chalk.gray(`    ${callee.file}:${callee.startLine}`));
          }

          console.log();
        }
      });
    });

  // Subcommand: cv graph imports
  cmd
    .command('imports [file]')
    .description('Show file import relationships')
    .option('--dependents', 'Show files that import this file')
    .option('--dependencies', 'Show files this file imports')
    .action(async (file, options) => {
      await withGraph(async (graph) => {
        if (!file) {
          // Show files with most imports
          const cypher = `
            MATCH (f:File)-[i:IMPORTS]->()
            WITH f, count(i) as importCount
            RETURN f.path as path, f.language as language, importCount
            ORDER BY importCount DESC
            LIMIT 20
          `;

          const results = await graph.query(cypher);

          if (results.length === 0) {
            console.log(chalk.yellow('No import relationships found'));
            return;
          }

          const table = new Table({
            head: [
              chalk.cyan('File'),
              chalk.cyan('Language'),
              chalk.cyan('Imports')
            ],
            colWidths: [60, 15, 10]
          });

          for (const row of results) {
            table.push([
              row.path,
              row.language,
              row.importCount
            ]);
          }

          console.log();
          console.log(chalk.bold('Files with Most Imports'));
          console.log(table.toString());
          console.log();

          return;
        }

        // Show imports/dependents for specific file
        if (options.dependents) {
          const dependents = await graph.getFileDependents(file);

          if (dependents.length === 0) {
            console.log(chalk.yellow(`No dependents found for: ${file}`));
            return;
          }

          console.log();
          console.log(chalk.bold(`Files that import ${chalk.cyan(file)}:`));
          console.log();

          for (const dep of dependents) {
            console.log(chalk.white('  ▸'), chalk.yellow(dep));
          }

          console.log();
          console.log(chalk.gray(`${dependents.length} dependent(s)`));
          console.log();

        } else {
          const dependencies = await graph.getFileDependencies(file);

          if (dependencies.length === 0) {
            console.log(chalk.yellow(`No dependencies found for: ${file}`));
            return;
          }

          console.log();
          console.log(chalk.bold(`${chalk.cyan(file)} imports:`));
          console.log();

          for (const dep of dependencies) {
            console.log(chalk.white('  ▸'), chalk.yellow(dep));
          }

          console.log();
          console.log(chalk.gray(`${dependencies.length} import(s)`));
          console.log();
        }
      });
    });

  // Subcommand: cv graph inspect
  cmd
    .command('inspect <symbol>')
    .description('Inspect a symbol in detail')
    .action(async (symbolName) => {
      await withGraph(async (graph) => {
        // Find symbols matching the name
        const cypher = `
          MATCH (s:Symbol)
          WHERE s.name = '${symbolName}' OR s.qualifiedName CONTAINS '${symbolName}'
          RETURN s
          LIMIT 5
        `;

        const results = await graph.query(cypher);

        if (results.length === 0) {
          console.log(chalk.yellow(`Symbol not found: ${symbolName}`));
          return;
        }

        for (const row of results) {
          const symbol = row.s;

          console.log();
          console.log(chalk.bold.cyan('Symbol Details'));
          console.log(chalk.gray('─'.repeat(70)));
          console.log(chalk.white('  Name:         '), chalk.yellow(symbol.name));
          console.log(chalk.white('  Qualified:    '), chalk.gray(symbol.qualifiedName));
          console.log(chalk.white('  Kind:         '), getKindColor(symbol.kind)(symbol.kind));
          console.log(chalk.white('  File:         '), symbol.file);
          console.log(chalk.white('  Lines:        '), `${symbol.startLine}-${symbol.endLine}`);
          console.log(chalk.white('  Visibility:   '), symbol.visibility);
          console.log(chalk.white('  Async:        '), symbol.isAsync ? 'Yes' : 'No');
          console.log(chalk.white('  Static:       '), symbol.isStatic ? 'Yes' : 'No');
          console.log(chalk.white('  Complexity:   '), symbol.complexity || 1);

          if (symbol.signature) {
            console.log(chalk.white('  Signature:    '));
            console.log(chalk.gray(`    ${symbol.signature.split('\n')[0]}`));
          }

          if (symbol.returnType) {
            console.log(chalk.white('  Return Type:  '), chalk.gray(symbol.returnType));
          }

          if (symbol.docstring) {
            console.log(chalk.white('  Documentation:'));
            const docLines = symbol.docstring.split('\n').slice(0, 3);
            docLines.forEach((line: string) => {
              console.log(chalk.gray(`    ${line}`));
            });
          }

          console.log(chalk.gray('─'.repeat(70)));
          console.log();
        }
      });
    });

  // Subcommand: cv graph query
  cmd
    .command('query <cypher>')
    .description('Run a custom Cypher query')
    .option('--json', 'Output as JSON')
    .action(async (cypher, options) => {
      await withGraph(async (graph) => {
        try {
          const results = await graph.query(cypher);

          if (options.json) {
            console.log(JSON.stringify(results, null, 2));
            return;
          }

          if (results.length === 0) {
            console.log(chalk.yellow('Query returned no results'));
            return;
          }

          // Auto-format results as table
          const keys = Object.keys(results[0]);

          const table = new Table({
            head: keys.map(k => chalk.cyan(k))
          });

          for (const row of results) {
            table.push(keys.map(k => {
              const val = row[k];
              if (typeof val === 'object' && val !== null) {
                return JSON.stringify(val);
              }
              return String(val);
            }));
          }

          console.log();
          console.log(table.toString());
          console.log();
          console.log(chalk.gray(`${results.length} row(s)`));
          console.log();

        } catch (error: any) {
          console.error(chalk.red('Query failed:'), error.message);
          console.error(chalk.gray('Make sure your Cypher syntax is correct'));
        }
      });
    });

  // Subcommand: cv graph path
  cmd
    .command('path <source> <target>')
    .description('Find call path between two symbols')
    .option('--max-depth <n>', 'Maximum path depth to search', '10')
    .option('--all', 'Find all paths (not just shortest)')
    .option('--json', 'Output as JSON')
    .action(async (source, target, options) => {
      await withGraphService(async (graphService) => {
        const maxDepth = parseInt(options.maxDepth) || 10;

        if (options.all) {
          const results = await graphService.findAllPaths(source, target, { maxDepth, maxPaths: 5 });

          if (results.length === 0) {
            console.log(chalk.yellow(`No paths found from ${source} to ${target}`));
            return;
          }

          if (options.json) {
            console.log(JSON.stringify(results, null, 2));
            return;
          }

          console.log();
          console.log(chalk.bold(`Found ${results.length} path(s) from ${chalk.cyan(source)} to ${chalk.cyan(target)}`));
          console.log();

          for (let i = 0; i < results.length; i++) {
            const path = results[i];
            console.log(chalk.yellow(`Path ${i + 1} (length: ${path.length}):`));
            console.log(chalk.white('  ' + path.path.join(' → ')));
            console.log();
          }

        } else {
          const result = await graphService.findPath(source, target, { maxDepth });

          if (options.json) {
            console.log(JSON.stringify(result, null, 2));
            return;
          }

          if (!result.found) {
            console.log(chalk.yellow(`No path found from ${source} to ${target}`));
            return;
          }

          console.log();
          console.log(chalk.bold(`Path from ${chalk.cyan(source)} to ${chalk.cyan(target)}:`));
          console.log(chalk.gray(`Length: ${result.length}`));
          console.log();

          // Display path with details
          for (let i = 0; i < result.pathDetails.length; i++) {
            const node = result.pathDetails[i];
            const edge = result.edges[i];
            const isLast = i === result.pathDetails.length - 1;

            console.log(chalk.white('  ▸'), chalk.yellow(node.name), chalk.gray(`(${node.kind})`));
            console.log(chalk.gray(`    ${node.file}${node.line ? ':' + node.line : ''}`));

            if (!isLast && edge) {
              console.log(chalk.gray(`    │ ${edge.type}`));
            }
          }

          console.log();
          console.log(chalk.gray(result.explanation));
          console.log();
        }
      });
    });

  // Subcommand: cv graph neighborhood
  cmd
    .command('neighborhood <symbol>')
    .description('Explore code neighborhood around a symbol')
    .option('-d, --depth <n>', 'Traversal depth', '2')
    .option('--max-nodes <n>', 'Maximum nodes to return', '30')
    .option('--json', 'Output as JSON')
    .action(async (symbol, options) => {
      await withGraphService(async (graphService) => {
        const depth = parseInt(options.depth) || 2;
        const maxNodes = parseInt(options.maxNodes) || 30;

        const result = await graphService.getNeighborhood(symbol, { depth, maxNodes });

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        console.log();
        console.log(chalk.bold(`Neighborhood of ${chalk.cyan(symbol)}`));
        console.log(chalk.gray('─'.repeat(70)));

        if (result.center) {
          console.log(chalk.white('  Center:'), chalk.yellow(result.center.name), chalk.gray(`(${result.center.type})`));
          console.log(chalk.gray(`    ${result.center.file}`));
          if (result.center.docstring) {
            console.log(chalk.gray(`    ${result.center.docstring.substring(0, 80)}...`));
          }
        }

        console.log();
        console.log(chalk.bold('  Connected Nodes:'));

        // Group by relationship type
        const byRelationship: Record<string, typeof result.nodes> = {};
        for (const node of result.nodes) {
          if (!byRelationship[node.relationship]) {
            byRelationship[node.relationship] = [];
          }
          byRelationship[node.relationship].push(node);
        }

        for (const [rel, nodes] of Object.entries(byRelationship)) {
          console.log();
          console.log(chalk.magenta(`    ${rel} (${nodes.length}):`));
          for (const node of nodes.slice(0, 10)) {
            const kindColor = getKindColor(node.type);
            console.log(`      ${node.direction === 'incoming' ? '←' : '→'} ${chalk.white(node.name)} ${kindColor(`(${node.type})`)} ${chalk.gray(`d:${node.distance}`)}`);
            console.log(chalk.gray(`         ${truncate(node.file, 50)}`));
          }
          if (nodes.length > 10) {
            console.log(chalk.gray(`      ... and ${nodes.length - 10} more`));
          }
        }

        console.log();
        console.log(chalk.gray('─'.repeat(70)));
        console.log(chalk.gray(`Summary: ${result.summary.totalNodes} nodes`));
        console.log(chalk.gray(`  By type: ${Object.entries(result.summary.byType).map(([k, v]) => `${k}(${v})`).join(', ')}`));
        console.log();
      });
    });

  // Subcommand: cv graph impact
  cmd
    .command('impact <symbol>')
    .description('Analyze change impact for a symbol')
    .option('--max-depth <n>', 'Maximum analysis depth', '3')
    .option('--json', 'Output as JSON')
    .action(async (symbol, options) => {
      await withGraphService(async (graphService) => {
        const maxDepth = parseInt(options.maxDepth) || 3;

        const result = await graphService.getImpactAnalysis(symbol, { maxDepth });

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        console.log();
        console.log(chalk.bold(`Impact Analysis for ${chalk.cyan(symbol)}`));
        console.log(chalk.gray('─'.repeat(70)));

        // Risk level with color
        const riskColors: Record<string, (s: string) => string> = {
          'low': chalk.green,
          'medium': chalk.yellow,
          'high': chalk.rgb(255, 165, 0), // orange
          'critical': chalk.red
        };
        const riskColor = riskColors[result.riskLevel] || chalk.white;

        console.log(chalk.white('  Target:'), chalk.yellow(result.target.name), chalk.gray(`(${result.target.type})`));
        console.log(chalk.gray(`    ${result.target.file}`));
        console.log();

        console.log(chalk.white('  Risk Level:'), riskColor(result.riskLevel.toUpperCase()));
        console.log(chalk.white('  Total Impact:'), chalk.yellow(result.totalImpact), 'symbols');
        console.log(chalk.gray(`    ${result.riskExplanation}`));
        console.log();

        if (result.directCallers.length > 0) {
          console.log(chalk.bold('  Direct Callers:'), chalk.gray(`(${result.directCallers.length})`));
          for (const caller of result.directCallers.slice(0, 10)) {
            console.log(`    ▸ ${chalk.yellow(caller.name)} ${chalk.gray(`(${caller.kind})`)}`);
            console.log(chalk.gray(`      ${caller.file}`));
          }
          if (result.directCallers.length > 10) {
            console.log(chalk.gray(`    ... and ${result.directCallers.length - 10} more`));
          }
          console.log();
        }

        if (result.indirectCallers.length > 0) {
          console.log(chalk.bold('  Indirect Callers:'), chalk.gray(`(${result.indirectCallers.length})`));
          for (const caller of result.indirectCallers.slice(0, 5)) {
            console.log(`    ▸ ${chalk.white(caller.name)} ${chalk.gray(`(depth: ${caller.depth})`)}`);
          }
          if (result.indirectCallers.length > 5) {
            console.log(chalk.gray(`    ... and ${result.indirectCallers.length - 5} more`));
          }
          console.log();
        }

        if (result.implementors.length > 0) {
          console.log(chalk.bold('  Implementors:'), result.implementors.slice(0, 5).join(', '));
        }

        if (result.extenders.length > 0) {
          console.log(chalk.bold('  Extenders:'), result.extenders.slice(0, 5).join(', '));
        }

        if (result.affectedFiles.length > 0) {
          console.log();
          console.log(chalk.bold('  Affected Files:'), chalk.gray(`(${result.affectedFiles.length})`));
          for (const file of result.affectedFiles.slice(0, 10)) {
            console.log(chalk.gray(`    ${file}`));
          }
          if (result.affectedFiles.length > 10) {
            console.log(chalk.gray(`    ... and ${result.affectedFiles.length - 10} more`));
          }
        }

        console.log();
      });
    });

  // Subcommand: cv graph bridge
  cmd
    .command('bridge <concept1> <concept2>')
    .description('Find code that bridges two concepts')
    .option('--limit <n>', 'Maximum results', '10')
    .option('--json', 'Output as JSON')
    .action(async (concept1, concept2, options) => {
      await withSemanticService(async (semanticService) => {
        const limit = parseInt(options.limit) || 10;

        const result = await semanticService.findSemanticBridge(concept1, concept2, { limit });

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        console.log();
        console.log(chalk.bold(`Bridge between "${chalk.cyan(concept1)}" and "${chalk.cyan(concept2)}"`));
        console.log(chalk.gray('─'.repeat(70)));

        if (result.bridgeSymbols.length > 0) {
          console.log();
          console.log(chalk.bold('  Bridge Symbols:'));
          for (const bridge of result.bridgeSymbols) {
            const avgRelevance = ((bridge.relevanceToFirst + bridge.relevanceToSecond) / 2).toFixed(2);
            console.log(`    ▸ ${chalk.yellow(bridge.name)} ${chalk.gray(`(${bridge.kind})`)}`);
            console.log(chalk.gray(`      ${bridge.file}`));
            console.log(chalk.gray(`      Relevance: ${concept1}=${bridge.relevanceToFirst.toFixed(2)}, ${concept2}=${bridge.relevanceToSecond.toFixed(2)}, avg=${avgRelevance}`));
          }
        } else {
          console.log(chalk.yellow('  No direct bridge symbols found'));
        }

        if (result.sharedCallers.length > 0) {
          console.log();
          console.log(chalk.bold('  Shared Callers:'));
          for (const caller of result.sharedCallers.slice(0, 5)) {
            console.log(chalk.gray(`    ▸ ${caller}`));
          }
        }

        if (result.sharedCallees.length > 0) {
          console.log();
          console.log(chalk.bold('  Shared Callees:'));
          for (const callee of result.sharedCallees.slice(0, 5)) {
            console.log(chalk.gray(`    ▸ ${callee}`));
          }
        }

        console.log();
      });
    });

  // Subcommand: cv graph info
  cmd
    .command('info')
    .description('Show graph database info and ownership metadata')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      await withGraph(async (graph) => {
        const ownership = await graph.getOwnership();
        const stats = await graph.getStats();
        const dbName = graph.getDatabaseName();
        const repoId = graph.getRepoId();

        if (options.json) {
          console.log(JSON.stringify({ dbName, repoId, ownership, stats }, null, 2));
          return;
        }

        console.log();
        console.log(chalk.bold.cyan('Graph Database Info'));
        console.log(chalk.gray('\u2500'.repeat(50)));
        console.log(chalk.white('  Database:   '), chalk.yellow(dbName));
        console.log(chalk.white('  Repo ID:    '), chalk.yellow(repoId || 'unknown'));

        if (ownership) {
          console.log(chalk.white('  Owner ID:   '), chalk.yellow(ownership.repoId));
          console.log(chalk.white('  Created:    '), chalk.gray(new Date(ownership.createdAt).toISOString()));
          if (repoId && ownership.repoId !== repoId) {
            console.log(chalk.red('  WARNING:    '), chalk.red('Ownership mismatch! Graph may be contaminated.'));
          }
        } else {
          console.log(chalk.white('  Owner:      '), chalk.gray('no ownership metadata'));
        }

        console.log();
        console.log(chalk.white('  Files:      '), chalk.yellow(stats.fileCount));
        console.log(chalk.white('  Symbols:    '), chalk.yellow(stats.symbolCount));
        console.log(chalk.white('  Modules:    '), chalk.yellow(stats.moduleCount));
        console.log(chalk.white('  Commits:    '), chalk.yellow(stats.commitCount));
        console.log(chalk.white('  Relations:  '), chalk.yellow(stats.relationshipCount));
        console.log(chalk.gray('\u2500'.repeat(50)));
        console.log();
      });
    });

  // Subcommand: cv graph reset
  cmd
    .command('reset')
    .description('Clear all data from this repository\'s graph')
    .option('--force', 'Skip confirmation prompt')
    .action(async (options) => {
      await withGraph(async (graph) => {
        const dbName = graph.getDatabaseName();
        const stats = await graph.getStats();

        if (!options.force) {
          console.log();
          console.log(chalk.yellow(`This will delete all data from graph '${dbName}':`));
          console.log(chalk.gray(`  ${stats.fileCount} files, ${stats.symbolCount} symbols, ${stats.commitCount} commits`));
          console.log();

          const inquirer = await import('inquirer');
          const { confirm } = await inquirer.default.prompt([{
            type: 'confirm',
            name: 'confirm',
            message: 'Are you sure you want to reset the graph?',
            default: false,
          }]);

          if (!confirm) {
            console.log(chalk.gray('Cancelled.'));
            return;
          }
        }

        const spinner = ora('Resetting graph...').start();
        await graph.clear();
        spinner.succeed(chalk.green(`Graph '${dbName}' has been reset.`));
        console.log(chalk.gray('Run `cv sync` to rebuild the graph.'));
        console.log();
      });
    });

  // Subcommand: cv graph hubs
  cmd
    .command('hubs')
    .description('Find hub functions (most connections)')
    .option('--limit <n>', 'Number of hubs to show', '20')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      await withGraphService(async (graphService) => {
        const limit = parseInt(options.limit) || 20;

        const hubs = await graphService.getHubs({ limit });

        if (options.json) {
          console.log(JSON.stringify(hubs, null, 2));
          return;
        }

        console.log();
        console.log(chalk.bold('Hub Functions (Most Connections)'));
        console.log(chalk.gray('─'.repeat(70)));

        const table = new Table({
          head: [
            chalk.cyan('Symbol'),
            chalk.cyan('Kind'),
            chalk.cyan('In'),
            chalk.cyan('Out'),
            chalk.cyan('Total'),
            chalk.cyan('File')
          ],
          colWidths: [25, 12, 10, 10, 8, 35]
        });

        for (const hub of hubs) {
          table.push([
            hub.name,
            hub.kind,
            hub.incomingCount,
            hub.outgoingCount,
            hub.totalConnections,
            truncate(hub.file, 32)
          ]);
        }

        console.log(table.toString());
        console.log();
      });
    });

  return cmd;
}

/**
 * Helper: Execute command with graph connection
 */
async function withGraph(fn: (graph: any) => Promise<void>): Promise<void> {
  const spinner = ora('Connecting to graph...').start();

  try {
    const repoRoot = await findRepoRoot();
    if (!repoRoot) {
      spinner.fail(chalk.red('Not in a CV-Git repository'));
      console.error(chalk.gray('Run `cv init` first'));
      process.exit(1);
    }

    const config = await configManager.load(repoRoot);
    const repoId = config.repository.repoId || generateRepoId(repoRoot);
    const graph = createGraphManager({ url: config.graph.url, repoId });

    await graph.connect();
    spinner.stop();

    await fn(graph);

    await graph.close();

  } catch (error: any) {
    spinner.fail(chalk.red('Failed to connect to graph'));
    console.error(chalk.red(error.message));

    if (error.message.includes('ECONNREFUSED')) {
      console.error();
      console.error(chalk.yellow('Make sure FalkorDB is running:'));
      console.error(chalk.gray('  docker run -d --name falkordb -p 6379:6379 falkordb/falkordb'));
    }

    process.exit(1);
  }
}

/**
 * Helper: Execute command with GraphService
 */
async function withGraphService(fn: (service: GraphService) => Promise<void>): Promise<void> {
  const spinner = ora('Connecting to graph...').start();

  try {
    const repoRoot = await findRepoRoot();
    if (!repoRoot) {
      spinner.fail(chalk.red('Not in a CV-Git repository'));
      console.error(chalk.gray('Run `cv init` first'));
      process.exit(1);
    }

    const config = await configManager.load(repoRoot);
    const repoId = config.repository.repoId || generateRepoId(repoRoot);
    const graph = createGraphManager({ url: config.graph.url, repoId });

    await graph.connect();
    spinner.stop();

    const graphService = createGraphService(graph);
    await fn(graphService);

    await graph.close();

  } catch (error: any) {
    spinner.fail(chalk.red('Failed to connect to graph'));
    console.error(chalk.red(error.message));

    if (error.message.includes('ECONNREFUSED')) {
      console.error();
      console.error(chalk.yellow('Make sure FalkorDB is running:'));
      console.error(chalk.gray('  docker run -d --name falkordb -p 6379:6379 falkordb/falkordb'));
    }

    process.exit(1);
  }
}

/**
 * Helper: Execute command with SemanticGraphService
 */
async function withSemanticService(fn: (service: SemanticGraphService) => Promise<void>): Promise<void> {
  const spinner = ora('Connecting to services...').start();

  try {
    const repoRoot = await findRepoRoot();
    if (!repoRoot) {
      spinner.fail(chalk.red('Not in a CV-Git repository'));
      console.error(chalk.gray('Run `cv init` first'));
      process.exit(1);
    }

    const config = await configManager.load(repoRoot);
    const repoId = config.repository.repoId || generateRepoId(repoRoot);
    const graph = createGraphManager({ url: config.graph.url, repoId });
    const vector = createVectorManager(config.vector.url);

    await graph.connect();
    await vector.connect();
    spinner.stop();

    const semanticService = createSemanticGraphService(graph, vector);
    await fn(semanticService);

    await graph.close();
    await vector.close();

  } catch (error: any) {
    spinner.fail(chalk.red('Failed to connect to services'));
    console.error(chalk.red(error.message));

    if (error.message.includes('ECONNREFUSED')) {
      console.error();
      console.error(chalk.yellow('Make sure FalkorDB and Qdrant are running'));
    }

    process.exit(1);
  }
}

/**
 * Helper: Get color for symbol kind
 */
function getKindColor(kind: string): (text: string) => string {
  const colors: Record<string, (text: string) => string> = {
    'function': chalk.blue,
    'method': chalk.blue,
    'class': chalk.magenta,
    'interface': chalk.cyan,
    'type': chalk.cyan,
    'variable': chalk.green,
    'constant': chalk.green
  };

  return colors[kind] || chalk.white;
}

/**
 * Helper: Truncate string
 */
function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + '...';
}
