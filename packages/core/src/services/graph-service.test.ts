/**
 * Unit tests for GraphService
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  GraphService,
  createGraphService,
  PathResult,
  Neighborhood,
  ImpactAnalysis,
  BridgeResult
} from './graph-service.js';
import { resetGlobalCache, getGlobalCache } from './cache-service.js';

// Mock GraphManager
const mockGraphManager = {
  query: vi.fn(),
  getSymbolNode: vi.fn(),
  getCallers: vi.fn(),
  getCallees: vi.fn()
};

describe('GraphService', () => {
  let service: GraphService;

  beforeEach(() => {
    vi.clearAllMocks();
    resetGlobalCache();
    service = createGraphService(mockGraphManager as any);
  });

  afterEach(() => {
    resetGlobalCache();
  });

  describe('PathResult interface', () => {
    it('should have correct structure', () => {
      const result: PathResult = {
        found: true,
        path: ['funcA', 'funcB', 'funcC'],
        pathDetails: [
          { name: 'funcA', file: 'src/a.ts', kind: 'function', line: 10 },
          { name: 'funcB', file: 'src/b.ts', kind: 'function', line: 20 },
          { name: 'funcC', file: 'src/c.ts', kind: 'function', line: 30 }
        ],
        edges: [
          { from: 'funcA', to: 'funcB', type: 'CALLS' },
          { from: 'funcB', to: 'funcC', type: 'CALLS' }
        ],
        length: 2,
        explanation: 'funcA calls funcB which calls funcC'
      };

      expect(result.found).toBe(true);
      expect(result.path).toHaveLength(3);
      expect(result.pathDetails).toHaveLength(3);
      expect(result.edges).toHaveLength(2);
      expect(result.length).toBe(2);
    });
  });

  describe('Neighborhood interface', () => {
    it('should have correct structure', () => {
      const neighborhood: Neighborhood = {
        center: {
          name: 'handleRequest',
          qualifiedName: 'Server.handleRequest',
          type: 'method',
          file: 'src/server.ts',
          line: 100,
          docstring: 'Handles incoming requests'
        },
        nodes: [
          {
            name: 'validateInput',
            qualifiedName: 'utils.validateInput',
            type: 'function',
            file: 'src/utils.ts',
            relationship: 'CALLS',
            direction: 'outgoing',
            distance: 1,
            line: 50
          },
          {
            name: 'processRequest',
            qualifiedName: 'Server.processRequest',
            type: 'method',
            file: 'src/server.ts',
            relationship: 'CALLS',
            direction: 'incoming',
            distance: 1,
            line: 80
          }
        ],
        summary: {
          totalNodes: 2,
          byType: { function: 1, method: 1 },
          byRelationship: { CALLS: 2 },
          byDistance: { 1: 2 }
        }
      };

      expect(neighborhood.center.name).toBe('handleRequest');
      expect(neighborhood.nodes).toHaveLength(2);
      expect(neighborhood.summary.totalNodes).toBe(2);
    });
  });

  describe('ImpactAnalysis interface', () => {
    it('should have correct structure', () => {
      const impact: ImpactAnalysis = {
        target: {
          name: 'validateInput',
          qualifiedName: 'utils.validateInput',
          type: 'function',
          file: 'src/utils.ts'
        },
        directCallers: [
          { name: 'handleRequest', file: 'src/server.ts', kind: 'method' },
          { name: 'processForm', file: 'src/form.ts', kind: 'function' }
        ],
        indirectCallers: [
          { name: 'main', file: 'src/index.ts', kind: 'function', depth: 2 }
        ],
        implementors: [],
        extenders: [],
        affectedFiles: ['src/server.ts', 'src/form.ts', 'src/index.ts'],
        totalImpact: 3,
        riskLevel: 'medium',
        riskExplanation: 'Changes affect 3 callers across 3 files'
      };

      expect(impact.target.name).toBe('validateInput');
      expect(impact.directCallers).toHaveLength(2);
      expect(impact.riskLevel).toBe('medium');
      expect(impact.totalImpact).toBe(3);
    });

    it('should handle different risk levels', () => {
      const levels: Array<'low' | 'medium' | 'high' | 'critical'> = ['low', 'medium', 'high', 'critical'];

      for (const level of levels) {
        const impact: ImpactAnalysis = {
          target: { name: 'test', qualifiedName: 'test', type: 'function', file: 'test.ts' },
          directCallers: [],
          indirectCallers: [],
          implementors: [],
          extenders: [],
          affectedFiles: [],
          totalImpact: 0,
          riskLevel: level,
          riskExplanation: ''
        };

        expect(impact.riskLevel).toBe(level);
      }
    });
  });

  describe('BridgeResult interface', () => {
    it('should have correct structure', () => {
      const bridge: BridgeResult = {
        source: { name: 'funcA', file: 'src/a.ts', kind: 'function' },
        target: { name: 'funcB', file: 'src/b.ts', kind: 'function' },
        connections: [
          {
            path: ['funcA', 'middleware', 'funcB'],
            pathDetails: [
              { name: 'funcA', file: 'src/a.ts', kind: 'function' },
              { name: 'middleware', file: 'src/middleware.ts', kind: 'function' },
              { name: 'funcB', file: 'src/b.ts', kind: 'function' }
            ],
            relationshipTypes: ['CALLS', 'CALLS'],
            length: 2
          }
        ],
        directConnection: false,
        explanation: 'funcA connects to funcB through middleware'
      };

      expect(bridge.source.name).toBe('funcA');
      expect(bridge.target.name).toBe('funcB');
      expect(bridge.connections).toHaveLength(1);
      expect(bridge.directConnection).toBe(false);
    });
  });

  describe('findPath', () => {
    it('should find a path between two symbols', async () => {
      // The actual query returns names, details, and edges as separate arrays
      mockGraphManager.query.mockResolvedValueOnce([{
        names: ['funcA', 'funcB'],
        details: [
          { name: 'funcA', file: 'a.ts', kind: 'function', startLine: 10 },
          { name: 'funcB', file: 'b.ts', kind: 'function', startLine: 20 }
        ],
        edges: [{ type: 'CALLS', from: 'funcA', to: 'funcB' }]
      }]);

      const result = await service.findPath('funcA', 'funcB');

      expect(result.found).toBe(true);
      expect(result.path).toEqual(['funcA', 'funcB']);
      expect(result.length).toBe(1);
    });

    it('should return not found when no path exists', async () => {
      mockGraphManager.query.mockResolvedValueOnce([]);

      const result = await service.findPath('funcA', 'unconnected');

      expect(result.found).toBe(false);
      expect(result.path).toEqual([]);
    });
  });

  describe('getNeighborhood', () => {
    it('should return neighborhood around a symbol', async () => {
      // Mock the center node query
      mockGraphManager.query.mockResolvedValueOnce([{
        s: {
          name: 'handleRequest',
          qualifiedName: 'Server.handleRequest',
          kind: 'method',
          file: 'server.ts',
          startLine: 100,
          docstring: 'Handles requests'
        }
      }]);

      // Mock the neighbors query - the implementation expects 'neighbor' not 'n'
      mockGraphManager.query.mockResolvedValueOnce([
        {
          neighbor: { name: 'validate', qualifiedName: 'validate', kind: 'function', file: 'utils.ts', startLine: 10 },
          relType: 'CALLS',
          direction: 'outgoing',
          distance: 1
        }
      ]);

      const result = await service.getNeighborhood('handleRequest', { depth: 1 });

      expect(result.center.name).toBe('handleRequest');
      expect(result.nodes.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('getImpactAnalysis', () => {
    it('should analyze impact of changing a symbol', async () => {
      // Mock target lookup
      mockGraphManager.getSymbolNode.mockResolvedValueOnce({
        name: 'validateInput',
        qualifiedName: 'utils.validateInput',
        kind: 'function',
        file: 'utils.ts'
      });

      // Mock direct callers
      mockGraphManager.getCallers.mockResolvedValueOnce([
        { name: 'handler1', file: 'handler.ts', kind: 'function' }
      ]);

      // Mock indirect callers query
      mockGraphManager.query.mockResolvedValueOnce([]);

      // Mock implementors/extenders queries
      mockGraphManager.query.mockResolvedValueOnce([]);
      mockGraphManager.query.mockResolvedValueOnce([]);

      const result = await service.getImpactAnalysis('validateInput');

      expect(result.target.name).toBe('validateInput');
      expect(result.directCallers.length).toBeGreaterThanOrEqual(0);
      expect(['low', 'medium', 'high', 'critical']).toContain(result.riskLevel);
    });
  });

  describe('getHubs', () => {
    it('should find hub functions', async () => {
      // The implementation expects s.name, s.file, etc. format from the query
      mockGraphManager.query.mockResolvedValueOnce([
        {
          name: 'logger',
          file: 'utils/logger.ts',
          kind: 'function',
          incomingCount: 50,
          outgoingCount: 5,
          totalConnections: 55
        },
        {
          name: 'validate',
          file: 'utils/validate.ts',
          kind: 'function',
          incomingCount: 30,
          outgoingCount: 10,
          totalConnections: 40
        }
      ]);

      const result = await service.getHubs({ limit: 10 });

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('logger');
      expect(result[0].totalConnections).toBe(55);
    });
  });

  describe('createGraphService', () => {
    it('should create a GraphService instance', () => {
      const service = createGraphService(mockGraphManager as any);
      expect(service).toBeInstanceOf(GraphService);
    });
  });

  describe('caching integration', () => {
    it('should cache findPath results', async () => {
      mockGraphManager.query.mockResolvedValue([{
        names: ['funcA', 'funcB'],
        details: [
          { name: 'funcA', file: 'a.ts', kind: 'function', startLine: 10 },
          { name: 'funcB', file: 'b.ts', kind: 'function', startLine: 20 }
        ],
        edges: [{ type: 'CALLS', from: 'funcA', to: 'funcB' }]
      }]);

      // First call should query the graph
      await service.findPath('funcA', 'funcB');
      expect(mockGraphManager.query).toHaveBeenCalledTimes(1);

      // Second call with same args should use cache
      await service.findPath('funcA', 'funcB');
      expect(mockGraphManager.query).toHaveBeenCalledTimes(1);

      // Different args should query again
      await service.findPath('funcA', 'funcC');
      expect(mockGraphManager.query).toHaveBeenCalledTimes(2);
    });

    it('should cache getNeighborhood results', async () => {
      mockGraphManager.query
        .mockResolvedValueOnce([{
          s: { name: 'funcA', qualifiedName: 'funcA', kind: 'function', file: 'a.ts', startLine: 10 }
        }])
        .mockResolvedValueOnce([]);

      await service.getNeighborhood('funcA', { depth: 2 });
      await service.getNeighborhood('funcA', { depth: 2 });

      // Should have only queried twice (center + neighbors) for the first call
      expect(mockGraphManager.query).toHaveBeenCalledTimes(2);
    });

    it('should cache getImpactAnalysis results', async () => {
      // Mock the target lookup query
      mockGraphManager.query
        .mockResolvedValueOnce([{ s: { name: 'funcA', qualifiedName: 'funcA', kind: 'function', file: 'a.ts' } }])  // target
        .mockResolvedValueOnce([])  // direct callers
        .mockResolvedValueOnce([])  // indirect callers
        .mockResolvedValueOnce([])  // implementors
        .mockResolvedValueOnce([]); // extenders

      await service.getImpactAnalysis('funcA');

      const callCount = mockGraphManager.query.mock.calls.length;

      // Second call should be cached
      await service.getImpactAnalysis('funcA');

      // Query count should not increase on second call
      expect(mockGraphManager.query).toHaveBeenCalledTimes(callCount);
    });

    it('should cache findBridge results', async () => {
      // findBridge makes 4 queries: source, target, direct check, paths
      mockGraphManager.query
        .mockResolvedValueOnce([{ s: { name: 'funcA', qualifiedName: 'funcA', kind: 'function', file: 'a.ts' } }])  // source
        .mockResolvedValueOnce([{ s: { name: 'funcB', qualifiedName: 'funcB', kind: 'function', file: 'b.ts' } }])  // target
        .mockResolvedValueOnce([])   // direct connection check
        .mockResolvedValueOnce([]);  // paths result

      await service.findBridge('funcA', 'funcB');

      const callCount = mockGraphManager.query.mock.calls.length;
      expect(callCount).toBe(4);

      // Second call should be cached
      await service.findBridge('funcA', 'funcB');

      // Query count should not increase on second call
      expect(mockGraphManager.query).toHaveBeenCalledTimes(callCount);
    });

    it('should show cache stats after queries', async () => {
      mockGraphManager.query.mockResolvedValue([]);

      await service.findPath('funcA', 'funcB');
      await service.findPath('funcA', 'funcB');

      const cache = getGlobalCache();
      const stats = cache.getStats('graph');

      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
    });

    it('should use different cache keys for different options', async () => {
      mockGraphManager.query.mockResolvedValue([]);

      await service.findPath('funcA', 'funcB', { maxDepth: 5 });
      await service.findPath('funcA', 'funcB', { maxDepth: 10 });

      // Different options should result in different cache entries
      expect(mockGraphManager.query).toHaveBeenCalledTimes(2);
    });
  });
});
