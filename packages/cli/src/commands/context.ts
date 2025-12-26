/**
 * cv context command
 * Generate context file for AI coding assistants
 *
 * Outputs markdown that can be piped to any AI tool:
 * - Claude Code (via stdin or file)
 * - Aider (via --read flag)
 * - Cursor, Continue, etc.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { promises as fs } from 'fs';
import * as path from 'path';
import {
  configManager,
  createVectorManager,
  createGraphManager,
} from '@cv-git/core';
import { findRepoRoot, VectorSearchResult, CodeChunkPayload, SymbolNode } from '@cv-git/shared';
import { PRDClient } from '@cv-git/prd-client';
import { addGlobalOptions, createOutput } from '../utils/output.js';
import { getEmbeddingCredentials } from '../utils/credentials.js';

interface ContextOptions {
  limit: string;
  depth: string;
  output?: string;
  format: 'markdown' | 'xml' | 'json';
  includeGraph: boolean;
  includeFiles: boolean;
  prd: boolean;
  includeTests: boolean;
  includeDocs: boolean;
  prdUrl: string;
  minScore: string;
}

export function contextCommand(): Command {
  const cmd = new Command('context');

  cmd
    .description('Generate context for AI coding assistants')
    .argument('<query>', 'What you want to work on (natural language)')
    .option('-l, --limit <number>', 'Maximum code chunks to include', '10')
    .option('-d, --depth <number>', 'Graph traversal depth for relationships', '2')
    .option('-o, --output <file>', 'Output file (default: stdout)')
    .option('-f, --format <format>', 'Output format: markdown, xml, json', 'markdown')
    .option('--no-graph', 'Skip graph relationships')
    .option('--no-files', 'Skip full file contents')
    .option('--prd', 'Include PRD requirements context')
    .option('--include-tests', 'Include test cases for PRD requirements (requires --prd)')
    .option('--include-docs', 'Include documentation for PRD requirements (requires --prd)')
    .option('--prd-url <url>', 'cv-prd API URL', 'http://localhost:8000')
    .option('--min-score <score>', 'Minimum similarity score (0-1)', '0.5');

  addGlobalOptions(cmd);

  cmd.action(async (query: string, options: ContextOptions) => {
    const output = createOutput(options as any);
    const isStdout = !options.output;

    // Only show spinner if outputting to file
    const spinner = isStdout ? null : output.spinner('Gathering context...').start();
    const log = (msg: string) => {
      if (spinner) spinner.text = msg;
    };

    try {
      const repoRoot = await findRepoRoot();
      if (!repoRoot) {
        if (spinner) spinner.fail(chalk.red('Not in a CV-Git repository'));
        else console.error('Error: Not in a CV-Git repository. Run `cv init` first.');
        process.exit(1);
      }

      const config = await configManager.load(repoRoot);

      // Get embedding credentials (OpenRouter preferred)
      const embeddingCreds = await getEmbeddingCredentials({
        openRouterKey: config.embedding?.apiKey,
        openaiKey: config.ai?.apiKey
      });

      if (!embeddingCreds.openrouterApiKey && !embeddingCreds.openaiApiKey) {
        if (spinner) spinner.fail(chalk.red('No embedding API key found'));
        else console.error('Error: Run `cv auth setup openrouter` or set OPENROUTER_API_KEY');
        process.exit(1);
      }

      // Initialize managers
      log('Connecting to vector database...');
      const vector = createVectorManager({
        url: config.vector.url,
        openrouterApiKey: embeddingCreds.openrouterApiKey,
        openaiApiKey: embeddingCreds.openaiApiKey,
        collections: config.vector.collections
      });
      await vector.connect();

      let graph = null;
      if (options.includeGraph !== false) {
        log('Connecting to graph database...');
        try {
          graph = createGraphManager(config.graph.url, config.graph.database);
          await graph.connect();
        } catch (e) {
          // Graph is optional
          graph = null;
        }
      }

      // Gather context
      log('Searching for relevant code...');
      const limit = parseInt(options.limit, 10);
      const minScore = parseFloat(options.minScore);
      const depth = parseInt(options.depth, 10);

      const chunks = await vector.searchCode(query, limit, { minScore });

      // Get related symbols from graph
      let symbols: SymbolNode[] = [];
      let relationships: Map<string, { callers: string[]; callees: string[] }> = new Map();

      if (graph && chunks.length > 0) {
        log('Analyzing code relationships...');

        const symbolNames = chunks
          .map(c => c.payload.symbolName)
          .filter((name): name is string => !!name);

        for (const symbolName of symbolNames.slice(0, 5)) {
          try {
            // Get symbol details
            const symbolQuery = `
              MATCH (s:Symbol)
              WHERE s.name = '${symbolName}'
              RETURN s
              LIMIT 1
            `;
            const results = await graph.query(symbolQuery);
            if (results.length > 0) {
              symbols.push(results[0].s as SymbolNode);
            }

            // Get relationships
            const callers = await graph.getCallers(symbolName);
            const callees = await graph.getCallees(symbolName);

            relationships.set(symbolName, {
              callers: callers.slice(0, depth).map(s => s.name),
              callees: callees.slice(0, depth).map(s => s.name)
            });
          } catch (e) {
            // Skip on error
          }
        }
      }

      // Read full file contents if requested
      let fileContents: Map<string, string> = new Map();
      if (options.includeFiles !== false && chunks.length > 0) {
        log('Reading file contents...');
        const uniqueFiles = [...new Set(chunks.map(c => c.payload.file))];

        for (const filePath of uniqueFiles.slice(0, 5)) {
          try {
            const fullPath = path.join(repoRoot, filePath);
            const content = await fs.readFile(fullPath, 'utf-8');
            fileContents.set(filePath, content);
          } catch (e) {
            // Skip files that can't be read
          }
        }
      }

      // Gather PRD requirements context if requested
      let prdRequirements: Array<{
        id: string;
        text: string;
        priority: string;
        prdId: string;
        score: number;
        tests?: Array<{ id: string; text: string; type: string }>;
        docs?: Array<{ id: string; text: string; type: string }>;
      }> = [];

      if (options.prd) {
        log('Searching for relevant requirements...');

        // Use PRDClient for unified context when tests/docs are requested
        if (options.includeTests || options.includeDocs) {
          try {
            const prdClient = new PRDClient({
              baseUrl: options.prdUrl || 'http://localhost:8000',
              timeout: 30000,
            });

            const available = await prdClient.isAvailable();
            if (available) {
              log('Getting unified PRD context with traceability...');
              const unifiedContext = await prdClient.getUnifiedContext(query, {
                depth: parseInt(options.depth, 10),
              });

              for (const result of unifiedContext.results) {
                const req: typeof prdRequirements[0] = {
                  id: result.chunk_id,
                  text: result.text,
                  priority: 'medium',
                  prdId: '',
                  score: result.score,
                };

                // Include tests if requested and available
                if (options.includeTests && result.traceability?.tests) {
                  req.tests = result.traceability.tests.map(t => ({
                    id: t.chunk_id,
                    text: t.text,
                    type: t.chunk_type,
                  }));
                }

                // Include docs if requested and available
                if (options.includeDocs && result.traceability?.documentation) {
                  req.docs = result.traceability.documentation.map(d => ({
                    id: d.chunk_id,
                    text: d.text,
                    type: d.chunk_type,
                  }));
                }

                prdRequirements.push(req);
              }
            } else {
              // Fall back to vector search
              log('cv-prd not available, falling back to vector search...');
              const prdResults = await vector.search('prd_chunks', query, 5);
              for (const result of prdResults) {
                const payload = result.payload as Record<string, unknown>;
                prdRequirements.push({
                  id: result.id as string || 'unknown',
                  text: payload.text as string || '',
                  priority: payload.priority as string || 'medium',
                  prdId: payload.prd_id as string || '',
                  score: result.score
                });
              }
            }
          } catch (e) {
            // Fall back to vector search on error
            log('PRD client error, falling back to vector search...');
            const prdResults = await vector.search('prd_chunks', query, 5);
            for (const result of prdResults) {
              const payload = result.payload as Record<string, unknown>;
              prdRequirements.push({
                id: result.id as string || 'unknown',
                text: payload.text as string || '',
                priority: payload.priority as string || 'medium',
                prdId: payload.prd_id as string || '',
                score: result.score
              });
            }
          }
        } else {
          // Simple vector search without traceability
          try {
            const prdResults = await vector.search('prd_chunks', query, 5);
            for (const result of prdResults) {
              const payload = result.payload as Record<string, unknown>;
              prdRequirements.push({
                id: result.id as string || 'unknown',
                text: payload.text as string || '',
                priority: payload.priority as string || 'medium',
                prdId: payload.prd_id as string || '',
                score: result.score
              });
            }
          } catch (e) {
            // PRD collection may not exist
          }
        }
      }

      // Generate output
      log('Generating context...');
      let contextOutput: string;

      switch (options.format) {
        case 'xml':
          contextOutput = generateXMLContext(query, chunks, symbols, relationships, fileContents, prdRequirements);
          break;
        case 'json':
          contextOutput = generateJSONContext(query, chunks, symbols, relationships, fileContents, prdRequirements);
          break;
        case 'markdown':
        default:
          contextOutput = generateMarkdownContext(query, chunks, symbols, relationships, fileContents, prdRequirements);
          break;
      }

      // Output
      if (options.output) {
        await fs.writeFile(options.output, contextOutput, 'utf-8');
        if (spinner) spinner.succeed(`Context written to ${options.output}`);
      } else {
        console.log(contextOutput);
      }

      // Cleanup
      await vector.close();
      if (graph) await graph.close();

    } catch (error: any) {
      if (spinner) spinner.fail(chalk.red('Failed to generate context'));
      console.error(chalk.red(`Error: ${error.message}`));
      process.exit(1);
    }
  });

  return cmd;
}

// Type for PRD requirements
interface PRDRequirement {
  id: string;
  text: string;
  priority: string;
  prdId: string;
  score: number;
  tests?: Array<{ id: string; text: string; type: string }>;
  docs?: Array<{ id: string; text: string; type: string }>;
}

/**
 * Generate markdown context output
 */
