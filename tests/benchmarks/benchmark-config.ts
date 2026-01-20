/**
 * Benchmark Configuration
 *
 * Defines benchmark parameters, thresholds, and baseline expectations.
 */

export interface BenchmarkThreshold {
  maxMs: number;           // Maximum acceptable average time in ms
  maxMemoryMB?: number;    // Maximum memory usage in MB
  description?: string;
}

export interface BenchmarkConfig {
  iterations: {
    warmup: number;       // Warmup iterations (not counted)
    measured: number;     // Measured iterations
  };
  thresholds: Record<string, BenchmarkThreshold>;
  outputFormats: ('console' | 'json' | 'markdown')[];
  outputDir: string;
  baselineFile: string;
  regressionThreshold: number;  // Percentage increase that triggers warning
}

export const defaultConfig: BenchmarkConfig = {
  iterations: {
    warmup: 1,
    measured: 10,
  },
  thresholds: {
    // Parser benchmarks
    'parser:typescript': { maxMs: 5, description: 'TypeScript file parsing' },
    'parser:python': { maxMs: 5, description: 'Python file parsing' },
    'parser:javascript': { maxMs: 3, description: 'JavaScript file parsing' },
    'parser:go': { maxMs: 3, description: 'Go file parsing' },
    'parser:rust': { maxMs: 5, description: 'Rust file parsing' },
    'parser:java': { maxMs: 5, description: 'Java file parsing' },

    // Graph benchmarks (when FalkorDB available)
    'graph:stats': { maxMs: 50, description: 'Graph statistics query' },
    'graph:simple-query': { maxMs: 100, description: 'Simple Cypher query' },
    'graph:complex-query': { maxMs: 500, description: 'Complex traversal query' },
    'graph:insert-node': { maxMs: 20, description: 'Insert single node' },
    'graph:insert-edge': { maxMs: 20, description: 'Insert single edge' },

    // Vector benchmarks (when Qdrant available)
    'vector:search': { maxMs: 100, description: 'Vector similarity search' },
    'vector:embed-chunk': { maxMs: 500, description: 'Embed single chunk (with API)' },

    // CLI benchmarks
    'cli:startup': { maxMs: 500, description: 'CLI startup time (no command)' },
    'cli:help': { maxMs: 600, description: 'CLI help command' },
    'cli:status': { maxMs: 2000, description: 'CV status in repo' },

    // Sync benchmarks
    'sync:incremental-small': { maxMs: 5000, description: 'Incremental sync (10 files)' },
    'sync:incremental-medium': { maxMs: 15000, description: 'Incremental sync (100 files)' },
    'sync:full-small': { maxMs: 10000, description: 'Full sync small repo' },

    // Memory benchmarks
    'memory:idle': { maxMs: 0, maxMemoryMB: 100, description: 'Idle memory usage' },
    'memory:sync-peak': { maxMs: 0, maxMemoryMB: 500, description: 'Peak memory during sync' },
  },
  outputFormats: ['console', 'json'],
  outputDir: 'benchmarks/results',
  baselineFile: 'benchmarks/baseline.json',
  regressionThreshold: 20, // 20% increase triggers warning
};
