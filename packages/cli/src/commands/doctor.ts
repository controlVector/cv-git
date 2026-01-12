/**
 * Doctor Command
 * Diagnostic tool to check CV-Git health and suggest fixes
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { simpleGit } from 'simple-git';
import { promises as fs } from 'fs';
import * as path from 'path';
import { getConfig } from '../config.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import { addGlobalOptions } from '../utils/output.js';

const execAsync = promisify(exec);

interface DiagnosticResult {
  name: string;
  status: 'pass' | 'warn' | 'fail';
  message: string;
  fix?: string;
}

export function doctorCommand(): Command {
  const cmd = new Command('doctor');
  cmd.description('Run diagnostics and health checks');
  cmd.option('--fix', 'Attempt to fix issues automatically');

  addGlobalOptions(cmd);

  cmd.action(async (options) => {
    try {
      const results: DiagnosticResult[] = [];

      // Run all diagnostic checks
      results.push(await checkGitInstalled());
      results.push(await checkGitRepository());
      results.push(await checkNodeVersion());
      results.push(await checkPnpmInstalled());
      results.push(await checkCVGitInitialized());
      results.push(await checkConfiguration());
      results.push(await checkCredentials());
      results.push(await checkFalkorDB());
      results.push(await checkQdrant());
      results.push(await checkOllama());
      results.push(await checkDiskSpace());
      results.push(await checkNetworkConnectivity());

      if (options.json) {
        console.log(JSON.stringify({ results }, null, 2));
      } else {
        console.log(chalk.bold('\n🔍 Running CV-Git Diagnostics...\n'));
        // Display results
        const passed = results.filter(r => r.status === 'pass').length;
        const warned = results.filter(r => r.status === 'warn').length;
        const failed = results.filter(r => r.status === 'fail').length;

        for (const result of results) {
          let icon: string;
          let color: any;

          switch (result.status) {
            case 'pass':
              icon = '✓';
              color = chalk.green;
              break;
            case 'warn':
              icon = '⚠';
              color = chalk.yellow;
              break;
            case 'fail':
              icon = '✗';
              color = chalk.red;
              break;
          }

          console.log(color(`${icon} ${result.name}`));
          console.log(`  ${result.message}`);
          if (result.fix) {
            console.log(chalk.cyan(`  → Fix: ${result.fix}`));
          }
          console.log();
        }

        // Summary
        console.log(chalk.bold('Summary:'));
        console.log(chalk.green(`  ✓ ${passed} passed`));
        if (warned > 0) console.log(chalk.yellow(`  ⚠ ${warned} warnings`));
        if (failed > 0) console.log(chalk.red(`  ✗ ${failed} failed`));
        console.log();

        // Overall status
        if (failed === 0 && warned === 0) {
          console.log(chalk.green.bold('🎉 All checks passed! CV-Git is healthy.\n'));
          process.exit(0);
        } else if (failed === 0) {
          console.log(chalk.yellow('⚠️  Some warnings found. CV-Git should work but may have issues.\n'));
          process.exit(0);
        } else {
          console.log(chalk.red('❌ Some checks failed. Please fix the issues above.\n'));
          process.exit(1);
        }
      }
    } catch (error: any) {
      console.error(chalk.red('✗ Doctor command failed:'), error.message);
      process.exit(1);
    }
  });

  return cmd;
}

/**
 * Check if git is installed
 */
async function checkGitInstalled(): Promise<DiagnosticResult> {
  try {
    const { stdout } = await execAsync('git --version');
    return {
      name: 'Git Installation',
      status: 'pass',
      message: stdout.trim(),
    };
  } catch {
    return {
      name: 'Git Installation',
      status: 'fail',
      message: 'Git is not installed',
      fix: 'Install git from https://git-scm.com/',
    };
  }
}

/**
 * Check if we're in a git repository
 */
async function checkGitRepository(): Promise<DiagnosticResult> {
  try {
    const git = simpleGit();
    const isRepo = await git.checkIsRepo();
    if (isRepo) {
      return {
        name: 'Git Repository',
        status: 'pass',
        message: 'Current directory is a git repository',
      };
    } else {
      return {
        name: 'Git Repository',
        status: 'fail',
        message: 'Not in a git repository',
        fix: 'Run "git init" or navigate to a git repository',
      };
    }
  } catch (error: any) {
    return {
      name: 'Git Repository',
      status: 'fail',
      message: error.message,
    };
  }
}

