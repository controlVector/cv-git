# cv-git Bug & Feature Tracker

This file tracks known bugs and feature requests for cv-git.

---

# Feature Requests

## FEAT-001: Git Identity Management per Repository

**Status:** OPEN
**Priority:** High
**Requested:** 2025-12-11
**Component:** packages/cli, packages/credentials

### Problem

Developers often work with multiple git identities across different platforms (GitHub, GitLab, Bitbucket) and organizations. Currently, managing `user.name` and `user.email` per repository is manual and error-prone:

- Forgetting to set identity leads to commits with wrong author
- Global config gets overwritten
- No easy way to switch between work/personal/client identities
- SSH keys and credentials are separate from git identity

### Proposed Solution

Add git identity profiles to cv-git that can be linked to repositories:

```bash
# Create identity profiles
cv identity create work --name "John Doe" --email "john@company.com" --signing-key "ABC123"
cv identity create personal --name "johndoe" --email "john@gmail.com"
cv identity create client-acme --name "John Doe" --email "john@acme-consulting.com"

# Link identity to current repo
cv identity use work

# Or link during clone
cv clone git@github.com:company/repo.git --identity work

# List identities
cv identity list

# Show current repo's identity
cv identity show

# Auto-detect based on remote URL patterns
cv identity auto-link github.com/company/* work
cv identity auto-link gitlab.com/personal/* personal
```

### Features to Include

1. **Identity Profiles**
   - Store name, email, signing key (GPG/SSH)
   - Optional: linked SSH key path
   - Optional: linked platform credentials (GitHub token, etc.)

2. **Repository Linking**
   - Per-repo identity stored in `.cv/config.json`
   - Automatically set `git config user.name/email` on cv operations
   - Warn if repo identity doesn't match current git config

3. **Auto-linking Rules**
   - Pattern-based rules (e.g., `*github.com/company/*` → work identity)
   - Applied during `cv clone` or `cv init`

4. **Integration with cv auth**
   - Link platform credentials to identities
   - `cv auth setup github --identity work`

5. **Identity Verification**
   - `cv identity verify` - check if current repo's git config matches linked identity
   - Pre-commit hook option to enforce identity

### Storage

```json
// ~/.cv-git/identities.json
{
  "profiles": {
    "work": {
      "name": "John Doe",
      "email": "john@company.com",
      "signingKey": "ABC123",
      "sshKey": "~/.ssh/id_work",
      "platforms": ["github:company-org"]
    },
    "personal": {
      "name": "johndoe",
      "email": "john@gmail.com"
    }
  },
  "autoLink": [
    { "pattern": "github.com/company/*", "identity": "work" },
    { "pattern": "gitlab.com/johndoe/*", "identity": "personal" }
  ]
}

// .cv/config.json (per-repo)
{
  "identity": "work",
  ...
}
```

### Implementation Notes

