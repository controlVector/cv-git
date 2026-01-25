/**
 * MCP Resources Handler
 * Provides resources for AI assistants to access codebase context
 */

import {
  configManager,
  createVectorManager,
} from '@cv-git/core';
import { findRepoRoot } from '@cv-git/shared';
import { getOpenAIApiKey, getOpenRouterApiKey } from './credentials.js';
import { createIsolatedGraphManager, getServiceUrls } from './utils.js';

/**
 * Resource definitions available from this server
 */
export interface MCPResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

/**
 * Resource content returned when reading a resource
 */
export interface ResourceContent {
  uri: string;
  mimeType?: string;
  text: string;
}

/**
 * List of available resources
 */
export function listResources(): MCPResource[] {
  return [
    {
      uri: 'cv://context/auto',
      name: 'Automatic Code Context',
      description: 'Auto-assembled context from the knowledge graph including relevant code, relationships, and documentation. Optimized for AI system prompts.',
      mimeType: 'application/json',
    },
    {
      uri: 'cv://graph/summary',
      name: 'Knowledge Graph Summary',
      description: 'Statistics and overview of the code knowledge graph including file counts, symbol counts, and relationship types.',
      mimeType: 'application/json',
    },
    {
      uri: 'cv://status',
      name: 'Repository Status',
      description: 'Current status of the CV-Git repository including git status, service health, and sync state.',
      mimeType: 'application/json',
    },
  ];
}

/**
 * Read a specific resource by URI
 */
export async function readResource(uri: string): Promise<ResourceContent> {
  switch (uri) {
    case 'cv://context/auto':
      return await readAutoContext();
    case 'cv://graph/summary':
      return await readGraphSummary();
    case 'cv://status':
      return await readStatus();
    default:
      throw new Error(`Unknown resource: ${uri}`);
  }
}

/**
 * Read auto-assembled context
 */
async function readAutoContext(): Promise<ResourceContent> {
  try {
    const repoRoot = await findRepoRoot();
    if (!repoRoot) {
      return {
        uri: 'cv://context/auto',
        mimeType: 'application/json',
        text: JSON.stringify({
          error: 'Not in a CV-Git repository',
          suggestion: 'Run `cv init` to initialize',
        }, null, 2),
      };
    }

    const config = await configManager.load(repoRoot);
    const openaiApiKey = config.ai.apiKey || await getOpenAIApiKey();
    const openrouterApiKey = await getOpenRouterApiKey();

    if (!openaiApiKey && !openrouterApiKey) {
      return {
        uri: 'cv://context/auto',
        mimeType: 'application/json',
        text: JSON.stringify({
          error: 'No embedding API key configured',
          suggestion: 'Run `cv auth setup openai` or `cv auth setup openrouter`',
        }, null, 2),
      };
    }

    // Get graph stats for context with repo isolation
    let graphStats: any = null;
    try {
      const { graph } = await createIsolatedGraphManager(repoRoot);
      await graph.connect();

      const statsQuery = `
        MATCH (f:File) WITH count(f) as files
        MATCH (s:Symbol) WITH files, count(s) as symbols
        MATCH ()-[r]->() WITH files, symbols, count(r) as relationships
        RETURN files, symbols, relationships
      `;
      const results = await graph.query(statsQuery);
      if (results.length > 0) {
        graphStats = results[0];
      }

      // Get recent symbols
      const symbolsQuery = `
        MATCH (s:Symbol)
        RETURN s.name as name, s.kind as kind, s.file as file
        LIMIT 20
      `;
      const symbols = await graph.query(symbolsQuery);

      await graph.close();

      return {
        uri: 'cv://context/auto',
        mimeType: 'application/json',
        text: JSON.stringify({
          repository: repoRoot,
          generated: new Date().toISOString(),
          graph: graphStats,
          recentSymbols: symbols,
          hint: 'Use cv_auto_context tool with a specific query for more targeted context',
        }, null, 2),
      };
    } catch (error: any) {
      return {
        uri: 'cv://context/auto',
        mimeType: 'application/json',
        text: JSON.stringify({
          repository: repoRoot,
          generated: new Date().toISOString(),
          error: `Graph unavailable: ${error.message}`,
          hint: 'Run `cv sync` to build the knowledge graph',
        }, null, 2),
      };
    }
  } catch (error: any) {
    return {
      uri: 'cv://context/auto',
      mimeType: 'application/json',
      text: JSON.stringify({
        error: error.message,
      }, null, 2),
    };
  }
}