function generateMarkdownContext(
  query: string,
  chunks: VectorSearchResult<CodeChunkPayload>[],
  symbols: SymbolNode[],
  relationships: Map<string, { callers: string[]; callees: string[] }>,
  fileContents: Map<string, string>,
  prdRequirements: PRDRequirement[] = []
): string {
  const lines: string[] = [];

  lines.push(`# Code Context: ${query}`);
  lines.push('');
  lines.push(`> Generated by cv-git for AI assistant context`);
  lines.push('');

  // Summary
  lines.push('## Summary');
  lines.push('');
  lines.push(`- **Query**: ${query}`);
  lines.push(`- **Relevant chunks**: ${chunks.length}`);
  lines.push(`- **Related symbols**: ${symbols.length}`);
  lines.push(`- **Files**: ${fileContents.size}`);
  if (prdRequirements.length > 0) {
    lines.push(`- **Requirements**: ${prdRequirements.length}`);
  }
  lines.push('');

  // Relevant code chunks
  if (chunks.length > 0) {
    lines.push('## Relevant Code');
    lines.push('');

    for (const chunk of chunks) {
      const { payload, score } = chunk;
      lines.push(`### ${payload.symbolName || 'Code'} (${(score * 100).toFixed(0)}% match)`);
      lines.push('');
      lines.push(`**File**: \`${payload.file}:${payload.startLine}-${payload.endLine}\``);

      if (payload.docstring) {
        lines.push('');
        lines.push(`**Description**: ${payload.docstring.split('\n')[0]}`);
      }

      lines.push('');
      lines.push('```' + (payload.language || ''));
      lines.push(payload.text);
      lines.push('```');
      lines.push('');
    }
  }

  // Relationships
  if (relationships.size > 0) {
    lines.push('## Code Relationships');
    lines.push('');

    for (const [symbol, rels] of relationships) {
      lines.push(`### ${symbol}`);
      lines.push('');

      if (rels.callers.length > 0) {
        lines.push(`**Called by**: ${rels.callers.join(', ')}`);
      }
      if (rels.callees.length > 0) {
        lines.push(`**Calls**: ${rels.callees.join(', ')}`);
      }
      lines.push('');
    }
  }

  // PRD Requirements
  if (prdRequirements.length > 0) {
    lines.push('## Related Requirements');
    lines.push('');
    lines.push('The following business requirements are relevant to this task:');
    lines.push('');

    for (const req of prdRequirements) {
      const priorityIcon = req.priority === 'critical' ? '🔴' :
        req.priority === 'high' ? '🟡' : '⚪';
      lines.push(`### ${priorityIcon} ${req.priority.toUpperCase()} (${(req.score * 100).toFixed(0)}% match)`);
      lines.push('');
      lines.push(`**ID**: ${req.id}`);
      lines.push('');
      lines.push(req.text);
      lines.push('');

      // Include test cases if available
      if (req.tests && req.tests.length > 0) {
        lines.push('#### Test Cases');
        lines.push('');
        for (const test of req.tests) {
          lines.push(`- **[${test.type}]** ${test.text.slice(0, 200)}${test.text.length > 200 ? '...' : ''}`);
        }
        lines.push('');
      }

      // Include documentation if available
      if (req.docs && req.docs.length > 0) {
        lines.push('#### Documentation');
        lines.push('');
        for (const doc of req.docs) {
          lines.push(`- **[${doc.type}]** ${doc.text.slice(0, 200)}${doc.text.length > 200 ? '...' : ''}`);
        }
        lines.push('');
      }
    }
  }

  // Full file contents
  if (fileContents.size > 0) {
    lines.push('## Full File Contents');
    lines.push('');

    for (const [filePath, content] of fileContents) {
      const ext = path.extname(filePath).slice(1) || '';
      lines.push(`### ${filePath}`);
      lines.push('');
      lines.push('```' + ext);
      lines.push(content);
      lines.push('```');
      lines.push('');
    }
  }

  return lines.join('\n');
}

