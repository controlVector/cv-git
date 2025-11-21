#!/usr/bin/env node
/**
 * CV-Git Sync Performance Benchmarks
 */

import { CodeParser } from '../../packages/core/dist/parser/index.js';
import { GraphManager } from '../../packages/core/dist/graph/index.js';
import { VectorManager } from '../../packages/core/dist/vector/index.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.join(__dirname, '..', '..');
const EXAMPLES_DIR = path.join(ROOT_DIR, 'examples', 'demo-microservices', 'src');

async function benchmark(name, fn, iterations = 10) {
  const times = [];
  await fn(); // warmup

  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await fn();
    times.push(performance.now() - start);
  }

  const avg = times.reduce((a, b) => a + b, 0) / iterations;
  const min = Math.min(...times);
  const max = Math.max(...times);

  return { name, avg, min, max };
}

async function main() {
  console.log('🧪 CV-Git Performance Benchmarks\n');
  console.log(`Node: ${process.version}`);
  console.log(`Platform: ${process.platform}\n`);

  const results = [];

  // Parser benchmarks
  const parser = new CodeParser();

  console.log('📝 Parser Benchmarks');

  const tsFile = path.join(EXAMPLES_DIR, 'api', 'gateway.ts');
  if (fs.existsSync(tsFile)) {
    const tsContent = fs.readFileSync(tsFile, 'utf-8');
    const tsResult = await benchmark('TS Parse', async () => {
      await parser.parseFile('gateway.ts', tsContent);
    }, 20);
    results.push(tsResult);
    console.log(`  TS Parse: ${tsResult.avg.toFixed(2)}ms avg`);
  }

  const pyFile = path.join(EXAMPLES_DIR, 'data', 'processor.py');
  if (fs.existsSync(pyFile)) {
    const pyContent = fs.readFileSync(pyFile, 'utf-8');
    const pyResult = await benchmark('PY Parse', async () => {
      await parser.parseFile('processor.py', pyContent);
    }, 20);
    results.push(pyResult);
    console.log(`  PY Parse: ${pyResult.avg.toFixed(2)}ms avg`);
  }

  // Graph benchmarks
  console.log('\n📊 Graph Benchmarks');
  try {
    const graphManager = new GraphManager();
    await graphManager.initialize();

    const statsResult = await benchmark('Stats', async () => {
      await graphManager.getStats();
    }, 50);
    results.push(statsResult);
    console.log(`  Stats: ${statsResult.avg.toFixed(2)}ms avg`);

    const queryResult = await benchmark('Query', async () => {
      await graphManager.query("MATCH (n:File) RETURN count(n) as count");
    }, 50);
    results.push(queryResult);
    console.log(`  Query: ${queryResult.avg.toFixed(2)}ms avg`);

    await graphManager.close();
  } catch (e) {
    console.log('  ⚠️  Skipped (FalkorDB not available)');
  }

  // Vector benchmarks
  console.log('\n🔍 Vector Benchmarks');
  try {
    const vectorManager = new VectorManager();
    await vectorManager.initialize();

    const searchResult = await benchmark('Search', async () => {
      await vectorManager.search('authentication', 5);
    }, 20);
    results.push(searchResult);
    console.log(`  Search: ${searchResult.avg.toFixed(2)}ms avg`);

    await vectorManager.close();
  } catch (e) {
    console.log('  ⚠️  Skipped (Qdrant/OpenAI not available)');
  }

  // Summary
  console.log('\n📊 Summary');
  console.log('| Operation | Avg (ms) | Min (ms) | Max (ms) |');
  console.log('|-----------|----------|----------|----------|');
  for (const r of results) {
    console.log(`| ${r.name.padEnd(9)} | ${r.avg.toFixed(2).padStart(8)} | ${r.min.toFixed(2).padStart(8)} | ${r.max.toFixed(2).padStart(8)} |`);
  }

  console.log('\n✅ Benchmarks complete\n');
}

main().catch(console.error);
