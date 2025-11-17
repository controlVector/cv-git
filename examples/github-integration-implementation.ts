/**
 * Example Implementation: GitHub Integration & AI-Powered Commands
 *
 * This file demonstrates the GitHub integration and AI-powered git commands
 * that will be built in Phase 5B and 5C.
 *
 * Location: packages/github/src/ and packages/cli/src/commands/
 */

import { Octokit } from '@octokit/rest';
import { CredentialManager, CredentialType } from '@cv-git/credentials';
import { AIManager } from '@cv-git/core';
import simpleGit, { SimpleGit } from 'simple-git';

// ============================================================================
// 1. GitHub Client
// ============================================================================

export class GitHubClient {
  private octokit: Octokit;
  private git: SimpleGit;

  constructor(
    private credentials: CredentialManager,
    private ai: AIManager
  ) {
    this.git = simpleGit();
  }

  /**
   * Initialize with GitHub authentication
   */
  async init(): Promise<void> {
    const token = await this.credentials.getGitHubToken();
    if (!token) {
      throw new Error(
        'GitHub token not found. Run: cv auth setup github'
      );
    }

    this.octokit = new Octokit({ auth: token });
  }

  /**
   * Validate GitHub token and get user info
   */
  async validateToken(token: string): Promise<{ login: string; name: string }> {
    const octokit = new Octokit({ auth: token });
    const { data } = await octokit.users.getAuthenticated();
    return {
      login: data.login,
      name: data.name || data.login,
    };
  }

  /**
   * Get token scopes
   */
  async getTokenScopes(token: string): Promise<string[]> {
    const octokit = new Octokit({ auth: token });
    const response = await octokit.request('HEAD /');
    const scopes = response.headers['x-oauth-scopes'];
    return scopes ? scopes.split(',').map((s) => s.trim()) : [];
  }

  /**
   * Get current repository info (owner/repo)
   */
  async getRepoInfo(): Promise<{ owner: string; repo: string }> {
    const remotes = await this.git.getRemotes(true);
    const origin = remotes.find((r) => r.name === 'origin');

    if (!origin?.refs?.push) {
      throw new Error('No git remote found. Not a git repository?');
    }

    // Parse GitHub URL (https or ssh)
    // https://github.com/owner/repo.git
    // git@github.com:owner/repo.git
    const match = origin.refs.push.match(
      /github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/
    );

    if (!match) {
      throw new Error('Not a GitHub repository');
    }

    return {
      owner: match[1],
      repo: match[2],
    };
  }

  /**
   * Create a pull request with AI-generated description
   */
  async createPR(options: {
    base: string;
    head: string;
    title?: string;
    generateAI?: boolean;
  }): Promise<{
    number: number;
    html_url: string;
    title: string;
    body: string;
  }> {
    await this.init();
    const { owner, repo } = await this.getRepoInfo();

    // Get diff and commits
    const diff = await this.git.diff([`${options.base}...${options.head}`]);
    const log = await this.git.log({
      from: options.base,
      to: options.head,
    });
    const commits = log.all;

    let title = options.title;
    let body = '';

    // Generate AI content if requested
    if (options.generateAI) {
      if (!title) {
        title = await this.generatePRTitle(diff, commits);
      }
      body = await this.generatePRDescription(diff, commits);
    }

    // Create PR via GitHub API
    const { data } = await this.octokit.pulls.create({
      owner,
      repo,
      title: title || commits[0]?.message || 'Untitled PR',
      body,
      base: options.base,
      head: options.head,
    });

    return {
      number: data.number,
      html_url: data.html_url,
      title: data.title,
      body: data.body || '',
    };
  }

  /**
   * List pull requests
   */
  async listPRs(options?: {
    state?: 'open' | 'closed' | 'all';
    limit?: number;
  }): Promise<
    Array<{
      number: number;
      title: string;
      state: string;
      html_url: string;
      user: { login: string };
      created_at: string;
      updated_at: string;
    }>
  > {
    await this.init();
    const { owner, repo } = await this.getRepoInfo();

    const { data } = await this.octokit.pulls.list({
      owner,
      repo,
      state: options?.state || 'open',
      per_page: options?.limit || 30,
    });

    return data.map((pr) => ({
      number: pr.number,
      title: pr.title,
      state: pr.state,
      html_url: pr.html_url,
      user: { login: pr.user?.login || 'unknown' },
      created_at: pr.created_at,
      updated_at: pr.updated_at,
    }));
  }

