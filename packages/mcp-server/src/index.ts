#!/usr/bin/env node

/**
 * CV-Git MCP Server
 * Model Context Protocol server exposing CV-Git functionality to AI agents
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';

// Resources handler
import { listResources, readResource } from './resources.js';

import {
  FindArgs,
  ExplainArgs,
  GraphQueryArgs,
  DoArgs,
  ReviewArgs,
  SyncArgs,
  CommitsArgs,
  FileHistoryArgs,
  BlameArgs,
  ToolResult,
} from './types.js';

import {
  successResult,
  errorResult,
  validateArgs,
  formatSearchResults,
  formatGraphResults,
  formatTaskResult,
  formatReview,
  formatSyncResult,
} from './utils.js';

// Tool handlers
import { handleFind } from './tools/search.js';
import { handleExplain } from './tools/explain.js';
import {
  handleGraphQuery,
  handleGraphStats,
  handleGraphInspect,
  handleGraphPath,
  handleGraphDeadCode,
  handleGraphComplexity,
  handleGraphCycles,
  handleGraphHotspots
} from './tools/graph.js';
import { handleDo, handleReview } from './tools/modify.js';
import { handleSync } from './tools/sync.js';
import { handlePRCreate, handlePRList, handlePRReview, handleReleaseCreate } from './tools/platform.js';
import { handleConfigGet, handleStatus, handleDoctor } from './tools/system.js';
import { handleContext, ContextArgs } from './tools/context.js';
import { handleAutoContext, AutoContextArgs } from './tools/auto-context.js';
import { serverLogger, toolLogger, resourceLogger } from './logger.js';
import {
  handlePRDContext,
  handleRequirementTrace,
  handleTestCoverage,
  handleDocCoverage,
  PRDContextArgs,
  RequirementTraceArgs,
  CoverageArgs,
} from './tools/prd.js';
import {
  handleDocsSearch,
  handleDocsIngest,
  handleDocsList,
  DocsSearchArgs,
  DocsIngestArgs,
  DocsListArgs,
} from './tools/docs.js';
import {
  handleCommits,
  handleFileHistory,
  handleBlame,
} from './tools/version.js';
import {
  handleCommitAnalyze,
  handleCommitGenerate,
  CommitAnalyzeArgs,
  CommitGenerateArgs,
} from './tools/commit.js';

/**
 * Tool definitions
 */
