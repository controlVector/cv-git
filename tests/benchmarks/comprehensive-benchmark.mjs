#!/usr/bin/env node
/**
 * Comprehensive CV-Git Performance Benchmarks
 *
 * Features:
 * - JSON output for CI integration
 * - Baseline comparison for regression detection
 * - Memory usage tracking
 * - CLI startup benchmarks
 * - Parser benchmarks for all supported languages
 *
 * Usage:
 *   node comprehensive-benchmark.mjs [options]
 *
 * Options:
 *   --json           Output results as JSON
 *   --save-baseline  Save results as new baseline
 *   --compare        Compare against baseline
 *   --output=<file>  Output file path (default: stdout for json)
 */

import { spawn, execSync } from 'child_process';
import { performance } from 'perf_hooks';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { promisify } from 'util';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..', '..');
const BASELINE_FILE = path.join(ROOT_DIR, 'benchmarks', 'baseline.json');
const RESULTS_DIR = path.join(ROOT_DIR, 'benchmarks', 'results');

// Parse CLI arguments
const args = process.argv.slice(2);
const outputJson = args.includes('--json');
const saveBaseline = args.includes('--save-baseline');
const compareBaseline = args.includes('--compare');
const outputArg = args.find(a => a.startsWith('--output='));
const outputFile = outputArg ? outputArg.split('=')[1] : null;

// ============================================================================
// Utility Functions
// ============================================================================

async function benchmark(name, fn, iterations = 10) {
  const times = [];

  // Warmup
  try {
    await fn();
  } catch (e) {
    return { name, error: e.message, skipped: true };
  }

  // Measured runs
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    try {
      await fn();
    } catch (e) {
      return { name, error: e.message, skipped: true };
    }
    times.push(performance.now() - start);
  }

  const avgMs = times.reduce((a, b) => a + b, 0) / iterations;
  const minMs = Math.min(...times);
  const maxMs = Math.max(...times);
  const stdDev = Math.sqrt(times.reduce((sum, t) => sum + Math.pow(t - avgMs, 2), 0) / iterations);

  return {
    name,
    iterations,
    avgMs: Number(avgMs.toFixed(3)),
    minMs: Number(minMs.toFixed(3)),
    maxMs: Number(maxMs.toFixed(3)),
    stdDev: Number(stdDev.toFixed(3)),
    opsPerSecond: Number((1000 / avgMs).toFixed(2)),
    skipped: false,
  };
}

async function runCommand(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const start = performance.now();
    const proc = spawn(command, args, {
      cwd: ROOT_DIR,
      stdio: 'pipe',
      timeout: options.timeout || 30000,
      ...options.spawnOptions,
    });

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data) => { stdout += data; });
    proc.stderr?.on('data', (data) => { stderr += data; });

    proc.on('close', (code) => {
      const elapsed = performance.now() - start;
      resolve({ code, stdout, stderr, elapsed });
    });

    proc.on('error', (err) => {
      reject(err);
    });
  });
}

function getMemoryUsage() {
  const mem = process.memoryUsage();
  return {
    heapUsedMB: Number((mem.heapUsed / 1024 / 1024).toFixed(2)),
    heapTotalMB: Number((mem.heapTotal / 1024 / 1024).toFixed(2)),
    rssMB: Number((mem.rss / 1024 / 1024).toFixed(2)),
    externalMB: Number((mem.external / 1024 / 1024).toFixed(2)),
  };
}

function loadBaseline() {
  try {
    if (fs.existsSync(BASELINE_FILE)) {
      return JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf-8'));
    }
  } catch (e) {
    console.error(`Warning: Could not load baseline: ${e.message}`);
  }
  return null;
}

function compareWithBaseline(results, baseline) {
  if (!baseline) return results;

  const compared = { ...results };
  compared.comparison = {};

  for (const [category, benchmarks] of Object.entries(results.benchmarks || {})) {
    compared.comparison[category] = {};

    for (const bench of benchmarks) {
      if (bench.skipped) continue;

      const baselineCategory = baseline.benchmarks?.[category];
      const baselineBench = baselineCategory?.find(b => b.name === bench.name);

      if (baselineBench && !baselineBench.skipped) {
        const diff = bench.avgMs - baselineBench.avgMs;
        const diffPercent = (diff / baselineBench.avgMs) * 100;

        compared.comparison[category][bench.name] = {
          baseline: baselineBench.avgMs,
          current: bench.avgMs,
          diffMs: Number(diff.toFixed(3)),
          diffPercent: Number(diffPercent.toFixed(2)),
          regression: diffPercent > 20,
          improvement: diffPercent < -10,
        };
      }
    }
  }

  return compared;
}

// ============================================================================
// Benchmark Suites
// ============================================================================