  /**
   * Get a specific pull request
   */
  async getPR(number: number): Promise<any> {
    await this.init();
    const { owner, repo } = await this.getRepoInfo();

    const { data } = await this.octokit.pulls.get({
      owner,
      repo,
      pull_number: number,
    });

    return data;
  }

  /**
   * Create a release with AI-generated changelog
   */
  async createRelease(options: {
    tag: string;
    name?: string;
    previousTag?: string;
    generateAI?: boolean;
    draft?: boolean;
    prerelease?: boolean;
  }): Promise<{
    id: number;
    html_url: string;
    tag_name: string;
    name: string;
    body: string;
  }> {
    await this.init();
    const { owner, repo } = await this.getRepoInfo();

    let body = '';

    // Generate AI changelog if requested
    if (options.generateAI) {
      const range = options.previousTag
        ? `${options.previousTag}..${options.tag}`
        : options.tag;

      const log = await this.git.log({ from: options.previousTag, to: options.tag });
      const commits = log.all;

      body = await this.generateChangelog(commits, {
        version: options.tag,
        previousVersion: options.previousTag,
      });
    }

    // Create git tag locally if it doesn't exist
    const tags = await this.git.tags();
    if (!tags.all.includes(options.tag)) {
      await this.git.addTag(options.tag);
    }

    // Push tag to remote
    await this.git.pushTags('origin');

    // Create GitHub release
    const { data } = await this.octokit.repos.createRelease({
      owner,
      repo,
      tag_name: options.tag,
      name: options.name || options.tag,
      body,
      draft: options.draft || false,
      prerelease: options.prerelease || false,
    });

    return {
      id: data.id,
      html_url: data.html_url,
      tag_name: data.tag_name,
      name: data.name || '',
      body: data.body || '',
    };
  }

  // ============================================================================
  // AI-Powered Generation Methods
  // ============================================================================

