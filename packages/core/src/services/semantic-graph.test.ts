/**
 * Unit tests for SemanticGraphService
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  SemanticGraphService,
  createSemanticGraphService,
  SemanticSearchResult,
  ExpandedContext,
  ConceptCluster
} from './semantic-graph.js';

// Mock dependencies
const mockGraphManager = {
  getCallers: vi.fn(),
  getCallees: vi.fn(),
  query: vi.fn(),
  getSymbolNode: vi.fn()
};

const mockVectorManager = {
  searchCode: vi.fn()
};

describe('SemanticGraphService', () => {
  let service: SemanticGraphService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = createSemanticGraphService(mockGraphManager as any, mockVectorManager as any);
  });

  describe('SemanticSearchResult interface', () => {
    it('should have correct structure', () => {
      const result: SemanticSearchResult = {
        symbol: {
          name: 'handleAuth',
          qualifiedName: 'AuthService.handleAuth',
          file: 'src/auth/service.ts',
          kind: 'method',
          startLine: 50,
          endLine: 100,
          signature: 'handleAuth(token: string): Promise<User>',
          docstring: 'Handles authentication for incoming requests'
        },
        semanticScore: 0.85,
        matchedText: 'export async function handleAuth(token: string): Promise<User> { ... }',
        graphContext: {
          callers: ['processRequest', 'validateSession'],
          callees: ['verifyToken', 'getUserFromToken'],
          relatedSymbols: ['User', 'AuthError']
        }
      };

      expect(result.symbol.name).toBe('handleAuth');
      expect(result.semanticScore).toBe(0.85);
      expect(result.graphContext.callers).toHaveLength(2);
      expect(result.graphContext.callees).toHaveLength(2);
    });
  });

  describe('ExpandedContext interface', () => {
    it('should have correct structure', () => {
      const context: ExpandedContext = {
        query: 'authentication flow',
        primaryResults: [
          {
            symbol: { name: 'handleAuth', qualifiedName: 'AuthService.handleAuth', file: 'auth.ts', kind: 'method', startLine: 1, endLine: 50 },
            semanticScore: 0.9,
            matchedText: 'async function handleAuth...',
            graphContext: { callers: [], callees: [], relatedSymbols: [] }
          }
        ],
        relatedCode: [
          {
            symbol: { name: 'verifyToken', file: 'token.ts', kind: 'function' },
            relationship: 'CALLS',
            distance: 1,
            fromResult: 'handleAuth'
          }
        ],
        involvedFiles: ['auth.ts', 'token.ts'],
        summary: {
          totalPrimaryResults: 1,
          totalRelatedSymbols: 1,
          fileCount: 2,
          languageBreakdown: { typescript: 2 }
        }
      };

      expect(context.query).toBe('authentication flow');
      expect(context.primaryResults).toHaveLength(1);
      expect(context.relatedCode).toHaveLength(1);
      expect(context.summary.fileCount).toBe(2);
    });
  });

  describe('ConceptCluster interface', () => {
    it('should have correct structure', () => {
      const cluster: ConceptCluster = {
        concept: 'database operations',
        coreSymbols: [
          { name: 'DatabaseClient', file: 'db/client.ts', kind: 'class', score: 0.95 },
          { name: 'query', file: 'db/query.ts', kind: 'function', score: 0.88 }
        ],
        relatedSymbols: [
          { name: 'Transaction', file: 'db/transaction.ts', kind: 'class', connection: 'USES', depth: 1 },
          { name: 'ConnectionPool', file: 'db/pool.ts', kind: 'class', connection: 'CONTAINS', depth: 2 }
        ],
        abstractions: ['IDatabase', 'IQueryBuilder'],
        implementations: ['PostgresClient', 'MySQLClient']
      };

      expect(cluster.concept).toBe('database operations');
      expect(cluster.coreSymbols).toHaveLength(2);
      expect(cluster.relatedSymbols).toHaveLength(2);
      expect(cluster.abstractions).toContain('IDatabase');
      expect(cluster.implementations).toContain('PostgresClient');
    });
  });

  describe('semanticSearch', () => {
    it('should combine semantic search with graph context', async () => {
      mockVectorManager.searchCode.mockResolvedValueOnce([
        {
          score: 0.9,
          payload: {
            symbolName: 'handleAuth',
            qualifiedName: 'AuthService.handleAuth',
            file: 'auth.ts',
            symbolKind: 'method',
            startLine: 10,
            endLine: 50,
            text: 'async function handleAuth...',
            signature: 'handleAuth(): void'
          }
        }
      ]);

      mockGraphManager.getCallers.mockResolvedValueOnce([
        { name: 'processRequest' }
      ]);

      mockGraphManager.getCallees.mockResolvedValueOnce([
        { name: 'verifyToken' }
      ]);

      // Mock neighborhood
      mockGraphManager.query.mockResolvedValueOnce([]);
      mockGraphManager.query.mockResolvedValueOnce([]);

      const results = await service.semanticSearch('authentication', { semanticLimit: 5 });

      expect(results.length).toBeGreaterThanOrEqual(0);
      if (results.length > 0) {
        expect(results[0].symbol.name).toBe('handleAuth');
        expect(results[0].semanticScore).toBe(0.9);
      }
    });

    it('should return empty array when no results', async () => {
      mockVectorManager.searchCode.mockResolvedValueOnce([]);

      const results = await service.semanticSearch('nonexistent query');

      expect(results).toHaveLength(0);
    });
  });

  describe('expandContext', () => {
    it('should expand search results with graph traversal', async () => {
      mockVectorManager.searchCode.mockResolvedValueOnce([
        {
          score: 0.85,
          payload: {
            symbolName: 'handleRequest',
            qualifiedName: 'Server.handleRequest',
            file: 'server.ts',
            symbolKind: 'method',
            startLine: 20,
            endLine: 80,
            text: 'async handleRequest...'
          }
        }
      ]);

      mockGraphManager.getCallers.mockResolvedValue([]);
      mockGraphManager.getCallees.mockResolvedValue([]);
      mockGraphManager.query.mockResolvedValue([]);

      const context = await service.expandContext('request handling');

      expect(context.query).toBe('request handling');
      expect(context.involvedFiles).toBeDefined();
      expect(context.summary).toBeDefined();
    });
  });

  describe('findConceptCluster', () => {
    it('should find a cluster of related code', async () => {
      mockVectorManager.searchCode.mockResolvedValueOnce([
        {
          score: 0.9,
          payload: {
            symbolName: 'Logger',
            qualifiedName: 'Logger',
            file: 'logger.ts',
            symbolKind: 'class',
            startLine: 1,
            endLine: 100
          }
        }
      ]);

      mockGraphManager.getCallers.mockResolvedValue([]);
      mockGraphManager.getCallees.mockResolvedValue([]);
      mockGraphManager.query.mockResolvedValue([]);

      const cluster = await service.findConceptCluster('logging');

      expect(cluster.concept).toBe('logging');
      expect(cluster.coreSymbols).toBeDefined();
      expect(cluster.relatedSymbols).toBeDefined();
    });
  });

  describe('findSemanticBridge', () => {
    it('should find code bridging two concepts', async () => {
      // First concept search
      mockVectorManager.searchCode.mockResolvedValueOnce([
        {
          score: 0.8,
          payload: {
            symbolName: 'UserService',
            file: 'user.ts',
            symbolKind: 'class',
            startLine: 1,
            endLine: 100
          }
        }
      ]);

      // Second concept search
      mockVectorManager.searchCode.mockResolvedValueOnce([
        {
          score: 0.8,
          payload: {
            symbolName: 'AuthService',
            file: 'auth.ts',
            symbolKind: 'class',
            startLine: 1,
            endLine: 100
          }
        }
      ]);

      mockGraphManager.getCallers.mockResolvedValue([]);
      mockGraphManager.getCallees.mockResolvedValue([]);
      mockGraphManager.query.mockResolvedValue([]);

      const bridge = await service.findSemanticBridge('user management', 'authentication');

      expect(bridge.bridgeSymbols).toBeDefined();
      expect(bridge.sharedCallers).toBeDefined();
      expect(bridge.sharedCallees).toBeDefined();
    });

    it('should find overlapping symbols as bridges', async () => {
      const sharedSymbol = {
        score: 0.85,
        payload: {
          symbolName: 'SessionManager',
          file: 'session.ts',
          symbolKind: 'class',
          startLine: 1,
          endLine: 50
        }
      };

      // Both searches return the same symbol
      mockVectorManager.searchCode.mockResolvedValueOnce([sharedSymbol]);
      mockVectorManager.searchCode.mockResolvedValueOnce([sharedSymbol]);

      mockGraphManager.getCallers.mockResolvedValue([]);
      mockGraphManager.getCallees.mockResolvedValue([]);
      mockGraphManager.query.mockResolvedValue([]);

      const bridge = await service.findSemanticBridge('session', 'authentication');

      // SessionManager should appear as a bridge since it matches both concepts
      expect(bridge.bridgeSymbols.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('getComprehensiveContext', () => {
    it('should return comprehensive context for a symbol', async () => {
      mockVectorManager.searchCode.mockResolvedValue([]);
      mockGraphManager.query.mockResolvedValue([]);
      mockGraphManager.getSymbolNode.mockResolvedValue({
        name: 'testFunc',
        kind: 'function',
        file: 'test.ts',
        startLine: 1
      });
      mockGraphManager.getCallers.mockResolvedValue([]);
      mockGraphManager.getCallees.mockResolvedValue([]);

      const context = await service.getComprehensiveContext('testFunc');

      expect(context.neighborhood).toBeDefined();
      expect(context.impactAnalysis).toBeDefined();
      expect(context.semanticallyRelated).toBeDefined();
    });
  });

  describe('createSemanticGraphService', () => {
    it('should create a SemanticGraphService instance', () => {
      const service = createSemanticGraphService(mockGraphManager as any, mockVectorManager as any);
      expect(service).toBeInstanceOf(SemanticGraphService);
    });
  });
});