const tools: Tool[] = [
  // Code Understanding Tools
  {
    name: 'cv_find',
    description: 'Search for code using natural language semantic search. Returns relevant code snippets with similarity scores.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query in natural language (e.g., "authentication logic", "error handling")',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results to return',
          default: 10,
        },
        minScore: {
          type: 'number',
          description: 'Minimum similarity score (0-1)',
          default: 0.5,
        },
        language: {
          type: 'string',
          description: 'Filter by programming language (e.g., "typescript", "python")',
        },
        file: {
          type: 'string',
          description: 'Filter by file path (partial match)',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'cv_context',
    description: 'Generate rich context about a codebase for AI coding assistants. Searches for relevant code, includes relationships from the knowledge graph, and optionally includes full file contents. Perfect for understanding code before making changes.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'What you want to understand or work on (natural language, e.g., "authentication flow", "error handling in API routes")',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of code chunks to include',
          default: 10,
        },
        depth: {
          type: 'number',
          description: 'Graph traversal depth for relationships (callers/callees)',
          default: 2,
        },
        includeGraph: {
          type: 'boolean',
          description: 'Include code relationships from knowledge graph',
          default: true,
        },
        includeFiles: {
          type: 'boolean',
          description: 'Include full file contents for matched code',
          default: true,
        },
        minScore: {
          type: 'number',
          description: 'Minimum similarity score (0-1)',
          default: 0.5,
        },
        format: {
          type: 'string',
          enum: ['markdown', 'xml', 'json'],
          description: 'Output format',
          default: 'markdown',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'cv_auto_context',
    description: `RECOMMENDED: Call this FIRST before any coding task to get relevant knowledge graph context automatically.

Returns structured context optimized for AI system prompts including:
- Semantically relevant code from the codebase
- Call graph relationships (callers/callees)
- Current file context and symbols
- Related documentation

USE THIS TOOL when:
- Starting any coding task or question about the codebase
- You need to understand code before making changes
- The user asks about how something works

This provides richer context than searching manually.`,
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'What you want to understand or work on (natural language)',
        },
        currentFile: {
          type: 'string',
          description: 'Path to the file currently being edited (optional)',
        },
        format: {
          type: 'string',
          enum: ['xml', 'markdown', 'json'],
          description: 'Output format (xml recommended for system prompts)',
          default: 'xml',
        },
        budget: {
          type: 'number',
          description: 'Token budget for context (default: 20000)',
          default: 20000,
        },
        includeDocs: {
          type: 'boolean',
          description: 'Include related documentation',
          default: true,
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'cv_explain',
    description: 'Get AI-powered explanation of code, symbols, or concepts. Provides detailed analysis including purpose, dependencies, and usage.',
    inputSchema: {
      type: 'object',
      properties: {
        target: {
          type: 'string',
          description: 'What to explain: symbol name (function/class), file path, or concept',
        },
        noStream: {
          type: 'boolean',
          description: 'Disable streaming output',
          default: false,
        },
      },
      required: ['target'],
    },
  },
  {
    name: 'cv_graph_query',
    description: 'Query the knowledge graph for relationships between code elements (calls, imports, dependencies).',
    inputSchema: {
      type: 'object',
      properties: {
        queryType: {
          type: 'string',
          enum: ['calls', 'called-by', 'imports', 'exports', 'functions', 'classes', 'files'],
          description: 'Type of query: calls (what this calls), called-by (what calls this), imports, exports, or list functions/classes/files',
        },
        target: {
          type: 'string',
          description: 'Target symbol or file (required for calls/called-by/imports/exports)',
        },
        language: {
          type: 'string',
          description: 'Filter by language (for list queries)',
        },
        file: {
          type: 'string',
          description: 'Filter by file path (for list queries)',
        },
      },
      required: ['queryType'],
    },
  },
  {
    name: 'cv_graph_stats',
    description: 'Get statistics about the knowledge graph (files, symbols, relationships).',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'cv_graph_inspect',
    description: 'Inspect detailed information about a specific symbol or file.',
    inputSchema: {
      type: 'object',
      properties: {
        target: {
          type: 'string',
          description: 'Symbol name or file path to inspect',
        },
      },
      required: ['target'],
    },
  },
  {
    name: 'cv_graph_path',
    description: 'Find execution paths between two functions in the call graph. Useful for understanding how functions interact.',
    inputSchema: {
      type: 'object',
      properties: {
        from: {
          type: 'string',
          description: 'Starting function name',
        },
        to: {
          type: 'string',
          description: 'Target function name',
        },
        maxDepth: {
          type: 'number',
          description: 'Maximum path depth to search',
          default: 10,
        },
      },
      required: ['from', 'to'],
    },
  },
  {
    name: 'cv_graph_dead_code',
    description: 'Find potentially unreachable or unused functions. Identifies code that may be safe to remove.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'cv_graph_complexity',
    description: 'Find high-complexity functions based on cyclomatic complexity. Helps identify functions that may need refactoring.',
    inputSchema: {
      type: 'object',
      properties: {
        threshold: {
          type: 'number',
          description: 'Minimum complexity threshold',
          default: 10,
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results to return',
          default: 20,
        },
      },
    },
  },
  {
    name: 'cv_graph_cycles',
    description: 'Find circular dependencies in the call graph. Detects potential architectural issues.',
    inputSchema: {
      type: 'object',
      properties: {
        maxDepth: {
          type: 'number',
          description: 'Maximum cycle depth to search',
          default: 5,
        },
      },
    },
  },
  {
    name: 'cv_graph_hotspots',
    description: 'Find most-called functions (hot spots) in the codebase. Identifies functions that may benefit from optimization.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Number of hot spots to return',
          default: 20,
        },
      },
    },
  },

  // Version-Aware Tools (Code Evolution)
  {
    name: 'cv_commits',
    description: 'List recent commits from the knowledge graph. Can filter by file or author. Shows commit history with metadata.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Maximum number of commits to return',
          default: 20,
        },
        file: {
          type: 'string',
          description: 'Filter to commits that modified this file path',
        },
        author: {
          type: 'string',
          description: 'Filter to commits by this author (partial match)',
        },
      },
    },
  },
  {
    name: 'cv_file_history',
    description: 'Get the complete modification history of a file. Shows all commits that changed the file with insertion/deletion counts.',
    inputSchema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          description: 'File path to get history for',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of commits to return',
          default: 10,
        },
        showDiff: {
          type: 'boolean',
          description: 'Include diff summaries (future feature)',
          default: false,
        },
      },
      required: ['file'],
    },
  },
  {
    name: 'cv_blame',
    description: 'Show which commits last modified code. For files, shows blame for each symbol. For symbol names, shows recent commits affecting that symbol.',
    inputSchema: {
      type: 'object',
      properties: {
        target: {
          type: 'string',
          description: 'File path or symbol name to get blame for',
        },
      },
      required: ['target'],
    },
  },

  // Code Modification Tools
  {
    name: 'cv_do',
    description: 'Execute a task with AI assistance. Can generate code, modify existing code, or perform refactoring. Returns execution plan and changes made.',
    inputSchema: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description: 'Task description in natural language (e.g., "add logging to error handlers", "refactor authentication")',
        },
        planOnly: {
          type: 'boolean',
          description: 'Only generate execution plan without making changes',
          default: false,
        },
        autoApprove: {
          type: 'boolean',
          description: 'Automatically approve and execute plan without user confirmation',
          default: false,
        },
      },
      required: ['task'],
    },
  },
  {
    name: 'cv_review',
    description: 'AI-powered code review. Analyzes code changes for bugs, style issues, security concerns, and best practices.',
    inputSchema: {
      type: 'object',
      properties: {
        ref: {
          type: 'string',
          description: 'Git ref to review (commit SHA, branch name)',
          default: 'HEAD',
        },
        staged: {
          type: 'boolean',
          description: 'Review staged changes instead of a commit',
          default: false,
        },
        context: {
          type: 'boolean',
          description: 'Include related code context in review',
          default: false,
        },
      },
    },
  },
  {
    name: 'cv_sync',
    description: 'Synchronize the knowledge graph with the repository. Parses code, extracts symbols, and builds/updates the graph.',
    inputSchema: {
      type: 'object',
      properties: {
        incremental: {
          type: 'boolean',
          description: 'Only sync changed files (faster)',
          default: false,
        },
        force: {
          type: 'boolean',
          description: 'Force full rebuild of the graph',
          default: false,
        },
      },
    },
  },

  // Platform Integration Tools
  {
    name: 'cv_pr_create',
    description: 'Create a pull request on GitHub. Requires GitHub CLI (gh) to be installed and authenticated.',
    inputSchema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Pull request title',
        },
        body: {
          type: 'string',
          description: 'Pull request description',
        },
        base: {
          type: 'string',
          description: 'Base branch for the PR',
          default: 'main',
        },
        draft: {
          type: 'boolean',
          description: 'Create as a draft PR',
          default: false,
        },
      },
    },
  },
  {
    name: 'cv_pr_list',
    description: 'List pull requests from the repository. Requires GitHub CLI (gh) to be installed and authenticated.',
    inputSchema: {
      type: 'object',
      properties: {
        state: {
          type: 'string',
          enum: ['open', 'closed', 'all'],
          description: 'Filter by PR state',
          default: 'open',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of PRs to list',
          default: 10,
        },
      },
    },
  },
  {
    name: 'cv_pr_review',
    description: 'Get details and review information for a pull request. Requires GitHub CLI (gh) to be installed and authenticated.',
    inputSchema: {
      type: 'object',
      properties: {
        number: {
          type: 'number',
          description: 'Pull request number',
        },
      },
      required: ['number'],
    },
  },
  {
    name: 'cv_release_create',
    description: 'Create a new release on GitHub. Requires GitHub CLI (gh) to be installed and authenticated.',
    inputSchema: {
      type: 'object',
      properties: {
        version: {
          type: 'string',
          description: 'Version tag (e.g., v1.0.0)',
        },
        title: {
          type: 'string',
          description: 'Release title',
        },
        notes: {
          type: 'string',
          description: 'Release notes (auto-generated if not provided)',
        },
        draft: {
          type: 'boolean',
          description: 'Create as a draft release',
          default: false,
        },
        prerelease: {
          type: 'boolean',
          description: 'Mark as a pre-release',
          default: false,
        },
      },
      required: ['version'],
    },
  },

  // System Tools
  {
    name: 'cv_config_get',
    description: 'Get a configuration value from CV-Git config. Supports nested keys with dot notation (e.g., "ai.model").',
    inputSchema: {
      type: 'object',
      properties: {
        key: {
          type: 'string',
          description: 'Configuration key to retrieve (use dot notation for nested keys)',
        },
      },
      required: ['key'],
    },
  },
  {
    name: 'cv_status',
    description: 'Get comprehensive status of CV-Git repository including git status, CV-Git initialization, and service health.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'cv_doctor',
    description: 'Run comprehensive diagnostics to check CV-Git setup, dependencies, services, and configuration.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },

  // PRD Integration Tools
  {
    name: 'cv_prd_context',
    description: 'Get unified PRD context for AI including requirements, test cases, documentation, and designs. Returns comprehensive context for understanding what to build and how it should be tested.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Natural language query to find relevant PRD artifacts',
        },
        prdId: {
          type: 'string',
          description: 'Optional PRD ID to filter results',
        },
        includeTypes: {
          type: 'array',
          items: { type: 'string' },
          description: 'Artifact types to include (requirement, test_case, documentation, etc.)',
        },
        depth: {
          type: 'number',
          description: 'Graph traversal depth for related artifacts',
          default: 3,
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'cv_requirement_trace',
    description: 'Get full traceability for a requirement: dependencies, tests, documentation, designs, and code implementations.',
    inputSchema: {
      type: 'object',
      properties: {
        chunkId: {
          type: 'string',
          description: 'Requirement chunk ID to trace',
        },
        depth: {
          type: 'number',
          description: 'Graph traversal depth',
          default: 3,
        },
      },
      required: ['chunkId'],
    },
  },
  {
    name: 'cv_test_coverage',
    description: 'Get test coverage metrics for a PRD. Shows how many requirements have test cases.',
    inputSchema: {
      type: 'object',
      properties: {
        prdId: {
          type: 'string',
          description: 'PRD ID to get coverage for',
        },
      },
      required: ['prdId'],
    },
  },
  {
    name: 'cv_doc_coverage',
    description: 'Get documentation coverage metrics for a PRD. Shows how many requirements are documented.',
    inputSchema: {
      type: 'object',
      properties: {
        prdId: {
          type: 'string',
          description: 'PRD ID to get coverage for',
        },
      },
      required: ['prdId'],
    },
  },

  // Documentation Knowledge Graph Tools
  {
    name: 'cv_docs_search',
    description: 'Search documentation in the knowledge graph using semantic search. Includes both active and archived documents. Use this to find design docs, historical decisions, and project documentation.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query in natural language (e.g., "authentication design", "sync strategy")',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results to return',
          default: 10,
        },
        minScore: {
          type: 'number',
          description: 'Minimum similarity score (0-1)',
          default: 0.5,
        },
        type: {
          type: 'string',
          description: 'Filter by document type (e.g., "design_spec", "readme", "guide", "api_doc")',
        },
        archivedOnly: {
          type: 'boolean',
          description: 'Only return results from archived documents',
          default: false,
        },
        activeOnly: {
          type: 'boolean',
          description: 'Only return results from active (non-archived) documents',
          default: false,
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'cv_docs_ingest',
    description: 'Ingest a markdown document into the knowledge graph. Creates document nodes, relationships, and vector embeddings for semantic search. Use this to add new documentation or update existing docs.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Relative path for the document (e.g., "docs/DESIGN.md")',
        },
        content: {
          type: 'string',
          description: 'Full markdown content of the document',
        },
        archive: {
          type: 'boolean',
          description: 'Store only in .cv/documents/ (not in repo filesystem)',
          default: false,
        },
        frontmatter: {
          type: 'object',
          description: 'Optional YAML frontmatter fields (type, status, tags, relates_to)',
        },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'cv_docs_list',
    description: 'List documents in the knowledge graph. Shows document paths, titles, types, and archived status.',
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          description: 'Filter by document type',
        },
        archived: {
          type: 'boolean',
          description: 'Filter by archived status (true=archived only, false=active only, omit for all)',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of documents to return',
          default: 50,
        },
      },
    },
  },

  // AI Commit Message Generation Tools
  {
    name: 'cv_commit_analyze',
    description: 'Analyze staged git changes using AI and knowledge graph. Returns structured information about files changed, symbols added/modified/deleted, breaking changes detected, and suggested commit type/scope.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'cv_commit_generate',
    description: 'Generate a conventional commit message from staged changes using AI analysis. Uses knowledge graph to detect breaking changes and affected callers. Returns a ready-to-use commit message.',
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          description: 'Override commit type (feat, fix, refactor, docs, test, chore, style, perf, build, ci)',
        },
        scope: {
          type: 'string',
          description: 'Override commit scope (e.g., "auth", "api", "ui")',
        },
      },
    },
  },
];

