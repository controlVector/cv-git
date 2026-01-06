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
import { promises as fs } from 'fs';
import * as path from 'path';
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

  // cv release publish - Publish to CV-Hub App Store
  cmd
    .command('publish')
    .description('Publish release to CV-Hub App Store')
    .option('--app <appId>', 'App ID on CV-Hub (e.g., cv-git)')
    .option('--version <version>', 'Version to publish (defaults to package.json version)')
    .option('--notes <notes>', 'Release notes (defaults to CHANGELOG.md section)')
    .option('--prerelease', 'Mark as pre-release')
    .option('--token <token>', 'CV-Hub API token (or set CV_HUB_TOKEN env var)')
    .action(async (options) => {
      try {
        console.log(chalk.bold.blue('\n🚀 Publishing to CV-Hub App Store\n'));

        const config = await getConfig().load();
        const hubUrl = config.hub?.url || 'https://api.hub.controlvector.io/api';

        // Get token from options, config, or env
        const token = options.token || config.hub?.token || process.env.CV_HUB_TOKEN;
        if (!token) {
          console.error(chalk.red('❌ No CV-Hub token found.'));
          console.log(chalk.gray('\nSet token using one of:'));
          console.log(chalk.gray('  --token <token>'));
          console.log(chalk.gray('  CV_HUB_TOKEN environment variable'));
          console.log(chalk.gray('  cv config set hub.token <token>'));
          console.log();
          console.log(chalk.gray('Get a token by logging into hub.controlvector.io'));
          return;
        }

        // Determine app ID
        let appId = options.app;
        if (!appId) {
          // Try to get from package.json name
          try {
            const pkgPath = path.join(process.cwd(), 'package.json');
            const pkgData = await fs.readFile(pkgPath, 'utf8');
            const pkg = JSON.parse(pkgData);
            appId = pkg.name;
            console.log(chalk.gray(`   App ID from package.json: ${appId}`));
          } catch {
            console.error(chalk.red('❌ Could not determine app ID. Use --app flag.'));
            return;
          }
        }

        // Get version
        let version = options.version;
        if (!version) {
          try {
            const pkgPath = path.join(process.cwd(), 'package.json');
            const pkgData = await fs.readFile(pkgPath, 'utf8');
            const pkg = JSON.parse(pkgData);
            version = pkg.version;
            console.log(chalk.gray(`   Version from package.json: ${version}`));
          } catch {
            console.error(chalk.red('❌ Could not determine version. Use --version flag.'));
            return;
          }
        }

        // Get release notes
        let releaseNotes = options.notes;
        if (!releaseNotes) {
          try {
            const changelogPath = path.join(process.cwd(), 'CHANGELOG.md');
            const changelog = await fs.readFile(changelogPath, 'utf8');

            // Extract section for this version
            const versionPattern = new RegExp(
              `##\\s*\\[?v?${version.replace(/\./g, '\\.')}\\]?[^#]*`,
              'i'
            );
            const match = changelog.match(versionPattern);
            if (match) {
              releaseNotes = match[0].trim();
              console.log(chalk.gray(`   Release notes from CHANGELOG.md`));
            } else {
              // Use recent git commits as fallback
              const log = await git.log({ maxCount: 10 });
              releaseNotes = `## ${version}\n\n` +
                log.all.map((c: any) => `- ${c.message}`).join('\n');
              console.log(chalk.gray(`   Release notes from recent commits`));
            }
          } catch {
            const log = await git.log({ maxCount: 10 });
            releaseNotes = `## ${version}\n\n` +
              log.all.map((c: any) => `- ${c.message}`).join('\n');
            console.log(chalk.gray(`   Release notes from recent commits`));
          }
        }

        // Try to get GitHub release assets
        let assets: Array<{
          platform: string;
          fileName: string;
          fileSize: number;
          downloadUrl: string;
        }> = [];

        try {
          const credentials = new CredentialManager();
          await credentials.init();
          const platform = createPlatformAdapter(config.platform, credentials);
          await platform.init();

          const release = await platform.getRelease(`v${version}`);
          if (release && (release as any).assets) {
            const ghAssets = (release as any).assets || [];
            console.log(chalk.gray(`   Found ${ghAssets.length} assets on GitHub`));

            // Map GitHub assets to CV-Hub format
            for (const asset of ghAssets) {
              let cvPlatform = 'linux-x64'; // default
              const name = asset.name.toLowerCase();

              if (name.includes('windows') || name.includes('.exe') || name.includes('.msi')) {
                cvPlatform = name.includes('arm') ? 'windows-arm64' : 'windows-x64';
              } else if (name.includes('macos') || name.includes('darwin') || name.includes('.dmg')) {
                cvPlatform = name.includes('arm') || name.includes('aarch64') ? 'macos-arm64' : 'macos-x64';
              } else if (name.includes('linux') || name.includes('.appimage') || name.includes('.deb')) {
                cvPlatform = name.includes('arm') || name.includes('aarch64') ? 'linux-arm64' : 'linux-x64';
              }

              assets.push({
                platform: cvPlatform,
                fileName: asset.name,
                fileSize: asset.size || 0,
                downloadUrl: asset.browser_download_url || asset.url,
              });
            }
          }
        } catch (err) {
          console.log(chalk.gray(`   No GitHub release found for v${version}`));
        }

        // Confirm publish
        console.log();
        console.log(chalk.bold('📦 Publish Summary:'));
        console.log(chalk.gray('─'.repeat(50)));
        console.log(`   App:        ${chalk.cyan(appId)}`);
        console.log(`   Version:    ${chalk.cyan(version)}`);
        console.log(`   Prerelease: ${options.prerelease ? chalk.yellow('Yes') : chalk.green('No')}`);
        console.log(`   Assets:     ${assets.length > 0 ? chalk.green(assets.length + ' files') : chalk.gray('None')}`);
        console.log();

        const { confirm } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'confirm',
            message: `Publish ${appId} v${version} to CV-Hub?`,
            default: true,
          },
        ]);

        if (!confirm) {
          console.log(chalk.gray('Cancelled.'));
          return;
        }

        // Publish to CV-Hub
        const spinner = ora('Publishing to CV-Hub...').start();

        const response = await fetch(`${hubUrl}/v1/apps/${appId}/publish`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({
            version,
            releaseNotes,
            isPrerelease: options.prerelease || false,
            assets: assets.length > 0 ? assets : undefined,
          }),
        });

        if (!response.ok) {
          const error = await response.json().catch(() => ({ message: response.statusText })) as any;
          spinner.fail(chalk.red('Failed to publish'));
          console.error(chalk.red(`\n❌ ${error.error?.message || error.message || 'Unknown error'}\n`));
          return;
        }

        const result = await response.json() as { message: string };
        spinner.succeed(chalk.green('Published successfully!'));

        console.log();
        console.log(chalk.bold(`  ✓ ${result.message}`));
        console.log(chalk.gray(`    View at: https://hub.controlvector.io/apps/${appId}`));
        console.log();

      } catch (error: any) {
        console.error(chalk.red(`\n❌ Failed to publish: ${error.message}\n`));
      }
    });

  return cmd;
}
