/**
 * System operation tools
 * Handles configuration, status, and diagnostics
 */

import { ConfigManager } from '@cv-git/core';
import { GitManager } from '@cv-git/core';
import { exec } from 'child_process';
import { promisify } from 'util';
import { ToolResult } from '../types.js';
import { successResult, errorResult } from '../utils.js';
import * as path from 'path';
import { getAnthropicApiKey, getOpenAIApiKey, getOpenRouterApiKey } from '../credentials.js';

const execAsync = promisify(exec);

interface ConfigGetArgs {
  key: string;
}

/**
 * Get configuration value
 */
export async function handleConfigGet(args: ConfigGetArgs): Promise<ToolResult> {
  try {
    const { key } = args;
    const repoRoot = process.cwd();

    const configManager = new ConfigManager();
    await configManager.load(repoRoot);
    const config = configManager.get();

    // Navigate nested keys (e.g., "ai.model")
    const keys = key.split('.');
    let value: any = config;

    for (const k of keys) {
      if (value && typeof value === 'object' && k in value) {
        value = value[k];
      } else {
        return errorResult(`Configuration key not found: ${key}`, new Error('Key not found'));
      }
    }

    let output = `Configuration: ${key}\n\n`;

    if (typeof value === 'object') {
      output += JSON.stringify(value, null, 2);
    } else {
      output += `Value: ${value}`;
    }

    return successResult(output);
  } catch (error: any) {
    return errorResult('Failed to get configuration', error);
  }
}

/**
 * Get CV-Git status
 */
export async function handleStatus(): Promise<ToolResult> {
  try {
    const repoRoot = process.cwd();

    // Check if it's a git repo
    const gitManager = new GitManager(repoRoot);
    const isGitRepo = await gitManager.isGitRepo();

    if (!isGitRepo) {
      return errorResult('Not a git repository', new Error('Current directory is not a git repository'));
    }

    let output = '📊 CV-Git Status\n\n';

    // Git information
    const branch = await gitManager.getCurrentBranch();
    const status = await gitManager.getStatus();

    output += `Git Repository:\n`;
    output += `  Branch: ${branch}\n`;

    const totalChanges =
      status.modified.length +
      status.added.length +
      status.deleted.length +
      status.untracked.length;

    if (totalChanges > 0) {
      output += `  Changes:\n`;
      if (status.modified.length > 0) {
        output += `    Modified: ${status.modified.length} file(s)\n`;
      }
      if (status.added.length > 0) {
        output += `    Added: ${status.added.length} file(s)\n`;
      }
      if (status.deleted.length > 0) {
        output += `    Deleted: ${status.deleted.length} file(s)\n`;
      }
      if (status.untracked.length > 0) {
        output += `    Untracked: ${status.untracked.length} file(s)\n`;
      }
    } else {
      output += `  Working tree clean\n`;
    }

    output += '\n';

    // CV-Git information
    try {
      const configManager = new ConfigManager();
      await configManager.load(repoRoot);
      const config = configManager.get();

      output += `CV-Git:\n`;
      output += `  ✓ Initialized\n`;
      output += `  Repository: ${config.repository.name}\n`;
      output += `  Version: ${config.version}\n`;

      // Check services
      output += '\nServices:\n';

      // Check FalkorDB (using TCP port check)
      try {
        const { stdout } = await execAsync('timeout 1 bash -c "</dev/tcp/localhost/6379" 2>/dev/null && echo "open" || echo "closed"', { timeout: 2000 });
        if (stdout.trim() === 'open') {
          output += `  ✓ FalkorDB: Running (localhost:6379)\n`;
        } else {
          output += `  ✗ FalkorDB: Not responding\n`;
        }
      } catch {
        output += `  ✗ FalkorDB: Not available\n`;
      }

      // Check Qdrant
      try {
        const { stdout } = await execAsync('curl -s http://localhost:6333/healthz', { timeout: 2000 });
        if (stdout) {
          output += `  ✓ Qdrant: Running (localhost:6333)\n`;
        } else {
          output += `  ✗ Qdrant: Not responding\n`;
        }
      } catch {
        output += `  ✗ Qdrant: Not available\n`;
      }

    } catch (error: any) {
      output += `CV-Git:\n`;
      output += `  Not initialized (run 'cv init')\n`;
    }

    return successResult(output.trim());
  } catch (error: any) {
    return errorResult('Failed to get status', error);
  }
}

/**
 * Run diagnostics
 */
