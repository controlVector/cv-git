# CV-Git Credential Management & AI-Native Git

## Problem Statement

**Current Pain Point:**
AI coding agents cannot perform version control operations (commit, push, PR creation) without manual credential input, breaking the seamless developer experience.

**Our Experience:**
```bash
# What happened during CV-Git release:
git push origin main
# fatal: could not read Username for 'https://github.com': No such device or address

# User had to manually:
# 1. Generate GitHub Personal Access Token
# 2. Use git push with token in URL
# 3. Re-enter credentials for each push
```

**Vision:**
CV-Git should be **better than git** by providing:
1. **Secure credential wallet** - One-time setup, automatic authentication
2. **AI-native commands** - Smart commits, PR creation, releases
3. **Seamless experience** - AI agents can do version control autonomously

---

## Architecture Design

### High-Level Overview

```
┌─────────────────────────────────────────────────────────────┐
│                        CV-Git CLI                            │
├─────────────────────────────────────────────────────────────┤
│  cv auth    cv commit    cv push    cv pr    cv release     │
└────────────────┬────────────────────────────────────────────┘
                 │
        ┌────────┴────────┐
        │                 │
┌───────▼──────┐  ┌──────▼────────┐
│  Credential  │  │    GitHub     │
│   Manager    │  │  Integration  │
└───────┬──────┘  └──────┬────────┘
        │                │
┌───────▼──────┐  ┌──────▼────────┐
│   Secure     │  │   AI-Powered  │
│   Storage    │  │  Git Commands │
└──────────────┘  └───────────────┘
```

### Package Structure

```
packages/
├── credentials/          # NEW: Secure credential management
│   ├── src/
│   │   ├── storage/
│   │   │   ├── keychain.ts      # OS keychain integration
│   │   │   ├── encrypted.ts     # Encrypted file storage
│   │   │   └── interface.ts     # Storage interface
│   │   ├── manager.ts           # Credential CRUD
│   │   └── types.ts             # Credential types
│   └── package.json
│
├── github/              # NEW: GitHub integration
│   ├── src/
│   │   ├── client.ts            # GitHub API client
│   │   ├── auth.ts              # Authentication
│   │   ├── pr.ts                # Pull request operations
│   │   ├── releases.ts          # Release management
│   │   └── types.ts             # GitHub types
│   └── package.json
│
└── cli/                 # UPDATED: New commands
    └── src/commands/
        ├── auth.ts              # cv auth commands
        ├── commit.ts            # cv commit (AI-powered)
        ├── push.ts              # cv push (authenticated)
        ├── pr.ts                # cv pr commands
        └── release.ts           # cv release (AI changelog)
```

---

## Credential Storage

### Security Requirements

1. **Encryption at Rest** - All credentials encrypted
2. **OS Integration** - Use native secure storage when available
3. **Access Control** - Master password or biometric authentication
4. **Audit Trail** - Log credential access (not values)
5. **Scope Limitation** - Minimal permissions for each credential

### Storage Backend Options

#### Option 1: OS Keychain (Preferred)
```typescript
// macOS: Keychain
// Windows: Credential Manager
// Linux: Secret Service API / gnome-keyring

import keytar from 'keytar';

export class KeychainStorage implements CredentialStorage {
  async store(key: string, value: string): Promise<void> {
    await keytar.setPassword('cv-git', key, value);
  }

  async retrieve(key: string): Promise<string | null> {
    return await keytar.getPassword('cv-git', key);
  }

  async delete(key: string): Promise<void> {
    await keytar.deletePassword('cv-git', key);
  }
}
```

**Pros:**
- Native OS security
- No master password needed
- Biometric integration (Touch ID, Windows Hello)
- Industry standard

**Cons:**
- Platform-specific implementation
- Requires native modules

#### Option 2: Encrypted File Storage (Fallback)
```typescript
import { encrypt, decrypt } from 'crypto';

export class EncryptedFileStorage implements CredentialStorage {
  private masterPassword: string;
  private filePath: string; // ~/.cv/credentials.enc

  async store(key: string, value: string): Promise<void> {
    const credentials = await this.loadAll();
    credentials[key] = value;
    const encrypted = encrypt(JSON.stringify(credentials), this.masterPassword);
    await fs.writeFile(this.filePath, encrypted);
  }

  // Uses AES-256-GCM encryption
  // PBKDF2 key derivation from master password
}
```