/**
 * Check Node.js version
 */
async function checkNodeVersion(): Promise<DiagnosticResult> {
  const version = process.version;
  const major = parseInt(version.slice(1).split('.')[0]);

  if (major >= 18) {
    return {
      name: 'Node.js Version',
      status: 'pass',
      message: `${version} (>= 18.0.0 required)`,
    };
  } else {
    return {
      name: 'Node.js Version',
      status: 'fail',
      message: `${version} (< 18.0.0)`,
      fix: 'Upgrade to Node.js 18 or higher',
    };
  }
}

/**
 * Check if pnpm is installed
 */
async function checkPnpmInstalled(): Promise<DiagnosticResult> {
  try {
    const { stdout } = await execAsync('pnpm --version');
    return {
      name: 'pnpm Installation',
      status: 'pass',
      message: `v${stdout.trim()}`,
    };
  } catch {
    return {
      name: 'pnpm Installation',
      status: 'warn',
      message: 'pnpm not installed',
      fix: 'Install pnpm: npm install -g pnpm',
    };
  }
}

/**
 * Check if CV-Git is initialized
 */
async function checkCVGitInitialized(): Promise<DiagnosticResult> {
  try {
    await fs.access('.cv');
    return {
      name: 'CV-Git Initialization',
      status: 'pass',
      message: 'Repository is initialized',
    };
  } catch {
    return {
      name: 'CV-Git Initialization',
      status: 'warn',
      message: 'Repository not initialized',
      fix: 'Run "cv init" to initialize CV-Git',
    };
  }
}

/**
 * Check configuration
 */
async function checkConfiguration(): Promise<DiagnosticResult> {
  try {
    const config = getConfig();
    const exists = await config.exists();

    if (exists) {
      const cvConfig = await config.load();
      return {
        name: 'Configuration',
        status: 'pass',
        message: `Configured for ${cvConfig.platform.type} (v${cvConfig.version})`,
      };
    } else {
      return {
        name: 'Configuration',
        status: 'warn',
        message: 'No configuration file found (using defaults)',
        fix: 'Run "cv config list" to create configuration',
      };
    }
  } catch (error: any) {
    return {
      name: 'Configuration',
      status: 'fail',
      message: `Configuration error: ${error.message}`,
      fix: 'Run "cv config reset" to reset configuration',
    };
  }
}

/**
 * Check credentials
 */
async function checkCredentials(): Promise<DiagnosticResult> {
  try {
    const { CredentialManager } = await import('@cv-git/credentials');
    const manager = new CredentialManager();
    await manager.init();
    const creds = await manager.list();

    if (creds.length > 0) {
      return {
        name: 'Credentials',
        status: 'pass',
        message: `${creds.length} credential(s) stored`,
      };
    } else {
      return {
        name: 'Credentials',
        status: 'warn',
        message: 'No credentials stored',
        fix: 'Run "cv auth setup" to configure credentials',
      };
    }
  } catch (error: any) {
    return {
      name: 'Credentials',
      status: 'warn',
      message: `Credential check failed: ${error.message}`,
    };
  }
}

/**
 * Check FalkorDB
 */
async function checkFalkorDB(): Promise<DiagnosticResult> {
  try {
    const config = getConfig();
    const cvConfig = await config.load();
    const { createClient } = await import('redis');
    const client = createClient({ url: cvConfig.graph.url });

    await client.connect();
    await client.ping();
    await client.disconnect();

    return {
      name: 'FalkorDB (Knowledge Graph)',
      status: 'pass',
      message: `Connected to ${cvConfig.graph.url}`,
    };
  } catch (error: any) {
    return {
      name: 'FalkorDB (Knowledge Graph)',
      status: 'warn',
      message: 'Not available',
      fix: 'Start FalkorDB: docker run -d --name falkordb -p 6379:6379 falkordb/falkordb',
    };
  }
}

/**
 * Check Qdrant
 */
async function checkQdrant(): Promise<DiagnosticResult> {
  try {
    const config = getConfig();
    const cvConfig = await config.load();
    const response = await fetch(`${cvConfig.vector.url}/collections`);

    if (response.ok) {
      return {
        name: 'Qdrant (Vector Search)',
        status: 'pass',
        message: `Connected to ${cvConfig.vector.url}`,
      };
    } else {
      throw new Error(`HTTP ${response.status}`);
    }
  } catch (error: any) {
    return {
      name: 'Qdrant (Vector Search)',
      status: 'warn',
      message: 'Not available',
      fix: 'Start Qdrant: docker run -d --name qdrant -p 6333:6333 qdrant/qdrant',
    };
  }
}

