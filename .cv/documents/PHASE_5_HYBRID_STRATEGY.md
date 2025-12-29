# Phase 5: Hybrid Strategy - GitHub Client with Platform Optionality

## Strategic Approach

**Short Term (Now - 6 months):**
Build CV-Git as a GitHub client with best-in-class credential management

**Long Term (6-18 months):**
Pivot to CV Platform when market validation is complete

**Key Principle:**
Design credential management and CLI architecture to be **platform-agnostic** from day one.

---

## Architecture: Platform-Agnostic Design

### The Key Insight

```
WRONG (GitHub-locked):
cv-git → GitHub API (hardcoded)

RIGHT (Platform-agnostic):
cv-git → Platform Adapter → [GitHub | CV Platform]
```

### Modular Architecture

```
┌─────────────────────────────────────────────────────┐
│                   CV-Git CLI                         │
│  (commands: commit, push, pr, release, etc.)        │
└────────────────┬────────────────────────────────────┘
                 │
┌────────────────▼────────────────────────────────────┐
│            Credential Manager                        │
│  (platform-agnostic, manages all credentials)       │
└────────────────┬────────────────────────────────────┘
                 │
┌────────────────▼────────────────────────────────────┐
│            Platform Adapter Layer                    │
│  (abstraction over git hosting platforms)           │
└──────┬──────────────────────┬───────────────────────┘
       │                      │
┌──────▼──────┐      ┌────────▼──────────┐
│   GitHub    │      │   CV Platform     │
│   Adapter   │      │   Adapter         │
│  (v0.2.0)   │      │   (v1.0.0)        │
└─────────────┘      └───────────────────┘
```

### Why This Works

**Today (v0.2.0):**
- Users get GitHub integration
- Credential management works locally
- CLI commands work with GitHub API

**Tomorrow (v1.0.0):**
- Same CLI commands
- Same credential management
- Just swap the adapter: GitHub → CV Platform
- **Zero CLI changes for users**

---

## Credential Management: Platform-Agnostic

### Design Principles

1. **Platform-agnostic storage** - Credentials don't know about GitHub
2. **Flexible credential types** - Can store any service's credentials
3. **Adapter pattern** - Platform adapters use credentials, CLI doesn't care which platform

### Credential Types

```typescript
// Platform-agnostic credential types
export enum CredentialType {
  // Git hosting platforms (generic)
  GIT_PLATFORM_TOKEN = 'git_platform_token',
  GIT_PLATFORM_SSH = 'git_platform_ssh',

  // Specific platforms (for migration)
  GITHUB_PAT = 'github_pat',
  CV_PLATFORM_TOKEN = 'cv_platform_token',

  // AI services
  ANTHROPIC_API = 'anthropic_api',
  OPENAI_API = 'openai_api',
}

export interface GitPlatformTokenCredential extends BaseCredential {
  type: CredentialType.GIT_PLATFORM_TOKEN;
  token: string;
  platform: 'github' | 'cv-platform' | 'gitlab';  // Flexible
  scopes: string[];
  expiresAt?: Date;
}
```

### Configuration

```typescript
// ~/.cv/config.json
{
  "platform": {
    "type": "github",  // or "cv-platform"
    "url": "https://github.com",  // or "https://cv-platform.com"
    "api": "https://api.github.com"  // or "https://api.cv-platform.com"
  },
  "credentials": {
    "storage": "keychain"  // or "encrypted-file"
  },
  "ai": {
    "provider": "anthropic",
    "model": "claude-3-5-sonnet-20241022"
  }
}
```

**Switching platforms is just:**
```bash
cv config set platform.type cv-platform
cv config set platform.url https://cv-platform.com
# Done! All commands now use CV Platform
```

---

## Platform Adapter Pattern

### Interface

```typescript
// packages/platform/src/interface.ts

export interface GitPlatformAdapter {
  // Repository operations
  getRepoInfo(): Promise<{ owner: string; repo: string }>;

  // Pull requests
  createPR(options: CreatePROptions): Promise<PullRequest>;
  listPRs(options?: ListPROptions): Promise<PullRequest[]>;
  getPR(number: number): Promise<PullRequest>;

  // Releases
  createRelease(options: CreateReleaseOptions): Promise<Release>;
  listReleases(): Promise<Release[]>;

  // Issues (future)
  createIssue(options: CreateIssueOptions): Promise<Issue>;
  listIssues(options?: ListIssueOptions): Promise<Issue[]>;

  // Authentication
  validateToken(token: string): Promise<{ username: string; name: string }>;
  getTokenScopes(token: string): Promise<string[]>;
}

// Platform-agnostic types
export interface PullRequest {
  number: number;
  title: string;
  body: string;
  state: 'open' | 'closed' | 'merged';
  url: string;
  author: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Release {
  id: string;
  tag: string;
  name: string;
  body: string;
  url: string;
  createdAt: Date;
}
```