- Should work alongside existing git config (don't fight git, enhance it)
- Consider integration with git's `includeIf` for automatic switching
- SSH agent integration for key selection
- Support for commit signing (GPG and SSH signatures)

### Related

- `cv auth` already manages platform credentials
- Could integrate with `cv clone` and `cv init` workflows
- Potential MCP server integration for IDE identity switching

---

## FEAT-002: Per-Repository Database Isolation

**Status:** OPEN
**Priority:** Critical
**Requested:** 2025-12-11
**Component:** packages/core, packages/cli

### Problem

Currently, cv-git uses a single shared database for all repositories:
- FalkorDB graph: `cv-git` (single database)
- Qdrant vectors: `code_chunks`, `docstrings`, `commits` (single collections)

When switching between repositories and running `cv sync`, the previous repo's data is **overwritten**. This makes cv-git unusable for developers working on multiple projects.

### Current Behavior

```bash
cd ~/project/repo-a
cv sync  # Indexes repo-a into cv-git database

cd ~/project/repo-b
cv sync  # OVERWRITES repo-a data with repo-b data

cd ~/project/repo-a
cv find "something"  # Returns results from repo-b (wrong!)
```

### Desired Behavior

Each repository should have isolated, persistent data:

```bash
cd ~/project/repo-a
cv sync  # Indexes to repo-a specific database

cd ~/project/repo-b
cv sync  # Indexes to repo-b specific database (repo-a untouched)

cd ~/project/repo-a
cv find "something"  # Returns results from repo-a (correct!)
```

### Proposed Solution

**Option A: Per-repo database names (Recommended)**

Use repository name/hash as database identifier:
- FalkorDB: `cv-git-{repo-hash}` or `cv-git-{repo-name}`
- Qdrant: `{repo-hash}_code_chunks`, `{repo-hash}_docstrings`

```json
// .cv/config.json
{
  "repository": {
    "id": "a1b2c3d4",  // Hash of repo root path or remote URL
    "name": "cv-git",
    "root": "/home/user/project/cv-git"
  },
  "graph": {
    "database": "cv-a1b2c3d4"  // Unique per repo
  },
  "vector": {
    "collections": {
      "codeChunks": "a1b2c3d4_code_chunks",
      "docstrings": "a1b2c3d4_docstrings",
      "commits": "a1b2c3d4_commits"
    }
  }
}
```

**Option B: Exportable snapshots**

Store graph/vector data as files in `.cv/` that can be loaded on demand:
- `.cv/graph/nodes.jsonl` - Graph nodes
- `.cv/graph/edges.jsonl` - Graph edges
- `.cv/vectors/embeddings.bin` - Vector embeddings

```bash
cv sync          # Updates .cv/ files AND loads into running DB
cv load          # Load .cv/ files into DB (when switching repos)
cv unload        # Clear current repo from DB (free memory)
```

**Option C: Hybrid approach**

- Use per-repo database names (Option A) for active development
- Export to `.cv/` files for portability/backup (Option B)
- Auto-load from `.cv/` files if database is empty

### Implementation Considerations

1. **Database naming**: Use hash of repo path or git remote URL
2. **Collection cleanup**: Command to remove old/unused repo databases
3. **Memory management**: FalkorDB/Qdrant may need limits with many repos
4. **Portability**: `.cv/` export allows sharing graph data via git

### Files to Modify

- `packages/core/src/config/index.ts` - Generate unique database names
- `packages/cli/src/commands/init.ts` - Set up per-repo database
- `packages/cli/src/commands/sync.ts` - Use repo-specific database
- `packages/core/src/graph/index.ts` - Support dynamic database names
- `packages/core/src/vector/index.ts` - Support dynamic collection names

### Related

- `.cv-prd/` already uses file-based storage (graph/nodes.jsonl, etc.)
- Could unify approach between cv-git and cv-prd
- Workspace mode already supports multiple repos with shared database

---

# Bugs

---

## BUG-001: Credential Retrieval Fails Despite Stored Credentials

**Status:** RESOLVED
**Severity:** Critical
**Reported:** 2025-12-10
**Resolved:** 2025-12-11
**Component:** packages/credentials, packages/cli

### Description

After successfully storing credentials via `cv auth setup openai`, the credentials cannot be retrieved by other cv-git commands like `cv find`, `cv sync`, or `cv context`.

### Steps to Reproduce

1. Run `cv auth setup openai` and enter a valid API key
2. Verify credential is stored: `cv auth list` shows the credential
3. Run `cv find "any query"`
4. **Expected:** Command uses stored credential for embeddings
5. **Actual:** Error "OpenAI API key not found"

### Evidence

```bash
$ cv auth list
🔑 Stored Credentials:
┌─────────────────────────┬─────────────────────────┬────────────────────┬────────────────────┐
│ Type                    │ Name                    │ Created            │ Last Used          │
├─────────────────────────┼─────────────────────────┼────────────────────┼────────────────────┤
│ openai_api              │ default                 │ 12/11/2025         │ never              │
└─────────────────────────┴─────────────────────────┴────────────────────┴────────────────────┘

$ cv auth test openai
- Testing authentication...
✖ OpenAI API key not found
Run: cv auth setup openai

$ cv find "vector search"
✖ OpenAI API key not found
```

### Root Cause Analysis

**ROOT CAUSE IDENTIFIED:** The CLI commands that need API keys do NOT use `CredentialManager` to retrieve credentials.

In `packages/cli/src/commands/find.ts` line 46:
```typescript
const openaiApiKey = config.ai.apiKey || process.env.OPENAI_API_KEY;
```

The `find` command only checks:
1. `config.ai.apiKey` (from `.cv/config.json`)
2. `process.env.OPENAI_API_KEY` (environment variable)

It **never** calls `CredentialManager.getOpenAIKey()` to retrieve the stored credential!

The `auth.ts` command correctly stores credentials using `CredentialManager`, but consumer commands don't read from it.

### Affected Commands

Commands that likely have this bug:
- `cv find` - checks `config.ai.apiKey` only
- `cv context` - likely same issue
- `cv sync` - likely same issue
- `cv chat` - likely same issue
- `cv explain` - likely same issue

### Files to Fix

- `packages/cli/src/commands/find.ts` - Add CredentialManager lookup
- `packages/cli/src/commands/context.ts` - Add CredentialManager lookup
- `packages/cli/src/commands/sync.ts` - Add CredentialManager lookup
- `packages/cli/src/commands/chat.ts` - Add CredentialManager lookup
- `packages/cli/src/commands/explain.ts` - Add CredentialManager lookup

### Solution

Add a helper function to get API keys with proper fallback order:
1. CredentialManager (keychain/file storage)
2. Config file (`.cv/config.json`)
3. Environment variable

### Workaround

Set the API key as an environment variable:
```bash
export OPENAI_API_KEY="sk-..."
cv find "query"
```

### Resolution

- [x] Identify root cause (2025-12-11)
- [x] Implement fix (2025-12-11)
- [x] Add test case to prevent regression (2025-12-11)
- [x] Verify fix works end-to-end (2025-12-11) - Credential retrieved successfully, error changed from "key not found" to OpenAI model access error

### Fix Applied

Created `packages/cli/src/utils/credentials.ts` with helper functions:
- `getOpenAIApiKey(configApiKey?)` - Retrieves from CredentialManager → config → env var
- `getAnthropicApiKey(configApiKey?)` - Same pattern
- `getOpenRouterApiKey(configApiKey?)` - Same pattern
- `getEmbeddingApiKey(config?)` - Tries OpenAI, then OpenRouter
- `getAIApiKey(config?)` - Tries Anthropic, OpenAI, OpenRouter

Updated the following command files to use these helpers:
- `packages/cli/src/commands/find.ts` - Now uses `getOpenAIApiKey()`
- `packages/cli/src/commands/context.ts` - Now uses `getEmbeddingApiKey()`
- `packages/cli/src/commands/review.ts` - Now uses `getAnthropicApiKey()` and `getOpenAIApiKey()`
- `packages/cli/src/commands/explain.ts` - Now uses `getAnthropicApiKey()` and `getOpenAIApiKey()`
- `packages/cli/src/commands/do.ts` - Now uses `getAnthropicApiKey()` and `getOpenAIApiKey()`

Commands that already used CredentialManager correctly (no changes needed):
- `packages/cli/src/commands/sync.ts`
- `packages/cli/src/commands/chat.ts`
- `packages/cli/src/commands/code.ts`

### Test Added

`tests/integration/cli-credentials.test.mjs` - Tests credential storage and retrieval flow

---

## BUG-002: No Model Availability Validation Before API Calls

**Status:** RESOLVED
**Severity:** High
**Reported:** 2025-12-11
**Resolved:** 2025-12-11
**Component:** packages/core, packages/cli

### Description

When using OpenAI API keys, cv-git assumes the user has access to `text-embedding-3-small` model. If the user's OpenAI project doesn't have access to this model, the command fails with a cryptic 403 error.

### Steps to Reproduce

1. Run `cv auth setup openai` with an API key that has restricted model access
2. Run `cv find "any query"`
3. **Expected:** Graceful error or automatic fallback to available model
4. **Actual:** `Error: Search failed: Failed to generate embedding: 403 Project does not have access to model`

### Evidence

```bash
$ cv find "vector search"
✔ Connected to vector database
✖ Search failed
Error: Search failed: Failed to generate embedding: 403 Project `proj_XXX` does not have access to model `text-embedding-3-small`
```

### Root Cause

1. cv-git hardcodes `text-embedding-3-small` as the default embedding model
2. No validation is done to check if the API key has access to this model
3. No fallback mechanism exists to try alternative models
4. User has no way to discover which models their API key can access

### Proposed Solution

1. **Model Discovery**: Query OpenAI `/v1/models` API to get list of available models
2. **Model Caching**: Cache the available models list with TTL (e.g., 24 hours)
3. **Smart Defaults**: Auto-select best available embedding model from user's access list
4. **User Selection**: Allow user to choose/configure preferred model via `cv auth setup openai`
5. **Graceful Fallback**: If preferred model unavailable, try alternatives before failing

### Files to Modify

- `packages/core/src/vector/index.ts` - Add model validation before embedding calls
- `packages/credentials/src/` - Add model list caching
- `packages/cli/src/commands/auth.ts` - Add model selection during setup
- `packages/cli/src/utils/credentials.ts` - Add model preference retrieval

### OpenAI Models API

```bash
curl https://api.openai.com/v1/models \
  -H "Authorization: Bearer $OPENAI_API_KEY"
```

Returns list of models the API key has access to. Embedding models include:
- `text-embedding-3-small` (newer, 1536 dimensions)
- `text-embedding-3-large` (newer, 3072 dimensions)
- `text-embedding-ada-002` (older, widely available, 1536 dimensions)

### Resolution

- [x] Research OpenAI models API
- [x] ~~Implement model discovery and caching~~ → Changed approach: Use OpenRouter as default
- [x] ~~Add model selection to cv auth setup~~ → OpenRouter handles model availability
- [x] Update embedding code to validate model access → OpenRouter-first architecture
- [x] Add fallback mechanism → OpenRouter > OpenAI > Ollama
- [x] Write tests → Verified with `cv find` command

### Fix Applied (2025-12-11)

Instead of implementing model discovery, we changed the default embedding provider to **OpenRouter**, which has better model availability and doesn't have the project-level restrictions that OpenAI has.

**Changes made:**

1. **Default config** (`packages/core/src/config/index.ts`):
   - `embedding.provider` now defaults to `'openrouter'`
   - `embedding.model` now defaults to `'openai/text-embedding-3-small'`

2. **Type definitions** (`packages/shared/src/types.ts`):
   - Added `'openrouter'` to embedding provider union type

3. **VectorManager** (`packages/core/src/vector/index.ts`):
   - New `VectorManagerOptions` interface with both `openrouterApiKey` and `openaiApiKey`
   - Provider priority: OpenRouter > OpenAI > Ollama
   - Auto-converts model names between providers

4. **CLI credentials** (`packages/cli/src/utils/credentials.ts`):
   - New `getEmbeddingCredentials()` function returns both keys with priority
   - `getEmbeddingApiKey()` now tries OpenRouter first

5. **Find command** (`packages/cli/src/commands/find.ts`):
   - Uses new credentials system with proper provider handling

**User action required:**
```bash
cv auth setup openrouter   # Set up OpenRouter API key
cv sync --force            # Re-sync to generate embeddings
cv find "query"            # Should now work!
```

---
