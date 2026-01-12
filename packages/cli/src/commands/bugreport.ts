/**
 * cv bugreport command
 * Collect diagnostic information and submit bug reports
 */

import { Command } from 'commander';
import chalk from 'chalk';
import * as os from 'os';
import * as fs from 'fs/promises';
import * as path from 'path';
import { execSync } from 'child_process';
import {
  findRepoRoot,
  getCVDir
} from '@cv-git/shared';
import { configManager, SyncReport } from '@cv-git/core';
import { addGlobalOptions } from '../utils/output.js';

interface BugReportData {
  timestamp: string;
  cvGitVersion: string;
  system: {
    platform: string;
    release: string;
    arch: string;
    nodeVersion: string;
    npmVersion: string;
  };
  git: {
    version: string;
    inRepo: boolean;
    branch?: string;
    remoteUrl?: string;
  };
  services: {
    falkordb: string;
    qdrant: string;
    docker: string;
  };
  config: {
    hasCV: boolean;
    graphEnabled: boolean;
    vectorEnabled: boolean;
  };
  recentLogs?: string[];
  syncReport?: SyncReport;
  errorContext?: string;
  userDescription?: string;
}

/**
 * Safely execute a command and return result
 */
function safeExec(cmd: string): string {
  try {
    return execSync(cmd, { encoding: 'utf8', timeout: 5000 }).trim();
  } catch {
    return 'unavailable';
  }
}

/**
 * Collect system information
 */
async function collectSystemInfo(): Promise<BugReportData['system']> {
  return {
    platform: `${os.platform()} ${os.release()}`,
    release: os.release(),
    arch: os.arch(),
    nodeVersion: process.version,
    npmVersion: safeExec('npm --version')
  };
}

/**
 * Collect git information
 */
async function collectGitInfo(): Promise<BugReportData['git']> {
  const version = safeExec('git --version');
  const inRepo = safeExec('git rev-parse --is-inside-work-tree') === 'true';

  if (!inRepo) {
    return { version, inRepo };
  }

  return {
    version,
    inRepo,
    branch: safeExec('git branch --show-current'),
    remoteUrl: sanitizeRemoteUrl(safeExec('git remote get-url origin 2>/dev/null'))
  };
}

/**
 * Remove sensitive info from remote URL
 */
function sanitizeRemoteUrl(url: string): string {
  if (!url || url === 'unavailable') return url;
  // Remove tokens/credentials from URLs
  return url
    .replace(/\/\/[^@]+@/, '//***@')  // Remove credentials
    .replace(/ghp_[a-zA-Z0-9]+/, 'ghp_***')  // GitHub tokens
    .replace(/glpat-[a-zA-Z0-9]+/, 'glpat-***');  // GitLab tokens
}

/**
 * Collect service status
 */
async function collectServiceInfo(): Promise<BugReportData['services']> {
  const docker = safeExec('docker --version');

  // Check FalkorDB
  let falkordb = 'not running';
  try {
    const result = safeExec('docker ps --filter "name=falkordb" --format "{{.Status}}"');
    if (result && result.includes('Up')) {
      falkordb = 'running';
    }
  } catch {
    falkordb = 'unavailable';
  }

  // Check Qdrant
  let qdrant = 'not running';
  try {
    const result = safeExec('docker ps --filter "name=qdrant" --format "{{.Status}}"');
    if (result && result.includes('Up')) {
      qdrant = 'running';
    }
  } catch {
    qdrant = 'unavailable';
  }

  return { falkordb, qdrant, docker };
}

/**
 * Collect cv-git config info
 */
async function collectConfigInfo(repoRoot: string | null): Promise<BugReportData['config']> {
  if (!repoRoot) {
    return { hasCV: false, graphEnabled: false, vectorEnabled: false };
  }

  const cvDir = getCVDir(repoRoot);
  let hasCV = false;
  try {
    await fs.access(cvDir);
    hasCV = true;
  } catch {
    hasCV = false;
  }

  // Load config
  try {
    const config = await configManager.load(repoRoot);
    return {
      hasCV,
      graphEnabled: !!config?.graph,
      vectorEnabled: !!config?.vector
    };
  } catch {
    return { hasCV, graphEnabled: false, vectorEnabled: false };
  }
}

