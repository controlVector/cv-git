/**
 * Documentation Tools Handler
 * Implements cv_docs_search, cv_docs_ingest, cv_docs_list
 * Enables searching and writing to the markdown knowledge graph
 */

import { ToolResult } from '../types.js';
import { successResult, errorResult, createIsolatedGraphManager } from '../utils.js';
import {
  configManager,
  createVectorManager,
  createIngestManager,
  createParser,
} from '@cv-git/core';
import { findRepoRoot } from '@cv-git/shared';
import { promises as fs } from 'fs';
import * as path from 'path';
import { getEmbeddingCredentials } from '../credentials.js';

/**
 * Arguments for cv_docs_search
 */
export interface DocsSearchArgs {
  query: string;
  limit?: number;
  minScore?: number;
  type?: string;
  archivedOnly?: boolean;
  activeOnly?: boolean;
}

/**
 * Arguments for cv_docs_ingest
 */
export interface DocsIngestArgs {
  path: string;
  content: string;
  archive?: boolean;
  frontmatter?: Record<string, any>;
}

/**
 * Arguments for cv_docs_list
 */
export interface DocsListArgs {
  type?: string;
  archived?: boolean;
  limit?: number;
}

/**
 * Handle cv_docs_search - Search documentation including archived docs
 */
export async function handleDocsSearch(args: DocsSearchArgs): Promise<ToolResult> {
  try {
    const { query, limit = 10, minScore = 0.5, type, archivedOnly, activeOnly } = args;

    const repoRoot = await findRepoRoot();
    if (!repoRoot) {
      return errorResult('Not in a CV-Git repository. Run `cv init` first.');
    }

    const config = await configManager.load(repoRoot);
    const creds = await getEmbeddingCredentials();

    if (!creds.openaiApiKey && !creds.openrouterApiKey) {
      return errorResult(
        'No embedding API key found. Run `cv auth setup openai` or `cv auth setup openrouter`.'
      );
    }

    // Initialize vector manager
    const vector = createVectorManager({
      url: config.vector.url,
      openrouterApiKey: creds.openrouterApiKey,
      openaiApiKey: creds.openaiApiKey,
      collections: config.vector.collections,
      cacheDir: path.join(repoRoot, '.cv', 'embeddings')
    });

    await vector.connect();

    // Load ingestion data for archived status
    const ingest = createIngestManager(repoRoot);
    const archivedPaths = new Set<string>();

    try {
      const archivedEntries = await ingest.getArchivedEntries();
      for (const entry of archivedEntries) {
        archivedPaths.add(entry.path);
      }
    } catch {
      // No ingestion data - that's fine
    }

    await ingest.close();

    // Search document_chunks collection
    const results = await vector.search(
      'document_chunks',
      query,
      limit * 2 // Get extra for filtering
    );

    await vector.close();

    // Filter by score
    let filteredResults = results.filter(r => r.score >= minScore);

    // Filter by type
    if (type) {
      filteredResults = filteredResults.filter(r => r.payload.documentType === type);
    }

    // Filter by archived status
    if (archivedOnly) {
      filteredResults = filteredResults.filter(r => archivedPaths.has(r.payload.file));
    }
    if (activeOnly) {
      filteredResults = filteredResults.filter(r => !archivedPaths.has(r.payload.file));
    }

    // Apply limit
    filteredResults = filteredResults.slice(0, limit);

    // Format results
    const formattedResults = filteredResults.map(r => {
      const isArchived = archivedPaths.has(r.payload.file);
      return {
        file: r.payload.file,
        section: r.payload.heading || null,
        type: r.payload.documentType || 'unknown',
        score: Math.round(r.score * 100),
        archived: isArchived,
        preview: (r.payload.text || '').substring(0, 200),
        startLine: r.payload.startLine,
        endLine: r.payload.endLine
      };
    });

    const output = [
      `Found ${formattedResults.length} documentation results for "${query}":`,
      '',
      ...formattedResults.map((r, i) => {
        const archivedTag = r.archived ? ' [ARCHIVED]' : '';
        return [
          `${i + 1}. ${r.file}${archivedTag}`,
          r.section ? `   Section: ${r.section}` : null,
          `   Type: ${r.type} | Score: ${r.score}%`,
          `   ${r.preview}...`,
          ''
        ].filter(Boolean).join('\n');
      })
    ].join('\n');

    return successResult(output);
  } catch (error: any) {
    return errorResult('Document search failed', error);
  }
}