**Pros:**
- Cross-platform
- No native dependencies
- Portable

**Cons:**
- Requires master password
- Manual password entry

### Credential Types

```typescript
export interface Credential {
  id: string;
  type: CredentialType;
  name: string;
  createdAt: Date;
  lastUsed?: Date;
  metadata?: Record<string, any>;
}

export enum CredentialType {
  GITHUB_PAT = 'github_pat',           // GitHub Personal Access Token
  GITHUB_SSH = 'github_ssh',           // SSH private key
  ANTHROPIC_API = 'anthropic_api',     // Anthropic API key
  OPENAI_API = 'openai_api',           // OpenAI API key
  GIT_CREDENTIALS = 'git_credentials'  // Generic git credentials
}

export interface GitHubPATCredential extends Credential {
  type: CredentialType.GITHUB_PAT;
  token: string;
  scopes: string[];           // ['repo', 'workflow', 'write:packages']
  expiresAt?: Date;
}

export interface AnthropicAPICredential extends Credential {
  type: CredentialType.ANTHROPIC_API;
  apiKey: string;
}
```

---

## GitHub Integration

### Authentication Flow

```typescript
export class GitHubAuthManager {
  /**
   * Interactive setup flow
   */
  async setup(): Promise<void> {
    console.log('🔐 GitHub Authentication Setup\n');

    // Option 1: Personal Access Token (simple)
    console.log('Option 1: Personal Access Token (recommended)');
    console.log('  1. Go to https://github.com/settings/tokens/new');
    console.log('  2. Select scopes: repo, workflow, write:packages');
    console.log('  3. Generate token');

    const token = await prompt('Enter your GitHub token:', { mask: true });

    // Validate token
    const user = await this.validateToken(token);

    // Store securely
    await this.credentials.store({
      type: CredentialType.GITHUB_PAT,
      name: `github-${user.login}`,
      token,
      scopes: await this.getTokenScopes(token)
    });

    // Configure git credential helper
    await this.configureGitCredentialHelper();

    console.log('✅ GitHub authentication configured!');
  }

  /**
   * Configure git to use CV-Git credentials
   */
  private async configureGitCredentialHelper(): Promise<void> {
    await exec('git config --global credential.helper cv-git');

    // Create credential helper script
    // Git will call: git-credential-cv-git get
    // We return: protocol=https\nhost=github.com\nusername=token\npassword=<token>
  }
}
```

### Git Credential Helper

```bash
#!/usr/bin/env node
# ~/.cv/git-credential-cv-git

# Git calls this with: get, store, erase
# We integrate with our credential manager

const { CredentialManager } = require('@cv-git/credentials');

async function main() {
  const action = process.argv[2]; // 'get', 'store', 'erase'
  const manager = new CredentialManager();

  if (action === 'get') {
    const input = await readStdin(); // protocol=https\nhost=github.com
    const { host } = parseInput(input);

    if (host === 'github.com') {
      const cred = await manager.getGitHubCredential();
      if (cred) {
        console.log('protocol=https');
        console.log('host=github.com');
        console.log('username=token');
        console.log(`password=${cred.token}`);
      }
    }
  }
}

main();
```

### GitHub API Client