### GitHub Adapter (v0.2.0)

```typescript
// packages/platform/src/adapters/github.ts

import { Octokit } from '@octokit/rest';
import { GitPlatformAdapter, PullRequest, Release } from '../interface';

export class GitHubAdapter implements GitPlatformAdapter {
  private octokit: Octokit;

  constructor(private credentials: CredentialManager) {}

  async init(): Promise<void> {
    const token = await this.credentials.getGitPlatformToken('github');
    this.octokit = new Octokit({ auth: token });
  }

  async createPR(options: CreatePROptions): Promise<PullRequest> {
    const { owner, repo } = await this.getRepoInfo();

    const { data } = await this.octokit.pulls.create({
      owner,
      repo,
      title: options.title,
      body: options.body,
      base: options.base,
      head: options.head,
    });

    // Convert GitHub PR to platform-agnostic PR
    return {
      number: data.number,
      title: data.title,
      body: data.body || '',
      state: data.state as 'open' | 'closed',
      url: data.html_url,
      author: data.user?.login || 'unknown',
      createdAt: new Date(data.created_at),
      updatedAt: new Date(data.updated_at),
    };
  }

  // ... other methods
}
```

### CV Platform Adapter (v1.0.0 - Future)

```typescript
// packages/platform/src/adapters/cv-platform.ts

export class CVPlatformAdapter implements GitPlatformAdapter {
  private client: CVPlatformClient;

  constructor(private credentials: CredentialManager) {}

  async init(): Promise<void> {
    const token = await this.credentials.getGitPlatformToken('cv-platform');
    this.client = new CVPlatformClient({ token });
  }

  async createPR(options: CreatePROptions): Promise<PullRequest> {
    // CV Platform API (when we build it)
    const response = await this.client.pullRequests.create({
      title: options.title,
      body: options.body,
      base: options.base,
      head: options.head,
      // CV Platform bonus features:
      aiEnhanced: true,  // Auto-generate description
      autoReview: true,  // AI review on creation
    });

    return {
      number: response.number,
      title: response.title,
      body: response.body,
      state: response.state,
      url: response.url,
      author: response.author.username,
      createdAt: new Date(response.createdAt),
      updatedAt: new Date(response.updatedAt),
    };
  }

  // ... other methods
}
```

### Platform Factory

```typescript
// packages/platform/src/factory.ts

export function createPlatformAdapter(
  config: PlatformConfig,
  credentials: CredentialManager
): GitPlatformAdapter {
  switch (config.type) {
    case 'github':
      return new GitHubAdapter(credentials);

    case 'cv-platform':
      return new CVPlatformAdapter(credentials);

    case 'gitlab':
      return new GitLabAdapter(credentials);  // Future

    default:
      throw new Error(`Unknown platform: ${config.type}`);
  }
}
```

---

## CLI Commands: Platform-Agnostic

### Example: cv pr create

