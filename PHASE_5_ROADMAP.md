# Phase 5: AI-Native Git with Credential Management

## Vision

Transform CV-Git from an AI wrapper around Git into a **truly superior version control experience** where AI agents can perform the full development workflow autonomously.

**Key Differentiator:** CV-Git = Git + AI + Knowledge Graph + Secure Credential Wallet

---

## 4-Week Implementation Plan

### Week 1: Credential Management Foundation

#### Package Setup
```bash
# Create new package
mkdir -p packages/credentials/src/{storage,types}
cd packages/credentials

# Initialize
pnpm init
```

#### Tasks

**Day 1-2: Storage Abstraction**
- [ ] Define `CredentialStorage` interface
- [ ] Implement credential types (GitHub PAT, API keys, SSH)
- [ ] Create credential metadata structure
- [ ] Add encryption utilities (AES-256-GCM)

**Day 3-4: OS Keychain Integration**
- [ ] Integrate `keytar` for cross-platform keychain
- [ ] Implement `KeychainStorage` class
- [ ] Test on macOS (Keychain)
- [ ] Test on Windows (Credential Manager)
- [ ] Test on Linux (Secret Service API)

**Day 5: Encrypted File Storage**
- [ ] Implement `EncryptedFileStorage` class
- [ ] Add PBKDF2 key derivation
- [ ] Create master password flow
- [ ] Add file permissions (chmod 600)

**Day 6-7: Credential Manager**
- [ ] Implement `CredentialManager` class
- [ ] Add CRUD operations
- [ ] Add credential validation
- [ ] Add migration from environment variables
- [ ] Write comprehensive tests

#### Deliverables
```typescript
// packages/credentials/src/index.ts
export { CredentialManager } from './manager';
export { CredentialType } from './types';
export type { Credential, GitHubPATCredential } from './types';

// Usage:
const manager = new CredentialManager();
await manager.store({
  type: CredentialType.GITHUB_PAT,
  name: 'github-main',
  token: 'ghp_...'
});
```

---

### Week 2: GitHub Integration

#### Package Setup
```bash
mkdir -p packages/github/src
cd packages/github
pnpm add @octokit/rest @octokit/auth-token
```

#### Tasks

**Day 1-2: Git Credential Helper**
- [ ] Create `git-credential-cv-git` script
- [ ] Implement `get` operation (return token)
- [ ] Implement `store` operation (save token)
- [ ] Implement `erase` operation (remove token)
- [ ] Configure git to use helper
- [ ] Test with `git push`

**Day 3-4: GitHub API Client**
- [ ] Implement `GitHubClient` class
- [ ] Add authentication with stored tokens
- [ ] Implement repository operations
- [ ] Implement PR operations (create, list, view)
- [ ] Implement release operations
- [ ] Add error handling for auth failures

**Day 5: Auth Setup Flow**
- [ ] Create `cv auth setup` command
- [ ] Add interactive GitHub token setup
- [ ] Add token validation
- [ ] Add scope checking (repo, workflow)
- [ ] Configure git credential helper

**Day 6-7: Testing & Integration**
- [ ] Test full auth flow
- [ ] Test git push without manual auth
- [ ] Test PR creation via API
- [ ] Test with multiple accounts
- [ ] Integration tests with real GitHub

#### Deliverables
```bash
# Auth setup
cv auth setup github
# 🔐 GitHub Authentication Setup
# Visit: https://github.com/settings/tokens/new
# Scopes needed: repo, workflow
# Enter token: ***
# ✅ GitHub authentication configured!

# Automatic push
git push
# [works automatically with stored credentials]

# Or use cv push
cv push
# 📤 Pushing to origin/main...
# ✅ Pushed successfully
```

---

### Week 3: AI-Powered Git Commands

#### Tasks

**Day 1-2: Smart Commits**
- [ ] Create `cv commit` command
- [ ] Implement commit message generation
- [ ] Add conventional commits format
- [ ] Add commit message templates
- [ ] Add interactive approval
- [ ] Test with various code changes

**Day 3-4: PR Creation**
- [ ] Create `cv pr create` command
- [ ] Implement PR title generation
- [ ] Implement PR description generation
- [ ] Add test plan generation
- [ ] Add breaking changes detection
- [ ] Add PR templates

**Day 5: Release Automation**
- [ ] Create `cv release` command
- [ ] Implement changelog generation
- [ ] Add commit categorization (feat, fix, docs)
- [ ] Add contributor attribution
- [ ] Add version detection
- [ ] Test release creation