/**
 * Handle cv_docs_ingest - Ingest markdown into knowledge graph
 */
export async function handleDocsIngest(args: DocsIngestArgs): Promise<ToolResult> {
  try {
    const { path: docPath, content, archive = false, frontmatter = {} } = args;

    const repoRoot = await findRepoRoot();
    if (!repoRoot) {
      return errorResult('Not in a CV-Git repository. Run `cv init` first.');
    }

    const config = await configManager.load(repoRoot);
    const creds = await getEmbeddingCredentials();

    // Initialize managers
    const ingest = createIngestManager(repoRoot);
    const parser = createParser();

    // Prepare content with frontmatter if provided
    let finalContent = content;
    if (Object.keys(frontmatter).length > 0) {
      const yamlFrontmatter = Object.entries(frontmatter)
        .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
        .join('\n');

      // Check if content already has frontmatter
      if (!content.startsWith('---')) {
        finalContent = `---\n${yamlFrontmatter}\n---\n\n${content}`;
      }
    }

    // Store in .cv/documents/
    const result = await ingest.ingest(docPath, finalContent, {
      archive,
      force: true
    });

    // Also write to actual file location if not archived
    if (!archive) {
      const absolutePath = path.join(repoRoot, docPath);
      await fs.mkdir(path.dirname(absolutePath), { recursive: true });
      await fs.writeFile(absolutePath, finalContent);
    }

    // Parse for graph indexing
    const parsed = await parser.parseDocument(docPath, finalContent);

    // Initialize graph for indexing
    let graphIndexed = false;
    let vectorIndexed = 0;

    try {
      const { graph } = await createIsolatedGraphManager(repoRoot);
      await graph.connect();

      // Create document node
      const stats = { mtimeMs: Date.now() };
      const firstH1 = parsed.headings.find((h: any) => h.level === 1);
      const title = firstH1?.text || path.basename(docPath, path.extname(docPath));
      const wordCount = finalContent.split(/\s+/).filter((w: string) => w.length > 0).length;

      const docNode = {
        path: docPath,
        absolutePath: path.join(repoRoot, docPath),
        title,
        type: parsed.frontmatter.type || parsed.inferredType,
        status: archive ? 'archived' : (parsed.frontmatter.status || 'active'),
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
      graphIndexed = true;

      // Create relationships from links
      for (const link of parsed.links) {
        if (link.isInternal) {
          const targetPath = resolveDocLink(docPath, link.target);
          if (link.isCodeRef) {
            await graph.createDescribesEdge(docPath, targetPath);
          } else {
            await graph.createReferencesDocEdge(docPath, targetPath);
          }
        }
      }

      // Create relationships from frontmatter relates_to
      if (parsed.frontmatter.relates_to) {
        for (const ref of parsed.frontmatter.relates_to) {
          const targetPath = resolveDocLink(docPath, ref);
          await graph.createDescribesEdge(docPath, targetPath);
        }
      }

      await graph.close();
    } catch (graphError: any) {
      // Graph not available - continue without it
    }

    // Generate embeddings if possible
    if (creds.openaiApiKey || creds.openrouterApiKey) {
      try {
        const vector = createVectorManager({
          url: config.vector.url,
          openrouterApiKey: creds.openrouterApiKey,
          openaiApiKey: creds.openaiApiKey,
          collections: config.vector.collections,
          cacheDir: path.join(repoRoot, '.cv', 'embeddings')
        });

        await vector.connect();

        const markdownParser = parser.getMarkdownParser();
        const chunks = markdownParser.chunkDocument(parsed, docPath);

        if (chunks.length > 0) {
          try {
            await vector.ensureCollection('document_chunks', 1536);
          } catch { /* Collection might exist */ }

          const textsToEmbed = chunks.map((chunk: any) => {
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

          const items = chunks.map((chunk: any, idx: number) => ({
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
          vectorIndexed = chunks.length;
        }

        await vector.close();
      } catch (vectorError: any) {
        // Vector DB not available - continue without embeddings
      }
    }

    await ingest.close();

    const output = [
      `Document ingested: ${docPath}`,
      `  Status: ${result.status}`,
      `  Archived: ${archive}`,
      `  Graph indexed: ${graphIndexed}`,
      `  Embeddings created: ${vectorIndexed}`,
      archive ? `  Content preserved in: .cv/documents/${docPath}` : `  Written to: ${docPath}`
    ].join('\n');

    return successResult(output);
  } catch (error: any) {
    return errorResult('Document ingestion failed', error);
  }
}

/**
 * Handle cv_docs_list - List documents in knowledge graph
 */
export async function handleDocsList(args: DocsListArgs): Promise<ToolResult> {
  try {
    const { type, archived, limit = 50 } = args;

    const repoRoot = await findRepoRoot();
    if (!repoRoot) {
      return errorResult('Not in a CV-Git repository. Run `cv init` first.');
    }

    // Get documents from graph with repo isolation
    const { graph } = await createIsolatedGraphManager(repoRoot);
    await graph.connect();

    let query = 'MATCH (d:Document) ';
    const params: Record<string, any> = {};

    if (type) {
      query += 'WHERE d.type = $type ';
      params.type = type;
    }

    query += 'RETURN d ORDER BY d.path LIMIT $limit';
    params.limit = limit;

    const results = await graph.query(query, params);
    await graph.close();

    // Get archived status from ingestion
    const ingest = createIngestManager(repoRoot);
    const archivedPaths = new Set<string>();

    try {
      const archivedEntries = await ingest.getArchivedEntries();
      for (const entry of archivedEntries) {
        archivedPaths.add(entry.path);
      }
    } catch {
      // No ingestion data
    }

    await ingest.close();

    // Filter by archived status if specified
    let documents = results.map((r: any) => ({
      path: r.d?.path || r.d?.properties?.path || '',
      title: r.d?.title || r.d?.properties?.title || '',
      type: r.d?.type || r.d?.properties?.type || 'unknown',
      archived: archivedPaths.has(r.d?.path || r.d?.properties?.path || '')
    })).filter((d: any) => d.path);

    if (archived !== undefined) {
      documents = documents.filter((d: any) => d.archived === archived);
    }

    if (documents.length === 0) {
      return successResult('No documents found. Run `cv docs sync` or `cv_docs_ingest` first.');
    }

    const output = [
      `Documents in knowledge graph (${documents.length}):`,
      '',
      ...documents.map((d: any) => {
        const archivedTag = d.archived ? ' [ARCHIVED]' : '';
        return `  ${d.path}${archivedTag}\n    Title: ${d.title || '(untitled)'}\n    Type: ${d.type}`;
      })
    ].join('\n');

    return successResult(output);
  } catch (error: any) {
    return errorResult('Document list failed', error);
  }
}

/**
 * Resolve a document link to a relative path
 */
function resolveDocLink(fromDoc: string, target: string): string {
  if (target.startsWith('#')) {
    return fromDoc + target;
  }
  if (target.startsWith('.')) {
    const dir = path.dirname(fromDoc);
    return path.normalize(path.join(dir, target));
  }
  if (target.startsWith('/')) {
    return target.slice(1);
  }
  const dir = path.dirname(fromDoc);
  return path.normalize(path.join(dir, target));
}
