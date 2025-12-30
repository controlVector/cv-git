/**
 * cv watch command
 * File watcher for automatic knowledge graph sync
 *
 * Watches for file changes and automatically syncs the knowledge graph
 * to keep it current during development.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { watch, FSWatcher } from 'chokidar';
import ignore, { Ignore } from 'ignore';
import { spawnSync, execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { addGlobalOptions } from '../utils/output.js';

/**
 * Find git repository root
 */
function findGitRoot(startDir: string = process.cwd()): string | null {
  let currentDir = path.resolve(startDir);
  const root = path.parse(currentDir).root;

  while (currentDir !== root) {
    const gitDir = path.join(currentDir, '.git');
    if (fs.existsSync(gitDir)) {
      return currentDir;
    }
    currentDir = path.dirname(currentDir);
  }

  return null;
}

/**
 * Check if CV is initialized in a git repo
 */
function isCVInitialized(repoRoot: string): boolean {
  const cvConfigPath = path.join(repoRoot, '.cv', 'config.json');
  return fs.existsSync(cvConfigPath);
}

/**
 * Load gitignore patterns
 */
function loadGitignore(repoRoot: string): Ignore {
  const ig = ignore();

  // Always ignore these
  ig.add([
    '.git',
    'node_modules',
    '.cv',
    'dist',
    'build',
    '*.log',
  ]);

  // Load .gitignore
  const gitignorePath = path.join(repoRoot, '.gitignore');
  if (fs.existsSync(gitignorePath)) {
    const content = fs.readFileSync(gitignorePath, 'utf-8');
    ig.add(content);
  }

  // Load .git/info/exclude
  const excludePath = path.join(repoRoot, '.git', 'info', 'exclude');
  if (fs.existsSync(excludePath)) {
    const content = fs.readFileSync(excludePath, 'utf-8');
    ig.add(content);
  }

  return ig;
}

/**
 * Get list of git-tracked files
 */
function getTrackedFiles(repoRoot: string): Set<string> {
  try {
    const output = execSync('git ls-files', {
      cwd: repoRoot,
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer for large repos
    });
    return new Set(output.trim().split('\n').filter(Boolean));
  } catch {
    return new Set();
  }
}

/**
 * Check if file is a code file we care about
 */
function isCodeFile(filePath: string): boolean {
  const codeExtensions = new Set([
    '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
    '.py', '.pyi',
    '.go',
    '.rs',
    '.java',
    '.md', '.markdown',
  ]);
  const ext = path.extname(filePath).toLowerCase();
  return codeExtensions.has(ext);
}

interface WatchOptions {
  debounce?: number;
  verbose?: boolean;
  quiet?: boolean;
}