**Day 6-7: AI Prompt Engineering**
- [ ] Optimize commit message prompts
- [ ] Optimize PR description prompts
- [ ] Optimize changelog prompts
- [ ] Add context from knowledge graph
- [ ] Add examples for few-shot learning
- [ ] A/B test different prompt strategies

#### Deliverables

**Commit Message Generation:**
```bash
cv commit -a
# 🤖 Analyzing staged changes...
#
# Proposed commit message:
# ──────────────────────────────────────────────────
# feat(credentials): add secure GitHub token storage
#
# - Implement keychain integration for cross-platform
#   secure storage
# - Add encrypted file storage fallback
# - Create git credential helper for automatic auth
#
# This enables seamless git operations without manual
# credential entry, improving AI agent autonomy.
#
# BREAKING CHANGE: Requires re-authentication via
# `cv auth setup github`
# ──────────────────────────────────────────────────
# Use this message? (Y/n)
```

**PR Description Generation:**
```bash
cv pr create
# 🤖 Generating pull request...
#
# Title: Add secure credential management system
#
# Description:
# ──────────────────────────────────────────────────
# ## Summary
# Adds secure credential management to CV-Git, enabling
# AI agents to perform git operations autonomously.
#
# ## What Changed
# - ✅ Cross-platform keychain storage (macOS/Windows/Linux)
# - ✅ Encrypted file storage fallback with AES-256
# - ✅ Git credential helper integration
# - ✅ GitHub API client with auto-authentication
# - ✅ AI-powered commit message generation
# - ✅ Automatic PR creation with AI descriptions
#
# ## Why
# Previously, AI agents couldn't push code or create PRs
# without manual credential entry. This broke the seamless
# development experience and required user intervention.
#
# ## Test Plan
# - [x] Test `cv auth setup` on macOS
# - [x] Test `cv auth setup` on Windows
# - [x] Test `cv auth setup` on Linux
# - [x] Verify `git push` works without manual auth
# - [x] Test `cv pr create` generates accurate descriptions
# - [x] Test encrypted storage with master password
# - [ ] Security audit of credential handling
#
# ## Breaking Changes
# - Users must run `cv auth setup` to migrate from env vars
# - Minimum Node.js version now 18+ (for native crypto)
#
# ## Screenshots
# [Add screenshots of `cv auth setup` flow]
# ──────────────────────────────────────────────────
# Create pull request? (Y/n)
```

**Changelog Generation:**
```bash
cv release v0.2.0
# 🤖 Generating changelog...
# Found 47 commits since v0.1.0
#
# Generated changelog:
# ──────────────────────────────────────────────────
# # v0.2.0 - 2024-01-15
#
# ## 🚀 Features
# - **credentials**: Add secure credential management (#42)
# - **github**: Implement GitHub API integration (#43)
# - **commit**: AI-powered commit message generation (#44)
# - **pr**: AI-generated PR descriptions (#45)
# - **release**: Automated changelog generation (#46)
#
# ## 🐛 Bug Fixes
# - **auth**: Fix token validation for fine-grained PATs (#47)
# - **storage**: Handle keychain errors gracefully (#48)
#
# ## 📚 Documentation
# - Add credential management guide (#49)
# - Update README with new commands (#50)
#
# ## 💥 Breaking Changes
# - Minimum Node.js version is now 18+
# - Users must run `cv auth setup` to migrate credentials
#
# ## 👥 Contributors
# - @jwschmo (45 commits)
# - @contributor2 (2 commits)
#
# **Full Changelog**: v0.1.0...v0.2.0
# ──────────────────────────────────────────────────
# Create release? (Y/n)
```

---

### Week 4: Polish, Testing & Documentation

#### Tasks

**Day 1-2: Cross-Platform Testing**
- [ ] Test on macOS (Intel + Apple Silicon)
- [ ] Test on Windows (10 + 11)
- [ ] Test on Linux (Ubuntu, Fedora, Arch)
- [ ] Test with different git configurations
- [ ] Test with monorepo vs single repo
- [ ] Test with private vs public repos

**Day 3: Error Handling & UX**
- [ ] Add helpful error messages
- [ ] Add progress indicators
- [ ] Add color coding for output
- [ ] Add interactive prompts with validation
- [ ] Add `--verbose` flag for debugging
- [ ] Add `--dry-run` for preview

**Day 4: Security Audit**
- [ ] Review credential storage security
- [ ] Review token handling in memory
- [ ] Review logging (ensure no token leaks)
- [ ] Review file permissions
- [ ] Run static analysis (semgrep, snyk)
- [ ] Third-party security review

**Day 5: Documentation**
- [ ] Update README with credential features
- [ ] Create CREDENTIAL_MANAGEMENT_GUIDE.md
- [ ] Add examples for each command
- [ ] Create migration guide from v0.1.0
- [ ] Add troubleshooting section
- [ ] Record demo videos