/**
 * Generate XML context output (for Claude-style context)
 */
function generateXMLContext(
  query: string,
  chunks: VectorSearchResult<CodeChunkPayload>[],
  symbols: SymbolNode[],
  relationships: Map<string, { callers: string[]; callees: string[] }>,
  fileContents: Map<string, string>,
  prdRequirements: PRDRequirement[] = []
): string {
  const lines: string[] = [];

  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<context>');
  lines.push(`  <query>${escapeXML(query)}</query>`);
  lines.push('');

  // PRD Requirements (first, as they provide context for what to build)
  if (prdRequirements.length > 0) {
    lines.push('  <requirements>');
    for (const req of prdRequirements) {
      lines.push(`    <requirement priority="${req.priority}" match="${(req.score * 100).toFixed(0)}%">`);
      lines.push(`      <id>${escapeXML(req.id)}</id>`);
      lines.push(`      <text>${escapeXML(req.text)}</text>`);

      // Include tests if available
      if (req.tests && req.tests.length > 0) {
        lines.push('      <tests>');
        for (const test of req.tests) {
          lines.push(`        <test type="${escapeXML(test.type)}">`);
          lines.push(`          <id>${escapeXML(test.id)}</id>`);
          lines.push(`          <text>${escapeXML(test.text)}</text>`);
          lines.push('        </test>');
        }
        lines.push('      </tests>');
      }

      // Include docs if available
      if (req.docs && req.docs.length > 0) {
        lines.push('      <documentation>');
        for (const doc of req.docs) {
          lines.push(`        <doc type="${escapeXML(doc.type)}">`);
          lines.push(`          <id>${escapeXML(doc.id)}</id>`);
          lines.push(`          <text>${escapeXML(doc.text)}</text>`);
          lines.push('        </doc>');
        }
        lines.push('      </documentation>');
      }

      lines.push('    </requirement>');
    }
    lines.push('  </requirements>');
    lines.push('');
  }

  // Code chunks
  lines.push('  <relevant_code>');
  for (const chunk of chunks) {
    const { payload, score } = chunk;
    lines.push('    <chunk>');
    lines.push(`      <file>${escapeXML(payload.file)}</file>`);
    lines.push(`      <lines>${payload.startLine}-${payload.endLine}</lines>`);
    lines.push(`      <symbol>${escapeXML(payload.symbolName || '')}</symbol>`);
    lines.push(`      <match_score>${(score * 100).toFixed(0)}%</match_score>`);
    if (payload.docstring) {
      lines.push(`      <docstring>${escapeXML(payload.docstring)}</docstring>`);
    }
    lines.push(`      <code><![CDATA[${payload.text}]]></code>`);
    lines.push('    </chunk>');
  }
  lines.push('  </relevant_code>');
  lines.push('');

  // Relationships
  if (relationships.size > 0) {
    lines.push('  <relationships>');
    for (const [symbol, rels] of relationships) {
      lines.push(`    <symbol name="${escapeXML(symbol)}">`);
      if (rels.callers.length > 0) {
        lines.push(`      <callers>${rels.callers.map(escapeXML).join(', ')}</callers>`);
      }
      if (rels.callees.length > 0) {
        lines.push(`      <callees>${rels.callees.map(escapeXML).join(', ')}</callees>`);
      }
      lines.push('    </symbol>');
    }
    lines.push('  </relationships>');
    lines.push('');
  }

  // Full files
  if (fileContents.size > 0) {
    lines.push('  <files>');
    for (const [filePath, content] of fileContents) {
      lines.push(`    <file path="${escapeXML(filePath)}">`);
      lines.push(`      <![CDATA[${content}]]>`);
      lines.push('    </file>');
    }
    lines.push('  </files>');
  }

  lines.push('</context>');
  return lines.join('\n');
}

/**
 * Generate JSON context output
 */
function generateJSONContext(
  query: string,
  chunks: VectorSearchResult<CodeChunkPayload>[],
  symbols: SymbolNode[],
  relationships: Map<string, { callers: string[]; callees: string[] }>,
  fileContents: Map<string, string>,
  prdRequirements: PRDRequirement[] = []
): string {
  const context = {
    query,
    generated: new Date().toISOString(),
    generator: 'cv-git',
    requirements: prdRequirements.map(req => ({
      id: req.id,
      text: req.text,
      priority: req.priority,
      prdId: req.prdId,
      matchScore: req.score,
      tests: req.tests || [],
      documentation: req.docs || [],
    })),
    chunks: chunks.map(chunk => ({
      file: chunk.payload.file,
      lines: `${chunk.payload.startLine}-${chunk.payload.endLine}`,
      symbol: chunk.payload.symbolName,
      language: chunk.payload.language,
      matchScore: chunk.score,
      docstring: chunk.payload.docstring,
      code: chunk.payload.text
    })),
    relationships: Object.fromEntries(relationships),
    files: Object.fromEntries(fileContents)
  };

  return JSON.stringify(context, null, 2);
}

/**
 * Escape XML special characters
 */
function escapeXML(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
