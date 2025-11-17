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
  Tool,
} from '@modelcontextprotocol/sdk/types.js';

import {
  FindArgs,
  ExplainArgs,
  GraphQueryArgs,
  DoArgs,
  ReviewArgs,
  SyncArgs,
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
import { handleGraphQuery, handleGraphStats, handleGraphInspect } from './tools/graph.js';
import { handleDo, handleReview } from './tools/modify.js';
import { handleSync } from './tools/sync.js';

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
 * Handle tool call request
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let result: ToolResult;

    switch (name) {
      // Code Understanding
      case 'cv_find':
        validateArgs(args, ['query']);
        result = await handleFind(args as unknown as FindArgs);
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

      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    // Return MCP-compliant result
    return {
      content: result.content,
      isError: result.isError
    };
  } catch (error: any) {
    console.error(`Error in tool ${name}:`, error);
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
  console.error('[MCP Error]', error);
};

process.on('SIGINT', async () => {
  await server.close();
  process.exit(0);
});

/**
 * Start the server
 */
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('CV-Git MCP Server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