  /**
   * Generate PR title from diff and commits
   */
  private async generatePRTitle(
    diff: string,
    commits: Array<{ message: string; hash: string }>
  ): Promise<string> {
    const prompt = `
Generate a concise, descriptive pull request title from the following commits and diff.

Guidelines:
- Use imperative mood (e.g., "Add feature" not "Added feature")
- Be specific and clear
- Max 50 characters
- No period at the end
- Follow format: "type: description" or "type(scope): description"

Types: feat, fix, docs, style, refactor, test, chore, perf

Commits:
${commits.map((c) => `- ${c.message}`).join('\n')}

Generate a title:`;

    const response = await this.ai.complete(prompt);
    return response.trim().replace(/^["']|["']$/g, '');
  }

  /**
   * Generate PR description from diff and commits
   */
  private async generatePRDescription(
    diff: string,
    commits: Array<{ message: string; hash: string; author_name: string }>
  ): Promise<string> {
    const commitList = commits
      .map((c) => `- ${c.message} (${c.hash.substring(0, 7)})`)
      .join('\n');

    const prompt = `
Generate a comprehensive pull request description in GitHub-flavored markdown.

Include these sections:
1. ## Summary - Brief overview (2-3 sentences)
2. ## What Changed - Bulleted list with checkmarks (✅)
3. ## Why - Motivation and context
4. ## Test Plan - Checklist of testing steps (- [ ] format)
5. ## Breaking Changes - List any breaking changes or "None"

Be clear, concise, and actionable. Focus on the "what" and "why", not the "how".

Commits:
${commitList}

Diff summary:
${diff.split('\n').slice(0, 100).join('\n')}
${diff.split('\n').length > 100 ? '\n...(diff truncated)' : ''}

Generate PR description:`;

    const response = await this.ai.complete(prompt);
    return response.trim();
  }

  /**
   * Generate changelog from commits
   */
  private async generateChangelog(
    commits: Array<{
      message: string;
      hash: string;
      author_name: string;
      date: string;
    }>,
    options: {
      version: string;
      previousVersion?: string;
    }
  ): Promise<string> {
    const commitList = commits
      .map((c) => `- ${c.message} (${c.hash.substring(0, 7)}) by ${c.author_name}`)
      .join('\n');

    const contributors = Array.from(
      new Set(commits.map((c) => c.author_name))
    );

    const prompt = `
Generate a changelog in Keep a Changelog format with Conventional Commits categorization.

Version: ${options.version}
Previous Version: ${options.previousVersion || 'Initial Release'}
Date: ${new Date().toISOString().split('T')[0]}

Categories:
- 🚀 Features (feat:)
- 🐛 Bug Fixes (fix:)
- 📚 Documentation (docs:)
- ♻️ Refactoring (refactor:)
- ⚡ Performance (perf:)
- ✅ Tests (test:)
- 🔧 Chores (chore:)
- 💥 Breaking Changes (BREAKING CHANGE:)

Format:
# ${options.version} - {date}

## 🚀 Features
- **scope**: description (#pr or hash)

## 🐛 Bug Fixes
- **scope**: description (#pr or hash)

[Other categories...]

## 👥 Contributors
- @username (N commits)

**Full Changelog**: ${options.previousVersion}...${options.version}

Commits:
${commitList}

Generate changelog:`;

    const response = await this.ai.complete(prompt);
    return response.trim();
  }

  /**
   * Generate commit message from diff
   */
  async generateCommitMessage(diff: string): Promise<string> {
    const prompt = `
Generate a git commit message following Conventional Commits specification.

Format:
<type>(<scope>): <subject>

<body>

<footer>

Types: feat, fix, docs, style, refactor, test, chore, perf
Scope: Optional component name
Subject: Imperative mood, lowercase, no period, max 50 chars
Body: Explain what and why, not how. Wrap at 72 chars.
Footer: BREAKING CHANGE or issue references

Example:
feat(auth): add OAuth2 login support

Implement OAuth2 authentication flow using the
authorization code grant. This enables users to
log in with GitHub, Google, and Microsoft accounts.

Closes #123

Diff:
${diff.split('\n').slice(0, 200).join('\n')}
${diff.split('\n').length > 200 ? '\n...(diff truncated)' : ''}

Generate commit message:`;

    const response = await this.ai.complete(prompt);
    return response.trim();
  }
}

// ============================================================================
// 2. CLI Commands
// ============================================================================

import { Command } from 'commander';

/**
 * cv auth - Credential management command
 */
export function authCommand(): Command {
  const cmd = new Command('auth').description('Manage credentials and authentication');

  // cv auth setup
  cmd
    .command('setup [service]')
    .description('Set up authentication for a service (github, anthropic, openai)')
    .action(async (service?: string) => {
      const credentials = new CredentialManager();

      console.log('🔐 CV-Git Authentication Setup\n');

      // Migrate from environment variables first
      console.log('Checking for environment variables to migrate...');
      await credentials.migrateFromEnv();
      console.log();

      if (!service || service === 'github') {
        await setupGitHubAuth(credentials);
      }

      if (!service || service === 'anthropic') {
        await setupAnthropicAuth(credentials);
      }

      if (!service || service === 'openai') {
        await setupOpenAIAuth(credentials);
      }

      console.log('\n✅ Authentication setup complete!');
      console.log('Run `cv auth list` to verify stored credentials.');
    });

  // cv auth list
  cmd
    .command('list')
    .description('List all stored credentials')
    .action(async () => {
      const credentials = new CredentialManager();
      const list = await credentials.list();

      if (list.length === 0) {
        console.log('No credentials stored.');
        console.log('Run: cv auth setup');
        return;
      }

      console.log('Stored credentials:\n');
      for (const cred of list) {
        const lastUsed = cred.lastUsed
          ? new Date(cred.lastUsed).toLocaleDateString()
          : 'never';
        console.log(`✓ ${cred.type}:${cred.name}`);
        console.log(`  Created: ${new Date(cred.createdAt).toLocaleDateString()}`);
        console.log(`  Last used: ${lastUsed}`);
        console.log();
      }
    });

  // cv auth test
  cmd
    .command('test <service>')
    .description('Test authentication for a service')
    .action(async (service: string) => {
      const credentials = new CredentialManager();

      if (service === 'github') {
        const token = await credentials.getGitHubToken();
        if (!token) {
          console.error('❌ GitHub token not found');
          console.log('Run: cv auth setup github');
          return;
        }

        try {
          const github = new GitHubClient(credentials, null as any);
          const user = await github.validateToken(token);
          console.log(`✅ GitHub authentication valid`);
          console.log(`   Authenticated as: ${user.login} (${user.name})`);
        } catch (error: any) {
          console.error('❌ GitHub authentication failed:', error.message);
        }
      }
      // Similar for other services...
    });

  return cmd;
}

/**
 * Setup GitHub authentication
 */
async function setupGitHubAuth(credentials: CredentialManager): Promise<void> {
  console.log('──────────────────────────────────────────────────');
  console.log('GitHub Authentication');
  console.log('──────────────────────────────────────────────────');
  console.log();
  console.log('1. Visit: https://github.com/settings/tokens/new?scopes=repo,workflow');
  console.log('2. Generate a Personal Access Token');
  console.log('3. Copy the token (it starts with ghp_)');
  console.log();

  const token = await prompt('Enter your GitHub token:', { mask: true });

  if (!token || !token.startsWith('ghp_')) {
    console.error('Invalid GitHub token format');
    return;
  }

  // Validate token
  console.log('Validating token...');
  const github = new GitHubClient(credentials, null as any);
  try {
    const user = await github.validateToken(token);
    const scopes = await github.getTokenScopes(token);

    console.log(`✓ Token validated for user: ${user.login}`);
    console.log(`✓ Token scopes: ${scopes.join(', ')}`);

    // Store token
    await credentials.store({
      id: randomBytes(16).toString('hex'),
      type: CredentialType.GITHUB_PAT,
      name: `github-${user.login}`,
      token,
      scopes,
      username: user.login,
      createdAt: new Date(),
    });

    // Configure git credential helper
    console.log('Configuring git credential helper...');
    await exec('git config --global credential.helper cv-git');

    console.log('✅ GitHub authentication configured!');
  } catch (error: any) {
    console.error('❌ Token validation failed:', error.message);
  }
}

async function setupAnthropicAuth(credentials: CredentialManager): Promise<void> {
  console.log('──────────────────────────────────────────────────');
  console.log('Anthropic Authentication');
  console.log('──────────────────────────────────────────────────');
  console.log();
  console.log('1. Visit: https://console.anthropic.com/');
  console.log('2. Copy your API key (starts with sk-ant-)');
  console.log();

  const apiKey = await prompt('Enter your Anthropic API key:', { mask: true });

  if (!apiKey || !apiKey.startsWith('sk-ant-')) {
    console.error('Invalid Anthropic API key format');
    return;
  }

  await credentials.store({
    id: randomBytes(16).toString('hex'),
    type: CredentialType.ANTHROPIC_API,
    name: 'default',
    apiKey,
    createdAt: new Date(),
  });

  console.log('✅ Anthropic authentication configured!');
}

async function setupOpenAIAuth(credentials: CredentialManager): Promise<void> {
  console.log('──────────────────────────────────────────────────');
  console.log('OpenAI Authentication');
  console.log('──────────────────────────────────────────────────');
  console.log();
  console.log('1. Visit: https://platform.openai.com/api-keys');
  console.log('2. Copy your API key (starts with sk-)');
  console.log();

  const apiKey = await prompt('Enter your OpenAI API key:', { mask: true });

  if (!apiKey || !apiKey.startsWith('sk-')) {
    console.error('Invalid OpenAI API key format');
    return;
  }

  await credentials.store({
    id: randomBytes(16).toString('hex'),
    type: CredentialType.OPENAI_API,
    name: 'default',
    apiKey,
    createdAt: new Date(),
  });

  console.log('✅ OpenAI authentication configured!');
}

/**
 * cv commit - AI-powered commit
 */
export function commitCommand(): Command {
  return new Command('commit')
    .description('Create commit with AI-generated message')
    .option('-a, --all', 'Stage all changes')
    .option('-m, --message <msg>', 'Use this message instead of AI')
    .option('--no-ai', 'Skip AI generation')
    .action(async (options) => {
      const git = simpleGit();
      const credentials = new CredentialManager();
      const ai = new AIManager(/* ... */);
      const github = new GitHubClient(credentials, ai);

      // Stage changes
      if (options.all) {
        await git.add('.');
      }

      // Get staged diff
      const status = await git.status();
      if (status.staged.length === 0) {
        console.error('No changes staged for commit');
        console.log('Use: cv commit -a  (to stage all changes)');
        return;
      }

      const diff = await git.diff(['--staged']);

      // Generate or use provided message
      let message = options.message;

      if (!message && options.ai) {
        console.log('🤖 Analyzing changes and generating commit message...\n');

        message = await github.generateCommitMessage(diff);

        console.log('Proposed commit message:');
        console.log('─'.repeat(60));
        console.log(message);
        console.log('─'.repeat(60));
        console.log();

        const approved = await confirm('Use this commit message?');
        if (!approved) {
          message = await prompt('Enter commit message:');
        }
      }

      if (!message) {
        message = await prompt('Enter commit message:');
      }

      // Commit
      await git.commit(message);
      console.log('✅ Changes committed successfully');

      // Suggest push
      const shouldPush = await confirm('Push to remote?');
      if (shouldPush) {
        const branch = await git.revparse(['--abbrev-ref', 'HEAD']);
        await git.push('origin', branch);
        console.log('✅ Pushed to origin/' + branch);
      }
    });
}

/**
 * cv push - Authenticated push
 */
export function pushCommand(): Command {
  return new Command('push')
    .description('Push to remote with automatic authentication')
    .argument('[remote]', 'Remote name', 'origin')
    .argument('[branch]', 'Branch name')
    .option('-f, --force', 'Force push')
    .option('-u, --set-upstream', 'Set upstream branch')
    .action(async (remote, branch, options) => {
      const git = simpleGit();

      // Get current branch if not specified
      if (!branch) {
        branch = await git.revparse(['--abbrev-ref', 'HEAD']);
      }

      console.log(`📤 Pushing to ${remote}/${branch}...`);

      try {
        const args = [];
        if (options.setUpstream) args.push('--set-upstream');
        if (options.force) args.push('--force');

        await git.push(remote, branch, args);

        console.log('✅ Pushed successfully');

        // Suggest PR creation for feature branches
        if (!['main', 'master', 'develop'].includes(branch)) {
          const createPR = await confirm('\nCreate pull request?');
          if (createPR) {
            // Call pr create command
            const { prCommand } = await import('./pr');
            await prCommand().parseAsync(['create'], { from: 'user' });
          }
        }
      } catch (error: any) {
        if (error.message.includes('authentication') || error.message.includes('credentials')) {
          console.error('❌ Authentication failed');
          console.log('\nRun: cv auth setup github');
        } else {
          throw error;
        }
      }
    });
}

/**
 * cv pr - Pull request management
 */
export function prCommand(): Command {
  const cmd = new Command('pr').description('Manage pull requests');

  // cv pr create
  cmd
    .command('create')
    .description('Create pull request with AI-generated description')
    .option('-b, --base <branch>', 'Base branch', 'main')
    .option('-t, --title <title>', 'PR title')
    .option('--no-ai', 'Skip AI generation')
    .action(async (options) => {
      const git = simpleGit();
      const credentials = new CredentialManager();
      const ai = new AIManager(/* ... */);
      const github = new GitHubClient(credentials, ai);

      const head = await git.revparse(['--abbrev-ref', 'HEAD']);

      if (head === options.base) {
        console.error('Cannot create PR: already on base branch');
        return;
      }

      // Get commits
      const log = await git.log({ from: options.base, to: head });
      const commitCount = log.all.length;

      console.log(`🔄 Creating PR: ${head} → ${options.base}`);
      console.log(`📝 ${commitCount} commit${commitCount === 1 ? '' : 's'} to merge\n`);

      // Ensure pushed to remote
      try {
        await git.push('origin', head, ['--set-upstream']);
      } catch (error: any) {
        console.error('❌ Failed to push branch to remote');
        console.log('Run: cv push');
        return;
      }

      // Create PR
      console.log('🤖 Creating pull request...');
      if (options.ai) {
        console.log('   Generating AI description...');
      }

      const pr = await github.createPR({
        base: options.base,
        head,
        title: options.title,
        generateAI: options.ai,
      });

      console.log(`\n✅ Pull request created!`);
      console.log(`   #${pr.number}: ${pr.title}`);
      console.log(`   ${pr.html_url}`);
    });

  // cv pr list
  cmd
    .command('list')
    .description('List pull requests')
    .option('--state <state>', 'Filter by state (open|closed|all)', 'open')
    .action(async (options) => {
      const credentials = new CredentialManager();
      const github = new GitHubClient(credentials, null as any);

      const prs = await github.listPRs({ state: options.state });

      if (prs.length === 0) {
        console.log(`No ${options.state} pull requests found`);
        return;
      }

      console.log(`${options.state.toUpperCase()} Pull Requests:\n`);
      for (const pr of prs) {
        console.log(`#${pr.number} ${pr.title}`);
        console.log(`  ${pr.html_url}`);
        console.log(`  ${pr.user.login} • ${pr.state} • Updated ${new Date(pr.updated_at).toLocaleDateString()}`);
        console.log();
      }
    });

  return cmd;
}

/**
 * cv release - Create release with AI changelog
 */
export function releaseCommand(): Command {
  return new Command('release')
    .description('Create release with AI-generated changelog')
    .argument('<version>', 'Version tag (e.g., v0.2.0)')
    .option('--previous <tag>', 'Previous release tag')
    .option('--no-ai', 'Skip AI changelog generation')
    .option('--draft', 'Create as draft release')
    .option('--prerelease', 'Mark as pre-release')
    .action(async (version, options) => {
      const git = simpleGit();
      const credentials = new CredentialManager();
      const ai = new AIManager(/* ... */);
      const github = new GitHubClient(credentials, ai);

      // Auto-detect previous tag
      let previousTag = options.previous;
      if (!previousTag) {
        const tags = await git.tags();
        previousTag = tags.latest;
      }

      console.log(`📦 Creating release ${version}`);
      if (previousTag) {
        console.log(`   (since ${previousTag})\n`);
      }

      // Get commits
      const log = await git.log({ from: previousTag, to: 'HEAD' });
      const commitCount = log.all.length;

      console.log(`📝 ${commitCount} commit${commitCount === 1 ? '' : 's'} since last release`);

      if (options.ai) {
        console.log('🤖 Generating changelog with AI...\n');
      }

      // Create release
      const release = await github.createRelease({
        tag: version,
        previousTag,
        generateAI: options.ai,
        draft: options.draft,
        prerelease: options.prerelease,
      });

      console.log('\n✅ Release created!');
      console.log(`   ${release.tag_name}: ${release.name}`);
      console.log(`   ${release.html_url}`);

      if (options.draft) {
        console.log('\n   (Draft release - publish when ready)');
      }
    });
}

// ============================================================================
// Utility Functions
// ============================================================================

async function prompt(message: string, options?: { mask?: boolean }): Promise<string> {
  // In production, use a proper prompt library like inquirer or prompts
  return new Promise((resolve) => {
    process.stdout.write(message + ' ');
    // Implementation details...
    resolve('user-input');
  });
}

async function confirm(message: string): Promise<boolean> {
  const answer = await prompt(message + ' (Y/n)');
  return !answer || answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes';
}

// ============================================================================
// Export
// ============================================================================

export {
  GitHubClient,
  authCommand,
  commitCommand,
  pushCommand,
  prCommand,
  releaseCommand,
};
