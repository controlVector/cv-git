/**
 * Unit tests for Graph MCP Tool Handlers
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Use vi.hoisted to create mock functions that are available during mock hoisting
const {
  mockFindRepoRoot,
  mockConfigManagerLoad,
  mockCreateGraphManager,
  mockCreateGraphService,
  mockLoadCodebaseSummary,
  mockGraphManager,
  mockGraphService
} = vi.hoisted(() => {
  const mockGraphManager = {
    connect: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    query: vi.fn().mockResolvedValue([])
  };

  const mockGraphService = {
    getNeighborhood: vi.fn(),
    getImpactAnalysis: vi.fn(),
    findBridge: vi.fn()
  };

  return {
    mockFindRepoRoot: vi.fn(),
    mockConfigManagerLoad: vi.fn(),
    mockCreateGraphManager: vi.fn().mockReturnValue(mockGraphManager),
    mockCreateGraphService: vi.fn().mockReturnValue(mockGraphService),
    mockLoadCodebaseSummary: vi.fn(),
    mockGraphManager,
    mockGraphService
  };
});

// Mock all external dependencies
vi.mock('@cv-git/core', () => ({
  configManager: {
    load: mockConfigManagerLoad
  },
  createGraphManager: mockCreateGraphManager,
  createGraphService: mockCreateGraphService,
  loadCodebaseSummary: mockLoadCodebaseSummary
}));

vi.mock('@cv-git/shared', () => ({
  findRepoRoot: mockFindRepoRoot
}));

// Import handlers after mocks are set up
import {
  handleGraphNeighborhood,
  handleGraphImpact,
  handleGraphBridge,
  handleSummaryView
} from './graph.js';

describe('Graph MCP Tool Handlers', () => {
  const mockSummary = {
    version: '1.0.0',
    generatedAt: '2024-01-01T00:00:00.000Z',
    stats: {
      totalFiles: 100,
      totalSymbols: 500,
      totalFunctions: 300,
      totalClasses: 50,
      languages: { typescript: 80, javascript: 20 }
    },
    architecture: {
      entryPoints: ['src/index.ts'],
      coreModules: [
        { name: 'core', path: 'src/core', fileCount: 20, symbolCount: 100, primaryLanguage: 'typescript', keyExports: ['main'] }
      ],
      patterns: ['Layered Architecture', 'Repository Pattern'],
      layers: ['api', 'services', 'data']
    },
    conventions: {
      naming: ['camelCase for functions'],
      fileStructure: ['feature-based folders'],
      testing: ['co-located tests']
    },
    abstractions: {
      interfaces: [{ name: 'IService', file: 'types.ts', description: '', implementors: [] }],
      baseClasses: [],
      utilities: []
    },
    dependencies: {
      external: ['lodash', 'express'],
      hotspots: ['handleRequest (10 callers)'],
      potentialIssues: []
    },
    naturalLanguageSummary: 'A TypeScript codebase with layered architecture.'
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Set up default mock implementations
    mockFindRepoRoot.mockResolvedValue('/test/repo');
    mockConfigManagerLoad.mockResolvedValue({
      graph: { url: 'redis://localhost:6379', database: 'cv_test' }
    });
    mockCreateGraphManager.mockReturnValue(mockGraphManager);
    mockCreateGraphService.mockReturnValue(mockGraphService);
    mockLoadCodebaseSummary.mockResolvedValue(mockSummary);

    // Set up graph service mock defaults
    mockGraphService.getNeighborhood.mockResolvedValue({
      center: {
        name: 'testFunc',
        type: 'function',
        file: 'test.ts',
        line: 10
      },
      nodes: [
        {
          name: 'callerFunc',
          type: 'function',
          file: 'caller.ts',
          relationship: 'CALLS',
          direction: 'incoming',
          distance: 1,
          line: 5
        }
      ],
      summary: {
        totalNodes: 1,
        byType: { function: 1 },
        byRelationship: { CALLS: 1 }
      }
    });

    mockGraphService.getImpactAnalysis.mockResolvedValue({
      target: {
        name: 'testFunc',
        type: 'function',
        file: 'test.ts'
      },
      directCallers: [
        { name: 'caller1', kind: 'function', file: 'caller.ts' }
      ],
      indirectCallers: [],
      implementors: [],
      extenders: [],
      affectedFiles: ['caller.ts'],
      totalImpact: 1,
      riskLevel: 'low',
      riskExplanation: 'Low impact - only 1 direct caller'
    });

    mockGraphService.findBridge.mockResolvedValue({
      source: { name: 'funcA', kind: 'function', file: 'a.ts' },
      target: { name: 'funcB', kind: 'function', file: 'b.ts' },
      directConnection: false,
      connections: [
        {
          path: ['funcA', 'middleware', 'funcB'],
          relationshipTypes: ['CALLS', 'CALLS'],
          length: 2
        }
      ],
      explanation: 'funcA connects to funcB through middleware'
    });
  });

  describe('handleGraphNeighborhood', () => {
    it('should return neighborhood for a symbol', async () => {
      const result = await handleGraphNeighborhood({
        symbol: 'testFunc',
        depth: 2,
        direction: 'both'
      });

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain('Neighborhood of "testFunc"');
      expect(result.content[0].text).toContain('callerFunc');
    });

    it('should handle missing symbol gracefully', async () => {
      mockGraphService.getNeighborhood.mockResolvedValueOnce({
        center: { name: 'unknown', type: 'function', file: 'unknown.ts' },
        nodes: [],
        summary: { totalNodes: 0, byType: {}, byRelationship: {} }
      });

      const result = await handleGraphNeighborhood({
        symbol: 'unknown',
        depth: 2
      });

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain('no neighbors');
    });

    it('should use default depth when not specified', async () => {
      const result = await handleGraphNeighborhood({
        symbol: 'testFunc'
      });

      expect(result.isError).toBeFalsy();
    });
  });

  describe('handleGraphImpact', () => {
    it('should return impact analysis for a symbol', async () => {
      const result = await handleGraphImpact({
        symbol: 'testFunc',
        depth: 3
      });

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain('Impact Analysis');
      expect(result.content[0].text).toContain('Risk Level');
      expect(result.content[0].text).toContain('Direct Callers');
    });

    it('should display risk level with appropriate indicator', async () => {
      const result = await handleGraphImpact({
        symbol: 'testFunc'
      });

      expect(result.content[0].text).toContain('LOW');
    });

    it('should use default depth when not specified', async () => {
      const result = await handleGraphImpact({
        symbol: 'testFunc'
      });

      expect(result.isError).toBeFalsy();
    });
  });

  describe('handleGraphBridge', () => {
    it('should find bridge between two symbols', async () => {
      const result = await handleGraphBridge({
        source: 'funcA',
        target: 'funcB',
        maxDepth: 5
      });

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain('Bridge Analysis');
      expect(result.content[0].text).toContain('funcA');
      expect(result.content[0].text).toContain('funcB');
      expect(result.content[0].text).toContain('middleware');
    });

    it('should indicate when no direct connection exists', async () => {
      const result = await handleGraphBridge({
        source: 'funcA',
        target: 'funcB'
      });

      expect(result.content[0].text).toContain('No direct connection');
    });

    it('should use default maxDepth when not specified', async () => {
      const result = await handleGraphBridge({
        source: 'funcA',
        target: 'funcB'
      });

      expect(result.isError).toBeFalsy();
    });
  });

  describe('handleSummaryView', () => {
    it('should return overview by default', async () => {
      const result = await handleSummaryView({});

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain('Codebase Overview');
      expect(result.content[0].text).toContain('TypeScript codebase');
    });

    it('should return architecture aspect', async () => {
      const result = await handleSummaryView({
        aspect: 'architecture'
      });

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain('Architecture');
      expect(result.content[0].text).toContain('Entry Points');
      expect(result.content[0].text).toContain('Core Modules');
    });

    it('should return patterns aspect', async () => {
      const result = await handleSummaryView({
        aspect: 'patterns'
      });

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain('Patterns');
      expect(result.content[0].text).toContain('Layered Architecture');
    });

    it('should return statistics aspect', async () => {
      const result = await handleSummaryView({
        aspect: 'statistics'
      });

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain('Statistics');
      expect(result.content[0].text).toContain('Total Files');
      expect(result.content[0].text).toContain('100');
    });

    it('should handle missing summary gracefully', async () => {
      mockLoadCodebaseSummary.mockResolvedValueOnce(null);

      const result = await handleSummaryView({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('No codebase summary found');
    });

    it('should handle invalid aspect', async () => {
      const result = await handleSummaryView({
        aspect: 'invalid'
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text?.toLowerCase()).toMatch(/unknown|invalid/);
    });
  });

  describe('error handling', () => {
    it('should handle repository not found', async () => {
      mockFindRepoRoot.mockResolvedValueOnce(null);

      const result = await handleSummaryView({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Not in a CV-Git repository');
    });

    it('should handle errors gracefully', async () => {
      mockLoadCodebaseSummary.mockRejectedValueOnce(new Error('Failed to load'));

      const result = await handleSummaryView({});

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text?.toLowerCase()).toMatch(/failed|error/);
    });
  });
});
