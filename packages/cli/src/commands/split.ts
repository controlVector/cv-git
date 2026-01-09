/**
 * cv split command
 * Interactively split a commit into multiple commits
 *
 * Helps break down large commits into smaller, atomic commits
 * for better review and history.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { execSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
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

interface SplitOptions {
  byFile?: boolean;
  interactive?: boolean;
  verbose?: boolean;
  quiet?: boolean;
  json?: boolean;
}

interface FileChange {
  file: string;
  status: string;
  insertions: number;
  deletions: number;
}

export function splitCommand(): Command {
  const cmd = new Command('split');

  cmd
    .description('Split a commit into multiple smaller commits')
    .argument('[commit]', 'Commit to split (default: HEAD)')
    .option('--by-file', 'Automatically split by file (one commit per file)')
    .option('-i, --interactive', 'Interactive mode (select files for each commit)')
    .option('-v, --verbose', 'Show detailed information');

  addGlobalOptions(cmd);

  cmd.action(async (commit: string | undefined, options: SplitOptions) => {
    const output = createOutput(options as any);

    try {
      const repoRoot = findGitRoot();
      if (!repoRoot) {
        console.error(chalk.red('Not in a git repository'));
        process.exit(1);
      }

      const targetCommit = commit || 'HEAD';

      // Check for uncommitted changes
      const status = execSync('git status --porcelain', {
        cwd: repoRoot,
        encoding: 'utf-8',
      }).trim();

      if (status) {
        console.error(chalk.red('You have uncommitted changes.'));
        console.log(chalk.gray('Commit or stash them first: cv stash'));
        process.exit(1);
      }

      // Get commit info
      const commitHash = execSync(`git rev-parse ${targetCommit}`, {
        cwd: repoRoot,
        encoding: 'utf-8',
      }).trim();

      const commitSubject = execSync(`git log -1 --format="%s" ${commitHash}`, {
        cwd: repoRoot,
        encoding: 'utf-8',
      }).trim();

      const shortHash = commitHash.substring(0, 7);

      // Check if this is the root commit
      let isRoot = false;
      try {
        execSync(`git rev-parse ${commitHash}^`, {
          cwd: repoRoot,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch {
        isRoot = true;
      }

      // Get files changed in the commit
      const changedFiles = getChangedFiles(repoRoot, commitHash, isRoot);

      if (changedFiles.length === 0) {
        console.log(chalk.yellow('No files changed in this commit'));
        return;
      }

      if (changedFiles.length === 1) {
        console.log(chalk.yellow('Only one file changed - nothing to split'));
        console.log(chalk.gray(`File: ${changedFiles[0].file}`));
        return;
      }

      console.log(chalk.cyan('Split Commit\n'));
      console.log(chalk.gray(`Target: ${shortHash} "${commitSubject}"`));
      console.log(chalk.gray(`Files:  ${changedFiles.length} changed\n`));

      // Show files
      for (const change of changedFiles) {
        const stats = change.insertions || change.deletions
          ? chalk.gray(` (+${change.insertions}/-${change.deletions})`)
          : '';
        console.log(`  ${chalk.yellow(change.status)} ${change.file}${stats}`);
      }

      console.log();

      if (options.byFile) {
        await splitByFile(repoRoot, commitHash, changedFiles, commitSubject, isRoot, options);
      } else if (options.interactive) {
        await splitInteractive(repoRoot, commitHash, changedFiles, commitSubject, isRoot, options);
      } else {
        // Default: show instructions for manual split
        console.log(chalk.cyan('Split options:\n'));
        console.log(chalk.gray('  cv split --by-file       Auto-split: one commit per file'));
        console.log(chalk.gray('  cv split --interactive   Interactive: choose files for each commit'));
        console.log();
        console.log(chalk.gray('Manual split process:'));
        console.log(chalk.gray(`  1. git reset HEAD^       # Unstage the commit`));
        console.log(chalk.gray('  2. git add <files>       # Stage first group'));
        console.log(chalk.gray('  3. git commit            # Create first commit'));
        console.log(chalk.gray('  4. Repeat 2-3 for remaining files'));
      }

      if (options.json) {
        output.json({
          commit: shortHash,
          subject: commitSubject,
          files: changedFiles,
        });
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
 * Get files changed in a commit
 */
