/**
 * cv add command
 * Git add with knowledge graph awareness
 *
 * Stages files for commit, with optional knowledge graph context
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { spawn, execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { addGlobalOptions, createOutput } from '../utils/output.js';

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

interface AddOptions {
  all?: boolean;
  patch?: boolean;
  interactive?: boolean;
  update?: boolean;
  intent?: boolean;
  dryRun?: boolean;
  verbose?: boolean;
  quiet?: boolean;
  json?: boolean;
}

export function addCommand(): Command {
  const cmd = new Command('add');

  cmd
    .description('Stage files for commit (git add wrapper)')
    .argument('[files...]', 'Files to stage')
    .option('-A, --all', 'Stage all changes (new, modified, deleted)')
    .option('-p, --patch', 'Interactively select hunks to stage')
    .option('-i, --interactive', 'Interactive mode')
    .option('-u, --update', 'Stage modified and deleted files only')
    .option('-N, --intent-to-add', 'Record only that path will be added later')
    .option('-n, --dry-run', 'Show what would be staged')
    .allowUnknownOption(true);

  addGlobalOptions(cmd);

  cmd.action(async (files: string[], options: AddOptions, command: Command) => {
    const output = createOutput(options as any);

    try {
      const repoRoot = findGitRoot();
      if (!repoRoot) {
        console.error(chalk.red('Not in a git repository'));
        process.exit(1);
      }

      // Build git add arguments
      const args = ['add'];

      if (options.all) args.push('--all');
      if (options.patch) args.push('--patch');
      if (options.interactive) args.push('--interactive');
      if (options.update) args.push('--update');
      if (options.intent) args.push('--intent-to-add');
      if (options.dryRun) args.push('--dry-run');
      if (options.verbose) args.push('--verbose');

      // Add extra passthrough arguments
      const extraArgs = command.args.filter(arg =>
        !['--all', '-A', '--patch', '-p', '--interactive', '-i',
         '--update', '-u', '--intent-to-add', '-N', '--dry-run', '-n',
         '--verbose', '--quiet', '--json', '--options'].includes(arg)
      );
      args.push(...extraArgs);

      // Add files
      if (files.length > 0) {
        args.push(...files);
      } else if (!options.all && !options.update && !options.patch && !options.interactive) {
        // No files specified and no flags that imply all files
        console.log(chalk.yellow('No files specified.'));
        console.log(chalk.gray('Usage: cv add <files...> or cv add --all'));
        console.log();
        console.log(chalk.gray('Examples:'));
        console.log(chalk.gray('  cv add .              # Stage all changes in current directory'));
        console.log(chalk.gray('  cv add -A             # Stage all changes'));
        console.log(chalk.gray('  cv add file.ts        # Stage specific file'));
        console.log(chalk.gray('  cv add -p             # Interactive patch mode'));
        return;
      }

      // Run git add
      if (options.json) {
        // For JSON output, capture what was staged
        const result = await runGitAdd(args, repoRoot, true);
        const staged = await getStagedFiles(repoRoot);
        output.json({ success: true, staged });
      } else {
        // Normal output
        await runGitAdd(args, repoRoot, options.verbose || false);

        if (!options.quiet && !options.dryRun) {
          // Show what was staged
          const staged = await getStagedFiles(repoRoot);
          if (staged.length > 0) {
            console.log(chalk.green(`✓ Staged ${staged.length} file(s)`));
            if (options.verbose) {
              staged.forEach(f => console.log(chalk.gray(`  ${f}`)));
            }
          }
        }
      }

    } catch (error: any) {
      if (options.json) {
        output.json({ success: false, error: error.message });
      } else {
        console.error(chalk.red(`Error: ${error.message}`));
      }
      process.exit(1);
    }
  });

  return cmd;
}

/**
 * Run git add command
 */
async function runGitAdd(args: string[], cwd: string, verbose: boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    const git = spawn('git', args, {
      cwd,
      stdio: verbose ? 'inherit' : ['inherit', 'pipe', 'pipe'],
    });

    let stderr = '';

    if (!verbose) {
      git.stderr?.on('data', (data) => {
        stderr += data.toString();
      });
    }

    git.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(stderr || `git add failed with code ${code}`));
      }
    });

    git.on('error', (error) => {
      reject(error);
    });
  });
}

/**
 * Get list of staged files
 */
async function getStagedFiles(cwd: string): Promise<string[]> {
  try {
    const output = execSync('git diff --cached --name-only', {
      cwd,
      encoding: 'utf-8',
    });
    return output.trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}
