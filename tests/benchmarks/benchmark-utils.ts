/**
 * Benchmark utilities for CV-Git performance testing
 */

export interface BenchmarkResult {
  name: string;
  iterations: number;
  totalMs: number;
  avgMs: number;
  minMs: number;
  maxMs: number;
  opsPerSecond: number;
}

export async function benchmark(
  name: string,
  fn: () => Promise<void> | void,
  iterations: number = 10
): Promise<BenchmarkResult> {
  const times: number[] = [];

  // Warmup run
  await fn();

  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await fn();
    const end = performance.now();
    times.push(end - start);
  }

  const totalMs = times.reduce((a, b) => a + b, 0);
  const avgMs = totalMs / iterations;
  const minMs = Math.min(...times);
  const maxMs = Math.max(...times);
  const opsPerSecond = 1000 / avgMs;

  return {
    name,
    iterations,
    totalMs,
    avgMs,
    minMs,
    maxMs,
    opsPerSecond
  };
}

export function formatResult(result: BenchmarkResult): string {
  return `${result.name}:
  Avg: ${result.avgMs.toFixed(2)}ms
  Min: ${result.minMs.toFixed(2)}ms
  Max: ${result.maxMs.toFixed(2)}ms
  Ops/sec: ${result.opsPerSecond.toFixed(2)}`;
}

export async function runBenchmarkSuite(
  suiteName: string,
  benchmarks: Array<{ name: string; fn: () => Promise<void> | void; iterations?: number }>
): Promise<BenchmarkResult[]> {
  console.log(`\n🏃 Running benchmark suite: ${suiteName}\n`);

  const results: BenchmarkResult[] = [];

  for (const { name, fn, iterations } of benchmarks) {
    process.stdout.write(`  ⏱️  ${name}...`);
    const result = await benchmark(name, fn, iterations);
    results.push(result);
    console.log(` ${result.avgMs.toFixed(2)}ms avg`);
  }

  return results;
}

export function printSummary(results: BenchmarkResult[]): void {
  console.log('\n📊 Benchmark Summary\n');
  console.log('| Operation | Avg (ms) | Min (ms) | Max (ms) | Ops/sec |');
  console.log('|-----------|----------|----------|----------|---------|');

  for (const r of results) {
    console.log(
      `| ${r.name.padEnd(9)} | ${r.avgMs.toFixed(2).padStart(8)} | ${r.minMs.toFixed(2).padStart(8)} | ${r.maxMs.toFixed(2).padStart(8)} | ${r.opsPerSecond.toFixed(2).padStart(7)} |`
    );
  }
}