export function watchCommand(): Command {
  const cmd = new Command('watch');

  cmd
    .description('Watch for file changes and automatically sync knowledge graph')
    .option('-d, --debounce <ms>', 'Debounce interval in milliseconds', '500')
    .option('--no-initial-sync', 'Skip initial sync on start');

  addGlobalOptions(cmd);

  cmd.action(async (options: WatchOptions & { debounce?: string; initialSync?: boolean }) => {
    const repoRoot = findGitRoot();
    if (!repoRoot) {
      console.error(chalk.red('Not in a git repository'));
      process.exit(128);
    }

    if (!isCVInitialized(repoRoot)) {
      console.error(chalk.red('CV not initialized. Run `cv init` first.'));
      process.exit(1);
    }

    const debounceMs = parseInt(options.debounce || '500', 10);

    console.log(chalk.cyan('CV Watch'));
    console.log(chalk.gray(`Repository: ${repoRoot}`));
    console.log(chalk.gray(`Debounce: ${debounceMs}ms`));
    console.log();

    // Initial sync if requested
    if (options.initialSync !== false) {
      const spinner = ora('Running initial sync...').start();
      const result = spawnSync('cv', ['sync', '--incremental'], {
        cwd: repoRoot,
        stdio: ['inherit', 'pipe', 'pipe'],
        encoding: 'utf-8',
      });
      if (result.status === 0) {
        spinner.succeed('Initial sync complete');
      } else {
        spinner.warn('Initial sync had warnings');
      }
      console.log();
    }

    // Load ignore patterns
    const ig = loadGitignore(repoRoot);

    // Track git-tracked files (refresh periodically)
    let trackedFiles = getTrackedFiles(repoRoot);
    const refreshTrackedFiles = () => {
      trackedFiles = getTrackedFiles(repoRoot);
    };

    // Refresh tracked files when git index changes
    const gitIndexPath = path.join(repoRoot, '.git', 'index');

    // Pending changes for debounced sync
    const pendingChanges: Map<string, 'add' | 'change' | 'unlink'> = new Map();
    let syncTimer: NodeJS.Timeout | null = null;
    let syncInProgress = false;

    /**
     * Process pending changes
     */
    const processPendingChanges = async () => {
      if (syncInProgress || pendingChanges.size === 0) return;

      syncInProgress = true;
      const changes = new Map(pendingChanges);
      pendingChanges.clear();

      const added = [...changes.entries()].filter(([_, t]) => t === 'add').length;
      const modified = [...changes.entries()].filter(([_, t]) => t === 'change').length;
      const deleted = [...changes.entries()].filter(([_, t]) => t === 'unlink').length;

      const summary = [
        added > 0 ? `${added} added` : null,
        modified > 0 ? `${modified} modified` : null,
        deleted > 0 ? `${deleted} deleted` : null,
      ].filter(Boolean).join(', ');

      const spinner = ora(`Syncing: ${summary}`).start();

      try {
        const result = spawnSync('cv', ['sync', '--incremental'], {
          cwd: repoRoot,
          stdio: ['inherit', 'pipe', 'pipe'],
          encoding: 'utf-8',
        });

        if (result.status === 0) {
          spinner.succeed(`Synced: ${summary}`);
        } else {
          spinner.warn(`Sync completed with warnings: ${summary}`);
        }
      } catch (error: any) {
        spinner.fail(`Sync failed: ${error.message}`);
      }

      syncInProgress = false;

      // Process any changes that came in during sync
      if (pendingChanges.size > 0) {
        scheduleSync();
      }
    };

    /**
     * Schedule a debounced sync
     */
    const scheduleSync = () => {
      if (syncTimer) {
        clearTimeout(syncTimer);
      }
      syncTimer = setTimeout(processPendingChanges, debounceMs);
    };

    /**
     * Handle file change event
     */
    const handleFileChange = (event: 'add' | 'change' | 'unlink', filePath: string) => {
      // Get relative path
      const relativePath = path.relative(repoRoot, filePath);

      // Skip if ignored
      if (ig.ignores(relativePath)) {
        if (options.verbose) {
          console.log(chalk.gray(`  Ignored: ${relativePath}`));
        }
        return;
      }

      // Skip if not a code file
      if (!isCodeFile(relativePath)) {
        if (options.verbose) {
          console.log(chalk.gray(`  Skipped (not code): ${relativePath}`));
        }
        return;
      }

      // For unlink, always process. For add/change, check if tracked or new
      if (event !== 'unlink') {
        // Allow new files (they might be about to be tracked)
        // and already tracked files
        const isTracked = trackedFiles.has(relativePath);
        const isNew = event === 'add';

        if (!isTracked && !isNew) {
          if (options.verbose) {
            console.log(chalk.gray(`  Skipped (untracked): ${relativePath}`));
          }
          return;
        }
      }

      // Coalesce changes
      const existing = pendingChanges.get(relativePath);
      if (existing) {
        // Coalesce: add + unlink = remove from pending
        if (existing === 'add' && event === 'unlink') {
          pendingChanges.delete(relativePath);
          return;
        }
        // unlink + add = change
        if (existing === 'unlink' && event === 'add') {
          pendingChanges.set(relativePath, 'change');
          scheduleSync();
          return;
        }
        // Keep most significant: unlink > change > add
        if (event === 'unlink') {
          pendingChanges.set(relativePath, 'unlink');
        }
      } else {
        pendingChanges.set(relativePath, event);
      }

      if (!options.quiet) {
        const icon = event === 'add' ? '+' : event === 'unlink' ? '-' : '~';
        const color = event === 'add' ? chalk.green : event === 'unlink' ? chalk.red : chalk.yellow;
        console.log(color(`  ${icon} ${relativePath}`));
      }

      scheduleSync();
    };

    // Create watcher
    console.log(chalk.gray('Starting file watcher...'));

    const watcher: FSWatcher = watch(repoRoot, {
      ignored: [
        /node_modules/,
        /\.git/,
        /\.cv/,
        /dist/,
        /build/,
        /coverage/,
        /\.next/,
        /\.nuxt/,
        /target/,
        /venv/,
        /\.venv/,
        /__pycache__/,
      ],
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 50,
      },
      usePolling: false,
    });

    // Watch git index for tracked file changes
    const gitWatcher = watch(gitIndexPath, {
      persistent: true,
      ignoreInitial: true,
    });

    gitWatcher.on('change', () => {
      if (options.verbose) {
        console.log(chalk.gray('  Git index changed, refreshing tracked files'));
      }
      refreshTrackedFiles();
    });

    // Set up event handlers
    watcher
      .on('add', (filePath) => handleFileChange('add', filePath))
      .on('change', (filePath) => handleFileChange('change', filePath))
      .on('unlink', (filePath) => handleFileChange('unlink', filePath))
      .on('error', (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error(chalk.red(`Watcher error: ${message}`));
      })
      .on('ready', () => {
        console.log(chalk.green('Watching for changes...'));
        console.log(chalk.gray('Press Ctrl+C to stop'));
        console.log();
      });

    // Handle shutdown
    const shutdown = async () => {
      console.log();
      console.log(chalk.gray('Stopping watcher...'));

      // Process any pending changes before exit
      if (pendingChanges.size > 0) {
        if (syncTimer) clearTimeout(syncTimer);
        await processPendingChanges();
      }

      await watcher.close();
      await gitWatcher.close();
      console.log(chalk.green('Watcher stopped'));
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  });

  return cmd;
}