async function runParserBenchmarks() {
  const benchmarks = [];

  // Dynamically import the parser
  let CodeParser;
  try {
    const parserModule = await import(path.join(ROOT_DIR, 'packages/core/dist/parser/index.js'));
    CodeParser = parserModule.CodeParser || parserModule.default;
  } catch (e) {
    return [{ name: 'parser:load', error: e.message, skipped: true }];
  }

  const parser = new CodeParser();

  // Test files for each language
  const testFiles = {
    'parser:typescript': { ext: '.ts', content: `
      interface User { id: number; name: string; }
      class UserService {
        private users: User[] = [];
        async getUser(id: number): Promise<User | undefined> {
          return this.users.find(u => u.id === id);
        }
        async createUser(name: string): Promise<User> {
          const user = { id: Date.now(), name };
          this.users.push(user);
          return user;
        }
      }
      export const userService = new UserService();
    `},
    'parser:javascript': { ext: '.js', content: `
      class Calculator {
        add(a, b) { return a + b; }
        subtract(a, b) { return a - b; }
        multiply(a, b) { return a * b; }
        divide(a, b) { return b !== 0 ? a / b : null; }
      }
      module.exports = { Calculator };
    `},
    'parser:python': { ext: '.py', content: `
class DataProcessor:
    def __init__(self, data):
        self.data = data
        self.processed = False

    def process(self):
        result = [item * 2 for item in self.data if item > 0]
        self.processed = True
        return result

    def get_stats(self):
        return {
            'count': len(self.data),
            'sum': sum(self.data),
            'avg': sum(self.data) / len(self.data) if self.data else 0
        }
    `},
    'parser:go': { ext: '.go', content: `
package main

import "fmt"

type Server struct {
    host string
    port int
}

func NewServer(host string, port int) *Server {
    return &Server{host: host, port: port}
}

func (s *Server) Start() error {
    fmt.Printf("Starting server on %s:%d\\n", s.host, s.port)
    return nil
}

func main() {
    server := NewServer("localhost", 8080)
    server.Start()
}
    `},
    'parser:rust': { ext: '.rs', content: `
struct Config {
    host: String,
    port: u16,
}

impl Config {
    fn new(host: &str, port: u16) -> Self {
        Config {
            host: host.to_string(),
            port,
        }
    }

    fn address(&self) -> String {
        format!("{}:{}", self.host, self.port)
    }
}

fn main() {
    let config = Config::new("localhost", 8080);
    println!("Address: {}", config.address());
}
    `},
    'parser:java': { ext: '.java', content: `
public class UserManager {
    private List<User> users = new ArrayList<>();

    public User createUser(String name, String email) {
        User user = new User(name, email);
        users.add(user);
        return user;
    }

    public Optional<User> findByEmail(String email) {
        return users.stream()
            .filter(u -> u.getEmail().equals(email))
            .findFirst();
    }
}
    `},
  };

  for (const [name, { ext, content }] of Object.entries(testFiles)) {
    const result = await benchmark(name, async () => {
      await parser.parseFile(`test${ext}`, content);
    }, 20);
    benchmarks.push(result);
  }

  return benchmarks;
}

async function runCliBenchmarks() {
  const benchmarks = [];
  const cvPath = path.join(ROOT_DIR, 'packages/cli/dist/index.js');

  // Check if CLI is built
  if (!fs.existsSync(cvPath)) {
    return [{ name: 'cli:not-built', error: 'CLI not built', skipped: true }];
  }

  // CLI startup (help)
  const helpResult = await benchmark('cli:help', async () => {
    await runCommand('node', [cvPath, '--help']);
  }, 5);
  benchmarks.push(helpResult);

  // CLI version
  const versionResult = await benchmark('cli:version', async () => {
    await runCommand('node', [cvPath, '--version']);
  }, 5);
  benchmarks.push(versionResult);

  return benchmarks;
}