/**
 * Check Ollama (local embeddings)
 */
async function checkOllama(): Promise<DiagnosticResult> {
  try {
    // First check if any Ollama (system or container) is responding
    try {
      const response = await fetch('http://127.0.0.1:11434/api/tags', {
        signal: AbortSignal.timeout(5000)
      });
      if (response.ok) {
        const data = await response.json() as { models?: Array<{ name: string }> };
        const models = data.models || [];
        const hasEmbeddingModel = models.some(m => m.name.includes('nomic-embed'));

        // Check if this is the Docker container or system install
        let source = 'system';
        try {
          const { stdout } = await execAsync('docker ps --filter name=cv-git-ollama --format "{{.Status}}"');
          if (stdout.trim().toLowerCase().startsWith('up')) {
            source = 'Docker';
          }
        } catch {
          // Not Docker, must be system
        }

        if (hasEmbeddingModel) {
          return {
            name: 'Ollama (Local Embeddings)',
            status: 'pass',
            message: `Running (${source}) with embedding model ready`,
          };
        } else {
          return {
            name: 'Ollama (Local Embeddings)',
            status: 'warn',
            message: `Running (${source}) but embedding model not installed`,
            fix: 'Run: cv sync (will auto-download model)',
          };
        }
      }
    } catch {
      // Ollama not responding, continue to check container/docker
    }

    // Check if container exists but not running
    try {
      const { stdout } = await execAsync('docker ps -a --filter name=cv-git-ollama --format "{{.Status}}"');
      if (stdout.trim()) {
        // Container exists
        if (stdout.trim().toLowerCase().startsWith('up')) {
          return {
            name: 'Ollama (Local Embeddings)',
            status: 'warn',
            message: 'Container running but API not responding',
            fix: 'Check Ollama logs: docker logs cv-git-ollama',
          };
        } else {
          return {
            name: 'Ollama (Local Embeddings)',
            status: 'warn',
            message: 'Container stopped',
            fix: 'Run: docker start cv-git-ollama',
          };
        }
      }
    } catch {
      // Docker not available or command failed
    }

    // Container not running, check if Docker is available
    try {
      await execAsync('docker info');
      return {
        name: 'Ollama (Local Embeddings)',
        status: 'warn',
        message: 'Not running (Docker available)',
        fix: 'Run: cv sync (will auto-start Ollama)',
      };
    } catch {
      return {
        name: 'Ollama (Local Embeddings)',
        status: 'warn',
        message: 'Docker not available',
        fix: 'Install Docker or use cloud embeddings: cv config set embedding.provider openrouter',
      };
    }
  } catch (error: any) {
    return {
      name: 'Ollama (Local Embeddings)',
      status: 'warn',
      message: 'Not available',
      fix: 'Install Docker to enable local embeddings, or use: cv auth setup openrouter',
    };
  }
}

/**
 * Check disk space
 */
async function checkDiskSpace(): Promise<DiagnosticResult> {
  try {
    const { stdout } = await execAsync('df -h . | tail -1');
    const parts = stdout.trim().split(/\s+/);
    const usedPercent = parseInt(parts[4]);

    if (usedPercent < 90) {
      return {
        name: 'Disk Space',
        status: 'pass',
        message: `${parts[4]} used`,
      };
    } else {
      return {
        name: 'Disk Space',
        status: 'warn',
        message: `${parts[4]} used (running low)`,
        fix: 'Free up disk space',
      };
    }
  } catch {
    return {
      name: 'Disk Space',
      status: 'warn',
      message: 'Could not check disk space',
    };
  }
}

/**
 * Check network connectivity
 */
async function checkNetworkConnectivity(): Promise<DiagnosticResult> {
  try {
    await fetch('https://www.google.com', { method: 'HEAD' });
    return {
      name: 'Network Connectivity',
      status: 'pass',
      message: 'Internet connection available',
    };
  } catch {
    return {
      name: 'Network Connectivity',
      status: 'warn',
      message: 'No internet connection (some features may not work)',
    };
  }
}
