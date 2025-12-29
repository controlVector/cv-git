/**
 * CV Docs Command
 * Documentation management and search for the knowledge graph
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import Table from 'cli-table3';
import {
  configManager,
  createGraphManager,
  createVectorManager,
  createSyncEngine,
  createParser,
  createGitManager,
  createIngestManager
} from '@cv-git/core';
import { findRepoRoot, DocumentType } from '@cv-git/shared';
import { glob } from 'glob';
import { promises as fs } from 'fs';
import { getEmbeddingCredentials } from '../utils/credentials.js';
import * as path from 'path';

/**
 * Resolve a document link to an absolute path
 */
function resolveDocLink(fromDoc: string, target: string): string {
  // Handle anchor links
  if (target.startsWith('#')) {
    return fromDoc + target;
  }

  // Handle relative paths
  if (target.startsWith('.')) {
    const dir = path.dirname(fromDoc);
    return path.normalize(path.join(dir, target));
  }

  // Handle absolute paths from root
  if (target.startsWith('/')) {
    return target.slice(1);
  }

  // Assume relative to current file's directory
  const dir = path.dirname(fromDoc);
  return path.normalize(path.join(dir, target));
}

/**
 * Create the docs command with subcommands
 */
export function createDocsCommand(): Command {
  const docs = new Command('docs')
    .description('Documentation management and search');

  // ═══════════════════════════════════════════════════════════════════════════
  // cv docs sync - Index markdown documentation
  // ═══════════════════════════════════════════════════════════════════════════
  docs
    .command('sync')
    .description('Index markdown documentation into knowledge graph')
    .option('--pattern <glob>', 'Custom glob pattern (default: **/*.md)')
    .option('--exclude <pattern>', 'Exclude pattern (can be used multiple times)', (val, prev: string[]) => {
      prev.push(val);
      return prev;
    }, [])
    .option('-v, --verbose', 'Show detailed output')
    .action(async (options) => {
      const spinner = ora('Syncing documentation...').start();

      try {
        const repoRoot = await findRepoRoot();
        if (!repoRoot) {
          spinner.fail(chalk.red('Not in a CV-Git repository. Run `cv init` first.'));
          process.exit(1);
        }

        const config = await configManager.load(repoRoot);

        // Initialize managers
        const git = createGitManager(repoRoot);
        const parser = createParser();
        const graph = createGraphManager(config.graph.url, config.graph.database);

        await graph.connect();

        // Initialize vector if available
        let vector;
        try {
          const embeddingCreds = await getEmbeddingCredentials({
            openRouterKey: config.embedding?.apiKey,
            openaiKey: config.ai?.apiKey
          });

          vector = createVectorManager({
            url: config.vector.url,
            openrouterApiKey: embeddingCreds.openrouterApiKey,
            openaiApiKey: embeddingCreds.openaiApiKey,
            collections: config.vector.collections,
            cacheDir: path.join(repoRoot, '.cv', 'embeddings')
          });

          await vector.connect();
        } catch (error) {
          if (options.verbose) {
            console.log(chalk.yellow('Vector database not available, skipping embeddings'));
          }
        }

        const sync = createSyncEngine(repoRoot, git, parser, graph, vector);

        spinner.text = 'Finding documentation files...';

        const result = await sync.syncDocuments({
          includeDocs: true,
          docPatterns: options.pattern ? [options.pattern] : undefined,
          docExcludePatterns: options.exclude.length > 0 ? options.exclude : undefined
        });

        if (result.documentCount === 0) {
          spinner.warn('No documentation files found');
        } else {
          spinner.succeed(
            chalk.green(`Synced ${result.documentCount} documents `) +
            chalk.gray(`(${result.sectionCount} sections, ${result.vectorCount} embeddings)`)
          );
        }

        if (result.errors.length > 0) {
          console.log(chalk.yellow('\nWarnings:'));
          for (const error of result.errors) {
            console.log(chalk.yellow(`  - ${error}`));
          }
        }

        await graph.close();
        if (vector) await vector.close();

      } catch (error: any) {
        spinner.fail(chalk.red(`Sync failed: ${error.message}`));
        process.exit(1);
      }
    });

  // ═══════════════════════════════════════════════════════════════════════════
  // cv docs ingest - Ingest markdown files into .cv/documents/
  // ═══════════════════════════════════════════════════════════════════════════
  docs
    .command('ingest <pattern>')
    .description('Ingest markdown files into knowledge system (stores + indexes)')
    .option('--archive', 'Archive files (mark for removal from git)')
    .option('--git-rm', 'Also run git rm to stage file removal (use with --archive)')
    .option('--force', 'Re-ingest even if unchanged')
    .option('--no-index', 'Skip graph/vector indexing (store only)')
    .option('-v, --verbose', 'Show detailed output')
    .action(async (pattern: string, options) => {
      const spinner = ora('Ingesting documents...').start();

      try {
        const repoRoot = await findRepoRoot();
        if (!repoRoot) {
          spinner.fail(chalk.red('Not in a CV-Git repository. Run `cv init` first.'));
          process.exit(1);
        }

        // Find files matching pattern
        spinner.text = 'Finding files...';
        const files = await glob(pattern, {
          cwd: repoRoot,
          ignore: ['node_modules/**', '.cv/**', '.git/**'],
          nodir: true
        });

        if (files.length === 0) {
          spinner.warn(`No files match pattern: ${pattern}`);
          process.exit(0);
        }

        spinner.text = `Ingesting ${files.length} file(s)...`;

        const config = await configManager.load(repoRoot);
        const ingest = createIngestManager(repoRoot);
        const parser = createParser();

        // Initialize graph for indexing (unless --no-index)
        let graph: ReturnType<typeof createGraphManager> | null = null;
        let vector: ReturnType<typeof createVectorManager> | null = null;

        if (options.index !== false) {
          try {
            graph = createGraphManager(config.graph.url, config.graph.database);
            await graph.connect();

            // Try to initialize vector manager
            try {
              const embeddingCreds = await getEmbeddingCredentials({
                openRouterKey: config.embedding?.apiKey,
                openaiKey: config.ai?.apiKey
              });

              vector = createVectorManager({
                url: config.vector.url,
                openrouterApiKey: embeddingCreds.openrouterApiKey,
                openaiApiKey: embeddingCreds.openaiApiKey,
                collections: config.vector.collections,
                cacheDir: path.join(repoRoot, '.cv', 'embeddings')
              });

              await vector.connect();
            } catch (error) {
              if (options.verbose) {
                console.log(chalk.yellow('\n  Vector DB not available, skipping embeddings'));
              }
            }
          } catch (error) {
            if (options.verbose) {
              console.log(chalk.yellow('\n  Graph DB not available, storing locally only'));
            }
          }
        }

        let created = 0;
        let updated = 0;
        let unchanged = 0;
        let errors = 0;
        let graphIndexed = 0;
        let vectorIndexed = 0;

        // Collect parsed docs for batch graph/vector update
        const parsedDocs: Array<{ file: string; content: string; parsed: any }> = [];

        for (const file of files) {
          try {
            const absolutePath = path.join(repoRoot, file);
            const content = await fs.readFile(absolutePath, 'utf-8');

            // Store in .cv/documents/
            const result = await ingest.ingest(file, content, {
              archive: options.archive,
              force: options.force
            });

            if (result.status === 'created') created++;
            else if (result.status === 'updated') updated++;
            else if (result.status === 'unchanged') unchanged++;
            else if (result.status === 'error') {
              errors++;
              if (options.verbose) {
                console.log(chalk.red(`\n  Error: ${file}: ${result.error}`));
              }
              continue;
            }

            // Parse document for graph indexing
            if (graph && (result.status === 'created' || result.status === 'updated' || options.force)) {
              try {
                const parsed = await parser.parseDocument(file, content);
                parsedDocs.push({ file, content, parsed });
              } catch (parseError: any) {
                if (options.verbose) {
                  console.log(chalk.yellow(`\n  Parse warning: ${file}: ${parseError.message}`));
                }
              }
            }

            if (options.verbose && result.status !== 'unchanged') {
              console.log(chalk.gray(`\n  ${result.status}: ${file}`));
            }
          } catch (error: any) {
            errors++;
            if (options.verbose) {
              console.log(chalk.red(`\n  Error reading ${file}: ${error.message}`));
            }
          }
        }

        await ingest.close();

        // Index to graph
        if (graph && parsedDocs.length > 0) {
          spinner.text = 'Indexing to knowledge graph...';

          for (const { file, parsed } of parsedDocs) {
            try {
              // Create document node
              const absolutePath = path.join(repoRoot, file);
              const stats = await fs.stat(absolutePath);

              const firstH1 = parsed.headings.find((h: any) => h.level === 1);
              const title = firstH1?.text || path.basename(file, path.extname(file));
              const wordCount = parsed.content.split(/\s+/).filter((w: string) => w.length > 0).length;

              const docNode = {
                path: file,
                absolutePath,
                title,
                type: parsed.frontmatter.type || parsed.inferredType,
                status: parsed.frontmatter.status || 'active',
                frontmatter: parsed.frontmatter,
                headings: parsed.headings,
                links: parsed.links,
                sections: parsed.sections,
                wordCount,
                gitHash: '',
                lastModified: stats.mtimeMs,
                createdAt: Date.now(),
                updatedAt: Date.now()
              };

              await graph.upsertDocumentNode(docNode);
              graphIndexed++;

              // Create relationships from links
              for (const link of parsed.links) {
                if (link.isInternal) {
                  const targetPath = resolveDocLink(file, link.target);
                  if (link.isCodeRef) {
                    await graph.createDescribesEdge(file, targetPath);
                  } else {
                    await graph.createReferencesDocEdge(file, targetPath);
                  }
                }
              }

              // Create relationships from frontmatter relates_to
              if (parsed.frontmatter.relates_to) {
                for (const ref of parsed.frontmatter.relates_to) {
                  const targetPath = resolveDocLink(file, ref);
                  await graph.createDescribesEdge(file, targetPath);
                }
              }
            } catch (graphError: any) {
              if (options.verbose) {
                console.log(chalk.yellow(`\n  Graph index warning: ${file}: ${graphError.message}`));
              }
            }
          }
        }

        // Generate embeddings
        if (vector && parsedDocs.length > 0) {
          spinner.text = 'Generating embeddings...';

          try {
            const markdownParser = parser.getMarkdownParser();
            const allChunks: any[] = [];

            for (const { file, parsed } of parsedDocs) {
              const chunks = markdownParser.chunkDocument(parsed, file);
              allChunks.push(...chunks);
            }

            if (allChunks.length > 0) {
              // Ensure collection exists
              try {
                await vector.ensureCollection('document_chunks', 1536);
              } catch { /* Collection might exist */ }

              // Prepare and embed
              const textsToEmbed = allChunks.map(chunk => {
                const parts: string[] = [];
                parts.push(`// Document Type: ${chunk.documentType}`);
                parts.push(`// File: ${chunk.file}`);
                if (chunk.heading) parts.push(`// Section: ${chunk.heading}`);
                if (chunk.tags?.length > 0) parts.push(`// Tags: ${chunk.tags.join(', ')}`);
                parts.push('');
                parts.push(chunk.text);
                return parts.join('\n');
              });

              const embeddings = await vector.embedBatch(textsToEmbed);

              const items = allChunks.map((chunk, idx) => ({
                id: chunk.id,
                vector: embeddings[idx],
                payload: {
                  id: chunk.id,
                  file: chunk.file,
                  language: 'markdown',
                  documentType: chunk.documentType,
                  heading: chunk.heading,
                  headingLevel: chunk.headingLevel,
                  startLine: chunk.startLine,
                  endLine: chunk.endLine,
                  text: chunk.text,
                  tags: chunk.tags,
                  lastModified: Date.now()
                }
              }));

              await vector.upsertBatch('document_chunks', items);
              vectorIndexed = allChunks.length;
            }
          } catch (vectorError: any) {
            if (options.verbose) {
              console.log(chalk.yellow(`\n  Embedding warning: ${vectorError.message}`));
            }
          }
        }

        // Close connections
        if (graph) await graph.close();
        if (vector) await vector.close();

        // Report results
        const parts = [];
        if (created > 0) parts.push(`${created} created`);
        if (updated > 0) parts.push(`${updated} updated`);
        if (unchanged > 0) parts.push(chalk.gray(`${unchanged} unchanged`));
        if (errors > 0) parts.push(chalk.red(`${errors} errors`));

        spinner.succeed(
          chalk.green('Ingestion complete: ') + parts.join(', ')
        );

        if (graphIndexed > 0 || vectorIndexed > 0) {
          console.log(chalk.gray(`  Indexed: ${graphIndexed} graph nodes, ${vectorIndexed} embeddings`));
        }

        // Handle git removal for archived files
        if (options.archive && options.gitRm && (created > 0 || updated > 0)) {
          spinner.start('Removing archived files from git...');

          const { execSync } = await import('child_process');
          let gitRmCount = 0;
          const gitRmErrors: string[] = [];

          for (const file of files) {
            try {
              // Check if file is tracked by git
              execSync(`git ls-files --error-unmatch "${file}"`, {
                cwd: repoRoot,
                stdio: 'pipe'
              });

              // File is tracked, remove it
              execSync(`git rm --cached "${file}"`, {
                cwd: repoRoot,
                stdio: 'pipe'
              });
              gitRmCount++;
            } catch (error: any) {
              // File not tracked or git error - that's fine
              if (options.verbose) {
                gitRmErrors.push(`${file}: ${error.message}`);
              }
            }
          }

          if (gitRmCount > 0) {
            spinner.succeed(chalk.green(`Removed ${gitRmCount} files from git index`));
            console.log(chalk.gray('  Run `git commit` to finalize the removal'));
            console.log(chalk.gray('  Content preserved in: .cv/documents/'));
          } else {
            spinner.info('No tracked files to remove');
          }
        } else if (options.archive) {
          console.log(chalk.yellow('\nNote: Files marked as archived. They remain in git until you remove them.'));
          console.log(chalk.gray('  To remove from git: git rm --cached <file>'));
          console.log(chalk.gray('  Or re-run with: cv docs ingest --archive --git-rm'));
          console.log(chalk.gray('  Content preserved in: .cv/documents/'));
        }

      } catch (error: any) {
        spinner.fail(chalk.red(`Ingest failed: ${error.message}`));
        process.exit(1);
      }
    });

  // ═══════════════════════════════════════════════════════════════════════════
  // cv docs archive - Archive an ingested document
  // ═══════════════════════════════════════════════════════════════════════════
  docs
    .command('archive <file>')
    .description('Mark ingested document as archived')
    .option('--git-rm', 'Also run git rm to stage file removal')
    .action(async (file: string, options) => {
      try {
        const repoRoot = await findRepoRoot();
        if (!repoRoot) {
          console.error(chalk.red('Not in a CV-Git repository'));
          process.exit(1);
        }

        const ingest = createIngestManager(repoRoot);

        const isIngested = await ingest.isIngested(file);
        if (!isIngested) {
          console.error(chalk.red(`Document not ingested: ${file}`));
          console.log(chalk.gray('Run `cv docs ingest <file>` first.'));
          await ingest.close();
          process.exit(1);
        }

        const result = await ingest.archive(file);
        await ingest.close();

        if (result) {
          console.log(chalk.green(`Archived: ${file}`));
          console.log(chalk.gray(`Content preserved in: .cv/documents/${file}`));

          // Handle git removal if requested
          if (options.gitRm) {
            try {
              const { execSync } = await import('child_process');

              // Check if file is tracked by git
              execSync(`git ls-files --error-unmatch "${file}"`, {
                cwd: repoRoot,
                stdio: 'pipe'
              });

              // File is tracked, remove it
              execSync(`git rm --cached "${file}"`, {
                cwd: repoRoot,
                stdio: 'pipe'
              });
              console.log(chalk.green(`Removed from git index: ${file}`));
              console.log(chalk.gray('Run `git commit` to finalize the removal'));
            } catch (error: any) {
              console.log(chalk.yellow(`Note: Could not remove from git (may not be tracked)`));
            }
          } else {
            console.log(chalk.gray(`To remove from git: git rm --cached ${file}`));
          }
        } else {
          console.log(chalk.yellow(`Already archived: ${file}`));
        }

      } catch (error: any) {
        console.error(chalk.red(`Error: ${error.message}`));
        process.exit(1);
      }
    });

  // ═══════════════════════════════════════════════════════════════════════════
  // cv docs restore - Restore an archived document
  // ═══════════════════════════════════════════════════════════════════════════
  docs
    .command('restore <file>')
    .description('Restore archived document to filesystem')
    .option('--stdout', 'Output content to stdout instead of writing file')
    .option('--git-add', 'Also run git add to stage the restored file')
    .action(async (file: string, options) => {
      try {
        const repoRoot = await findRepoRoot();
        if (!repoRoot) {
          console.error(chalk.red('Not in a CV-Git repository'));
          process.exit(1);
        }

        const ingest = createIngestManager(repoRoot);

        const content = await ingest.restore(file);
        await ingest.close();

        if (!content) {
          console.error(chalk.red(`Document not found: ${file}`));
          console.log(chalk.gray('Run `cv docs list --ingested` to see ingested documents.'));
          process.exit(1);
        }

        if (options.stdout) {
          console.log(content);
        } else {
          const absolutePath = path.join(repoRoot, file);
          await fs.mkdir(path.dirname(absolutePath), { recursive: true });
          await fs.writeFile(absolutePath, content);

          console.log(chalk.green(`Restored: ${file}`));

          // Handle git add if requested
          if (options.gitAdd) {
            try {
              const { execSync } = await import('child_process');
              execSync(`git add "${file}"`, {
                cwd: repoRoot,
                stdio: 'pipe'
              });
              console.log(chalk.green(`Added to git: ${file}`));
            } catch (error: any) {
              console.log(chalk.yellow(`Note: Could not add to git: ${error.message}`));
            }
          } else {
            console.log(chalk.gray(`To add back to git: git add ${file}`));
          }
        }

      } catch (error: any) {
        console.error(chalk.red(`Error: ${error.message}`));
        process.exit(1);
      }
    });

  // ═══════════════════════════════════════════════════════════════════════════
  // cv docs list - List indexed documents
  // ═══════════════════════════════════════════════════════════════════════════
  docs
    .command('list')
    .description('List indexed documents')
    .option('-t, --type <type>', 'Filter by document type')
    .option('--tag <tag>', 'Filter by tag')
    .option('--ingested', 'List ingested documents (from .cv/documents/)')
    .option('--archived', 'List only archived documents')
    .option('--active', 'List only active (non-archived) documents')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      try {
        const repoRoot = await findRepoRoot();
        if (!repoRoot) {
          console.error(chalk.red('Not in a CV-Git repository'));
          process.exit(1);
        }

        // If showing ingested documents, use IngestManager
        if (options.ingested || options.archived || options.active) {
          const ingest = createIngestManager(repoRoot);

          let entries;
          if (options.archived) {
            entries = await ingest.getArchivedEntries();
          } else if (options.active) {
            entries = await ingest.getActiveEntries();
          } else {
            entries = await ingest.getAllEntries();
          }

          await ingest.close();

          if (options.json) {
            console.log(JSON.stringify(entries, null, 2));
          } else {
            if (entries.length === 0) {
              console.log(chalk.yellow('No ingested documents found.'));
              console.log(chalk.gray('Run `cv docs ingest <pattern>` to ingest documents.'));
            } else {
              const table = new Table({
                head: [
                  chalk.cyan('Path'),
                  chalk.cyan('Words'),
                  chalk.cyan('Sections'),
                  chalk.cyan('Status'),
                  chalk.cyan('Ingested')
                ],
                colWidths: [45, 8, 10, 12, 20]
              });

              for (const entry of entries) {
                const status = entry.archived ? chalk.yellow('archived') : chalk.green('active');
                const date = new Date(entry.ingestedAt).toLocaleDateString();

                table.push([
                  entry.path.substring(0, 43),
                  entry.wordCount,
                  entry.sectionCount,
                  status,
                  date
                ]);
              }

              console.log(table.toString());

              const stats = entries.reduce((acc, e) => ({
                archived: acc.archived + (e.archived ? 1 : 0),
                words: acc.words + e.wordCount
              }), { archived: 0, words: 0 });

              console.log(chalk.gray(`\nTotal: ${entries.length} documents (${stats.archived} archived, ${stats.words} words)`));
            }
          }
          return;
        }

        // Otherwise use graph database
        const config = await configManager.load(repoRoot);
        const graph = createGraphManager(config.graph.url, config.graph.database);
        await graph.connect();

        let documents;
        if (options.type) {
          documents = await graph.getDocumentsByType(options.type as DocumentType);
        } else if (options.tag) {
          documents = await graph.getDocumentsByTag(options.tag);
        } else {
          // Get all documents
          const result = await graph.query('MATCH (d:Document) RETURN d ORDER BY d.path LIMIT 100');
          documents = result.map(r => r.d);
        }

        if (options.json) {
          console.log(JSON.stringify(documents, null, 2));
        } else {
          if (documents.length === 0) {
            console.log(chalk.yellow('No documents found. Run `cv docs sync` first.'));
          } else {
            const table = new Table({
              head: [
                chalk.cyan('Path'),
                chalk.cyan('Type'),
                chalk.cyan('Title'),
                chalk.cyan('Status')
              ],
              colWidths: [40, 15, 30, 10]
            });

            for (const doc of documents) {
              table.push([
                doc.path?.substring(0, 38) || '',
                doc.type || 'unknown',
                (doc.title || '').substring(0, 28),
                doc.status || 'active'
              ]);
            }

            console.log(table.toString());
            console.log(chalk.gray(`\nTotal: ${documents.length} documents`));
          }
        }

        await graph.close();

      } catch (error: any) {
        console.error(chalk.red(`Error: ${error.message}`));
        process.exit(1);
      }
    });

  // ═══════════════════════════════════════════════════════════════════════════
  // cv docs show - Show document details
  // ═══════════════════════════════════════════════════════════════════════════
  docs
    .command('show <file>')
    .description('Show document details and relationships')
    .option('--graph', 'Show graph relationships')
    .option('--sections', 'Show section breakdown')
    .option('--json', 'Output as JSON')
    .action(async (file: string, options) => {
      try {
        const repoRoot = await findRepoRoot();
        if (!repoRoot) {
          console.error(chalk.red('Not in a CV-Git repository'));
          process.exit(1);
        }

        const config = await configManager.load(repoRoot);
        const graph = createGraphManager(config.graph.url, config.graph.database);
        await graph.connect();

        const doc = await graph.getDocumentNode(file);

        if (!doc) {
          console.error(chalk.red(`Document not found: ${file}`));
          console.log(chalk.gray('Run `cv docs sync` to index documents.'));
          process.exit(1);
        }

        if (options.json) {
          const result: any = { document: doc };
          if (options.graph) {
            result.related = await graph.getRelatedDocuments(file);
            result.describes = await graph.query(
              `MATCH (d:Document {path: $path})-[:DESCRIBES]->(t) RETURN t.path as path`,
              { path: file }
            );
          }
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(chalk.bold.cyan(`\n${doc.title || file}`));
          console.log(chalk.gray('─'.repeat(50)));

          console.log(`${chalk.bold('Path:')} ${doc.path}`);
          console.log(`${chalk.bold('Type:')} ${doc.type}`);
          console.log(`${chalk.bold('Status:')} ${doc.status}`);
          console.log(`${chalk.bold('Words:')} ${doc.wordCount}`);

          if (doc.frontmatter?.tags && doc.frontmatter.tags.length > 0) {
            console.log(`${chalk.bold('Tags:')} ${doc.frontmatter.tags.join(', ')}`);
          }

          if (doc.frontmatter?.author) {
            console.log(`${chalk.bold('Author:')} ${doc.frontmatter.author}`);
          }

          if (options.sections && doc.headings) {
            console.log(chalk.bold('\nSections:'));
            for (const heading of doc.headings) {
              const indent = '  '.repeat(heading.level - 1);
              console.log(`${indent}${heading.text}`);
            }
          }

          if (options.graph) {
            console.log(chalk.bold('\nRelationships:'));

            const related = await graph.getRelatedDocuments(file);
            if (related.length > 0) {
              console.log(chalk.gray('  References:'));
              for (const rel of related) {
                console.log(`    → ${rel.path}`);
              }
            }

            const describes = await graph.query(
              `MATCH (d:Document {path: $path})-[:DESCRIBES]->(t) RETURN t.path as path`,
              { path: file }
            );
            if (describes.length > 0) {
              console.log(chalk.gray('  Describes:'));
              for (const desc of describes) {
                console.log(`    → ${desc.path}`);
              }
            }
          }

          console.log('');
        }

        await graph.close();

      } catch (error: any) {
        console.error(chalk.red(`Error: ${error.message}`));
        process.exit(1);
      }
    });

  // ═══════════════════════════════════════════════════════════════════════════
  // cv docs search - Semantic search across documentation
  // ═══════════════════════════════════════════════════════════════════════════
  docs
    .command('search <query>')
    .description('Semantic search across documentation (includes archived docs)')
    .option('-n, --limit <number>', 'Number of results', '10')
    .option('-t, --type <type>', 'Filter by document type')
    .option('--archived-only', 'Only show results from archived documents')
    .option('--active-only', 'Only show results from non-archived documents')
    .option('--min-score <score>', 'Minimum similarity score (0-1)', '0.5')
    .option('--json', 'Output as JSON')
    .action(async (query: string, options) => {
      const spinner = ora('Searching documents...').start();

      try {
        const repoRoot = await findRepoRoot();
        if (!repoRoot) {
          spinner.fail(chalk.red('Not in a CV-Git repository'));
          process.exit(1);
        }

        const config = await configManager.load(repoRoot);

        const embeddingCreds = await getEmbeddingCredentials({
          openRouterKey: config.embedding?.apiKey,
          openaiKey: config.ai?.apiKey
        });

        const vector = createVectorManager({
          url: config.vector.url,
          openrouterApiKey: embeddingCreds.openrouterApiKey,
          openaiApiKey: embeddingCreds.openaiApiKey,
          collections: config.vector.collections,
          cacheDir: path.join(repoRoot, '.cv', 'embeddings')
        });

        await vector.connect();

        // Load ingestion data to check archived status
        const ingest = createIngestManager(repoRoot);
        const archivedPaths = new Set<string>();

        try {
          const archivedEntries = await ingest.getArchivedEntries();
          for (const entry of archivedEntries) {
            archivedPaths.add(entry.path);
          }
        } catch {
          // Ingestion data not available - that's fine
        }

        await ingest.close();

        // Search document_chunks collection
        const results = await vector.search(
          'document_chunks',
          query,
          parseInt(options.limit, 10) * 2, // Get extra for filtering
          { minScore: parseFloat(options.minScore) }
        );

        spinner.stop();

        // Filter by type and archived status
        let filteredResults = results;

        if (options.type) {
          filteredResults = filteredResults.filter(r => r.payload.documentType === options.type);
        }

        if (options.archivedOnly) {
          filteredResults = filteredResults.filter(r => archivedPaths.has(r.payload.file));
        }

        if (options.activeOnly) {
          filteredResults = filteredResults.filter(r => !archivedPaths.has(r.payload.file));
        }

        // Apply final limit
        filteredResults = filteredResults.slice(0, parseInt(options.limit, 10));

        if (options.json) {
          // Add archived status to JSON output
          const enrichedResults = filteredResults.map(r => ({
            ...r,
            archived: archivedPaths.has(r.payload.file)
          }));
          console.log(JSON.stringify(enrichedResults, null, 2));
        } else {
          if (filteredResults.length === 0) {
            console.log(chalk.yellow('No matching documents found.'));
          } else {
            console.log(chalk.bold(`\nFound ${filteredResults.length} results for "${query}":\n`));

            for (const result of filteredResults) {
              const score = (result.score * 100).toFixed(0);
              const type = result.payload.documentType || 'unknown';
              const heading = result.payload.heading || '';
              const isArchived = archivedPaths.has(result.payload.file);

              // Show file path with archived indicator
              const pathDisplay = isArchived
                ? chalk.cyan(`${result.payload.file}`) + chalk.yellow(' [archived]')
                : chalk.cyan(`${result.payload.file}`);

              console.log(pathDisplay);
              if (heading) {
                console.log(chalk.gray(`  Section: ${heading}`));
              }
              console.log(chalk.gray(`  Type: ${type} | Score: ${score}%`));

              // Show preview
              const preview = (result.payload.text || '').substring(0, 150);
              if (preview) {
                console.log(chalk.gray(`  ${preview}...`));
              }
              console.log('');
            }

            // Show hint about archived docs
            const archivedCount = filteredResults.filter(r => archivedPaths.has(r.payload.file)).length;
            if (archivedCount > 0) {
              console.log(chalk.gray(`Tip: ${archivedCount} result(s) from archived docs. Use 'cv docs restore <file>' to access.`));
            }
          }
        }

        await vector.close();

      } catch (error: any) {
        spinner.fail(chalk.red(`Search failed: ${error.message}`));
        process.exit(1);
      }
    });

  // ═══════════════════════════════════════════════════════════════════════════
  // cv docs classify - Show or set document classification
  // ═══════════════════════════════════════════════════════════════════════════
  docs
    .command('classify <file>')
    .description('Show or infer document classification')
    .option('--json', 'Output as JSON')
    .action(async (file: string, options) => {
      try {
        const repoRoot = await findRepoRoot();
        if (!repoRoot) {
          console.error(chalk.red('Not in a CV-Git repository'));
          process.exit(1);
        }

        const parser = createParser();
        const markdownParser = parser.getMarkdownParser();
        const fs = await import('fs/promises');
        const path = await import('path');

        const absolutePath = path.join(repoRoot, file);
        const content = await fs.readFile(absolutePath, 'utf-8');

        const parsed = await markdownParser.parseFile(file, content);
        const inferredType = markdownParser.inferDocumentType(file, content);

        const result = {
          path: file,
          inferredType,
          frontmatterType: parsed.frontmatter.type || null,
          effectiveType: parsed.frontmatter.type || inferredType,
          frontmatter: parsed.frontmatter,
          headingCount: parsed.headings.length,
          linkCount: parsed.links.length,
          sectionCount: parsed.sections.length
        };

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(chalk.bold.cyan(`\nDocument Classification: ${file}\n`));
          console.log(chalk.gray('─'.repeat(50)));

          console.log(`${chalk.bold('Inferred Type:')} ${inferredType}`);
          if (parsed.frontmatter.type) {
            console.log(`${chalk.bold('Frontmatter Type:')} ${parsed.frontmatter.type}`);
          }
          console.log(`${chalk.bold('Effective Type:')} ${result.effectiveType}`);

          console.log(chalk.bold('\nStats:'));
          console.log(`  Headings: ${result.headingCount}`);
          console.log(`  Links: ${result.linkCount}`);
          console.log(`  Sections: ${result.sectionCount}`);

          if (Object.keys(parsed.frontmatter).length > 0) {
            console.log(chalk.bold('\nFrontmatter:'));
            for (const [key, value] of Object.entries(parsed.frontmatter)) {
              if (value !== undefined && value !== null) {
                const displayValue = Array.isArray(value) ? value.join(', ') : value;
                console.log(`  ${key}: ${displayValue}`);
              }
            }
          }

          console.log(chalk.gray('\nTip: Add frontmatter to override the inferred type:'));
          console.log(chalk.gray('  ---'));
          console.log(chalk.gray(`  type: ${inferredType}`));
          console.log(chalk.gray('  status: active'));
          console.log(chalk.gray('  tags: [example]'));
          console.log(chalk.gray('  ---'));
          console.log('');
        }

      } catch (error: any) {
        console.error(chalk.red(`Error: ${error.message}`));
        process.exit(1);
      }
    });

  // ═══════════════════════════════════════════════════════════════════════════
  // cv docs types - List available document types
  // ═══════════════════════════════════════════════════════════════════════════
  docs
    .command('types')
    .description('List available document types')
    .action(async () => {
      console.log(chalk.bold.cyan('\nDocument Types\n'));

      console.log(chalk.bold('PRD Types (compatible with cvPRD):'));
      const prdTypes = ['technical_spec', 'design_spec', 'user_manual', 'api_doc', 'release_note'];
      for (const t of prdTypes) {
        console.log(`  - ${t}`);
      }

      console.log(chalk.bold('\ncv-git Specific Types:'));
      const cvTypes = ['roadmap', 'session_notes', 'phase_doc', 'adr', 'changelog', 'readme', 'guide', 'tutorial', 'reference'];
      for (const t of cvTypes) {
        console.log(`  - ${t}`);
      }

      console.log(chalk.gray('\nSet type via frontmatter:'));
      console.log(chalk.gray('  ---'));
      console.log(chalk.gray('  type: design_spec'));
      console.log(chalk.gray('  ---'));
      console.log('');
    });

  return docs;
}

// Export for index.ts
export { createDocsCommand as docsCommand };
