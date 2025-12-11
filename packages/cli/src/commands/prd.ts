/**
 * cv prd - PRD (Product Requirements Document) management
 *
 * Supports two modes:
 * 1. File mode: .cv-prd/ directory in repo (local-first, portable)
 * 2. API mode: Connect to cv-prd backend server
 *
 * Usage:
 *   cv prd init                    Initialize .cv-prd/ in current repo
 *   cv prd add <file>              Add a PRD markdown file
 *   cv prd list                    List PRDs
 *   cv prd show <prd-id>           Show PRD details
 *   cv prd find <query>            Semantic search in requirements
 *   cv prd sync                    Sync PRDs to graph + vectors
 *   cv prd link <chunk-id> <file:line>  Link code to requirement
 *   cv prd coverage                Show requirement coverage
 */

import { Command } from 'commander';
import * as fs from 'fs/promises';
import * as path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import { PRDClient } from '@cv-git/prd-client';
import {
  configManager,
  createVectorManager,
  createGraphManager,
  VectorManager,
  GraphManager,
} from '@cv-git/core';

/**
 * Find git repository root by looking for .git directory
 */
async function findGitRoot(startDir: string = process.cwd()): Promise<string | null> {
  let currentDir = path.resolve(startDir);
  const root = path.parse(currentDir).root;

  while (currentDir !== root) {
    try {
      const gitDir = path.join(currentDir, '.git');
      const stat = await fs.stat(gitDir);
      if (stat.isDirectory()) {
        return currentDir;
      }
    } catch {
      // .git doesn't exist, continue
    }
    currentDir = path.dirname(currentDir);
  }

  return null;
}

// Types for PRD-as-files
interface PRDManifest {
  version: string;
  created: string;
  updated: string;
  repository: {
    name: string;
    remote?: string;
  };
  prds: PRDEntry[];
  stats: {
    total_chunks: number;
    total_embeddings: number;
    linked_symbols: number;
    coverage_percent: number;
  };
  embedding_model: {
    provider: string;
    model: string;
    dimensions: number;
  };
  graph_version: string;
}

interface PRDEntry {
  id: string;
  file: string;
  name: string;
  status: string;
  chunks: number;
  coverage: number;
}

interface PRDChunk {
  id: string;
  prd_id: string;
  text: string;
  type: string;
  priority?: string;
  depends?: string[];
  implements?: string;
  line_start: number;
  line_end: number;
}

interface ParsedPRD {
  id: string;
  name: string;
  version?: string;
  status: string;
  owner?: string;
  tags: string[];
  chunks: PRDChunk[];
  raw_content: string;
}