function getChangedFiles(cwd: string, commit: string, isRoot: boolean): FileChange[] {
  try {
    // For root commit, use empty tree
    const diffCmd = isRoot
      ? `git diff-tree --no-commit-id --name-status -r ${commit}`
      : `git diff-tree --no-commit-id --name-status -r ${commit}`;

    const output = execSync(diffCmd, {
      cwd,
      encoding: 'utf-8',
    }).trim();

    if (!output) return [];

    const files: FileChange[] = [];

    for (const line of output.split('\n')) {
      const [status, ...fileParts] = line.split('\t');
      const file = fileParts.join('\t'); // Handle files with tabs (rare)

      // Get stats for this file
      let insertions = 0;
      let deletions = 0;

      try {
        const statCmd = isRoot
          ? `git diff --numstat 4b825dc642cb6eb9a060e54bf8d69288fbee4904 ${commit} -- "${file}"`
          : `git diff --numstat ${commit}^ ${commit} -- "${file}"`;

        const stats = execSync(statCmd, {
          cwd,
          encoding: 'utf-8',
        }).trim();

        if (stats) {
          const [ins, del] = stats.split('\t');
          insertions = parseInt(ins, 10) || 0;
          deletions = parseInt(del, 10) || 0;
        }
      } catch {
        // Ignore stats errors
      }

      files.push({
        file,
        status: status.trim(),
        insertions,
        deletions,
      });
    }

    return files;

  } catch {
    return [];
  }
}

/**
 * Split commit by file (one commit per file)
 */
async function splitByFile(
  cwd: string,
  commit: string,
  files: FileChange[],
  originalSubject: string,
  isRoot: boolean,
  options: SplitOptions
) {
  console.log(chalk.cyan('Splitting by file...\n'));

  // Save current HEAD for recovery
  const originalHead = execSync('git rev-parse HEAD', {
    cwd,
    encoding: 'utf-8',
  }).trim();

  try {
    // Reset to before the commit (soft to keep changes)
    if (isRoot) {
      // For root commit, we need to use update-ref
      execSync('git update-ref -d HEAD', { cwd, stdio: 'pipe' });
    } else {
      execSync(`git reset --soft ${commit}^`, { cwd, stdio: 'pipe' });
    }

    // Unstage everything
    try {
      execSync('git reset HEAD', { cwd, stdio: 'pipe' });
    } catch {
      // Ignore if nothing to unstage
    }

    const createdCommits: string[] = [];

    // Create a commit for each file
    for (let i = 0; i < files.length; i++) {
      const file = files[i];

      // Stage just this file
      if (file.status === 'D') {
        execSync(`git rm "${file.file}"`, { cwd, stdio: 'pipe' });
      } else {
        execSync(`git add "${file.file}"`, { cwd, stdio: 'pipe' });
      }

      // Create commit
      const subject = files.length > 1
        ? `${originalSubject} (${i + 1}/${files.length}: ${path.basename(file.file)})`
        : originalSubject;

      execSync(`git commit -m "${subject}"`, { cwd, stdio: 'pipe' });

      const newCommit = execSync('git rev-parse --short HEAD', {
        cwd,
        encoding: 'utf-8',
      }).trim();

      createdCommits.push(newCommit);

      if (!options.quiet) {
        console.log(chalk.green(`✓ ${newCommit} ${path.basename(file.file)}`));
      }
    }

    console.log(chalk.green(`\n✓ Split into ${createdCommits.length} commits`));

    if (options.verbose) {
      console.log(chalk.gray('\nTo undo this split:'));
      console.log(chalk.gray(`  git reset --hard ${originalHead.substring(0, 7)}`));
    }

  } catch (error: any) {
    // Try to recover
    console.error(chalk.red(`\nSplit failed: ${error.message}`));
    console.log(chalk.yellow('Attempting to recover...'));

    try {
      execSync(`git reset --hard ${originalHead}`, { cwd, stdio: 'pipe' });
      console.log(chalk.green('Recovered to original state'));
    } catch {
      console.error(chalk.red('Recovery failed. Use git reflog to recover.'));
    }

    process.exit(1);
  }
}

/**
 * Split commit interactively
 */