/**
 * Read knowledge graph summary
 */
async function readGraphSummary(): Promise<ResourceContent> {
  try {
    const repoRoot = await findRepoRoot();
    if (!repoRoot) {
      return {
        uri: 'cv://graph/summary',
        mimeType: 'application/json',
        text: JSON.stringify({ error: 'Not in a CV-Git repository' }, null, 2),
      };
    }

    // Initialize graph with repo isolation
    const { graph } = await createIsolatedGraphManager(repoRoot);
    await graph.connect();

    // Get comprehensive stats
    const queries = {
      files: 'MATCH (f:File) RETURN count(f) as count',
      symbols: 'MATCH (s:Symbol) RETURN count(s) as count',
      functions: 'MATCH (s:Symbol) WHERE s.kind = "function" RETURN count(s) as count',
      classes: 'MATCH (s:Symbol) WHERE s.kind = "class" RETURN count(s) as count',
      calls: 'MATCH ()-[r:CALLS]->() RETURN count(r) as count',
      imports: 'MATCH ()-[r:IMPORTS]->() RETURN count(r) as count',
      defines: 'MATCH ()-[r:DEFINES]->() RETURN count(r) as count',
    };

    const stats: Record<string, number> = {};
    for (const [key, query] of Object.entries(queries)) {
      try {
        const result = await graph.query(query);
        stats[key] = result[0]?.count || 0;
      } catch {
        stats[key] = 0;
      }
    }

    // Get languages
    const langQuery = `
      MATCH (f:File)
      RETURN f.language as language, count(f) as count
      ORDER BY count DESC
    `;
    let languages: any[] = [];
    try {
      languages = await graph.query(langQuery);
    } catch {
      // Skip if fails
    }

    await graph.close();

    return {
      uri: 'cv://graph/summary',
      mimeType: 'application/json',
      text: JSON.stringify({
        repository: repoRoot,
        generated: new Date().toISOString(),
        stats,
        languages,
      }, null, 2),
    };
  } catch (error: any) {
    return {
      uri: 'cv://graph/summary',
      mimeType: 'application/json',
      text: JSON.stringify({
        error: error.message,
        hint: 'Ensure FalkorDB is running and run `cv sync`',
      }, null, 2),
    };
  }
}

/**
 * Read repository status
 */
async function readStatus(): Promise<ResourceContent> {
  try {
    const repoRoot = await findRepoRoot();
    if (!repoRoot) {
      return {
        uri: 'cv://status',
        mimeType: 'application/json',
        text: JSON.stringify({ error: 'Not in a CV-Git repository' }, null, 2),
      };
    }

    const config = await configManager.load(repoRoot);

    // Check services
    const services: Record<string, 'available' | 'unavailable'> = {};

    // Check FalkorDB with repo isolation
    try {
      const { graph } = await createIsolatedGraphManager(repoRoot);
      await graph.connect();
      await graph.close();
      services.falkordb = 'available';
    } catch {
      services.falkordb = 'unavailable';
    }

    // Get service URLs (checks services.json for dynamic ports first)
    const serviceUrls = await getServiceUrls(config);

    // Check Qdrant
    try {
      const openaiApiKey = await getOpenAIApiKey();
      const openrouterApiKey = await getOpenRouterApiKey();
      const vector = createVectorManager({
        url: serviceUrls.qdrant,
        openrouterApiKey,
        openaiApiKey,
        collections: config.vector.collections,
      });
      await vector.connect();
      await vector.close();
      services.qdrant = 'available';
    } catch {
      services.qdrant = 'unavailable';
    }

    return {
      uri: 'cv://status',
      mimeType: 'application/json',
      text: JSON.stringify({
        repository: repoRoot,
        generated: new Date().toISOString(),
        services,
        config: {
          graphUrl: serviceUrls.falkordb,
          vectorUrl: serviceUrls.qdrant,
        },
      }, null, 2),
    };
  } catch (error: any) {
    return {
      uri: 'cv://status',
      mimeType: 'application/json',
      text: JSON.stringify({ error: error.message }, null, 2),
    };
  }
}