export function createPRDCommand(): Command {
  const prd = new Command('prd')
    .description('PRD (Product Requirements Document) management');

  // ═══════════════════════════════════════════════════════════════
  // cv prd init
  // ═══════════════════════════════════════════════════════════════
  prd
    .command('init')
    .description('Initialize .cv-prd/ directory in current repository')
    .option('--api <url>', 'Connect to cv-prd API instead of file mode')
    .action(async (options) => {
      const spinner = ora('Initializing PRD directory...').start();

      try {
        const repoRoot = await findGitRoot();
        if (!repoRoot) {
          spinner.fail('Not in a git repository');
          return;
        }

        const prdDir = path.join(repoRoot, '.cv-prd');

        // Check if already initialized
        if (await fileExists(path.join(prdDir, 'manifest.json'))) {
          spinner.info('PRD directory already initialized');
          return;
        }

        // Create directory structure
        await fs.mkdir(prdDir, { recursive: true });
        await fs.mkdir(path.join(prdDir, 'prds'), { recursive: true });
        await fs.mkdir(path.join(prdDir, 'graph'), { recursive: true });
        await fs.mkdir(path.join(prdDir, 'vectors'), { recursive: true });
        await fs.mkdir(path.join(prdDir, 'links'), { recursive: true });

        // Get repo name from git
        const repoName = path.basename(repoRoot);

        // Create manifest
        const manifest: PRDManifest = {
          version: '1.0.0',
          created: new Date().toISOString(),
          updated: new Date().toISOString(),
          repository: {
            name: repoName
          },
          prds: [],
          stats: {
            total_chunks: 0,
            total_embeddings: 0,
            linked_symbols: 0,
            coverage_percent: 0
          },
          embedding_model: {
            provider: 'openai',
            model: 'text-embedding-3-small',
            dimensions: 1536
          },
          graph_version: 'falkordb-v1'
        };

        await fs.writeFile(
          path.join(prdDir, 'manifest.json'),
          JSON.stringify(manifest, null, 2)
        );

        // Create .gitignore for large files
        await fs.writeFile(
          path.join(prdDir, '.gitignore'),
          '# Large binary files (regenerated on sync)\nvectors/embeddings.bin\n'
        );

        // Create graph schema
        const schema = {
          version: '1.0.0',
          node_types: {
            PRD: ['id', 'name', 'status', 'file', 'created', 'updated'],
            Chunk: ['id', 'prd_id', 'text', 'priority', 'chunk_type', 'vector_id'],
            Symbol: ['id', 'name', 'file', 'line', 'kind']
          },
          edge_types: {
            BELONGS_TO: { from: 'Chunk', to: 'PRD' },
            DEPENDS_ON: { from: 'Chunk', to: 'Chunk' },
            REFERENCES: { from: 'Chunk', to: 'Chunk' },
            IMPLEMENTS: { from: 'Symbol', to: 'Chunk' }
          }
        };

        await fs.writeFile(
          path.join(prdDir, 'graph', 'schema.json'),
          JSON.stringify(schema, null, 2)
        );

        // Create empty JSONL files
        await fs.writeFile(path.join(prdDir, 'graph', 'nodes.jsonl'), '');
        await fs.writeFile(path.join(prdDir, 'graph', 'edges.jsonl'), '');
        await fs.writeFile(path.join(prdDir, 'vectors', 'metadata.jsonl'), '');
        await fs.writeFile(path.join(prdDir, 'links', 'implementations.jsonl'), '');
        await fs.writeFile(
          path.join(prdDir, 'links', 'coverage.json'),
          JSON.stringify({ coverage: {}, updated: new Date().toISOString() }, null, 2)
        );

        spinner.succeed(`Initialized .cv-prd/ in ${repoRoot}`);

        console.log('\nNext steps:');
        console.log('  cv prd add <requirements.md>   Add a PRD document');
        console.log('  cv prd sync                    Sync to graph + vectors');
        console.log('  cv prd find "query"            Search requirements');
      } catch (error) {
        spinner.fail(`Failed to initialize: ${error}`);
      }
    });

  // ═══════════════════════════════════════════════════════════════
  // cv prd add
  // ═══════════════════════════════════════════════════════════════
  prd
    .command('add <file>')
    .description('Add a PRD markdown file')
    .option('--id <id>', 'Override PRD ID (default: derived from filename)')
    .action(async (file, options) => {
      const spinner = ora('Adding PRD...').start();

      try {
        const repoRoot = await findGitRoot();
        if (!repoRoot) {
          spinner.fail('Not in a git repository');
          return;
        }

        const prdDir = path.join(repoRoot, '.cv-prd');

        // Check if initialized
        if (!(await fileExists(path.join(prdDir, 'manifest.json')))) {
          spinner.fail('PRD not initialized. Run: cv prd init');
          return;
        }

        // Read source file
        const sourcePath = path.resolve(file);
        if (!(await fileExists(sourcePath))) {
          spinner.fail(`File not found: ${sourcePath}`);
          return;
        }

        const content = await fs.readFile(sourcePath, 'utf-8');
        const parsed = parsePRDMarkdown(content, options.id || path.basename(file, '.md'));

        // Copy to prds directory
        const destFile = `${parsed.id}.md`;
        const destPath = path.join(prdDir, 'prds', destFile);
        await fs.writeFile(destPath, content);

        // Update manifest
        const manifest = await loadManifest(prdDir);
        const existingIndex = manifest.prds.findIndex(p => p.id === parsed.id);

        const entry: PRDEntry = {
          id: parsed.id,
          file: `prds/${destFile}`,
          name: parsed.name,
          status: parsed.status,
          chunks: parsed.chunks.length,
          coverage: 0
        };

        if (existingIndex >= 0) {
          manifest.prds[existingIndex] = entry;
        } else {
          manifest.prds.push(entry);
        }

        manifest.updated = new Date().toISOString();
        manifest.stats.total_chunks = manifest.prds.reduce((sum, p) => sum + p.chunks, 0);

        await saveManifest(prdDir, manifest);

        // Append nodes to graph
        await appendGraphNodes(prdDir, parsed);

        spinner.succeed(`Added PRD: ${parsed.name} (${parsed.chunks.length} chunks)`);

        console.log('\nRun `cv prd sync` to generate embeddings and update the graph database.');
      } catch (error) {
        spinner.fail(`Failed to add PRD: ${error}`);
      }
    });

  // ═══════════════════════════════════════════════════════════════
  // cv prd list
  // ═══════════════════════════════════════════════════════════════
  prd
    .command('list')
    .description('List PRDs in current repository')
    .option('--api', 'List from cv-prd API instead of local files')
    .action(async (options) => {
      try {
        const repoRoot = await findGitRoot();
        if (!repoRoot) {
          console.log(chalk.red('Not in a git repository'));
          return;
        }

        const prdDir = path.join(repoRoot, '.cv-prd');

        if (options.api) {
          // API mode
          const config = await configManager.load(repoRoot);
          const apiUrl = (config as any).prd?.apiUrl || 'http://localhost:8000';
          const client = new PRDClient({
            baseUrl: apiUrl
          });

          if (!(await client.isAvailable())) {
            console.log(chalk.yellow('cv-prd API not available'));
            return;
          }

          const prds = await client.listPRDs();
          console.log(chalk.bold('\nPRDs from cv-prd API:\n'));
          for (const prd of prds) {
            console.log(`  ${chalk.cyan(prd.id)} - ${prd.name}`);
            console.log(`    Status: ${prd.status}`);
          }
        } else {
          // File mode
          if (!(await fileExists(path.join(prdDir, 'manifest.json')))) {
            console.log(chalk.yellow('No .cv-prd/ directory. Run: cv prd init'));
            return;
          }

          const manifest = await loadManifest(prdDir);

          if (manifest.prds.length === 0) {
            console.log(chalk.yellow('No PRDs found. Run: cv prd add <file.md>'));
            return;
          }

          console.log(chalk.bold('\nPRDs in repository:\n'));
          for (const prd of manifest.prds) {
            const coverageColor = prd.coverage >= 0.7 ? chalk.green :
              prd.coverage >= 0.4 ? chalk.yellow : chalk.red;

            console.log(`  ${chalk.cyan(prd.id)} - ${prd.name}`);
            console.log(`    Status: ${prd.status}, Chunks: ${prd.chunks}, Coverage: ${coverageColor(`${(prd.coverage * 100).toFixed(0)}%`)}`);
          }

          console.log(chalk.gray(`\n  Total: ${manifest.prds.length} PRDs, ${manifest.stats.total_chunks} chunks`));
        }
      } catch (error) {
        console.error(chalk.red(`Error: ${error}`));
      }
    });

  // ═══════════════════════════════════════════════════════════════
  // cv prd show
  // ═══════════════════════════════════════════════════════════════
  prd
    .command('show <prd-id>')
    .description('Show PRD details')
    .option('--chunks', 'Show all chunks')
    .action(async (prdId, options) => {
      try {
        const repoRoot = await findGitRoot();
        if (!repoRoot) {
          console.log(chalk.red('Not in a git repository'));
          return;
        }

        const prdDir = path.join(repoRoot, '.cv-prd');

        const manifest = await loadManifest(prdDir);
        const entry = manifest.prds.find(p => p.id === prdId);

        if (!entry) {
          console.log(chalk.red(`PRD not found: ${prdId}`));
          return;
        }

        // Read PRD content
        const content = await fs.readFile(path.join(repoRoot, '.cv-prd', entry.file), 'utf-8');
        const parsed = parsePRDMarkdown(content, prdId);

        console.log(chalk.bold(`\n${parsed.name}`));
        console.log(chalk.gray(`ID: ${parsed.id}`));
        console.log(`Status: ${parsed.status}`);
        if (parsed.tags.length > 0) {
          console.log(`Tags: ${parsed.tags.join(', ')}`);
        }
        console.log(`Chunks: ${parsed.chunks.length}`);
        console.log(`Coverage: ${(entry.coverage * 100).toFixed(0)}%`);

        if (options.chunks) {
          console.log(chalk.bold('\nChunks:\n'));
          for (const chunk of parsed.chunks) {
            const priorityColor = chunk.priority === 'high' ? chalk.red :
              chunk.priority === 'medium' ? chalk.yellow : chalk.gray;

            console.log(`  ${chalk.cyan(chunk.id)} [${chunk.type}] ${priorityColor(chunk.priority || 'normal')}`);
            console.log(`    ${chunk.text.substring(0, 100)}...`);
            if (chunk.depends && chunk.depends.length > 0) {
              console.log(chalk.gray(`    Depends on: ${chunk.depends.join(', ')}`));
            }
            console.log();
          }
        }
      } catch (error) {
        console.error(chalk.red(`Error: ${error}`));
      }
    });

  // ═══════════════════════════════════════════════════════════════
  // cv prd find
  // ═══════════════════════════════════════════════════════════════
  prd
    .command('find <query>')
    .description('Semantic search in requirements')
    .option('-n, --limit <n>', 'Number of results', '10')
    .option('--type <type>', 'Filter by chunk type (functional, security, etc)')
    .option('--priority <priority>', 'Filter by priority (high, medium, low)')
    .option('--api', 'Search via cv-prd API')
    .action(async (query, options) => {
      const spinner = ora('Searching requirements...').start();

      try {
        const repoRoot = await findGitRoot();
        if (!repoRoot) {
          spinner.fail('Not in a git repository');
          return;
        }

        const config = await configManager.load(repoRoot);

        if (options.api) {
          // API mode
          const apiUrl = (config as any).prd?.apiUrl || 'http://localhost:8000';
          const client = new PRDClient({
            baseUrl: apiUrl
          });

          if (!(await client.isAvailable())) {
            spinner.fail('cv-prd API not available');
            return;
          }

          const results = await client.search({
            query,
            limit: parseInt(options.limit),
            filters: {
              chunk_type: options.type ? [options.type] : undefined,
              priority: options.priority ? [options.priority] : undefined
            }
          });

          spinner.stop();

          if (results.length === 0) {
            console.log(chalk.yellow('No matching requirements found'));
            return;
          }

          console.log(chalk.bold(`\nFound ${results.length} requirements:\n`));
          for (const result of results) {
            console.log(`  ${chalk.cyan(result.chunk.id)} (${(result.score * 100).toFixed(0)}% match)`);
            console.log(`    ${result.chunk.text.substring(0, 150)}...`);
            console.log();
          }
        } else {
          // Local file mode - use vector search
          const prdDir = path.join(repoRoot, '.cv-prd');

          if (!(await fileExists(path.join(prdDir, 'manifest.json')))) {
            spinner.fail('PRD not initialized. Run: cv prd init');
            return;
          }

          // Initialize vector manager
          const vectorUrl = config.vector?.url || 'http://localhost:6333';
          const apiKey = config.embedding?.apiKey;
          const vector = createVectorManager(vectorUrl, apiKey);

          await vector.connect();

          // Search in PRD collection
          const results = await vector.search(
            'cv_prd_chunks',
            query,
            parseInt(options.limit)
          );

          spinner.stop();

          if (results.length === 0) {
            console.log(chalk.yellow('No matching requirements found'));
            console.log(chalk.gray('Tip: Run `cv prd sync` to index requirements'));
            return;
          }

          console.log(chalk.bold(`\nFound ${results.length} requirements:\n`));
          for (const result of results) {
            const payload = result.payload as Record<string, unknown>;
            console.log(`  ${chalk.cyan(payload.chunk_id as string || 'unknown')} (${(result.score * 100).toFixed(0)}% match)`);
            const text = payload.text as string || '';
            console.log(`    ${text.substring(0, 150)}...`);
            if (payload.prd_id) {
              console.log(chalk.gray(`    PRD: ${payload.prd_id}`));
            }
            console.log();
          }

          await vector.close();
        }
      } catch (error) {
        spinner.fail(`Search failed: ${error}`);
      }
    });

  // ═══════════════════════════════════════════════════════════════
  // cv prd sync
  // ═══════════════════════════════════════════════════════════════
  prd
    .command('sync')
    .description('Sync PRDs to graph database and vector store')
    .option('--prd <id>', 'Sync specific PRD only')
    .option('--graph-only', 'Only sync to graph, skip vectors')
    .option('--vectors-only', 'Only sync vectors, skip graph')
    .action(async (options) => {
      const spinner = ora('Syncing PRDs...').start();

      try {
        const repoRoot = await findGitRoot();
        if (!repoRoot) {
          spinner.fail('Not in a git repository');
          return;
        }

        const prdDir = path.join(repoRoot, '.cv-prd');
        const config = await configManager.load(repoRoot);

        if (!(await fileExists(path.join(prdDir, 'manifest.json')))) {
          spinner.fail('PRD not initialized. Run: cv prd init');
          return;
        }

        const manifest = await loadManifest(prdDir);

        if (manifest.prds.length === 0) {
          spinner.info('No PRDs to sync');
          return;
        }

        // Filter PRDs if specific one requested
        const prdsToSync = options.prd
          ? manifest.prds.filter(p => p.id === options.prd)
          : manifest.prds;

        if (prdsToSync.length === 0) {
          spinner.fail(`PRD not found: ${options.prd}`);
          return;
        }

        // Parse all PRDs
        const allChunks: PRDChunk[] = [];
        const allParsed: ParsedPRD[] = [];

        for (const entry of prdsToSync) {
          const content = await fs.readFile(
            path.join(repoRoot, '.cv-prd', entry.file),
            'utf-8'
          );
          const parsed = parsePRDMarkdown(content, entry.id);
          allParsed.push(parsed);
          allChunks.push(...parsed.chunks);
        }

        spinner.text = `Syncing ${allChunks.length} chunks from ${prdsToSync.length} PRDs...`;

        // Sync to graph
        if (!options.vectorsOnly) {
          spinner.text = 'Syncing to FalkorDB...';

          const graphUrl = config.graph?.url || 'redis://localhost:6379';
          const graph = createGraphManager(graphUrl, 'cv-shared');

          await graph.connect();

          // Create PRD nodes
          for (const parsed of allParsed) {
            await graph.query(`
              MERGE (p:PRD {id: $id})
              SET p.name = $name, p.status = $status, p.updated = $updated
            `, {
              id: parsed.id,
              name: parsed.name,
              status: parsed.status,
              updated: new Date().toISOString()
            });

            // Create chunk nodes
            for (const chunk of parsed.chunks) {
              await graph.query(`
                MERGE (c:Chunk {id: $id})
                SET c.prd_id = $prd_id, c.text = $text, c.type = $type, c.priority = $priority
              `, {
                id: chunk.id,
                prd_id: parsed.id,
                text: chunk.text.substring(0, 1000), // Truncate for graph
                type: chunk.type,
                priority: chunk.priority || 'normal'
              });

              // Create BELONGS_TO relationship
              await graph.query(`
                MATCH (c:Chunk {id: $chunk_id})
                MATCH (p:PRD {id: $prd_id})
                MERGE (c)-[:BELONGS_TO]->(p)
              `, { chunk_id: chunk.id, prd_id: parsed.id });

              // Create dependency edges
              if (chunk.depends) {
                for (const dep of chunk.depends) {
                  await graph.query(`
                    MATCH (c:Chunk {id: $id})
                    MATCH (d:Chunk {id: $dep_id})
                    MERGE (c)-[:DEPENDS_ON]->(d)
                  `, { id: chunk.id, dep_id: dep });
                }
              }
            }
          }

          await graph.close();
          spinner.text = 'Graph sync complete';
        }

        // Sync to vectors
        if (!options.graphOnly) {
          spinner.text = 'Generating embeddings...';

          const vectorUrl = config.vector?.url || 'http://localhost:6333';
          const apiKey = config.embedding?.apiKey;
          const vector = createVectorManager(vectorUrl, apiKey);

          await vector.connect();

          // Ensure collection exists
          await vector.ensureCollection('cv_prd_chunks', manifest.embedding_model.dimensions);

          // Embed and upsert chunks
          const texts = allChunks.map(c => c.text);
          const embeddings = await vector.embedBatch(texts);

          const points = allChunks.map((chunk, i) => ({
            id: chunk.id,
            vector: embeddings[i],
            payload: {
              chunk_id: chunk.id,
              prd_id: chunk.prd_id,
              text: chunk.text,
              type: chunk.type,
              priority: chunk.priority || 'normal'
            }
          }));

          await vector.upsertBatch('cv_prd_chunks', points);

          // Update metadata file
          const metadata = allChunks.map(chunk => ({
            id: `vec-${chunk.id}`,
            chunk_id: chunk.id,
            text_hash: hashString(chunk.text),
            created: new Date().toISOString()
          }));

          await fs.writeFile(
            path.join(prdDir, 'vectors', 'metadata.jsonl'),
            metadata.map(m => JSON.stringify(m)).join('\n')
          );

          await vector.close();
        }

        // Update manifest
        manifest.updated = new Date().toISOString();
        manifest.stats.total_embeddings = allChunks.length;
        await saveManifest(prdDir, manifest);

        spinner.succeed(`Synced ${allChunks.length} chunks from ${prdsToSync.length} PRDs`);
      } catch (error) {
        spinner.fail(`Sync failed: ${error}`);
      }
    });

  // ═══════════════════════════════════════════════════════════════
  // cv prd link
  // ═══════════════════════════════════════════════════════════════
  prd
    .command('link <chunk-id> <location>')
    .description('Link code location to a requirement chunk')
    .option('--symbol <name>', 'Link by symbol name instead of file:line')
    .action(async (chunkId, location, options) => {
      const spinner = ora('Creating link...').start();

      try {
        const repoRoot = await findGitRoot();
        if (!repoRoot) {
          spinner.fail('Not in a git repository');
          return;
        }

        const prdDir = path.join(repoRoot, '.cv-prd');

        // Parse location (file:line format)
        let file: string;
        let line: number | undefined;

        if (location.includes(':')) {
          const [f, l] = location.split(':');
          file = f;
          line = parseInt(l);
        } else {
          file = location;
        }

        // Verify file exists
        const fullPath = path.join(repoRoot, file);
        if (!(await fileExists(fullPath))) {
          spinner.fail(`File not found: ${file}`);
          return;
        }

        // Try to sync to graph if cv-git is initialized
        try {
          const config = await configManager.load(repoRoot);
          const graphUrl = config.graph?.url || 'redis://localhost:6379';
          const graph = createGraphManager(graphUrl, 'cv-shared');

          await graph.connect();

          // Find or create file/symbol node
          if (options.symbol) {
            await graph.query(`
              MATCH (c:Chunk {id: $chunk_id})
              MERGE (s:Symbol {name: $symbol, file: $file})
              MERGE (s)-[:IMPLEMENTS]->(c)
            `, {
              chunk_id: chunkId,
              symbol: options.symbol,
              file
            });
          } else {
            await graph.query(`
              MATCH (c:Chunk {id: $chunk_id})
              MERGE (f:File {path: $file})
              MERGE (f)-[:IMPLEMENTS {line: $line}]->(c)
            `, {
              chunk_id: chunkId,
              file,
              line: line || 0
            });
          }

          await graph.close();
        } catch {
          // cv-git not initialized or graph not available - that's fine, just store locally
        }

        // Append to implementations file
        const implPath = path.join(prdDir, 'links', 'implementations.jsonl');
        const impl = {
          chunk_id: chunkId,
          file,
          line,
          symbol: options.symbol,
          created: new Date().toISOString()
        };
        await fs.appendFile(implPath, JSON.stringify(impl) + '\n');

        // Update coverage
        await updateCoverage(prdDir);

        spinner.succeed(`Linked ${chunkId} → ${location}`);
      } catch (error) {
        spinner.fail(`Failed to create link: ${error}`);
      }
    });

  // ═══════════════════════════════════════════════════════════════
  // cv prd coverage
  // ═══════════════════════════════════════════════════════════════
  prd
    .command('coverage')
    .description('Show requirement coverage')
    .option('--missing', 'Show only unimplemented requirements')
    .action(async (options) => {
      try {
        const repoRoot = await findGitRoot();
        if (!repoRoot) {
          console.log(chalk.red('Not in a git repository'));
          return;
        }

        const prdDir = path.join(repoRoot, '.cv-prd');

        const manifest = await loadManifest(prdDir);
        const coverageFile = path.join(prdDir, 'links', 'coverage.json');
        const coverage = JSON.parse(await fs.readFile(coverageFile, 'utf-8'));

        console.log(chalk.bold('\nRequirement Coverage:\n'));

        let totalChunks = 0;
        let implementedChunks = 0;

        for (const entry of manifest.prds) {
          const content = await fs.readFile(
            path.join(repoRoot, '.cv-prd', entry.file),
            'utf-8'
          );
          const parsed = parsePRDMarkdown(content, entry.id);

          totalChunks += parsed.chunks.length;
          const implemented = parsed.chunks.filter(c =>
            coverage.coverage[c.id]
          ).length;
          implementedChunks += implemented;

          const pct = parsed.chunks.length > 0 ? (implemented / parsed.chunks.length) * 100 : 0;
          const color = pct >= 70 ? chalk.green : pct >= 40 ? chalk.yellow : chalk.red;

          console.log(`  ${chalk.cyan(entry.id)} - ${entry.name}`);
          console.log(`    ${color(`${pct.toFixed(0)}%`)} (${implemented}/${parsed.chunks.length} chunks)`);

          if (options.missing) {
            const missing = parsed.chunks.filter(c => !coverage.coverage[c.id]);
            for (const chunk of missing) {
              console.log(chalk.gray(`      ○ ${chunk.id}: ${chunk.text.substring(0, 60)}...`));
            }
          }
          console.log();
        }

        const totalPct = totalChunks > 0 ? (implementedChunks / totalChunks) * 100 : 0;
        const totalColor = totalPct >= 70 ? chalk.green : totalPct >= 40 ? chalk.yellow : chalk.red;

        console.log(chalk.bold('Overall:'));
        console.log(`  ${totalColor(`${totalPct.toFixed(0)}%`)} (${implementedChunks}/${totalChunks} requirements implemented)`);
      } catch (error) {
        console.error(chalk.red(`Error: ${error}`));
      }
    });

  return prd;
}