```typescript
// packages/cli/src/commands/pr.ts

export function prCommand(): Command {
  return new Command('pr')
    .command('create')
    .option('-b, --base <branch>', 'Base branch', 'main')
    .option('-t, --title <title>', 'PR title')
    .option('--no-ai', 'Skip AI generation')
    .action(async (options) => {
      // Load config (knows which platform to use)
      const config = await loadConfig();

      // Create platform adapter (GitHub or CV Platform)
      const credentials = new CredentialManager();
      const platform = createPlatformAdapter(config.platform, credentials);
      await platform.init();

      // Get current branch
      const git = simpleGit();
      const head = await git.revparse(['--abbrev-ref', 'HEAD']);

      // Generate AI content (platform-agnostic)
      let title = options.title;
      let body = '';

      if (options.ai) {
        const ai = createAIManager(config.ai, credentials);
        const diff = await git.diff([`${options.base}...${head}`]);

        title = title || await ai.generatePRTitle(diff);
        body = await ai.generatePRDescription(diff);
      }

      // Create PR (works with any platform!)
      const pr = await platform.createPR({
        base: options.base,
        head,
        title,
        body,
      });

      console.log(`✅ Pull request created!`);
      console.log(`   #${pr.number}: ${pr.title}`);
      console.log(`   ${pr.url}`);
    });
}
```

**Key point:** The command doesn't know or care if it's GitHub or CV Platform. The adapter handles all platform-specific details.

---

## Package Structure

### New Package: @cv-git/platform

```
packages/
├── platform/              # NEW: Platform abstraction
│   ├── src/
│   │   ├── interface.ts           # GitPlatformAdapter interface
│   │   ├── factory.ts             # Platform factory
│   │   ├── adapters/
│   │   │   ├── github.ts          # GitHub implementation
│   │   │   ├── cv-platform.ts     # CV Platform (future)
│   │   │   └── gitlab.ts          # GitLab (future)
│   │   └── types.ts               # Platform-agnostic types
│   └── package.json
│
├── credentials/           # UPDATED: Platform-agnostic
│   ├── src/
│   │   ├── storage/               # Keychain, encrypted file
│   │   ├── manager.ts             # Credential CRUD
│   │   └── types.ts               # Platform-agnostic credential types
│   └── package.json
│
├── cli/                   # UPDATED: Uses platform adapter
│   ├── src/
│   │   ├── commands/
│   │   │   ├── auth.ts            # cv auth (platform-agnostic)
│   │   │   ├── commit.ts          # cv commit
│   │   │   ├── push.ts            # cv push
│   │   │   ├── pr.ts              # cv pr (platform-agnostic)
│   │   │   └── release.ts         # cv release (platform-agnostic)
│   │   └── config.ts              # Load config with platform settings
│   └── package.json
│
├── core/                  # EXISTING: No changes
├── shared/                # EXISTING: No changes
└── github/                # DEPRECATED: Merge into platform/adapters/github
```

---

## Migration Path: GitHub → CV Platform

### For Users

**Today (v0.2.0):**
```bash
# One-time setup
cv auth setup github

# Daily workflow
cv commit -a
cv push
cv pr create
```

**Tomorrow (v1.0.0):**
```bash
# One-time migration
cv platform migrate cv-platform

# Daily workflow (SAME COMMANDS)
cv commit -a
cv push
cv pr create
```

**That's it.** Same commands, better platform.

### For Us (Developers)

**Today (v0.2.0):**
- Build GitHubAdapter
- Test with real GitHub repos
- Validate market demand

**Tomorrow (v1.0.0):**
- Build CV Platform backend
- Implement CVPlatformAdapter (same interface)
- Ship migration command
- Users can switch with one command

---

## Implementation Plan

### Week 1-2: Credential Management (Platform-Agnostic)
- [ ] Design platform-agnostic credential types
- [ ] Implement KeychainStorage
- [ ] Implement EncryptedFileStorage
- [ ] Implement CredentialManager
- [ ] Support multiple platforms in credential storage

**Deliverable:** `cv auth setup` works, stores credentials in platform-agnostic way

### Week 3-4: Platform Adapter Layer
- [ ] Design GitPlatformAdapter interface
- [ ] Implement platform-agnostic types (PR, Release, etc.)
- [ ] Create platform factory
- [ ] Implement GitHubAdapter
- [ ] Git credential helper integration

**Deliverable:** Platform adapter layer working with GitHub

### Week 5-6: CLI Commands with Platform Adapter
- [ ] Update `cv pr create` to use platform adapter
- [ ] Update `cv release` to use platform adapter
- [ ] Update `cv auth` to support platform selection
- [ ] Add `cv config` command for platform settings
- [ ] Test with GitHub

**Deliverable:** All CLI commands platform-agnostic

### Week 7-8: Polish & Documentation
- [ ] Cross-platform testing
- [ ] Write migration guide (for future CV Platform migration)
- [ ] Document platform adapter interface
- [ ] Security audit
- [ ] Release v0.2.0

**Deliverable:** Production-ready v0.2.0

---

## Configuration Design

### ~/.cv/config.json

```json
{
  "version": "0.2.0",

  "platform": {
    "type": "github",
    "url": "https://github.com",
    "api": "https://api.github.com"
  },

  "credentials": {
    "storage": "keychain",
    "masterPasswordRequired": false
  },

  "ai": {
    "provider": "anthropic",
    "model": "claude-3-5-sonnet-20241022",
    "maxTokens": 4096,
    "temperature": 0.7
  },

  "graph": {
    "url": "redis://localhost:6379",
    "database": "cv-graph"
  },

  "vector": {
    "url": "http://localhost:6333",
    "collection": "cv-vectors"
  },

  "features": {
    "aiCommitMessages": true,
    "aiPRDescriptions": true,
    "aiCodeReview": true,
    "autoMerge": false
  }
}
```

### CLI Commands for Config

```bash
# View current platform
cv config get platform.type
# Output: github

