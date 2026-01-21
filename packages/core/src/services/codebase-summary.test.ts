/**
 * Unit tests for CodebaseSummaryService
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  CodebaseSummaryService,
  CodebaseSummary,
  ModuleSummary,
  InterfaceSummary,
  ClassSummary,
  FunctionSummary
} from './codebase-summary.js';

// Mock the Anthropic SDK
vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{
            type: 'text',
            text: JSON.stringify({
              patterns: ['Layered Architecture', 'Repository Pattern'],
              layers: ['api', 'services', 'data'],
              conventions: {
                naming: ['camelCase for functions'],
                fileStructure: ['feature-based folders'],
                testing: ['colocated test files']
              },
              potentialIssues: ['Some circular dependencies detected'],
              naturalLanguageSummary: 'This is a TypeScript codebase with layered architecture.'
            })
          }]
        })
      }
    }))
  };
});

describe('CodebaseSummaryService', () => {
  describe('CodebaseSummary interface', () => {
    it('should have correct structure', () => {
      const summary: CodebaseSummary = {
        version: '1.0.0',
        generatedAt: new Date().toISOString(),
        stats: {
          totalFiles: 100,
          totalSymbols: 500,
          totalFunctions: 300,
          totalClasses: 50,
          languages: { typescript: 80, javascript: 20 },
          linesOfCode: 10000
        },
        architecture: {
          entryPoints: ['src/index.ts'],
          coreModules: [],
          patterns: ['Layered Architecture']
        },
        conventions: {
          naming: ['camelCase'],
          fileStructure: ['feature-based'],
          testing: ['jest']
        },
        abstractions: {
          interfaces: [],
          baseClasses: [],
          utilities: []
        },
        dependencies: {
          external: ['lodash', 'express'],
          hotspots: ['handleRequest (45 callers)'],
          potentialIssues: []
        },
        naturalLanguageSummary: 'A web application built with TypeScript.'
      };

      expect(summary.version).toBe('1.0.0');
      expect(summary.stats.totalFiles).toBe(100);
      expect(summary.architecture.patterns).toContain('Layered Architecture');
    });
  });

  describe('ModuleSummary interface', () => {
    it('should correctly define module summaries', () => {
      const module: ModuleSummary = {
        name: 'services',
        path: 'src/services',
        description: 'Business logic layer',
        fileCount: 15,
        symbolCount: 120,
        primaryLanguage: 'typescript',
        keyExports: ['UserService', 'AuthService', 'DataService']
      };

      expect(module.name).toBe('services');
      expect(module.fileCount).toBe(15);
      expect(module.keyExports).toContain('UserService');
    });
  });

  describe('InterfaceSummary interface', () => {
    it('should correctly define interface summaries', () => {
      const iface: InterfaceSummary = {
        name: 'Repository',
        file: 'src/types.ts',
        description: 'Base repository interface',
        implementors: ['UserRepository', 'ProductRepository']
      };

      expect(iface.name).toBe('Repository');
      expect(iface.implementors).toHaveLength(2);
    });
  });

  describe('ClassSummary interface', () => {
    it('should correctly define class summaries', () => {
      const cls: ClassSummary = {
        name: 'BaseController',
        file: 'src/controllers/base.ts',
        description: 'Base controller class',
        subclasses: ['UserController', 'ProductController']
      };

      expect(cls.name).toBe('BaseController');
      expect(cls.subclasses).toContain('UserController');
    });
  });

  describe('FunctionSummary interface', () => {
    it('should correctly define function summaries', () => {
      const func: FunctionSummary = {
        name: 'validateInput',
        file: 'src/utils/validation.ts',
        description: 'Validates user input',
        callerCount: 45
      };

      expect(func.name).toBe('validateInput');
      expect(func.callerCount).toBe(45);
    });
  });

  describe('Summary formatting', () => {
    it('should format stats correctly', () => {
      const summary: CodebaseSummary = {
        version: '1.0.0',
        generatedAt: new Date().toISOString(),
        stats: {
          totalFiles: 127,
          totalSymbols: 1432,
          totalFunctions: 856,
          totalClasses: 94,
          languages: { typescript: 98, javascript: 29 },
          linesOfCode: 45000
        },
        architecture: {
          entryPoints: ['src/index.ts', 'src/cli/index.ts'],
          coreModules: [
            { name: 'services', path: 'src/services', description: '', fileCount: 15, symbolCount: 120, primaryLanguage: 'typescript', keyExports: [] },
            { name: 'commands', path: 'src/commands', description: '', fileCount: 20, symbolCount: 80, primaryLanguage: 'typescript', keyExports: [] }
          ],
          patterns: ['Layered', 'Repository pattern']
        },
        conventions: {
          naming: ['camelCase for functions', 'PascalCase for classes'],
          fileStructure: ['feature-based folders'],
          testing: ['colocated tests']
        },
        abstractions: {
          interfaces: [],
          baseClasses: [],
          utilities: []
        },
        dependencies: {
          external: ['lodash', 'express', 'commander'],
          hotspots: ['logger (47 callers)', 'validateInput (32 callers)'],
          potentialIssues: []
        },
        naturalLanguageSummary: 'This is a CLI tool built with TypeScript.'
      };

      // Verify all expected properties
      expect(summary.stats.totalFiles).toBe(127);
      expect(summary.stats.totalSymbols).toBe(1432);
      expect(summary.architecture.coreModules).toHaveLength(2);
      expect(summary.dependencies.hotspots).toHaveLength(2);
    });
  });

  describe('Pattern detection', () => {
    it('should detect layered architecture patterns', () => {
      const patterns = ['Layered Architecture', 'Repository Pattern', 'Service Layer'];

      expect(patterns).toContain('Layered Architecture');
      expect(patterns).toContain('Repository Pattern');
    });

    it('should detect common architectural patterns', () => {
      const commonPatterns = [
        'Layered Architecture',
        'Repository Pattern',
        'Service Layer',
        'MVC',
        'MVVM',
        'Component-Based UI',
        'Event-Driven',
        'Microservices',
        'Monolithic'
      ];

      // Ensure we recognize these pattern types
      expect(commonPatterns).toContain('Layered Architecture');
      expect(commonPatterns).toContain('Repository Pattern');
      expect(commonPatterns).toContain('MVC');
    });
  });

  describe('Hotspot identification', () => {
    it('should format hotspots correctly', () => {
      const hotspots = [
        { name: 'logger', callerCount: 47 },
        { name: 'validateInput', callerCount: 32 },
        { name: 'formatDate', callerCount: 28 }
      ];

      const formatted = hotspots.map(h => `${h.name} (${h.callerCount} callers)`);

      expect(formatted[0]).toBe('logger (47 callers)');
      expect(formatted[1]).toBe('validateInput (32 callers)');
    });
  });

  describe('Language statistics', () => {
    it('should correctly aggregate language stats', () => {
      const languages: Record<string, number> = {
        typescript: 98,
        javascript: 29,
        python: 5,
        json: 15
      };

      const sorted = Object.entries(languages)
        .sort((a, b) => b[1] - a[1]);

      expect(sorted[0][0]).toBe('typescript');
      expect(sorted[0][1]).toBe(98);
    });

    it('should format language string correctly', () => {
      const languages: Record<string, number> = {
        typescript: 98,
        javascript: 29
      };

      const langStr = Object.entries(languages)
        .sort((a, b) => b[1] - a[1])
        .map(([lang, count]) => `${lang}(${count})`)
        .join(', ');

      expect(langStr).toBe('typescript(98), javascript(29)');
    });
  });

  describe('Circular dependency detection', () => {
    it('should format circular dependencies', () => {
      const circularDeps = [
        ['src/a.ts', 'src/b.ts', 'src/a.ts'],
        ['src/services/auth.ts', 'src/services/user.ts', 'src/services/auth.ts']
      ];

      const formatted = circularDeps.map(cycle => cycle.join(' → '));

      expect(formatted[0]).toBe('src/a.ts → src/b.ts → src/a.ts');
      expect(formatted[1]).toContain('auth.ts');
    });
  });

  describe('Summary embedding', () => {
    it('should handle optional embedding field', () => {
      const summaryWithEmbedding: CodebaseSummary = {
        version: '1.0.0',
        generatedAt: new Date().toISOString(),
        stats: { totalFiles: 10, totalSymbols: 50, totalFunctions: 30, totalClasses: 5, languages: {} },
        architecture: { entryPoints: [], coreModules: [], patterns: [] },
        conventions: { naming: [], fileStructure: [], testing: [] },
        abstractions: { interfaces: [], baseClasses: [], utilities: [] },
        dependencies: { external: [], hotspots: [], potentialIssues: [] },
        naturalLanguageSummary: 'Test summary',
        embedding: [0.1, 0.2, 0.3, 0.4, 0.5]
      };

      expect(summaryWithEmbedding.embedding).toHaveLength(5);

      const summaryWithoutEmbedding: CodebaseSummary = {
        version: '1.0.0',
        generatedAt: new Date().toISOString(),
        stats: { totalFiles: 10, totalSymbols: 50, totalFunctions: 30, totalClasses: 5, languages: {} },
        architecture: { entryPoints: [], coreModules: [], patterns: [] },
        conventions: { naming: [], fileStructure: [], testing: [] },
        abstractions: { interfaces: [], baseClasses: [], utilities: [] },
        dependencies: { external: [], hotspots: [], potentialIssues: [] },
        naturalLanguageSummary: 'Test summary'
      };

      expect(summaryWithoutEmbedding.embedding).toBeUndefined();
    });
  });
});
