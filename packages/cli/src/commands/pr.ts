/**
 * cv pr - Pull Request Management Command
 *
 * Create, list, and manage pull requests using platform adapters.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import ora from 'ora';
import Table from 'cli-table3';
import { simpleGit } from 'simple-git';
import { CredentialManager, GitPlatform } from '@cv-git/credentials';
import {
  createPlatformAdapter,
  PullRequestState,
  type PullRequest,
} from '@cv-git/platform';
import { getConfig } from '../config.js';

const git = simpleGit();

export function prCommand(): Command {
  const cmd = new Command('pr').description('Manage pull requests');

  // cv pr create
  cmd
    .command('create')
    .description('Create a pull request')
    .option('-b, --base <branch>', 'Base branch (target)', 'main')
    .option('-t, --title <title>', 'PR title')
    .option('--body <body>', 'PR description/body')
    .option('--draft', 'Create as draft PR')
    .action(async (options) => {
      try {
        // Get current branch
        const head = await git.revparse(['--abbrev-ref', 'HEAD']);

        if (head === options.base) {
          console.log(
            chalk.red(
              `\n❌ Cannot create PR: already on base branch (${options.base})\n`
            )
          );
          return;
        }

        console.log(chalk.bold.blue(`\n🔄 Creating PR: ${head} → ${options.base}\n`));

        // Get commits for this branch
        const log = await git.log({ from: options.base, to: head });
        const commitCount = log.all.length;

        if (commitCount === 0) {
          console.log(
            chalk.yellow('⚠️  No commits to merge. Push some changes first.\n')
          );
          return;
        }

        console.log(
          chalk.gray(`📝 ${commitCount} commit${commitCount === 1 ? '' : 's'} to merge\n`)
        );

        // Ensure branch is pushed
        const spinner = ora('Pushing branch to remote...').start();
        try {
          await git.push('origin', head, ['--set-upstream']);
          spinner.succeed('Branch pushed');
        } catch (error: any) {
          if (error.message.includes('up-to-date')) {
            spinner.info('Branch already up-to-date');
          } else {
            spinner.fail(`Failed to push: ${error.message}`);
            return;
          }
        }

        // Get title if not provided
        let title = options.title;
        if (!title) {
          // Use first commit message as default
          const defaultTitle = log.all[0]?.message || 'Update';

          const { inputTitle } = await inquirer.prompt([
            {
              type: 'input',
              name: 'inputTitle',
              message: 'PR title:',
              default: defaultTitle,
            },
          ]);
          title = inputTitle;
        }

        // Get body if not provided
        let body = options.body;
        if (!body) {
          const { inputBody } = await inquirer.prompt([
            {
              type: 'editor',
              name: 'inputBody',
              message: 'PR description (opens editor):',
              default: `## Summary\n\n<!-- Describe your changes -->\n\n## Changes\n${log.all
                .map((c: any) => `- ${c.message}`)
                .join('\n')}\n`,
            },
          ]);
          body = inputBody;
        }

        // Create platform adapter
        const config = await getConfig().load();
        const credentials = new CredentialManager();
        await credentials.init();

        const platform = createPlatformAdapter(config.platform, credentials);
        await platform.init();

        // Create PR
        const prSpinner = ora('Creating pull request...').start();

        const pr = await platform.createPR({
          base: options.base,
          head,
          title,
          body,
          draft: options.draft || false,
        });

        prSpinner.succeed(chalk.green('Pull request created!'));

        console.log();
        console.log(chalk.bold(`  #${pr.number}: ${pr.title}`));
        console.log(chalk.gray(`  ${pr.url}`));
        console.log();
      } catch (error: any) {
        console.error(chalk.red(`\n❌ Failed to create PR: ${error.message}\n`));
      }
    });

  // cv pr list
  cmd
    .command('list')
    .description('List pull requests')
    .option('--state <state>', 'Filter by state (open|closed|merged|all)', 'open')
    .option('--limit <number>', 'Number of PRs to show', '10')
    .action(async (options) => {
      try {
        const config = await getConfig().load();
        const credentials = new CredentialManager();
        await credentials.init();

        const platform = createPlatformAdapter(config.platform, credentials);
        await platform.init();

        const spinner = ora('Fetching pull requests...').start();

        const prs = await platform.listPRs({
          state: options.state as any,
          limit: parseInt(options.limit),
        });

        spinner.stop();

        if (prs.length === 0) {
          console.log(chalk.yellow(`\nNo ${options.state} pull requests found.\n`));
          return;
        }

        console.log(
          chalk.bold(`\n📋 ${options.state.toUpperCase()} Pull Requests:\n`)
        );

        const table = new Table({
          head: [
            chalk.cyan('#'),
            chalk.cyan('Title'),
            chalk.cyan('Author'),
            chalk.cyan('State'),
            chalk.cyan('Updated'),
          ],
          colWidths: [6, 40, 15, 10, 15],
        });

        for (const pr of prs) {
          const stateColor =
            pr.state === PullRequestState.OPEN
              ? chalk.green
              : pr.state === PullRequestState.MERGED
              ? chalk.magenta
              : chalk.red;

          table.push([
            `#${pr.number}`,
            pr.title.length > 37 ? pr.title.substring(0, 34) + '...' : pr.title,
            pr.author.username,
            stateColor(pr.state),
            new Date(pr.updatedAt).toLocaleDateString(),
          ]);
        }

        console.log(table.toString());
        console.log();
      } catch (error: any) {
        console.error(chalk.red(`\n❌ Failed to list PRs: ${error.message}\n`));
      }
    });

  // cv pr view
  cmd
    .command('view <number>')
    .description('View pull request details')
    .action(async (number: string) => {
      try {
        const config = await getConfig().load();
        const credentials = new CredentialManager();
        await credentials.init();

        const platform = createPlatformAdapter(config.platform, credentials);
        await platform.init();

        const spinner = ora('Fetching pull request...').start();

        const pr = await platform.getPR(parseInt(number));

        spinner.stop();

        console.log();
        console.log(chalk.bold.blue(`PR #${pr.number}: ${pr.title}`));
        console.log(chalk.gray('─'.repeat(60)));
        console.log();
        console.log(chalk.bold('State:       ') + getStateDisplay(pr.state));
        console.log(
          chalk.bold('Author:      ') + `${pr.author.username} (${pr.author.name || 'no name'})`
        );
        console.log(chalk.bold('Branches:    ') + `${pr.head} → ${pr.base}`);
        console.log(chalk.bold('Created:     ') + new Date(pr.createdAt).toLocaleString());
        console.log(chalk.bold('Updated:     ') + new Date(pr.updatedAt).toLocaleString());

        if (pr.mergedAt) {
          console.log(
            chalk.bold('Merged:      ') + new Date(pr.mergedAt).toLocaleString()
          );
        }

        if (pr.commits) {
          console.log(
            chalk.bold('Commits:     ') +
              `${pr.commits} commit${pr.commits === 1 ? '' : 's'}`
          );
        }

        if (pr.changedFiles) {
          console.log(
            chalk.bold('Files:       ') +
              `${pr.changedFiles} file${pr.changedFiles === 1 ? '' : 's'} changed`
          );
        }

        if (pr.additions !== undefined && pr.deletions !== undefined) {
          console.log(
            chalk.bold('Changes:     ') +
              chalk.green(`+${pr.additions}`) +
              ' ' +
              chalk.red(`-${pr.deletions}`)
          );
        }

        console.log();
        console.log(chalk.bold('Description:'));
        console.log(chalk.gray('─'.repeat(60)));
        console.log(pr.body || chalk.gray('(no description)'));
        console.log();
        console.log(chalk.bold('URL:         ') + chalk.blue(pr.url));
        console.log();
      } catch (error: any) {
        console.error(chalk.red(`\n❌ Failed to view PR: ${error.message}\n`));
      }
    });

  // cv pr merge
  cmd
    .command('merge <number>')
    .description('Merge a pull request')
    .option('--method <method>', 'Merge method (merge|squash|rebase)', 'merge')
    .option('--message <message>', 'Commit message')
    .action(async (number: string, options) => {
      try {
        const config = await getConfig().load();
        const credentials = new CredentialManager();
        await credentials.init();

        const platform = createPlatformAdapter(config.platform, credentials);
        await platform.init();

        const { confirm } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'confirm',
            message: `Merge PR #${number} using ${options.method}?`,
            default: false,
          },
        ]);

        if (!confirm) {
          console.log(chalk.gray('Cancelled.'));
          return;
        }

        const spinner = ora('Merging pull request...').start();

        await platform.mergePR(parseInt(number), {
          mergeMethod: options.method,
          commitMessage: options.message,
        });

        spinner.succeed(chalk.green(`PR #${number} merged successfully!`));
      } catch (error: any) {
        console.error(chalk.red(`\n❌ Failed to merge PR: ${error.message}\n`));
      }
    });

  return cmd;
}

function getStateDisplay(state: PullRequestState): string {
  switch (state) {
    case PullRequestState.OPEN:
      return chalk.green('OPEN');
    case PullRequestState.MERGED:
      return chalk.magenta('MERGED');
    case PullRequestState.CLOSED:
      return chalk.red('CLOSED');
    default:
      return chalk.gray(state);
  }
}
