#!/usr/bin/env node
/**
 * Sync Engine Performance Benchmarks
 *
 * Measures performance of key sync operations:
 * - File parsing by language
 * - Graph updates
 * - Vector embedding generation
 * - Full vs incremental sync
 */

import { runBenchmarkSuite, printSummary, BenchmarkResult } from './benchmark-utils.js';
import { ParserManager } from '../../packages/core/dist/parser/index.js';
import { GraphManager } from '../../packages/core/dist/graph/index.js';
import { VectorManager } from '../../packages/core/dist/vector/index.js';
import * as fs from 'fs';
import * as path from 'path';

const EXAMPLES_DIR = path.join(process.cwd(), 'examples', 'demo-microservices', 'src');

async function main() {
  console.log('🧪 CV-Git Sync Performance Benchmarks\n');
  console.log('Environment:');
  console.log(`  Node: ${process.version}`);
  console.log(`  Platform: ${process.platform}`);
  console.log(`  CWD: ${process.cwd()}\n`);

  const allResults: BenchmarkResult[] = [];

  // Parser benchmarks
  const parserManager = new ParserManager();

  const parserBenchmarks = await runBenchmarkSuite('Parser', [
    {
      name: 'TS Parse',
      fn: async () => {
        const content = fs.readFileSync(path.join(EXAMPLES_DIR, 'api', 'gateway.ts'), 'utf-8');
        await parserManager.parseFile('gateway.ts', content);
      },
      iterations: 20
    },
    {
      name: 'PY Parse',
      fn: async () => {
        const content = fs.readFileSync(path.join(EXAMPLES_DIR, 'data', 'processor.py'), 'utf-8');
        await parserManager.parseFile('processor.py', content);
      },
      iterations: 20
    }
  ]);
  allResults.push(...parserBenchmarks);

  // Graph benchmarks (if services available)
  try {
    const graphManager = new GraphManager();
    await graphManager.initialize();

    const graphBenchmarks = await runBenchmarkSuite('Graph', [
      {
        name: 'Stats',
        fn: async () => {
          await graphManager.getStats();
        },
        iterations: 50
      },
      {
        name: 'Query',
        fn: async () => {
          await graphManager.query("MATCH (n:File) RETURN count(n) as count");
        },
        iterations: 50
      }
    ]);
    allResults.push(...graphBenchmarks);
    await graphManager.close();
  } catch (e) {
    console.log('\n⚠️  Graph benchmarks skipped (FalkorDB not available)\n');
  }

  // Vector benchmarks (if services available)
  try {
    const vectorManager = new VectorManager();
    await vectorManager.initialize();

    const vectorBenchmarks = await runBenchmarkSuite('Vector', [
      {
        name: 'Search',
        fn: async () => {
          await vectorManager.search('authentication', 5);
        },
        iterations: 20
      }
    ]);
    allResults.push(...vectorBenchmarks);
    await vectorManager.close();
  } catch (e) {
    console.log('\n⚠️  Vector benchmarks skipped (Qdrant/OpenAI not available)\n');
  }

  // Print final summary
  if (allResults.length > 0) {
    printSummary(allResults);
  }

  console.log('\n✅ Benchmarks complete\n');
}

main().catch(console.error);