/**
 * Create and configure the MCP server
 */
const server = new Server(
  {
    name: 'cv-git',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
      resources: {},
    },
  }
);

/**
 * Handle list tools request
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools };
});

/**
 * Handle list resources request
 */
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  resourceLogger.debug('Listing resources');
  const resources = listResources();
  resourceLogger.info('Resources listed', { count: resources.length });
  return { resources };
});

/**
 * Handle read resource request
 */
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params;
  resourceLogger.debug('Reading resource', { uri });
  const start = Date.now();

  try {
    const content = await readResource(uri);
    const duration = Date.now() - start;
    resourceLogger.info('Resource read', { uri, duration });
    return {
      contents: [content],
    };
  } catch (error: any) {
    const duration = Date.now() - start;
    resourceLogger.error('Resource read failed', { uri, duration, error: error.message });
    return {
      contents: [{
        uri,
        mimeType: 'application/json',
        text: JSON.stringify({ error: error.message }),
      }],
    };
  }
});

/**
 * Handle tool call request
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  toolLogger.debug('Tool call received', { tool: name, args: Object.keys(args || {}) });
  const start = Date.now();

  try {
    let result: ToolResult;

    switch (name) {
      // Code Understanding
      case 'cv_find':
        validateArgs(args, ['query']);
        result = await handleFind(args as unknown as FindArgs);
        break;

      case 'cv_context':
        validateArgs(args, ['query']);
        result = await handleContext(args as unknown as ContextArgs);
        break;

      case 'cv_auto_context':
        validateArgs(args, ['query']);
        result = await handleAutoContext(args as unknown as AutoContextArgs);
        break;

      case 'cv_explain':
        validateArgs(args, ['target']);
        result = await handleExplain(args as unknown as ExplainArgs);
        break;

      case 'cv_graph_query':
        validateArgs(args, ['queryType']);
        result = await handleGraphQuery(args as unknown as GraphQueryArgs);
        break;

      case 'cv_graph_stats':
        result = await handleGraphStats();
        break;

      case 'cv_graph_inspect':
        validateArgs(args, ['target']);
        result = await handleGraphInspect(args as { target: string });
        break;

      case 'cv_graph_path':
        validateArgs(args, ['from', 'to']);
        result = await handleGraphPath(args as { from: string; to: string; maxDepth?: number });
        break;

      case 'cv_graph_dead_code':
        result = await handleGraphDeadCode();
        break;

      case 'cv_graph_complexity':
        result = await handleGraphComplexity(args as { threshold?: number; limit?: number });
        break;

      case 'cv_graph_cycles':
        result = await handleGraphCycles(args as { maxDepth?: number });
        break;

      case 'cv_graph_hotspots':
        result = await handleGraphHotspots(args as { limit?: number });
        break;

      // Version-Aware Tools
      case 'cv_commits':
        result = await handleCommits(args as unknown as CommitsArgs);
        break;

      case 'cv_file_history':
        validateArgs(args, ['file']);
        result = await handleFileHistory(args as unknown as FileHistoryArgs);
        break;

      case 'cv_blame':
        validateArgs(args, ['target']);
        result = await handleBlame(args as unknown as BlameArgs);
        break;

      // Code Modification
      case 'cv_do':
        validateArgs(args, ['task']);
        result = await handleDo(args as unknown as DoArgs);
        break;

      case 'cv_review':
        result = await handleReview(args as unknown as ReviewArgs);
        break;

      case 'cv_sync':
        result = await handleSync(args as unknown as SyncArgs);
        break;

      // Platform Integration
      case 'cv_pr_create':
        result = await handlePRCreate(args as any);
        break;

      case 'cv_pr_list':
        result = await handlePRList(args as any);
        break;

      case 'cv_pr_review':
        validateArgs(args, ['number']);
        result = await handlePRReview(args as any);
        break;

      case 'cv_release_create':
        validateArgs(args, ['version']);
        result = await handleReleaseCreate(args as any);
        break;

      // System Operations
      case 'cv_config_get':
        validateArgs(args, ['key']);
        result = await handleConfigGet(args as any);
        break;

      case 'cv_status':
        result = await handleStatus();
        break;

      case 'cv_doctor':
        result = await handleDoctor();
        break;

      // PRD Integration Tools
      case 'cv_prd_context':
        validateArgs(args, ['query']);
        result = await handlePRDContext(args as unknown as PRDContextArgs);
        break;

      case 'cv_requirement_trace':
        validateArgs(args, ['chunkId']);
        result = await handleRequirementTrace(args as unknown as RequirementTraceArgs);
        break;

      case 'cv_test_coverage':
        validateArgs(args, ['prdId']);
        result = await handleTestCoverage(args as unknown as CoverageArgs);
        break;

      case 'cv_doc_coverage':
        validateArgs(args, ['prdId']);
        result = await handleDocCoverage(args as unknown as CoverageArgs);
        break;

      // Documentation Knowledge Graph Tools
      case 'cv_docs_search':
        validateArgs(args, ['query']);
        result = await handleDocsSearch(args as unknown as DocsSearchArgs);
        break;

      case 'cv_docs_ingest':
        validateArgs(args, ['path', 'content']);
        result = await handleDocsIngest(args as unknown as DocsIngestArgs);
        break;

      case 'cv_docs_list':
        result = await handleDocsList(args as unknown as DocsListArgs);
        break;

      // AI Commit Message Generation
      case 'cv_commit_analyze':
        result = await handleCommitAnalyze(args as unknown as CommitAnalyzeArgs);
        break;

      case 'cv_commit_generate':
        result = await handleCommitGenerate(args as unknown as CommitGenerateArgs);
        break;

      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    // Return MCP-compliant result
    const duration = Date.now() - start;
    toolLogger.info('Tool call completed', { tool: name, duration, isError: result.isError });
    return {
      content: result.content,
      isError: result.isError
    };
  } catch (error: any) {
    const duration = Date.now() - start;
    toolLogger.error('Tool call failed', { tool: name, duration, error: error.message });
    const errResult = errorResult(`Failed to execute ${name}`, error);
    return {
      content: errResult.content,
      isError: true
    };
  }
});

/**
 * Handle errors
 */
server.onerror = (error) => {
  serverLogger.error('MCP protocol error', { error: String(error) });
};

process.on('SIGINT', async () => {
  serverLogger.info('Shutting down');
  await server.close();
  process.exit(0);
});

/**
 * Start the server
 */
async function main() {
  serverLogger.info('Starting CV-Git MCP Server', {
    logLevel: process.env.CV_LOG_LEVEL || 'info',
    debug: !!process.env.CV_DEBUG
  });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  serverLogger.info('Server connected via stdio');
}

main().catch((error) => {
  serverLogger.error('Fatal startup error', { error: error.message });
  process.exit(1);
});