async function runMemoryBenchmarks() {
  const benchmarks = [];

  // Baseline memory
  if (global.gc) global.gc(); // Force GC if available
  const baseline = getMemoryUsage();

  benchmarks.push({
    name: 'memory:baseline',
    heapUsedMB: baseline.heapUsedMB,
    rssMB: baseline.rssMB,
    skipped: false,
  });

  // Memory after parser load
  try {
    const parserModule = await import(path.join(ROOT_DIR, 'packages/core/dist/parser/index.js'));
    const CodeParser = parserModule.CodeParser || parserModule.default;
    const parser = new CodeParser();

    // Parse a few files to warm up
    await parser.parseFile('test.ts', 'const x = 1;');
    await parser.parseFile('test.py', 'x = 1');

    const afterParser = getMemoryUsage();
    benchmarks.push({
      name: 'memory:after-parser',
      heapUsedMB: afterParser.heapUsedMB,
      rssMB: afterParser.rssMB,
      deltaMB: Number((afterParser.heapUsedMB - baseline.heapUsedMB).toFixed(2)),
      skipped: false,
    });
  } catch (e) {
    benchmarks.push({ name: 'memory:after-parser', error: e.message, skipped: true });
  }

  return benchmarks;
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const startTime = new Date().toISOString();
  const results = {
    timestamp: startTime,
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    benchmarks: {},
  };

  if (!outputJson) {
    console.log('');
    console.log('CV-Git Performance Benchmarks');
    console.log('');
    console.log(`Node: ${process.version}`);
    console.log(`Platform: ${process.platform} ${process.arch}`);
    console.log(`Time: ${startTime}`);
    console.log('');
  }

  // Run parser benchmarks
  if (!outputJson) console.log('Parser Benchmarks');
  results.benchmarks.parser = await runParserBenchmarks();
  if (!outputJson) {
    for (const b of results.benchmarks.parser) {
      if (b.skipped) {
        console.log(`  ${b.name}: SKIPPED (${b.error})`);
      } else {
        console.log(`  ${b.name}: ${b.avgMs.toFixed(2)}ms avg (${b.opsPerSecond} ops/sec)`);
      }
    }
    console.log('');
  }

  // Run CLI benchmarks
  if (!outputJson) console.log('CLI Benchmarks');
  results.benchmarks.cli = await runCliBenchmarks();
  if (!outputJson) {
    for (const b of results.benchmarks.cli) {
      if (b.skipped) {
        console.log(`  ${b.name}: SKIPPED (${b.error})`);
      } else {
        console.log(`  ${b.name}: ${b.avgMs.toFixed(2)}ms avg`);
      }
    }
    console.log('');
  }

  // Run memory benchmarks
  if (!outputJson) console.log('Memory Benchmarks');
  results.benchmarks.memory = await runMemoryBenchmarks();
  if (!outputJson) {
    for (const b of results.benchmarks.memory) {
      if (b.skipped) {
        console.log(`  ${b.name}: SKIPPED (${b.error})`);
      } else {
        console.log(`  ${b.name}: ${b.heapUsedMB}MB heap, ${b.rssMB}MB RSS`);
      }
    }
    console.log('');
  }

  // Compare with baseline if requested
  let finalResults = results;
  if (compareBaseline) {
    const baseline = loadBaseline();
    if (baseline) {
      finalResults = compareWithBaseline(results, baseline);

      if (!outputJson && finalResults.comparison) {
        console.log('Baseline Comparison');
        for (const [category, comparisons] of Object.entries(finalResults.comparison)) {
          for (const [name, comp] of Object.entries(comparisons)) {
            const arrow = comp.regression ? '!!!' : comp.improvement ? '+++' : '   ';
            const sign = comp.diffPercent >= 0 ? '+' : '';
            console.log(`  ${arrow} ${name}: ${sign}${comp.diffPercent}% (${comp.baseline}ms -> ${comp.current}ms)`);
          }
        }
        console.log('');
      }
    } else {
      if (!outputJson) console.log('No baseline found for comparison\n');
    }
  }

  // Save baseline if requested
  if (saveBaseline) {
    fs.mkdirSync(path.dirname(BASELINE_FILE), { recursive: true });
    fs.writeFileSync(BASELINE_FILE, JSON.stringify(results, null, 2));
    if (!outputJson) console.log(`Baseline saved to ${BASELINE_FILE}\n`);
  }

  // Output JSON if requested
  if (outputJson) {
    const jsonOutput = JSON.stringify(finalResults, null, 2);
    if (outputFile) {
      fs.mkdirSync(path.dirname(outputFile), { recursive: true });
      fs.writeFileSync(outputFile, jsonOutput);
    } else {
      console.log(jsonOutput);
    }
  } else {
    // Summary table
    console.log('Summary');
    console.log('| Benchmark | Avg (ms) | Min | Max | Ops/sec |');
    console.log('|-----------|----------|-----|-----|---------|');
    for (const [category, benchmarks] of Object.entries(results.benchmarks)) {
      for (const b of benchmarks) {
        if (!b.skipped && b.avgMs !== undefined) {
          console.log(`| ${b.name.padEnd(20)} | ${b.avgMs.toFixed(2).padStart(8)} | ${b.minMs?.toFixed(2).padStart(3) || 'N/A'} | ${b.maxMs?.toFixed(2).padStart(3) || 'N/A'} | ${(b.opsPerSecond || 0).toString().padStart(7)} |`);
        }
      }
    }
    console.log('');
    console.log('Benchmarks complete');
  }

  // Check for regressions
  if (finalResults.comparison) {
    const regressions = [];
    for (const [category, comparisons] of Object.entries(finalResults.comparison)) {
      for (const [name, comp] of Object.entries(comparisons)) {
        if (comp.regression) {
          regressions.push(`${name}: +${comp.diffPercent}%`);
        }
      }
    }
    if (regressions.length > 0) {
      console.error('\nPerformance regressions detected:');
      regressions.forEach(r => console.error(`  - ${r}`));
      process.exit(1);
    }
  }
}

main().catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
