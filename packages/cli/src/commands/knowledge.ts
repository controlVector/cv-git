/**
 * cv knowledge command
 * Query session knowledge from the graph
 */

import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import ora from 'ora';
import {
  configManager,
  createGraphManager,
  generateRepoId,
} from '@cv-git/core';
import { findRepoRoot } from '@cv-git/shared';

export function knowledgeCommand(): Command {
  const cmd = new Command('knowledge');

  cmd.description('Query session knowledge from the knowledge graph');

  // Subcommand: cv knowledge list
  cmd
    .command('list')
    .description('List recent session knowledge entries')
    .option('-l, --limit <n>', 'Limit results', '20')
    .option('-c, --concern <concern>', 'Filter by concern')
    .option('-f, --file <path>', 'Filter by file path')
    .action(async (options) => {
      await withGraph(async (graph) => {
        let cypher = 'MATCH (sk:SessionKnowledge) ';
        const conditions: string[] = [];

        if (options.concern) {
          conditions.push(`sk.concern = '${options.concern}'`);
        }

        if (options.file) {
          // Find SK nodes that have the file in their filesTouched list
          cypher = 'MATCH (sk:SessionKnowledge)-[:ABOUT]->(f:File) ';
          conditions.push(`f.path CONTAINS '${options.file}'`);
        }

        if (conditions.length > 0) {
          cypher += `WHERE ${conditions.join(' AND ')} `;
        }

        cypher += 'RETURN DISTINCT sk.sessionId as sessionId, sk.turnNumber as turnNumber, ' +
                  'sk.timestamp as timestamp, sk.summary as summary, sk.concern as concern ' +
                  'ORDER BY sk.timestamp DESC ' +
                  `LIMIT ${options.limit}`;

        const results = await graph.query(cypher);

        if (results.length === 0) {
          console.log(chalk.yellow('No session knowledge found'));
          return;
        }

        const table = new Table({
          head: [
            chalk.cyan('Session'),
            chalk.cyan('Turn'),
            chalk.cyan('Time'),
            chalk.cyan('Concern'),
            chalk.cyan('Summary'),
          ],
          colWidths: [14, 6, 22, 12, 50],
          wordWrap: true,
        });

        for (const row of results) {
          const ts = row.timestamp ? new Date(Number(row.timestamp)).toISOString().replace('T', ' ').slice(0, 19) : '?';
          const sessionShort = String(row.sessionId || '').slice(0, 12);
          const summary = String(row.summary || '').slice(0, 80);
          table.push([sessionShort, row.turnNumber || '?', ts, row.concern || '?', summary]);
        }

        console.log();
        console.log(chalk.bold.cyan('Session Knowledge'));
        console.log(table.toString());
        console.log(chalk.gray(`\n  ${results.length} entries shown`));
        console.log();
      });
    });

  // Subcommand: cv knowledge show <sessionId>
  cmd
    .command('show <sessionId>')
    .description('Show the turn-by-turn timeline for a session')
    .action(async (sessionId: string) => {
      await withGraph(async (graph) => {
        const cypher =
          `MATCH (sk:SessionKnowledge) WHERE sk.sessionId = '${sessionId}' ` +
          'RETURN sk.sessionId as sessionId, sk.turnNumber as turnNumber, ' +
          'sk.timestamp as timestamp, sk.summary as summary, sk.concern as concern, ' +
          'sk.filesTouched as filesTouched, sk.symbolsReferenced as symbolsReferenced ' +
          'ORDER BY sk.turnNumber ASC';

        const results = await graph.query(cypher);

        if (results.length === 0) {
          console.log(chalk.yellow(`No knowledge found for session: ${sessionId}`));
          return;
        }

        console.log();
        console.log(chalk.bold.cyan(`Session: ${sessionId}`));
        console.log(chalk.gray('─'.repeat(60)));

        for (const turn of results) {
          const ts = turn.timestamp ? new Date(Number(turn.timestamp)).toISOString().replace('T', ' ').slice(0, 19) : '?';
          console.log();
          console.log(chalk.white.bold(`  Turn ${turn.turnNumber}`) + chalk.gray(` — ${ts}`));
          console.log(chalk.gray(`  Concern: ${turn.concern || 'codebase'}`));
          console.log(chalk.white(`  ${turn.summary || '(no summary)'}`));

          const files = parseListField(turn.filesTouched);
          if (files.length > 0) {
            console.log(chalk.green(`  Files: ${files.join(', ')}`));
          }

          const symbols = parseListField(turn.symbolsReferenced);
          if (symbols.length > 0) {
            console.log(chalk.blue(`  Symbols: ${symbols.join(', ')}`));
          }
        }

        console.log();
        console.log(chalk.gray('─'.repeat(60)));
        console.log(chalk.gray(`  ${results.length} turns total`));
        console.log();
      });
    });

  // Subcommand: cv knowledge search <query>
  cmd
    .command('search <query>')
    .description('Search session knowledge by files or symbols')
    .option('-l, --limit <n>', 'Limit results', '10')
    .action(async (query: string, options) => {
      await withGraph(async (graph) => {
        // Search across summaries, and use ANY() for list fields
        const cypher =
          'MATCH (sk:SessionKnowledge) ' +
          `WHERE sk.summary CONTAINS '${query}' ` +
          `OR ANY(f IN sk.filesTouched WHERE f CONTAINS '${query}') ` +
          `OR ANY(s IN sk.symbolsReferenced WHERE s CONTAINS '${query}') ` +
          'RETURN sk.sessionId as sessionId, sk.turnNumber as turnNumber, ' +
          'sk.timestamp as timestamp, sk.summary as summary, sk.concern as concern, ' +
          'sk.filesTouched as filesTouched, sk.symbolsReferenced as symbolsReferenced ' +
          'ORDER BY sk.timestamp DESC ' +
          `LIMIT ${options.limit}`;

        const results = await graph.query(cypher);

        if (results.length === 0) {
          console.log(chalk.yellow(`No session knowledge matching: ${query}`));
          return;
        }

        console.log();
        console.log(chalk.bold.cyan(`Search: "${query}"`));
        console.log(chalk.gray('─'.repeat(60)));

        for (const sk of results) {
          const ts = sk.timestamp ? new Date(Number(sk.timestamp)).toISOString().replace('T', ' ').slice(0, 19) : '?';
          const sessionShort = String(sk.sessionId || '').slice(0, 12);
          console.log();
          console.log(
            chalk.white.bold(`  ${sessionShort}`) +
            chalk.gray(` turn ${sk.turnNumber} — ${ts}`)
          );
          console.log(chalk.white(`  ${String(sk.summary || '').slice(0, 120)}`));

          const files = parseListField(sk.filesTouched);
          if (files.length > 0) {
            console.log(chalk.green(`  Files: ${files.join(', ')}`));
          }
        }

        console.log();
        console.log(chalk.gray(`  ${results.length} results`));
        console.log();
      });
    });

  // Subcommand: cv knowledge egress (used by hooks to write session knowledge)
  cmd
    .command('egress')
    .description('Write session knowledge to the graph (used by hooks)')
    .requiredOption('--session-id <id>', 'Session ID')
    .requiredOption('--turn <n>', 'Turn number')
    .option('--transcript <text>', 'Transcript segment', '')
    .option('--files <paths>', 'Comma-separated file paths', '')
    .option('--symbols <names>', 'Comma-separated symbol names', '')
    .option('--concern <concern>', 'Session concern', 'codebase')
    .action(async (options) => {
      await withGraph(async (graph) => {
        const sessionId = options.sessionId;
        const turnNumber = parseInt(options.turn, 10);
        const transcript = options.transcript || '';
        const files = options.files ? options.files.split(',').filter(Boolean) : [];
        const symbols = options.symbols ? options.symbols.split(',').filter(Boolean) : [];
        const concern = options.concern;

        const summary = transcript.slice(0, 500).trim();

        // Create SessionKnowledge node
        await graph.upsertSessionKnowledgeNode({
          sessionId,
          turnNumber,
          timestamp: Date.now(),
          summary,
          concern,
          source: 'cv_git',
          filesTouched: files,
          symbolsReferenced: symbols,
        });

        let edgesCreated = 0;

        // ABOUT edges to files
        for (const filePath of files) {
          try {
            await graph.createAboutFileEdge(sessionId, turnNumber, filePath, { role: 'touched' });
            edgesCreated++;
          } catch { /* File not in graph */ }
        }

        // ABOUT edges to symbols
        for (const qn of symbols) {
          try {
            await graph.createAboutSymbolEdge(sessionId, turnNumber, qn, { role: 'referenced' });
            edgesCreated++;
          } catch { /* Symbol not in graph */ }
        }

        // FOLLOWS edge
        if (turnNumber > 1) {
          const prev = await graph.getSessionKnowledgeNode(sessionId, turnNumber - 1);
          if (prev) {
            try {
              await graph.createFollowsEdge(sessionId, turnNumber, turnNumber - 1);
              edgesCreated++;
            } catch { /* Non-fatal */ }
          }
        }

        // Output minimal JSON for hook consumption
        console.log(JSON.stringify({
          ok: true,
          sessionId,
          turnNumber,
          edgesCreated,
        }));
      });
    });

  // Subcommand: cv knowledge query (used by hooks to pull context)
  cmd
    .command('query')
    .description('Query session knowledge and output markdown (used by hooks)')
    .option('--files <paths>', 'Comma-separated file paths to query')
    .option('--symbols <names>', 'Comma-separated symbol names to query')
    .option('--exclude-session <id>', 'Exclude a specific session')
    .option('-l, --limit <n>', 'Limit results', '5')
    .action(async (options) => {
      await withGraph(async (graph) => {
        const files = options.files ? options.files.split(',').filter(Boolean) : [];
        const symbols = options.symbols ? options.symbols.split(',').filter(Boolean) : [];
        const excludeSessionId = options.excludeSession;
        const limit = parseInt(options.limit, 10);

        if (!files.length && !symbols.length) {
          // No filters — nothing to query
          return;
        }

        const results: any[] = [];

        if (files.length) {
          const byFiles = await graph.getSessionKnowledgeByFiles(files, excludeSessionId, limit);
          results.push(...byFiles);
        }

        if (symbols.length) {
          const bySymbols = await graph.getSessionKnowledgeBySymbols(symbols, excludeSessionId, limit);
          const seen = new Set(results.map((r: any) => `${r.sessionId}:${r.turnNumber}`));
          for (const sk of bySymbols) {
            const key = `${sk.sessionId}:${sk.turnNumber}`;
            if (!seen.has(key)) {
              seen.add(key);
              results.push(sk);
            }
          }
        }

        results.sort((a: any, b: any) => b.timestamp - a.timestamp);
        const capped = results.slice(0, limit);

        if (capped.length === 0) return;

        // Output as markdown for Claude Code to pick up
        const lines = [
          '## Prior Session Knowledge',
          '',
        ];

        for (const sk of capped) {
          const date = sk.timestamp ? new Date(sk.timestamp).toISOString().replace('T', ' ').slice(0, 19) : '?';
          lines.push(`### Session ${String(sk.sessionId).slice(0, 8)} / Turn ${sk.turnNumber}`);
          lines.push(`*${date}* — concern: ${sk.concern || 'codebase'}`);
          lines.push('');
          lines.push(sk.summary || '(no summary)');

          const skFiles = parseListField(sk.filesTouched);
          if (skFiles.length) {
            lines.push(`\nFiles: ${skFiles.join(', ')}`);
          }
          lines.push('');
        }

        console.log(lines.join('\n'));
      });
    });

  return cmd;
}

/**
 * Parse a FalkorDB list field.
 * FalkorDB compact format returns lists as arrays of [type, value] pairs,
 * e.g. [[2, "file1"], [2, "file2"]]. Also handles plain string arrays.
 */
function parseListField(value: unknown): string[] {
  if (!Array.isArray(value)) {
    if (typeof value === 'string' && value.length > 0) {
      return value.replace(/^\[|\]$/g, '').split(',').map(s => s.trim()).filter(Boolean);
    }
    return [];
  }

  // Check if it's [type, value] pairs (FalkorDB compact format)
  if (value.length > 0 && Array.isArray(value[0])) {
    return value.map((pair: any) => String(pair[1] || pair)).filter(Boolean);
  }

  // Plain string array
  return value.map(String).filter(Boolean);
}

/**
 * Helper: connect to graph and execute a function
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
    spinner.fail(chalk.red('Error'));
    console.error(chalk.red(error.message));
    process.exit(1);
  }
}