export async function handleDoctor(): Promise<ToolResult> {
  try {
    const repoRoot = process.cwd();
    const checks: Array<{ name: string; status: 'pass' | 'warn' | 'fail'; message: string }> = [];

    // Check 1: Git installation
    try {
      const { stdout } = await execAsync('git --version');
      checks.push({
        name: 'Git Installation',
        status: 'pass',
        message: stdout.trim()
      });
    } catch {
      checks.push({
        name: 'Git Installation',
        status: 'fail',
        message: 'Git is not installed'
      });
    }

    // Check 2: Git repository
    try {
      const gitManager = new GitManager(repoRoot);
      const isRepo = await gitManager.isGitRepo();
      if (isRepo) {
        checks.push({
          name: 'Git Repository',
          status: 'pass',
          message: 'Current directory is a git repository'
        });
      } else {
        checks.push({
          name: 'Git Repository',
          status: 'fail',
          message: 'Not a git repository'
        });
      }
    } catch {
      checks.push({
        name: 'Git Repository',
        status: 'fail',
        message: 'Not a git repository'
      });
    }

    // Check 3: Node.js version
    const nodeVersion = process.version;
    const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0]);
    if (majorVersion >= 18) {
      checks.push({
        name: 'Node.js Version',
        status: 'pass',
        message: `${nodeVersion} (>= 18.0.0 required)`
      });
    } else {
      checks.push({
        name: 'Node.js Version',
        status: 'fail',
        message: `${nodeVersion} (>= 18.0.0 required)`
      });
    }

    // Check 4: CV-Git initialization
    try {
      const configManager = new ConfigManager();
      await configManager.load(repoRoot);
      checks.push({
        name: 'CV-Git Initialization',
        status: 'pass',
        message: 'CV-Git is initialized'
      });
    } catch {
      checks.push({
        name: 'CV-Git Initialization',
        status: 'warn',
        message: 'CV-Git not initialized (run: cv init)'
      });
    }

    // Check 5: FalkorDB (using TCP port check instead of redis-cli)
    try {
      const { stdout } = await execAsync('timeout 1 bash -c "</dev/tcp/localhost/6379" 2>/dev/null && echo "open" || echo "closed"', { timeout: 2000 });
      if (stdout.trim() === 'open') {
        checks.push({
          name: 'FalkorDB (Knowledge Graph)',
          status: 'pass',
          message: 'Running on localhost:6379'
        });
      } else {
        checks.push({
          name: 'FalkorDB (Knowledge Graph)',
          status: 'fail',
          message: 'Not responding'
        });
      }
    } catch {
      checks.push({
        name: 'FalkorDB (Knowledge Graph)',
        status: 'warn',
        message: 'Not available. Start with: docker run -d --name falkordb -p 6379:6379 falkordb/falkordb'
      });
    }

    // Check 6: Qdrant
    try {
      const { stdout } = await execAsync('curl -s http://localhost:6333/healthz', { timeout: 2000 });
      if (stdout) {
        checks.push({
          name: 'Qdrant (Vector Search)',
          status: 'pass',
          message: 'Running on localhost:6333'
        });
      } else {
        checks.push({
          name: 'Qdrant (Vector Search)',
          status: 'fail',
          message: 'Not responding'
        });
      }
    } catch {
      checks.push({
        name: 'Qdrant (Vector Search)',
        status: 'warn',
        message: 'Not available. Start with: docker run -d --name qdrant -p 6333:6333 qdrant/qdrant'
      });
    }

    // Check 7: API Keys (from credential manager)
    const anthropicKey = await getAnthropicApiKey();
    const openaiKey = await getOpenAIApiKey();
    const openrouterKey = await getOpenRouterApiKey();

    if (anthropicKey) {
      checks.push({
        name: 'Anthropic API Key',
        status: 'pass',
        message: 'Configured (via credential manager)'
      });
    } else {
      checks.push({
        name: 'Anthropic API Key',
        status: 'warn',
        message: 'Not set. Run: cv auth setup anthropic'
      });
    }

    if (openaiKey || openrouterKey) {
      const provider = openrouterKey ? 'OpenRouter' : 'OpenAI';
      checks.push({
        name: 'Embedding API Key',
        status: 'pass',
        message: `Configured via ${provider} (credential manager)`
      });
    } else {
      checks.push({
        name: 'Embedding API Key',
        status: 'warn',
        message: 'Not set. Run: cv auth setup openai (or openrouter)'
      });
    }

    // Format output
    let output = '🔍 CV-Git Diagnostics\n\n';

    for (const check of checks) {
      const icon = check.status === 'pass' ? '✓' : check.status === 'warn' ? '⚠' : '✗';
      output += `${icon} ${check.name}\n`;
      output += `  ${check.message}\n\n`;
    }

    // Summary
    const passed = checks.filter(c => c.status === 'pass').length;
    const warned = checks.filter(c => c.status === 'warn').length;
    const failed = checks.filter(c => c.status === 'fail').length;

    output += 'Summary:\n';
    output += `  ✓ ${passed} passed\n`;
    if (warned > 0) output += `  ⚠ ${warned} warnings\n`;
    if (failed > 0) output += `  ✗ ${failed} failed\n`;

    return successResult(output.trim());
  } catch (error: any) {
    return errorResult('Failed to run diagnostics', error);
  }
}