```typescript
export class GitHubClient {
  private octokit: Octokit;

  constructor(private credentials: CredentialManager) {
    const token = await credentials.getGitHubToken();
    this.octokit = new Octokit({ auth: token });
  }

  /**
   * Create pull request with AI-generated description
   */
  async createPR(options: {
    base: string;
    head: string;
    title?: string;
    generateDescription?: boolean;
  }): Promise<PullRequest> {
    // Get diff
    const diff = await git.getDiff(`${options.base}...${options.head}`);

    // Generate AI description if requested
    let body = '';
    if (options.generateDescription) {
      body = await this.ai.generatePRDescription(diff, {
        includeTestPlan: true,
        includeBreakingChanges: true,
        includeScreenshots: false
      });
    }

    // Create PR
    const pr = await this.octokit.pulls.create({
      owner: await this.getOwner(),
      repo: await this.getRepo(),
      title: options.title || await this.ai.generatePRTitle(diff),
      body,
      base: options.base,
      head: options.head
    });

    return pr.data;
  }

  /**
   * Create release with AI-generated changelog
   */
  async createRelease(options: {
    tag: string;
    previousTag?: string;
    generateChangelog?: boolean;
  }): Promise<Release> {
    let body = '';

    if (options.generateChangelog) {
      // Get commits since last release
      const commits = await git.getCommits(options.previousTag, options.tag);

      // Generate AI changelog
      body = await this.ai.generateChangelog(commits, {
        categorize: true,        // Features, Fixes, Breaking Changes
        includeContributors: true,
        format: 'markdown'
      });
    }

    const release = await this.octokit.repos.createRelease({
      owner: await this.getOwner(),
      repo: await this.getRepo(),
      tag_name: options.tag,
      name: options.tag,
      body
    });

    return release.data;
  }
}
```

---

## AI-Powered Git Commands

### cv commit - Smart Commits

```typescript
export function commitCommand(): Command {
  return new Command('commit')
    .description('AI-powered git commit with smart message generation')
    .option('-a, --all', 'Commit all changes')
    .option('--no-ai', 'Disable AI message generation')
    .option('-m, --message <msg>', 'Use this message instead of AI')
    .action(async (options) => {
      // Stage changes
      if (options.all) {
        await git.add('.');
      }

      // Get staged diff
      const diff = await git.getDiff('--staged');

      if (!diff) {
        console.error('No changes staged for commit');
        return;
      }

      // Generate commit message with AI
      let message = options.message;
      if (!message && options.ai) {
        console.log('🤖 Generating commit message...\n');

        message = await ai.generateCommitMessage(diff, {
          style: 'conventional',  // conventional commits format
          maxLength: 72,
          includeBody: true,
          includeBreakingChanges: true
        });

        console.log('Proposed commit message:');
        console.log('─'.repeat(50));
        console.log(message);
        console.log('─'.repeat(50));

        const proceed = await confirm('Use this message?');
        if (!proceed) {
          message = await prompt('Enter commit message:');
        }
      }

      // Commit (credentials handled automatically)
      await git.commit(message);
      console.log('✅ Committed successfully');
    });
}
```

**Example usage:**
```bash
cv commit -a
# 🤖 Generating commit message...
#
# Proposed commit message:
# ──────────────────────────────────────────────────
# feat: add secure credential management system
#
# - Implement keychain storage for GitHub tokens
# - Add encrypted fallback storage
# - Create git credential helper integration
# - Support multiple credential types
#
# This enables AI agents to perform git operations
# without manual authentication.
# ──────────────────────────────────────────────────
# Use this message? (Y/n)
```

### cv push - Authenticated Push

```typescript
export function pushCommand(): Command {
  return new Command('push')
    .description('Push to remote with automatic authentication')
    .argument('[remote]', 'Remote name', 'origin')
    .argument('[branch]', 'Branch name')
    .option('-f, --force', 'Force push')
    .action(async (remote, branch, options) => {
      // Credentials are automatically used via git credential helper
      const currentBranch = branch || await git.getCurrentBranch();

      console.log(`📤 Pushing to ${remote}/${currentBranch}...`);

      try {
        await git.push(remote, currentBranch, {
          force: options.force,
          setUpstream: true
        });

        console.log('✅ Pushed successfully');

        // Suggest creating PR if not on main/master
        if (!['main', 'master'].includes(currentBranch)) {
          const createPR = await confirm('Create pull request?');
          if (createPR) {
            await prCommand().parseAsync(['create'], { from: 'user' });
          }
        }
      } catch (error) {
        if (error.message.includes('authentication')) {
          console.error('❌ Authentication failed');
          console.log('Run: cv auth setup');
        } else {
          throw error;
        }
      }
    });
}
```