async function splitInteractive(
  cwd: string,
  commit: string,
  files: FileChange[],
  originalSubject: string,
  isRoot: boolean,
  options: SplitOptions
) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const question = (prompt: string): Promise<string> => {
    return new Promise((resolve) => {
      rl.question(prompt, resolve);
    });
  };

  console.log(chalk.cyan('Interactive split mode\n'));
  console.log(chalk.gray('For each commit, enter file numbers to include (e.g., "1,3,4" or "1-3")'));
  console.log(chalk.gray('Enter "done" when finished, "abort" to cancel\n'));

  // Number the files
  files.forEach((f, i) => {
    console.log(`  ${chalk.yellow((i + 1).toString().padStart(2))}. ${f.file}`);
  });

  console.log();

  // Save current HEAD for recovery
  const originalHead = execSync('git rev-parse HEAD', {
    cwd,
    encoding: 'utf-8',
  }).trim();

  // Reset to before the commit
  try {
    if (isRoot) {
      execSync('git update-ref -d HEAD', { cwd, stdio: 'pipe' });
    } else {
      execSync(`git reset --soft ${commit}^`, { cwd, stdio: 'pipe' });
    }
    execSync('git reset HEAD', { cwd, stdio: 'pipe' });
  } catch {
    // Ignore
  }

  const remainingFiles = new Set(files.map((_, i) => i));
  const createdCommits: string[] = [];
  let commitNum = 1;

  try {
    while (remainingFiles.size > 0) {
      console.log(chalk.gray(`\nRemaining files: ${Array.from(remainingFiles).map(i => i + 1).join(', ')}`));

      const input = await question(chalk.cyan(`Commit ${commitNum} files: `));

      if (input.toLowerCase() === 'abort') {
        console.log(chalk.yellow('\nAborting...'));
        execSync(`git reset --hard ${originalHead}`, { cwd, stdio: 'pipe' });
        console.log(chalk.green('Restored original state'));
        rl.close();
        return;
      }

      if (input.toLowerCase() === 'done') {
        if (remainingFiles.size > 0) {
          console.log(chalk.yellow(`${remainingFiles.size} files will remain uncommitted`));
        }
        break;
      }

      // Parse file selection
      const selected = parseSelection(input, files.length);
      const validSelected = selected.filter(i => remainingFiles.has(i));

      if (validSelected.length === 0) {
        console.log(chalk.yellow('No valid files selected'));
        continue;
      }

      // Get commit message
      const defaultMsg = commitNum === 1 ? originalSubject : `${originalSubject} (part ${commitNum})`;
      const msgInput = await question(chalk.gray(`  Message [${defaultMsg}]: `));
      const message = msgInput.trim() || defaultMsg;

      // Stage selected files
      for (const i of validSelected) {
        const file = files[i];
        if (file.status === 'D') {
          execSync(`git rm "${file.file}"`, { cwd, stdio: 'pipe' });
        } else {
          execSync(`git add "${file.file}"`, { cwd, stdio: 'pipe' });
        }
        remainingFiles.delete(i);
      }

      // Create commit
      execSync(`git commit -m "${message}"`, { cwd, stdio: 'pipe' });

      const newCommit = execSync('git rev-parse --short HEAD', {
        cwd,
        encoding: 'utf-8',
      }).trim();

      createdCommits.push(newCommit);
      console.log(chalk.green(`✓ Created commit ${newCommit}`));

      commitNum++;
    }

    rl.close();

    if (createdCommits.length > 0) {
      console.log(chalk.green(`\n✓ Created ${createdCommits.length} commits`));
    }

    if (remainingFiles.size > 0) {
      console.log(chalk.yellow(`\n${remainingFiles.size} files remain unstaged`));
    }

  } catch (error: any) {
    rl.close();
    console.error(chalk.red(`\nError: ${error.message}`));
    console.log(chalk.yellow('Attempting to recover...'));

    try {
      execSync(`git reset --hard ${originalHead}`, { cwd, stdio: 'pipe' });
      console.log(chalk.green('Recovered to original state'));
    } catch {
      console.error(chalk.red('Recovery failed'));
    }

    process.exit(1);
  }
}

/**
 * Parse file selection input like "1,3,4" or "1-3" or "1,3-5,7"
 */
function parseSelection(input: string, max: number): number[] {
  const result = new Set<number>();

  const parts = input.split(',').map(s => s.trim());

  for (const part of parts) {
    if (part.includes('-')) {
      const [start, end] = part.split('-').map(s => parseInt(s.trim(), 10));
      if (!isNaN(start) && !isNaN(end)) {
        for (let i = start; i <= end; i++) {
          if (i >= 1 && i <= max) {
            result.add(i - 1); // Convert to 0-indexed
          }
        }
      }
    } else {
      const num = parseInt(part, 10);
      if (!isNaN(num) && num >= 1 && num <= max) {
        result.add(num - 1); // Convert to 0-indexed
      }
    }
  }

  return Array.from(result).sort((a, b) => a - b);
}