# Switch platform (future)
cv config set platform.type cv-platform

# View all config
cv config list

# Reset to defaults
cv config reset
```

---

## Future Migration: GitHub → CV Platform

### Migration Command

```bash
cv platform migrate cv-platform
```

**What it does:**
1. Updates `config.json` platform settings
2. Migrates credentials (GitHub token → CV Platform token)
3. Tests connection to CV Platform
4. Optionally syncs repositories to CV Platform
5. Updates git remotes (or leaves them, works both ways)

### Dual-Platform Support

```json
// Support both platforms simultaneously
{
  "platforms": [
    {
      "name": "github",
      "type": "github",
      "url": "https://github.com",
      "default": false
    },
    {
      "name": "cv-platform",
      "type": "cv-platform",
      "url": "https://cv-platform.com",
      "default": true
    }
  ]
}
```

**Usage:**
```bash
cv pr create --platform github      # Create PR on GitHub
cv pr create --platform cv-platform # Create PR on CV Platform
cv pr create                        # Use default (cv-platform)
```

---

## Benefits of This Approach

### Technical Benefits
1. **Clean architecture** - Separation of concerns
2. **Testability** - Mock platform adapters for testing
3. **Flexibility** - Support multiple platforms (GitHub, GitLab, CV Platform)
4. **Future-proof** - Easy to add new platforms

### Business Benefits
1. **Validate first** - Test with GitHub before building platform
2. **Learn from users** - Understand needs before platform design
3. **Low risk** - Build incrementally
4. **Optionality** - Can pivot to CV Platform when ready

### User Benefits
1. **Use today** - Works with GitHub immediately
2. **Smooth migration** - One command to switch to CV Platform
3. **No lock-in** - Can use multiple platforms
4. **Same experience** - CLI commands identical across platforms

---

## Success Criteria

### v0.2.0 (GitHub Client)
- [ ] Works with any GitHub repository
- [ ] Credential management is platform-agnostic
- [ ] All commands work through platform adapter
- [ ] Config supports platform switching (even if only GitHub exists)
- [ ] Documentation shows migration path to CV Platform

### v1.0.0 (CV Platform)
- [ ] CV Platform backend exists
- [ ] CVPlatformAdapter implemented
- [ ] Migration command works
- [ ] Users can switch with one command
- [ ] Zero breaking changes to CLI

---

## Timeline

**Phase 1 (Weeks 1-8):** v0.2.0 - GitHub Client
- Platform-agnostic architecture
- GitHub adapter
- Full credential management
- All CLI commands

**Phase 2 (Months 3-6):** Market Validation
- User feedback
- Feature requests
- Usage metrics
- Decision point: Build CV Platform?

**Phase 3 (Months 7-12):** v1.0.0 - CV Platform
- Build CV Platform backend
- Implement CVPlatformAdapter
- Migration tools
- Dual-platform support

**Phase 4 (Months 13+):** Scale
- Deprecate GitHub adapter (optional)
- CV Platform becomes primary
- GitHub becomes legacy

---

## The Smart Path Forward

**Start:** GitHub client with platform-agnostic architecture
**Learn:** What users really need
**Decide:** Build CV Platform if validated
**Migrate:** One command, zero friction

**This gives you:**
- ✅ Revenue soon (GitHub client users)
- ✅ Learning before big investment
- ✅ Smooth pivot path
- ✅ Low technical debt

---

## Next Steps

### This Week
1. ✅ **Design complete** - This document
2. [ ] **Review & approve** - Validate approach
3. [ ] **Start Week 1** - Credential management implementation

### Next Month
- Complete credential management
- Complete platform adapter layer
- First working version with GitHub

### This Quarter
- v0.2.0 release
- User feedback
- Market validation
- Decision on CV Platform timing

---

**This is the smart, pragmatic path that keeps all options open.** 🎯