### cv pr - Pull Request Management

```typescript
export function prCommand(): Command {
  const cmd = new Command('pr')
    .description('Manage pull requests with AI assistance');

  // cv pr create
  cmd
    .command('create')
    .description('Create pull request with AI-generated description')
    .option('-b, --base <branch>', 'Base branch', 'main')
    .option('-t, --title <title>', 'PR title')
    .option('--no-ai', 'Skip AI description generation')
    .action(async (options) => {
      const head = await git.getCurrentBranch();

      if (head === options.base) {
        console.error('Already on base branch');
        return;
      }

      console.log(`🔄 Creating PR: ${head} → ${options.base}`);

      // Get commits for PR
      const commits = await git.getCommits(`${options.base}..${head}`);
      console.log(`📝 ${commits.length} commits to merge\n`);

      // Generate PR content with AI
      let title = options.title;
      let description = '';

      if (options.ai) {
        console.log('🤖 Generating PR description...\n');

        const diff = await git.getDiff(`${options.base}...${head}`);

        if (!title) {
          title = await ai.generatePRTitle(diff, commits);
        }

        description = await ai.generatePRDescription(diff, {
          commits,
          includeTestPlan: true,
          includeScreenshots: false,
          format: 'github_markdown'
        });

        console.log('Title:', title);
        console.log('\nDescription:');
        console.log('─'.repeat(50));
        console.log(description);
        console.log('─'.repeat(50));
        console.log();
      }

      const proceed = await confirm('Create this pull request?');
      if (!proceed) return;

      // Create PR via GitHub API (uses credentials)
      const github = new GitHubClient(credentials);
      const pr = await github.createPR({
        base: options.base,
        head,
        title,
        body: description
      });

      console.log(`✅ Pull request created: ${pr.html_url}`);
    });

  // cv pr list
  cmd
    .command('list')
    .description('List pull requests')
    .option('--state <state>', 'PR state (open|closed|all)', 'open')
    .action(async (options) => {
      const github = new GitHubClient(credentials);
      const prs = await github.listPRs({ state: options.state });

      for (const pr of prs) {
        console.log(`#${pr.number} ${pr.title}`);
        console.log(`  ${pr.html_url}`);
        console.log(`  ${pr.user.login} - ${pr.state}`);
        console.log();
      }
    });

  return cmd;
}
```

**Example usage:**
```bash
cv pr create
# 🔄 Creating PR: feature/auth → main
# 📝 5 commits to merge
#
# 🤖 Generating PR description...
#
# Title: Add secure credential management system
#
# Description:
# ──────────────────────────────────────────────────
# ## Summary
# This PR adds a secure credential management system
# to CV-Git, enabling AI agents to perform git
# operations without manual authentication.
#
# ## Changes
# - ✅ Keychain storage integration (macOS, Windows, Linux)
# - ✅ Encrypted file storage fallback
# - ✅ Git credential helper
# - ✅ GitHub API client with auto-auth
# - ✅ AI-powered commit messages
#
# ## Test Plan
# - [ ] Test `cv auth setup` flow
# - [ ] Verify automatic push authentication
# - [ ] Test PR creation
# - [ ] Cross-platform testing
#
# ## Breaking Changes
# None
# ──────────────────────────────────────────────────
#
# Create this pull request? (Y/n)
```

### cv release - Automated Releases

```typescript
export function releaseCommand(): Command {
  return new Command('release')
    .description('Create release with AI-generated changelog')
    .argument('<version>', 'Version tag (e.g., v0.1.0)')
    .option('--previous <tag>', 'Previous release tag')
    .option('--no-ai', 'Skip AI changelog generation')
    .action(async (version, options) => {
      // Auto-detect previous release
      let previousTag = options.previous;
      if (!previousTag) {
        const tags = await git.getTags();
        previousTag = tags[0]; // Most recent tag
      }

      console.log(`📦 Creating release ${version}`);
      if (previousTag) {
        console.log(`   (since ${previousTag})\n`);
      }

      // Get commits since last release
      const commits = await git.getCommits(
        previousTag ? `${previousTag}..HEAD` : 'HEAD'
      );

      console.log(`📝 ${commits.length} commits since last release\n`);

      // Generate changelog with AI
      let changelog = '';
      if (options.ai) {
        console.log('🤖 Generating changelog...\n');

        changelog = await ai.generateChangelog(commits, {
          categorize: true,           // Group by type
          includeContributors: true,  // List contributors
          includeLinks: true,         // Link to commits/PRs
          format: 'markdown',
          style: 'detailed'           // vs 'concise'
        });

        console.log('Generated changelog:');
        console.log('─'.repeat(50));
        console.log(changelog);
        console.log('─'.repeat(50));
        console.log();
      }

      const proceed = await confirm(`Create release ${version}?`);
      if (!proceed) return;

      // Create git tag
      await git.tag(version, changelog);
      await git.push('origin', version);

      // Create GitHub release
      const github = new GitHubClient(credentials);
      const release = await github.createRelease({
        tag: version,
        name: version,
        body: changelog,
        draft: false,
        prerelease: version.includes('beta') || version.includes('alpha')
      });

      console.log(`✅ Release created: ${release.html_url}`);
    });
}
```

---

## CLI Commands

### cv auth - Credential Management

```bash
# Setup GitHub authentication
cv auth setup

