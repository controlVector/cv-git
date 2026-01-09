/**
 * cv tag command
 * Git tag wrapper
 *
 * Create, list, delete, and verify tags
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

interface TagOptions {
  annotate?: boolean;
  message?: string;
  delete?: boolean;
  force?: boolean;
  list?: boolean;
  sort?: string;
  verify?: boolean;
  verbose?: boolean;
  quiet?: boolean;
  json?: boolean;
}

export function tagCommand(): Command {
  const cmd = new Command('tag');

  cmd
    .description('Create, list, delete, or verify tags (git tag wrapper)')
    .argument('[tagname]', 'Tag name')
    .argument('[commit]', 'Commit to tag (default: HEAD)')
    .option('-a, --annotate', 'Create an annotated tag')
    .option('-m, --message <message>', 'Tag message (implies -a)')
    .option('-d, --delete', 'Delete tag')
    .option('-f, --force', 'Force tag creation/update')
    .option('-l, --list [pattern]', 'List tags matching pattern')
    .option('--sort <key>', 'Sort by key (e.g., -version:refname)')
    .option('-v, --verify', 'Verify tag signature')
    .allowUnknownOption(true);

  addGlobalOptions(cmd);

  cmd.action(async (tagname: string | undefined, commit: string | undefined, options: TagOptions, command: Command) => {
    const output = createOutput(options as any);

    try {
      const repoRoot = findGitRoot();
      if (!repoRoot) {
        console.error(chalk.red('Not in a git repository'));
        process.exit(1);
      }

      // List mode
      if (options.list || (!tagname && !options.delete)) {
        const args = ['tag', '-l'];

        if (typeof options.list === 'string') {
          args.push(options.list);
        }

        if (options.sort) args.push(`--sort=${options.sort}`);

        if (options.json) {
          const tags = getTagsJson(repoRoot, options.sort);
          output.json({ tags });
        } else {
          await runGitTag(args, repoRoot);
        }
        return;
      }

      // Delete mode
      if (options.delete) {
        if (!tagname) {
          console.error(chalk.red('Tag name required for delete'));
          process.exit(1);
        }

        await runGitTag(['tag', '-d', tagname], repoRoot);

        if (!options.quiet) {
          console.log(chalk.green(`✓ Deleted tag ${tagname}`));
        }
        return;
      }

      // Verify mode
      if (options.verify) {
        if (!tagname) {
          console.error(chalk.red('Tag name required for verify'));
          process.exit(1);
        }

        await runGitTag(['tag', '-v', tagname], repoRoot);
        return;
      }

      // Create mode
      if (!tagname) {
        console.log(chalk.yellow('Usage: cv tag <tagname> [commit]'));
        console.log();
        console.log(chalk.gray('Examples:'));
        console.log(chalk.gray('  cv tag v1.0.0                  # Lightweight tag at HEAD'));
        console.log(chalk.gray('  cv tag -a v1.0.0 -m "Release"  # Annotated tag'));
        console.log(chalk.gray('  cv tag -l "v1.*"               # List matching tags'));
        console.log(chalk.gray('  cv tag -d v1.0.0               # Delete tag'));
        console.log();
        console.log(chalk.gray('Tip: Use `cv release create` for full release workflow'));
        return;
      }

      const args = ['tag'];

      if (options.annotate || options.message) {
        args.push('-a');
      }

      if (options.message) {
        args.push('-m', options.message);
      }

      if (options.force) {
        args.push('-f');
      }

      args.push(tagname);

      if (commit) {
        args.push(commit);
      }

      await runGitTag(args, repoRoot);

      if (!options.quiet) {
        console.log(chalk.green(`✓ Created tag ${tagname}`));
        console.log(chalk.gray(`  Push with: cv push --tags`));
      }

      if (options.json) {
        output.json({ success: true, tag: tagname });
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
 * Run git tag command
 */
async function runGitTag(args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const git = spawn('git', args, {
      cwd,
      stdio: 'inherit',
    });

    git.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`git tag failed with code ${code}`));
      }
    });

    git.on('error', reject);
  });
}

/**
 * Get tags as JSON
 */
function getTagsJson(cwd: string, sort?: string): any[] {
  try {
    const args = ['tag', '-l', '--format=%(refname:short)|%(objectname:short)|%(creatordate:iso)|%(subject)'];
    if (sort) args.push(`--sort=${sort}`);

    const output = execSync(args.join(' '), {
      cwd,
      encoding: 'utf-8',
    });

    return output
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(line => {
        const [name, sha, date, message] = line.split('|');
        return {
          name: name.trim(),
          sha: sha.trim(),
          date: date.trim(),
          message: message?.trim() || null,
        };
      });
  } catch {
    return [];
  }
}