// ═══════════════════════════════════════════════════════════════
// Helper Functions
// ═══════════════════════════════════════════════════════════════

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function loadManifest(prdDir: string): Promise<PRDManifest> {
  const content = await fs.readFile(path.join(prdDir, 'manifest.json'), 'utf-8');
  return JSON.parse(content);
}

async function saveManifest(prdDir: string, manifest: PRDManifest): Promise<void> {
  await fs.writeFile(
    path.join(prdDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2)
  );
}

/**
 * Parse PRD markdown with front-matter and chunk markers
 */
function parsePRDMarkdown(content: string, defaultId: string): ParsedPRD {
  const lines = content.split('\n');
  const chunks: PRDChunk[] = [];

  // Parse front-matter
  let frontMatter: Record<string, string | string[]> = {};
  let bodyStart = 0;

  if (lines[0] === '---') {
    const endIndex = lines.indexOf('---', 1);
    if (endIndex > 0) {
      const fmLines = lines.slice(1, endIndex);
      for (const line of fmLines) {
        const match = line.match(/^(\w+):\s*(.+)$/);
        if (match) {
          const [, key, value] = match;
          // Parse arrays
          if (value.startsWith('[') && value.endsWith(']')) {
            frontMatter[key] = value.slice(1, -1).split(',').map(s => s.trim());
          } else {
            frontMatter[key] = value;
          }
        }
      }
      bodyStart = endIndex + 1;
    }
  }

  // Parse chunks from body
  const body = lines.slice(bodyStart);
  let currentChunk: Partial<PRDChunk> | null = null;
  let chunkLines: string[] = [];

  for (let i = 0; i < body.length; i++) {
    const line = body[i];

    // Check for chunk start marker
    const startMatch = line.match(/<!--\s*chunk:(\S+)(?:\s+(.+))?\s*-->/);
    if (startMatch) {
      const [, chunkId, attrs] = startMatch;

      currentChunk = {
        id: chunkId,
        prd_id: (frontMatter.id as string) || defaultId,
        type: 'functional',
        line_start: bodyStart + i
      };

      // Parse attributes
      if (attrs) {
        const attrPairs = attrs.split(/\s+/);
        for (const pair of attrPairs) {
          const [key, value] = pair.split(':');
          if (key === 'priority') currentChunk.priority = value;
          if (key === 'type') currentChunk.type = value;
          if (key === 'depends') currentChunk.depends = value.split(',');
          if (key === 'implements') currentChunk.implements = value;
        }
      }

      chunkLines = [];
      continue;
    }

    // Check for chunk end marker
    if (line.match(/<!--\s*\/chunk\s*-->/)) {
      if (currentChunk) {
        currentChunk.text = chunkLines.join('\n').trim();
        currentChunk.line_end = bodyStart + i;
        chunks.push(currentChunk as PRDChunk);
        currentChunk = null;
      }
      continue;
    }

    // Accumulate chunk content
    if (currentChunk) {
      chunkLines.push(line);
    }
  }

  // Extract name from first heading if not in front-matter
  let name = frontMatter.name as string | undefined;
  if (!name) {
    const headingMatch = body.find(l => l.startsWith('# '));
    if (headingMatch) {
      name = headingMatch.replace(/^#\s+/, '');
    } else {
      name = defaultId;
    }
  }

  return {
    id: (frontMatter.id as string) || defaultId,
    name,
    version: frontMatter.version as string | undefined,
    status: (frontMatter.status as string) || 'draft',
    owner: frontMatter.owner as string | undefined,
    tags: (frontMatter.tags as string[]) || [],
    chunks,
    raw_content: content
  };
}

async function appendGraphNodes(prdDir: string, parsed: ParsedPRD): Promise<void> {
  const nodesPath = path.join(prdDir, 'graph', 'nodes.jsonl');
  const edgesPath = path.join(prdDir, 'graph', 'edges.jsonl');

  // Append PRD node
  const prdNode = {
    type: 'PRD',
    id: parsed.id,
    name: parsed.name,
    status: parsed.status,
    file: `prds/${parsed.id}.md`
  };
  await fs.appendFile(nodesPath, JSON.stringify(prdNode) + '\n');

  // Append chunk nodes and edges
  for (const chunk of parsed.chunks) {
    const chunkNode = {
      type: 'Chunk',
      id: chunk.id,
      prd_id: chunk.prd_id,
      text: chunk.text.substring(0, 500),
      priority: chunk.priority || 'normal',
      chunk_type: chunk.type
    };
    await fs.appendFile(nodesPath, JSON.stringify(chunkNode) + '\n');

    // BELONGS_TO edge
    const belongsEdge = {
      type: 'BELONGS_TO',
      from: chunk.id,
      to: parsed.id
    };
    await fs.appendFile(edgesPath, JSON.stringify(belongsEdge) + '\n');

    // DEPENDS_ON edges
    if (chunk.depends) {
      for (const dep of chunk.depends) {
        const depEdge = {
          type: 'DEPENDS_ON',
          from: chunk.id,
          to: dep
        };
        await fs.appendFile(edgesPath, JSON.stringify(depEdge) + '\n');
      }
    }
  }
}

async function updateCoverage(prdDir: string): Promise<void> {
  const implPath = path.join(prdDir, 'links', 'implementations.jsonl');
  const coveragePath = path.join(prdDir, 'links', 'coverage.json');

  const content = await fs.readFile(implPath, 'utf-8');
  const lines = content.trim().split('\n').filter(l => l);

  const coverage: Record<string, boolean> = {};
  for (const line of lines) {
    try {
      const impl = JSON.parse(line);
      coverage[impl.chunk_id] = true;
    } catch {
      // Skip invalid lines
    }
  }

  await fs.writeFile(coveragePath, JSON.stringify({
    coverage,
    updated: new Date().toISOString()
  }, null, 2));

  // Update manifest coverage stats
  const manifest = await loadManifest(prdDir);
  const implementedCount = Object.keys(coverage).length;
  manifest.stats.linked_symbols = implementedCount;
  manifest.stats.coverage_percent = manifest.stats.total_chunks > 0
    ? (implementedCount / manifest.stats.total_chunks) * 100
    : 0;

  // Update per-PRD coverage
  for (const entry of manifest.prds) {
    // Would need to load each PRD to calculate exact coverage
    // For now, use rough estimate
    entry.coverage = manifest.stats.coverage_percent / 100;
  }

  await saveManifest(prdDir, manifest);
}

function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16);
}

export default createPRDCommand;