/**
 * Read recent error logs from .cv directory
 */
async function collectRecentLogs(repoRoot: string | null): Promise<string[]> {
  if (!repoRoot) return [];

  const logs: string[] = [];
  const cvDir = getCVDir(repoRoot);
  const logFile = path.join(cvDir, 'error.log');

  try {
    const content = await fs.readFile(logFile, 'utf8');
    // Get last 50 lines, sanitized
    const lines = content.split('\n').slice(-50);
    return lines.map(line => sanitizeLine(line));
  } catch {
    return [];
  }
}

/**
 * Read the most recent sync report from .cv directory
 */
async function collectSyncReport(repoRoot: string | null): Promise<SyncReport | undefined> {
  if (!repoRoot) return undefined;

  const cvDir = getCVDir(repoRoot);
  const reportFile = path.join(cvDir, 'sync-report.json');

  try {
    const content = await fs.readFile(reportFile, 'utf8');
    return JSON.parse(content) as SyncReport;
  } catch {
    return undefined;
  }
}

/**
 * Sanitize log lines to remove sensitive info
 */
function sanitizeLine(line: string): string {
  return line
    .replace(/Bearer [a-zA-Z0-9._-]+/g, 'Bearer ***')
    .replace(/token=[a-zA-Z0-9._-]+/gi, 'token=***')
    .replace(/password=[^\s&]+/gi, 'password=***')
    .replace(/api[_-]?key=[a-zA-Z0-9._-]+/gi, 'api_key=***')
    .replace(/sk-[a-zA-Z0-9]+/g, 'sk-***')
    .replace(/ghp_[a-zA-Z0-9]+/g, 'ghp_***');
}

/**
 * Format report for display
 */
function formatReport(data: BugReportData): string {
  const lines: string[] = [
    '# CV-Git Bug Report',
    '',
    `**Generated:** ${data.timestamp}`,
    `**CV-Git Version:** ${data.cvGitVersion}`,
    '',
    '## System Information',
    `- Platform: ${data.system.platform}`,
    `- Architecture: ${data.system.arch}`,
    `- Node.js: ${data.system.nodeVersion}`,
    `- npm: ${data.system.npmVersion}`,
    '',
    '## Git Information',
    `- Git Version: ${data.git.version}`,
    `- In Repository: ${data.git.inRepo}`,
  ];

  if (data.git.branch) {
    lines.push(`- Branch: ${data.git.branch}`);
  }
  if (data.git.remoteUrl) {
    lines.push(`- Remote: ${data.git.remoteUrl}`);
  }

  lines.push('');
  lines.push('## Services');
  lines.push(`- Docker: ${data.services.docker}`);
  lines.push(`- FalkorDB: ${data.services.falkordb}`);
  lines.push(`- Qdrant: ${data.services.qdrant}`);

  lines.push('');
  lines.push('## Configuration');
  lines.push(`- CV Directory: ${data.config.hasCV ? 'present' : 'missing'}`);
  lines.push(`- Graph Enabled: ${data.config.graphEnabled}`);
  lines.push(`- Vector Enabled: ${data.config.vectorEnabled}`);

  if (data.errorContext) {
    lines.push('');
    lines.push('## Error Context');
    lines.push('```');
    lines.push(data.errorContext);
    lines.push('```');
  }

  if (data.userDescription) {
    lines.push('');
    lines.push('## Description');
    lines.push(data.userDescription);
  }

  if (data.syncReport) {
    lines.push('');
    lines.push('## Last Sync Report');
    lines.push(`- Timestamp: ${new Date(data.syncReport.timestamp).toISOString()}`);
    lines.push(`- Type: ${data.syncReport.type}`);
    lines.push(`- Success: ${data.syncReport.success}`);
    lines.push(`- Duration: ${data.syncReport.duration}s`);
    lines.push(`- Files Processed: ${data.syncReport.stats.filesProcessed}`);
    lines.push(`- Files Failed: ${data.syncReport.stats.filesFailed}`);

    if (data.syncReport.errors.length > 0) {
      lines.push('');
      lines.push('### Sync Errors (last 20)');
      lines.push('```');
      const recentErrors = data.syncReport.errors.slice(-20);
      for (const err of recentErrors) {
        lines.push(`[${err.phase}] ${err.file}: ${err.error}`);
      }
      lines.push('```');
    }
  }

  if (data.recentLogs && data.recentLogs.length > 0) {
    lines.push('');
    lines.push('## Recent Logs');
    lines.push('```');
    lines.push(data.recentLogs.join('\n'));
    lines.push('```');
  }

  return lines.join('\n');
}

