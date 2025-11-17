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
  createGraphManager
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
    const graph = createGraphManager(config.graph.url, config.graph.database);

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