**Day 6-7: Release Preparation**
- [ ] Update all package.json to v0.2.0
- [ ] Update CHANGELOG.md
- [ ] Create GitHub release draft
- [ ] Prepare announcement blog post
- [ ] Prepare social media posts
- [ ] Test npm publish flow

#### Deliverables
- All tests passing on all platforms
- Documentation complete
- Security audit passed
- Ready to release v0.2.0

---

## Technical Architecture

### Package Dependencies

```
@cv-git/cli
  ├── @cv-git/credentials  (NEW)
  ├── @cv-git/github       (NEW)
  ├── @cv-git/core         (EXISTING)
  └── @cv-git/shared       (EXISTING)

@cv-git/credentials
  ├── keytar               (OS keychain)
  ├── crypto               (encryption)
  └── @cv-git/shared

@cv-git/github
  ├── @octokit/rest        (GitHub API)
  ├── @cv-git/credentials  (auth)
  ├── @cv-git/core         (AI integration)
  └── simple-git           (git operations)

@cv-git/core
  ├── @anthropic-ai/sdk    (EXISTING)
  └── (no changes needed)
```

### File Structure

```
packages/
├── credentials/
│   ├── src/
│   │   ├── storage/
│   │   │   ├── interface.ts         # Storage interface
│   │   │   ├── keychain.ts          # OS keychain storage
│   │   │   ├── encrypted.ts         # Encrypted file storage
│   │   │   └── index.ts
│   │   ├── types/
│   │   │   ├── credential.ts        # Credential types
│   │   │   └── index.ts
│   │   ├── manager.ts               # Credential CRUD
│   │   ├── encryption.ts            # Crypto utilities
│   │   └── index.ts
│   ├── tests/
│   │   ├── storage.test.ts
│   │   └── manager.test.ts
│   └── package.json
│
├── github/
│   ├── src/
│   │   ├── client.ts                # GitHub API client
│   │   ├── auth.ts                  # Authentication
│   │   ├── pr.ts                    # Pull requests
│   │   ├── releases.ts              # Releases
│   │   ├── repos.ts                 # Repository operations
│   │   └── index.ts
│   ├── tests/
│   │   ├── client.test.ts
│   │   └── pr.test.ts
│   └── package.json
│
└── cli/
    ├── src/
    │   ├── commands/
    │   │   ├── auth.ts              # NEW: cv auth
    │   │   ├── commit.ts            # NEW: cv commit
    │   │   ├── push.ts              # NEW: cv push
    │   │   ├── pr.ts                # NEW: cv pr
    │   │   ├── release.ts           # NEW: cv release
    │   │   └── ... (existing)
    │   └── prompts/
    │       ├── commit-message.ts    # NEW: Commit prompts
    │       ├── pr-description.ts    # NEW: PR prompts
    │       └── changelog.ts         # NEW: Changelog prompts
    └── package.json
```

---

## AI Prompts Design

### Commit Message Prompt

```typescript
export const COMMIT_MESSAGE_PROMPT = `
You are an expert at writing clear, concise git commit messages following the Conventional Commits specification.

Given a git diff, generate a commit message that:

1. **Type**: Use one of: feat, fix, docs, style, refactor, test, chore, perf
2. **Scope** (optional): Affected component in parentheses
3. **Subject**: Imperative mood, lowercase, no period, max 50 chars
4. **Body** (optional): Explain what and why, not how. Wrap at 72 chars.
5. **Footer** (optional): BREAKING CHANGE or issue references