/**
 * Get CV-Git version
 */
function getCVGitVersion(): string {
  try {
    // Try to get from package.json
    const result = safeExec('cv --version 2>/dev/null');
    return result || 'unknown';
  } catch {
    return 'unknown';
  }
}

export function bugreportCommand(): Command {
  const cmd = new Command('bugreport');

  cmd
    .description('Generate a bug report with diagnostic information')
    .option('-o, --output <file>', 'Write report to file instead of stdout')
    .option('--copy', 'Copy report to clipboard (requires xclip/pbcopy)')
    .option('--open-issue', 'Open GitHub issues page in browser')
    .option('-m, --message <msg>', 'Add description to the report')
    .option('--error <context>', 'Include error context/message');

  addGlobalOptions(cmd);

  cmd.action(async (options) => {
    console.log(chalk.cyan('Collecting diagnostic information...\n'));

    // Find repo root
    const repoRoot = await findRepoRoot();

    // Collect all information
    const data: BugReportData = {
      timestamp: new Date().toISOString(),
      cvGitVersion: getCVGitVersion(),
      system: await collectSystemInfo(),
      git: await collectGitInfo(),
      services: await collectServiceInfo(),
      config: await collectConfigInfo(repoRoot),
      recentLogs: await collectRecentLogs(repoRoot),
      syncReport: await collectSyncReport(repoRoot),
      errorContext: options.error,
      userDescription: options.message
    };

    const report = formatReport(data);

    // Output options
    if (options.output) {
      await fs.writeFile(options.output, report, 'utf8');
      console.log(chalk.green(`✓ Report written to ${options.output}`));
    } else {
      console.log(report);
    }

    // Copy to clipboard
    if (options.copy) {
      try {
        const platform = os.platform();
        if (platform === 'darwin') {
          execSync('pbcopy', { input: report });
        } else if (platform === 'linux') {
          execSync('xclip -selection clipboard', { input: report });
        } else if (platform === 'win32') {
          execSync('clip', { input: report });
        }
        console.log(chalk.green('✓ Report copied to clipboard'));
      } catch {
        console.log(chalk.yellow('Could not copy to clipboard (install xclip on Linux)'));
      }
    }

    // Open GitHub issues
    if (options.openIssue) {
      const issueUrl = 'https://github.com/controlVector/cv-git/issues/new';
      try {
        const platform = os.platform();
        if (platform === 'darwin') {
          execSync(`open "${issueUrl}"`);
        } else if (platform === 'linux') {
          execSync(`xdg-open "${issueUrl}"`);
        } else if (platform === 'win32') {
          execSync(`start "${issueUrl}"`);
        }
        console.log(chalk.cyan('\nOpened GitHub issues page. Paste the report above.'));
      } catch {
        console.log(chalk.yellow(`\nCould not open browser. Visit: ${issueUrl}`));
      }
    }

    // Always show the GitHub URL
    console.log(chalk.gray('\n---'));
    console.log(chalk.cyan('To submit this report:'));
    console.log(chalk.white('  1. Visit: https://github.com/controlVector/cv-git/issues/new'));
    console.log(chalk.white('  2. Paste the report above'));
    console.log(chalk.white('  3. Add any additional context'));
    console.log(chalk.gray('\nOr use: cv bugreport --copy --open-issue'));
  });

  return cmd;
}