# Setup specific service
cv auth setup github
cv auth setup anthropic
cv auth setup openai

# List configured credentials
cv auth list

# Test credentials
cv auth test github

# Rotate/update credential
cv auth rotate github

# Remove credential
cv auth remove github
```

### AI-Powered Git Workflow

```bash
# Traditional git workflow (manual):
git add .
git commit -m "feat: add new feature"
git push origin feature-branch
# [manually create PR on GitHub]
# [manually write release notes]

# CV-Git workflow (AI-powered):
cv commit -a                    # AI generates commit message
cv push                         # Auto-authenticated
cv pr create                    # AI generates PR description
cv release v1.0.0              # AI generates changelog
```

---

## Implementation Phases

### Phase 5A: Credential Management (Week 1)
**Goal:** Secure credential storage

**Tasks:**
- [ ] Create `@cv-git/credentials` package
- [ ] Implement KeychainStorage (macOS, Windows, Linux)
- [ ] Implement EncryptedFileStorage (fallback)
- [ ] Create CredentialManager with CRUD operations
- [ ] Add credential types (GitHub, Anthropic, OpenAI)
- [ ] Write tests for all storage backends

**Deliverables:**
- Secure credential storage working on all platforms
- CLI commands: `cv auth setup`, `cv auth list`

### Phase 5B: GitHub Integration (Week 2)
**Goal:** GitHub API integration with auto-auth

**Tasks:**
- [ ] Create `@cv-git/github` package
- [ ] Implement GitHubClient (using Octokit)
- [ ] Create git credential helper script
- [ ] Configure git to use CV-Git credentials
- [ ] Implement PR creation, listing, viewing
- [ ] Implement release creation
- [ ] Add GitHub authentication flow

**Deliverables:**
- `cv push` works without manual auth
- `cv pr create` creates PRs via API
- Git credential helper integration

### Phase 5C: AI-Powered Git Commands (Week 3)
**Goal:** AI-enhanced git workflow

**Tasks:**
- [ ] Implement `cv commit` with AI message generation
- [ ] Add commit message prompt templates
- [ ] Implement `cv pr create` with AI descriptions
- [ ] Add PR description templates
- [ ] Implement `cv release` with AI changelogs
- [ ] Add changelog generation logic
- [ ] Create prompt engineering for each command

**Deliverables:**
- `cv commit` generates conventional commit messages
- `cv pr create` generates PR descriptions with test plan
- `cv release` generates categorized changelogs

### Phase 5D: Polish & Documentation (Week 4)
**Goal:** Production-ready release

**Tasks:**
- [ ] Cross-platform testing (macOS, Windows, Linux)
- [ ] Error handling and user feedback
- [ ] Migration guide for existing users
- [ ] Security audit
- [ ] Documentation updates
- [ ] Demo videos

**Deliverables:**
- Complete documentation
- Security review passed
- Ready for v0.2.0 release

---

## Security Considerations

### Token Storage
- ✅ Never store tokens in plain text
- ✅ Use OS keychain when available
- ✅ Encrypt file storage with AES-256-GCM
- ✅ Require master password for encrypted storage
- ✅ Support biometric authentication (Touch ID, Windows Hello)

### Token Permissions
- ✅ Request minimal GitHub token scopes
- ✅ Document required permissions
- ✅ Support multiple tokens for different permissions
- ✅ Warn on overly permissive tokens

### Audit Trail
- ✅ Log credential access (not values)
- ✅ Track last used timestamp
- ✅ Notify on suspicious activity
- ✅ Support credential rotation

### Best Practices
- ✅ Never log credential values
- ✅ Mask credentials in CLI output
- ✅ Clear credentials from memory after use
- ✅ Support credential expiration
- ✅ Integrate with GitHub token expiration

---

## Developer Experience Benefits

### Before CV-Git (Current Pain Points)
```bash
git add .
git commit -m "fix stuff"           # Generic message
git push
# > Username: [manual entry]
# > Password: [manual entry]
# > fatal: authentication failed