Format:
\`\`\`
<type>(<scope>): <subject>

<body>

<footer>
\`\`\`

Examples:
\`\`\`
feat(auth): add OAuth2 login support

Implement OAuth2 authentication flow using the
authorization code grant. This enables users to
log in with GitHub, Google, and Microsoft accounts.

Closes #123
\`\`\`

\`\`\`
fix(parser): handle null values in AST nodes

Previously, null values caused crashes. Now we
gracefully handle them by treating as undefined.
\`\`\`

Git diff:
\`\`\`diff
{diff}
\`\`\`

Generate a commit message:`;
```

### PR Description Prompt

```typescript
export const PR_DESCRIPTION_PROMPT = `
You are an expert at writing clear, comprehensive pull request descriptions.

Given a git diff and commit history, generate a PR description that includes:

1. **Summary**: Brief overview of changes (2-3 sentences)
2. **What Changed**: Bulleted list of changes with checkmarks
3. **Why**: Motivation and context for changes
4. **Test Plan**: Checklist of testing steps
5. **Breaking Changes**: List any breaking changes (if applicable)
6. **Screenshots**: Placeholder for visual changes (if applicable)

Use GitHub-flavored markdown. Be clear, concise, and actionable.

Format:
\`\`\`markdown
## Summary
[Clear overview of changes]

## What Changed
- ✅ [Completed change 1]
- ✅ [Completed change 2]
- 🚧 [In progress change] (if any)

## Why
[Motivation and context]

## Test Plan
- [ ] [Test step 1]
- [ ] [Test step 2]

## Breaking Changes
[List breaking changes or "None"]

## Screenshots
[Add if UI changes, otherwise omit section]
\`\`\`

Commits:
{commits}

Diff:
\`\`\`diff
{diff}
\`\`\`

Generate PR description:`;
```

### Changelog Prompt

```typescript
export const CHANGELOG_PROMPT = `
You are an expert at writing clear, well-organized changelogs.

Given a list of commits, generate a changelog that:

1. **Categorizes** commits by type (Features, Bug Fixes, Docs, etc.)
2. **Summarizes** each change clearly
3. **Links** to commits/PRs where applicable
4. **Highlights** breaking changes
5. **Lists** contributors

Follow Keep a Changelog format with Conventional Commits categorization.

Format:
\`\`\`markdown
# v{version} - {date}

## 🚀 Features
- **scope**: description (#pr)

## 🐛 Bug Fixes
- **scope**: description (#pr)

## 📚 Documentation
- description (#pr)

## 💥 Breaking Changes
- description

## 👥 Contributors
- @username (N commits)

**Full Changelog**: v{prev}...v{current}
\`\`\`

Commits:
{commits}

Version: {version}
Previous Version: {previousVersion}

Generate changelog:`;
```

---

## Migration Guide

### For Existing CV-Git Users (v0.1.0 → v0.2.0)

#### Step 1: Update
```bash
cd cv-git
git pull
pnpm install
pnpm build
```

#### Step 2: Setup Credentials
```bash
# Migrate from environment variables
cv auth setup

# The setup wizard will:
# 1. Detect existing env vars (ANTHROPIC_API_KEY, etc.)
# 2. Offer to migrate them to secure storage
# 3. Set up GitHub authentication
# 4. Configure git credential helper
```

#### Step 3: Test
```bash
# Test credential storage
cv auth list

# Test GitHub auth
cv push

# Test AI features still work
cv explain "some function"
```

#### Breaking Changes
- Environment variables are deprecated (still work but show warning)
- New minimum Node.js version: 18+
- Git credential helper configuration required

---

## Success Metrics

### Technical
- [ ] Zero credential-related push failures
- [ ] <1 second credential retrieval
- [ ] 100% cross-platform compatibility
- [ ] Zero credential leaks in logs/errors

### User Experience
- [ ] <30 seconds for `cv auth setup`
- [ ] 80%+ users satisfied with AI commit messages
- [ ] 70%+ users prefer `cv pr create` over manual
- [ ] 50% reduction in time to create releases

### Adoption
- [ ] 2000+ GitHub stars (from current 0)
- [ ] 500+ npm downloads/week
- [ ] 50+ community contributions
- [ ] Featured on Hacker News / Reddit

---

## Risk Mitigation

### Security Risks
**Risk**: Credential theft via malware
**Mitigation**:
- Use OS keychain (protected by OS security)
- Encrypt file storage with strong key derivation
- Audit all credential access
- Never log credential values

**Risk**: Token leaks in logs
**Mitigation**:
- Strict log filtering
- Mask all credential-like strings
- Security audit of all console.log statements

### UX Risks
**Risk**: Users confused by credential setup
**Mitigation**:
- Interactive wizard with clear instructions
- Auto-detect and migrate from env vars
- Comprehensive troubleshooting docs

**Risk**: AI-generated messages are poor quality
**Mitigation**:
- Interactive approval required
- Allow manual editing
- Continuous prompt optimization
- Collect user feedback

---

## Post-Launch

### v0.2.0 Release
- [ ] GitHub release with full changelog
- [ ] Publish to npm
- [ ] Announcement blog post
- [ ] Social media campaign
- [ ] Submit to awesome lists

### Community Building
- [ ] Create Discord/Slack community
- [ ] Weekly office hours
- [ ] Contribution bounties
- [ ] Documentation improvements
- [ ] Video tutorials

### Future Roadmap (v0.3.0+)
- OAuth app for easier GitHub auth (no manual token)
- GitLab / Bitbucket support
- Jira integration
- Slack notifications
- Team collaboration features
- Multi-repo management
- Enterprise SSO support

---

**Let's make CV-Git the obvious choice for AI-first development teams! 🚀**
