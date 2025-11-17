/**
 * cv release - Release Management Command
 *
 * Create and manage releases using platform adapters.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import ora from 'ora';
import Table from 'cli-table3';
import { simpleGit } from 'simple-git';
import { CredentialManager } from '@cv-git/credentials';
import { createPlatformAdapter, type Release } from '@cv-git/platform';
import { getConfig } from '../config.js';

const git = simpleGit();

export function releaseCommand(): Command {
  const cmd = new Command('release').description('Manage releases');

  // cv release create
  cmd
    .command('create <tag>')
    .description('Create a release')
    .option('--name <name>', 'Release name (defaults to tag)')
    .option('--body <body>', 'Release notes')
    .option('--draft', 'Create as draft')
    .option('--prerelease', 'Mark as pre-release')
    .action(async (tag: string, options) => {
      try {
        console.log(chalk.bold.blue(`\n📦 Creating release ${tag}\n`));

        // Auto-detect previous tag
        const tags = await git.tags();
        const previousTag = tags.latest;

        if (previousTag) {
          console.log(chalk.gray(`   (since ${previousTag})\n`));
        }

        // Get commits since last release
        const log = await git.log(
          previousTag ? { from: previousTag, to: 'HEAD' } : undefined
        );
        const commitCount = log.all.length;

        console.log(
          chalk.gray(
            `📝 ${commitCount} commit${commitCount === 1 ? '' : 's'} since last release\n`
          )
        );

        // Get release name
        const name = options.name || tag;

        // Get release notes if not provided
        let body = options.body;
        if (!body) {
          const commitList = log.all.map((c: any) => `- ${c.message}`).join('\n');

          const { inputBody } = await inquirer.prompt([
            {
              type: 'editor',
              name: 'inputBody',
              message: 'Release notes (opens editor):',
              default: `## What's Changed\n\n${commitList}\n\n**Full Changelog**: ${
                previousTag ? `${previousTag}...${tag}` : tag
              }`,
            },
          ]);
          body = inputBody;
        }

        // Confirm creation
        const { confirm } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'confirm',
            message: `Create release ${tag}${options.draft ? ' (draft)' : ''}${
              options.prerelease ? ' (pre-release)' : ''
            }?`,
            default: true,
          },
        ]);

        if (!confirm) {
          console.log(chalk.gray('Cancelled.'));
          return;
        }

        // Create platform adapter
        const config = await getConfig().load();
        const credentials = new CredentialManager();
        await credentials.init();

        const platform = createPlatformAdapter(config.platform, credentials);
        await platform.init();

        // Create git tag if it doesn't exist
        const existingTags = await git.tags();
        if (!existingTags.all.includes(tag)) {
          const tagSpinner = ora('Creating git tag...').start();
          await git.addTag(tag);
          await git.pushTags('origin');
          tagSpinner.succeed('Git tag created and pushed');
        }

        // Create release
        const releaseSpinner = ora('Creating release...').start();

        const release = await platform.createRelease({
          tag,
          name,
          body,
          draft: options.draft || false,
          prerelease: options.prerelease || false,
        });

        releaseSpinner.succeed(chalk.green('Release created!'));

        console.log();
        console.log(chalk.bold(`  ${release.tag}: ${release.name}`));
        console.log(chalk.gray(`  ${release.url}`));

        if (options.draft) {
          console.log();
          console.log(chalk.yellow('  ℹ️  This is a draft release. Publish when ready.'));
        }

        console.log();
      } catch (error: any) {
        console.error(chalk.red(`\n❌ Failed to create release: ${error.message}\n`));
      }
    });

  // cv release list
  cmd
    .command('list')
    .description('List releases')
    .option('--limit <number>', 'Number of releases to show', '10')
    .action(async (options) => {
      try {
        const config = await getConfig().load();
        const credentials = new CredentialManager();
        await credentials.init();

        const platform = createPlatformAdapter(config.platform, credentials);
        await platform.init();

        const spinner = ora('Fetching releases...').start();

        const releases = await platform.listReleases(parseInt(options.limit));

        spinner.stop();

        if (releases.length === 0) {
          console.log(chalk.yellow('\nNo releases found.\n'));
          return;
        }

        console.log(chalk.bold('\n📦 Releases:\n'));

        const table = new Table({
          head: [
            chalk.cyan('Tag'),
            chalk.cyan('Name'),
            chalk.cyan('Published'),
            chalk.cyan('Type'),
          ],
          colWidths: [20, 35, 15, 15],
        });

        for (const release of releases) {
          const type = release.isDraft
            ? chalk.yellow('draft')
            : release.isPrerelease
            ? chalk.blue('pre-release')
            : chalk.green('release');

          const published = release.publishedAt
            ? new Date(release.publishedAt).toLocaleDateString()
            : chalk.gray('unpublished');

          table.push([release.tag, release.name, published, type]);
        }

        console.log(table.toString());
        console.log();
      } catch (error: any) {
        console.error(chalk.red(`\n❌ Failed to list releases: ${error.message}\n`));
      }
    });

  // cv release view
  cmd
    .command('view <tag>')
    .description('View release details')
    .action(async (tag: string) => {
      try {
        const config = await getConfig().load();
        const credentials = new CredentialManager();
        await credentials.init();

        const platform = createPlatformAdapter(config.platform, credentials);
        await platform.init();

        const spinner = ora('Fetching release...').start();

        const release = await platform.getRelease(tag);

        spinner.stop();

        console.log();
        console.log(chalk.bold.blue(`Release: ${release.name}`));
        console.log(chalk.gray('─'.repeat(60)));
        console.log();
        console.log(chalk.bold('Tag:         ') + release.tag);
        console.log(
          chalk.bold('Author:      ') +
            `${release.author.username} (${release.author.name || 'no name'})`
        );
        console.log(
          chalk.bold('Created:     ') + new Date(release.createdAt).toLocaleString()
        );

        if (release.publishedAt) {
          console.log(
            chalk.bold('Published:   ') + new Date(release.publishedAt).toLocaleString()
          );
        }

        console.log(
          chalk.bold('Type:        ') +
            (release.isDraft
              ? chalk.yellow('Draft')
              : release.isPrerelease
              ? chalk.blue('Pre-release')
              : chalk.green('Release'))
        );

        console.log();
        console.log(chalk.bold('Release Notes:'));
        console.log(chalk.gray('─'.repeat(60)));
        console.log(release.body || chalk.gray('(no release notes)'));
        console.log();
        console.log(chalk.bold('URL:         ') + chalk.blue(release.url));
        console.log();
      } catch (error: any) {
        console.error(chalk.red(`\n❌ Failed to view release: ${error.message}\n`));
      }
    });

  // cv release delete
  cmd
    .command('delete <tag>')
    .description('Delete a release')
    .action(async (tag: string) => {
      try {
        const { confirm } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'confirm',
            message: chalk.yellow(`Delete release ${tag}? This cannot be undone.`),
            default: false,
          },
        ]);

        if (!confirm) {
          console.log(chalk.gray('Cancelled.'));
          return;
        }

        const config = await getConfig().load();
        const credentials = new CredentialManager();
        await credentials.init();

        const platform = createPlatformAdapter(config.platform, credentials);
        await platform.init();

        const spinner = ora('Deleting release...').start();

        await platform.deleteRelease(tag);

        spinner.succeed(chalk.green(`Release ${tag} deleted`));
      } catch (error: any) {
        console.error(chalk.red(`\n❌ Failed to delete release: ${error.message}\n`));
      }
    });

  return cmd;
}