# Create PR manually on GitHub
# Write PR description manually
# Generate changelog manually
```

### After CV-Git (Seamless Experience)
```bash
cv commit -a
# 🤖 Generating commit message...
# ✅ Committed: "fix(auth): resolve token validation edge case"

cv push
# 📤 Pushing to origin/fix-auth...
# ✅ Pushed successfully
# Create pull request? (Y/n) y

cv pr create
# 🤖 Generating PR description...
# ✅ Pull request created: https://github.com/...

# When ready to release:
cv release v0.2.0
# 🤖 Generating changelog...
# ✅ Release created with AI changelog
```

### Benefits
1. **Zero credential friction** - One-time setup, then automatic
2. **Better commit messages** - AI generates conventional commits
3. **Faster PR creation** - AI writes descriptions with test plans
4. **Automated changelogs** - AI categorizes commits by type
5. **AI agent friendly** - Agents can do full git workflow autonomously

---

## Comparison with Alternatives

### vs. GitHub CLI (`gh`)
- ✅ CV-Git has AI-generated content (commits, PRs, changelogs)
- ✅ CV-Git integrates with knowledge graph & semantic search
- ✅ CV-Git handles multiple credential types (not just GitHub)
- ✅ CV-Git provides AI code review context
- ⚖️ Both provide PR/release management

### vs. Conventional Commits CLI
- ✅ CV-Git auto-generates messages (no manual prompts)
- ✅ CV-Git understands code context from knowledge graph
- ✅ CV-Git generates full PR descriptions, not just commit messages
- ⚖️ Both follow conventional commits format

### vs. Git Credential Managers
- ✅ CV-Git manages multiple credential types (not just git)
- ✅ CV-Git provides AI-powered commands (not just storage)
- ✅ CV-Git integrates credentials with AI features
- ⚖️ Both provide secure storage

---

## Success Metrics

### Technical Metrics
- ✅ 100% of git push/pull operations work without manual auth
- ✅ <1 second credential retrieval time
- ✅ Zero credential exposure in logs or errors
- ✅ 100% cross-platform compatibility

### UX Metrics
- ✅ <30 seconds for initial `cv auth setup`
- ✅ >80% user satisfaction with AI commit messages
- ✅ >70% user adoption of `cv pr create` over manual
- ✅ 50%+ reduction in time to create releases

### Adoption Metrics
- ✅ 1000+ GitHub stars
- ✅ 100+ active users
- ✅ 10+ community contributions
- ✅ Featured in developer newsletters

---

## Next Steps

1. **Design Review** - Review this proposal
2. **Prototype** - Build credential storage proof-of-concept
3. **Security Review** - Audit credential handling
4. **Implementation** - Follow 4-week roadmap
5. **Testing** - Cross-platform testing
6. **Release** - CV-Git v0.2.0 with credential management

---

**This makes CV-Git truly better than git - not just a wrapper, but an AI-first version control experience.**
