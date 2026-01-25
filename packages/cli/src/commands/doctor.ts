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
import { exec, execSync } from 'child_process';
import { promisify } from 'util';
import { addGlobalOptions } from '../utils/output.js';
import {
  loadCVGitConfig,
  detectPrivilegeMode,
  getDefaultPaths,
  getRecommendedRuntime,
  getContainerService,
  getFalkorDbUrl,
  getQdrantUrl,
  getOllamaUrl,
} from '@cv-git/core';
import { loadServicesFile } from '../utils/services.js';

/**
 * Discover FalkorDB port from running cv-git-falkordb container
 */
function discoverFalkorDBPort(): number | null {
  try {
    const result = execSync('docker ps --filter name=^cv-git-falkordb$ --format "{{.Ports}}"', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore']
    }).trim();

    if (result) {
      // Parse port from "0.0.0.0:6380->6379/tcp" format
      const portMatch = result.match(/:(\d+)->/);
      if (portMatch) {
        return parseInt(portMatch[1], 10);
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Discover Qdrant port from running cv-git-qdrant container
 */
function discoverQdrantPort(): number | null {
  try {
    const result = execSync('docker ps --filter name=cv-git-qdrant --format "{{.Ports}}"', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore']
    }).trim();

    if (result) {
      // Parse port from "0.0.0.0:6334->6333/tcp" format
      const portMatch = result.match(/:(\d+)->/);
      if (portMatch) {
        return parseInt(portMatch[1], 10);
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Discover Ollama port from running cv-git-ollama container
 */
function discoverOllamaPort(): number | null {
  try {
    const result = execSync('docker ps --filter name=^cv-git-ollama$ --format "{{.Ports}}"', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore']
    }).trim();

    if (result) {
      // Parse port from "0.0.0.0:11434->11434/tcp" format
      const portMatch = result.match(/:(\d+)->/);
      if (portMatch) {
        return parseInt(portMatch[1], 10);
      }
    }
    return null;
  } catch {
    return null;
  }
}

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
      // Note: pnpm check removed - only needed for cv-git development, not end users
      results.push(await checkCVGitInitialized());
      results.push(await checkConfiguration());
      results.push(await checkPrivilegeMode());
      results.push(await checkContainerRuntime());
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
      // Using defaults is fine - not a warning
      return {
        name: 'Configuration',
        status: 'pass',
        message: 'Using default configuration',
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
 * Check privilege mode configuration
 */
async function checkPrivilegeMode(): Promise<DiagnosticResult> {
  try {
    const globalConfig = await loadCVGitConfig();
    const detectedMode = detectPrivilegeMode();
    const configuredMode = globalConfig.privilege.mode;
    const paths = getDefaultPaths(configuredMode);
    const isRoot = process.getuid?.() === 0;

    // Build status message
    let message = `Mode: ${configuredMode}`;
    if (configuredMode === 'auto') {
      message += ` (detected: ${detectedMode})`;
    }
    message += `, Data: ${paths.data}`;

    // Check for warnings
    if (isRoot && globalConfig.privilege.warnOnRoot) {
      return {
        name: 'Privilege Mode',
        status: 'warn',
        message: `${message} - Running as root`,
        fix: 'Consider running as non-root user or set privilege.warnOnRoot to false',
      };
    }

    // Check if configured mode matches environment
    if (configuredMode !== 'auto' && configuredMode !== detectedMode) {
      return {
        name: 'Privilege Mode',
        status: 'warn',
        message: `${message} - Mode mismatch (configured: ${configuredMode}, detected: ${detectedMode})`,
        fix: 'Run "cv config global-init" to reconfigure',
      };
    }

    return {
      name: 'Privilege Mode',
      status: 'pass',
      message,
    };
  } catch (error: any) {
    return {
      name: 'Privilege Mode',
      status: 'warn',
      message: `Could not check privilege mode: ${error.message}`,
      fix: 'Run "cv config global-init" to initialize global configuration',
    };
  }
}

/**
 * Check container runtime status
 */
async function checkContainerRuntime(): Promise<DiagnosticResult> {
  try {
    const containerService = getContainerService();
    const status = await containerService.getStatus();
    const recommendedRuntime = getRecommendedRuntime();

    // Build status message
    const parts: string[] = [];
    parts.push(`Runtime: ${status.runtime}`);
    parts.push(status.rootless ? 'rootless' : 'rootful');

    // Check container states
    const falkorStatus = status.falkordb;
    const qdrantStatus = status.qdrant;

    if (falkorStatus === 'external' && qdrantStatus === 'external') {
      parts.push('using external databases');
    } else {
      parts.push(`FalkorDB: ${falkorStatus}`);
      parts.push(`Qdrant: ${qdrantStatus}`);
    }

    const message = parts.join(', ');

    // Check if runtime is available
    const isAvailable = await containerService.isRuntimeAvailable();
    if (!isAvailable && status.runtime !== 'external') {
      return {
        name: 'Container Runtime',
        status: 'warn',
        message: `${status.runtime} not available`,
        fix: `Install ${status.runtime} or use external databases: cv config set containers.runtime external`,
      };
    }

    // Recommend rootless if not using it
    if (!status.rootless && status.runtime !== 'external') {
      return {
        name: 'Container Runtime',
        status: 'warn',
        message: `${message} - Consider using rootless mode`,
        fix: `Use rootless ${recommendedRuntime} for better security`,
      };
    }

    // Check if containers are running
    if (falkorStatus === 'stopped' || qdrantStatus === 'stopped') {
      return {
        name: 'Container Runtime',
        status: 'warn',
        message,
        fix: 'Start containers with: cv services start',
      };
    }

    if (falkorStatus === 'not-found' || qdrantStatus === 'not-found') {
      return {
        name: 'Container Runtime',
        status: 'warn',
        message,
        fix: 'Initialize containers with: cv services start',
      };
    }

    return {
      name: 'Container Runtime',
      status: 'pass',
      message,
    };
  } catch (error: any) {
    return {
      name: 'Container Runtime',
      status: 'warn',
      message: `Could not check container runtime: ${error.message}`,
      fix: 'Run "cv config global-init" to configure container runtime',
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
  // Priority: services.json > running container > env vars > defaults
  const servicesFile = await loadServicesFile();
  let falkorUrl = servicesFile?.services?.falkordb;

  if (!falkorUrl) {
    // Try to discover from running container
    const containerPort = discoverFalkorDBPort();
    if (containerPort) {
      falkorUrl = `redis://localhost:${containerPort}`;
    } else {
      falkorUrl = getFalkorDbUrl();
    }
  }

  try {
    const { createClient } = await import('redis');
    const client = createClient({ url: falkorUrl });

    await client.connect();
    await client.ping();
    await client.disconnect();

    return {
      name: 'FalkorDB (Knowledge Graph)',
      status: 'pass',
      message: `Connected to ${falkorUrl}`,
    };
  } catch (error: any) {
    // Extract port from URL for the fix suggestion
    const urlMatch = falkorUrl.match(/:(\d+)$/);
    const port = urlMatch ? urlMatch[1] : '6379';

    return {
      name: 'FalkorDB (Knowledge Graph)',
      status: 'warn',
      message: `Not available at ${falkorUrl}`,
      fix: `Start FalkorDB: docker run -d --name falkordb -p ${port}:6379 falkordb/falkordb`,
    };
  }
}

/**
 * Check Qdrant
 */
async function checkQdrant(): Promise<DiagnosticResult> {
  // Priority: services.json > running container > env vars > defaults
  const servicesFile = await loadServicesFile();
  let qdrantUrl = servicesFile?.services?.qdrant;

  if (!qdrantUrl) {
    // Try to discover from running container
    const containerPort = discoverQdrantPort();
    if (containerPort) {
      qdrantUrl = `http://localhost:${containerPort}`;
    } else {
      qdrantUrl = getQdrantUrl();
    }
  }

  try {
    const response = await fetch(`${qdrantUrl}/collections`, {
      signal: AbortSignal.timeout(5000)
    });

    if (response.ok) {
      return {
        name: 'Qdrant (Vector Search)',
        status: 'pass',
        message: `Connected to ${qdrantUrl}`,
      };
    } else {
      throw new Error(`HTTP ${response.status}`);
    }
  } catch (error: any) {
    // Extract port from URL for the fix suggestion
    const urlMatch = qdrantUrl.match(/:(\d+)$/);
    const port = urlMatch ? urlMatch[1] : '6333';

    return {
      name: 'Qdrant (Vector Search)',
      status: 'warn',
      message: `Not available at ${qdrantUrl}`,
      fix: `Start Qdrant: docker run -d --name qdrant -p ${port}:6333 qdrant/qdrant`,
    };
  }
}

/**
 * Check Ollama (local embeddings)
 */
async function checkOllama(): Promise<DiagnosticResult> {
  try {
    // Priority: services.json > running container > env vars > defaults
    const servicesFile = await loadServicesFile();
    let ollamaUrl = servicesFile?.services?.ollama;

    if (!ollamaUrl) {
      // Try to discover from running container
      const containerPort = discoverOllamaPort();
      if (containerPort) {
        ollamaUrl = `http://127.0.0.1:${containerPort}`;
      } else {
        ollamaUrl = getOllamaUrl();
      }
    }

    // First check if any Ollama (system or container) is responding
    try {
      const response = await fetch(`${ollamaUrl}/api/tags`, {
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
  // Try multiple endpoints for reliability
  const endpoints = [
    'https://api.anthropic.com',
    'https://api.github.com',
    'https://1.1.1.1',
  ];

  for (const endpoint of endpoints) {
    try {
      await fetch(endpoint, {
        method: 'HEAD',
        signal: AbortSignal.timeout(5000)
      });
      return {
        name: 'Network Connectivity',
        status: 'pass',
        message: 'Internet connection available',
      };
    } catch {
      // Try next endpoint
    }
  }

  return {
    name: 'Network Connectivity',
    status: 'warn',
    message: 'Limited connectivity (API calls may fail)',
  };
}
