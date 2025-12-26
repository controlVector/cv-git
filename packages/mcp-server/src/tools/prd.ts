/**
 * PRD Integration Tools for MCP Server
 * Provides AI tools for accessing PRD artifacts, traceability, and coverage
 */

import { PRDClient } from '@cv-git/prd-client';
import { ToolResult } from '../types.js';
import { successResult, errorResult } from '../utils.js';

// PRD Client instance (lazy initialized)
let prdClient: PRDClient | null = null;

function getPRDClient(): PRDClient {
  if (!prdClient) {
    // Default to localhost:8000 - cv-prd backend
    const baseUrl = process.env.CVPRD_API_URL || 'http://localhost:8000';
    prdClient = new PRDClient({
      baseUrl,
      timeout: 30000,
    });
  }
  return prdClient;
}

export interface PRDContextArgs {
  query: string;
  prdId?: string;
  includeTypes?: string[];
  depth?: number;
}

export interface RequirementTraceArgs {
  chunkId: string;
  depth?: number;
}

export interface CoverageArgs {
  prdId: string;
}

/**
 * Get unified PRD context for AI
 */
export async function handlePRDContext(args: PRDContextArgs): Promise<ToolResult> {
  try {
    const client = getPRDClient();

    // Check if PRD service is available
    const available = await client.isAvailable();
    if (!available) {
      return errorResult(
        'cv-prd service not available',
        new Error('Could not connect to cv-prd. Make sure it is running at ' + (process.env.CVPRD_API_URL || 'http://localhost:8000'))
      );
    }

    const context = await client.getUnifiedContext(args.query, {
      prdId: args.prdId,
      includeTypes: args.includeTypes as any,
      depth: args.depth || 3,
    });

    // Format for AI consumption
    const formatted = PRDClient.formatUnifiedContextForPrompt(context);

    return successResult(formatted);
  } catch (error: any) {
    return errorResult('Failed to get PRD context', error);
  }
}

/**
 * Get full traceability for a requirement
 */
export async function handleRequirementTrace(args: RequirementTraceArgs): Promise<ToolResult> {
  try {
    const client = getPRDClient();

    const available = await client.isAvailable();
    if (!available) {
      return errorResult(
        'cv-prd service not available',
        new Error('Could not connect to cv-prd')
      );
    }

    const traceability = await client.getFullTraceability(args.chunkId, args.depth || 3);

    // Format traceability for AI
    const parts: string[] = [];

    if (traceability.chunk) {
      parts.push(`## Requirement`);
      parts.push(`**Type:** ${traceability.chunk.chunk_type}`);
      parts.push(`**Text:** ${traceability.chunk.text}`);
      parts.push('');
    }

    if (traceability.dependencies.length > 0) {
      parts.push(`## Dependencies (${traceability.dependencies.length})`);
      for (const dep of traceability.dependencies) {
        parts.push(`- [${dep.chunk_type}] ${dep.text.slice(0, 150)}...`);
      }
      parts.push('');
    }

    if (traceability.tests.length > 0) {
      parts.push(`## Test Cases (${traceability.tests.length})`);
      for (const test of traceability.tests) {
        parts.push(`- [${test.chunk_type}] ${test.text.slice(0, 150)}...`);
      }
      parts.push('');
    }

    if (traceability.documentation.length > 0) {
      parts.push(`## Documentation (${traceability.documentation.length})`);
      for (const doc of traceability.documentation) {
        parts.push(`- [${doc.chunk_type}] ${doc.text.slice(0, 150)}...`);
      }
      parts.push('');
    }

    if (traceability.designs.length > 0) {
      parts.push(`## Designs (${traceability.designs.length})`);
      for (const design of traceability.designs) {
        parts.push(`- [${design.chunk_type}] ${design.text.slice(0, 150)}...`);
      }
      parts.push('');
    }

    if (traceability.implementations.length > 0) {
      parts.push(`## Code Implementations (${traceability.implementations.length})`);
      for (const impl of traceability.implementations) {
        parts.push(`- ${impl.symbols.join(', ')} in ${impl.files.join(', ')}`);
      }
      parts.push('');
    }

    return successResult(parts.join('\n'));
  } catch (error: any) {
    return errorResult('Failed to get requirement traceability', error);
  }
}

/**
 * Get test coverage metrics for a PRD
 */
export async function handleTestCoverage(args: CoverageArgs): Promise<ToolResult> {
  try {
    const client = getPRDClient();

    const available = await client.isAvailable();
    if (!available) {
      return errorResult(
        'cv-prd service not available',
        new Error('Could not connect to cv-prd')
      );
    }

    const coverage = await client.getTestCoverage(args.prdId);

    const parts: string[] = [
      `## Test Coverage for PRD: ${args.prdId}`,
      '',
      `**Coverage:** ${coverage.coverage_percent}%`,
      `**Total Requirements:** ${coverage.total_requirements}`,
      `**Covered Requirements:** ${coverage.covered_requirements}`,
      `**Uncovered Requirements:** ${coverage.uncovered_requirements}`,
      `**Total Tests:** ${coverage.total_tests}`,
    ];

    return successResult(parts.join('\n'));
  } catch (error: any) {
    return errorResult('Failed to get test coverage', error);
  }
}

/**
 * Get documentation coverage metrics for a PRD
 */
export async function handleDocCoverage(args: CoverageArgs): Promise<ToolResult> {
  try {
    const client = getPRDClient();

    const available = await client.isAvailable();
    if (!available) {
      return errorResult(
        'cv-prd service not available',
        new Error('Could not connect to cv-prd')
      );
    }

    const coverage = await client.getDocumentationCoverage(args.prdId);

    const parts: string[] = [
      `## Documentation Coverage for PRD: ${args.prdId}`,
      '',
      `**Coverage:** ${coverage.coverage_percent}%`,
      `**Total Requirements:** ${coverage.total_requirements}`,
      `**Documented Requirements:** ${coverage.covered_requirements}`,
      `**Undocumented Requirements:** ${coverage.uncovered_requirements}`,
      `**Total Documentation Chunks:** ${coverage.total_docs}`,
    ];

    return successResult(parts.join('\n'));
  } catch (error: any) {
    return errorResult('Failed to get documentation coverage', error);
  }
}
