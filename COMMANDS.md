# CV-Git CLI Commands Reference

**Version:** 0.4.11
**Last Updated:** 2026-01-09

Complete reference guide for all CV-Git CLI commands.

---

## Table of Contents

- [Global Options](#global-options)
- [Setup Commands](#setup-commands)
  - [cv init](#cv-init)
  - [cv auth](#cv-auth)
  - [cv config](#cv-config)
- [Core Workflow](#core-workflow)
  - [cv sync](#cv-sync)
  - [cv status](#cv-status)
  - [cv doctor](#cv-doctor)
- [Git Wrapper Commands](#git-wrapper-commands)
  - [cv add](#cv-add)
  - [cv commit](#cv-commit)
  - [cv diff](#cv-diff)
  - [cv log](#cv-log)
  - [cv branch](#cv-branch)
  - [cv checkout / cv switch](#cv-checkout--cv-switch)
  - [cv merge](#cv-merge)
  - [cv stash](#cv-stash)
  - [cv fetch](#cv-fetch)
  - [cv pull](#cv-pull)
  - [cv push](#cv-push)
  - [cv remote](#cv-remote)
  - [cv reset](#cv-reset)
  - [cv revert](#cv-revert)
  - [cv tag](#cv-tag)
- [Advanced Workflow Commands](#advanced-workflow-commands)
  - [cv absorb](#cv-absorb)
  - [cv undo](#cv-undo)
  - [cv reflog](#cv-reflog)
  - [cv stack](#cv-stack)
  - [cv split](#cv-split)
- [AI Features](#ai-features)
  - [cv find](#cv-find)
  - [cv do](#cv-do)
  - [cv explain](#cv-explain)
  - [cv review](#cv-review)
  - [cv chat](#cv-chat)
  - [cv context](#cv-context)
- [Platform Integration](#platform-integration)
  - [cv pr](#cv-pr)
  - [cv release](#cv-release)
  - [cv clone](#cv-clone)
- [Advanced](#advanced)
  - [cv graph](#cv-graph)
  - [cv git](#cv-git)

---

## Global Options

All commands support these global flags:

| Flag | Description |
|------|-------------|
| `--json` | Output results as JSON for scripting/automation |
| `--quiet` | Suppress non-essential output |
| `--verbose` | Show detailed debug information |
| `--options` | Show available options for the command |
| `--help` | Show help for the command |

---

## Setup Commands

### cv init

Initialize CV-Git in a repository.

```bash
cv init [options]
```

**Options:**
| Option | Description | Default |
|--------|-------------|---------|
| `--name <name>` | Repository name | Directory name |

**Examples:**
```bash
cv init                    # Initialize in current directory
cv init --name my-project  # Initialize with custom name
```

---

### cv auth

Manage credentials for AI services and platforms.

```bash
cv auth <command> [options]
```

**Commands:**
- `cv auth setup` - Interactive setup (supports categories: ai/, git/, dns/, devops/)
- `cv auth setup ai/anthropic` - Setup Anthropic API key
- `cv auth setup git/github` - Setup GitHub token
- `cv auth setup dns/cloudflare` - Setup Cloudflare API token
- `cv auth setup devops/aws` - Setup AWS credentials
- `cv auth list` - List stored credentials
- `cv auth get <service>` - Get a credential
- `cv auth set <service> <key>` - Set a credential
- `cv auth remove <service>` - Remove a credential
- `cv auth test <service>` - Test credential validity

---

### cv config

Manage CV-Git configuration.

```bash
cv config <command>
```

**Commands:**
- `cv config list` - Show all settings
- `cv config get <key>` - Get a value (dot notation: `ai.model`)
- `cv config set <key> <value>` - Set a value
- `cv config reset` - Reset to defaults
- `cv config edit` - Open in editor
- `cv config path` - Show config file location

---

## Core Workflow

### cv sync

Synchronize the knowledge graph with your repository.

```bash
cv sync [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--incremental` | Only sync changed files (faster) |
| `--force` | Force full rebuild |

**Examples:**
```bash
cv sync                    # Full sync
cv sync --incremental      # Incremental (faster)
cv sync --force            # Force rebuild
```

---

### cv status

Show CV-Git status and health.

```bash
cv status [options]
```

---

### cv doctor

Run health diagnostics.

```bash
cv doctor [options]
```

---

## Git Wrapper Commands

CV-Git provides enhanced wrappers for common git commands with knowledge graph integration.

### cv add

Stage files for commit.

```bash
cv add [files...] [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `-A, --all` | Stage all changes |
| `-p, --patch` | Interactive patch mode |
| `-u, --update` | Stage modified and deleted only |
| `-n, --dry-run` | Show what would be staged |

**Examples:**
```bash
cv add .                   # Stage all files
cv add -A                  # Stage all including untracked
cv add src/               # Stage directory
cv add --patch             # Interactive staging
```

---

### cv commit

Commit with AI-generated messages and credential identity.

```bash
cv commit [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `-m, --message <msg>` | Commit message |
| `-a, --all` | Stage all modified files |
| `--amend` | Amend previous commit |
| `--ai` | Generate AI commit message |
| `--no-verify` | Skip pre-commit hooks |

**Examples:**
```bash
cv commit -m "Fix bug"     # Manual message
cv commit --ai             # AI-generated message
cv commit -a --ai          # Stage all + AI message
```

---

### cv diff

Show changes with optional AI analysis.

```bash
cv diff [commit...] [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--staged` | Show staged changes |
| `--stat` | Show diffstat |
| `--name-only` | Show only file names |
| `--analyze` | AI-powered analysis of changes |

**Examples:**
```bash
cv diff                    # Working tree vs index
cv diff --staged           # Index vs HEAD
cv diff HEAD~3             # Last 3 commits
cv diff --analyze          # AI analysis of changes
cv diff --stat             # Summary statistics
```

**AI Analysis Output:**
```
Analyzing changes...

Change Summary:
- Modified authentication flow to use JWT
- Added input validation for email
- Updated error handling

Suggested commit type: feat
Suggested scope: auth
Potential issues: None detected
```

---

### cv log

Show commit history with knowledge graph features.

```bash
cv log [revision-range] [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--oneline` | One line per commit |
| `--graph` | Draw ASCII graph |
| `--all` | Show all branches |
| `-n, --number <n>` | Limit to n commits |
| `--author <pattern>` | Filter by author |
| `-S, --symbol <name>` | Show commits affecting a symbol |
| `--smart` | Visual branch tree (smartlog style) |
| `--mine` | Show only my commits |
| `--stack` | Show current stack context |

**Examples:**
```bash
cv log -5                  # Last 5 commits
cv log --oneline --graph   # Graphical view
cv log --symbol login      # Commits affecting 'login' function
cv log --smart             # Smartlog visual tree
cv log --mine              # Only my commits
cv log --stack             # Current stack commits
```

**Smart Log Output:**
```
📊 Smart Log

Current: main

* fe94939 John 2 hours ago (HEAD -> main, origin/main)
  test: Add integration tests
|
* 27d7572 John 3 hours ago
  feat: Add git command wrappers
|
* 9a58272 John 4 hours ago
  fix: Windows build

Tip: cv log --mine  # Show only your commits
     cv log --stack # Show current stack
```

**Stack Log Output:**
```
📚 Stack Log

Base: main
Commits in stack: 3

│ 1. fe94939 test: Add integration tests (2 hours ago)
│
│ 2. 27d7572 feat: Add git command wrappers (3 hours ago)
│
◉ 3. 9a58272 fix: Windows build (4 hours ago)
│
◯ main
```

---

### cv branch

List, create, or delete branches.

```bash
cv branch [branch-name] [start-point] [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `-a, --all` | List local and remote branches |
| `-r, --remotes` | List only remote branches |
| `-d, --delete` | Delete a branch |
| `-D, --force-delete` | Force delete |
| `-m, --move` | Rename a branch |

**Examples:**
```bash
cv branch                  # List branches
cv branch feature          # Create branch
cv branch -d feature       # Delete branch
cv branch -m old new       # Rename branch
cv branch --json           # JSON output
```

---

### cv checkout / cv switch

Switch branches or restore files with auto-sync.

```bash
cv checkout [branch-or-file] [options]
cv switch [branch] [options]        # Modern style
```

**Options:**
| Option | Description |
|--------|-------------|
| `-b, --create <branch>` | Create and switch to branch |
| `-f, --force` | Force switch (discard changes) |
| `--no-sync` | Skip knowledge graph sync |

**Examples:**
```bash
cv checkout main           # Switch to main
cv checkout -b feature     # Create and switch
cv switch feature          # Modern switch syntax
cv checkout -- file.ts     # Restore file
```

Auto-syncs knowledge graph when switching branches (unless `--no-sync`).

---

### cv merge

Merge branches with conflict detection and auto-sync.

```bash
cv merge [branch] [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--no-ff` | Create merge commit even if fast-forward |
| `--squash` | Squash commits |
| `--abort` | Abort current merge |
| `--continue` | Continue after resolving conflicts |

**Examples:**
```bash
cv merge feature           # Merge feature into current
cv merge feature --no-ff   # Force merge commit
cv merge --abort           # Abort merge
```

Auto-syncs knowledge graph after successful merge.

---

### cv stash

Stash changes.

```bash
cv stash [subcommand] [options]
```

**Subcommands:**
- `push` (default) - Stash changes
- `pop` - Apply and remove top stash
- `apply` - Apply without removing
- `list` - List stashes
- `show` - Show stash contents
- `drop` - Remove a stash
- `clear` - Remove all stashes

**Options:**
| Option | Description |
|--------|-------------|
| `-m, --message <msg>` | Stash message |
| `-u, --include-untracked` | Include untracked files |
| `-k, --keep-index` | Keep staged changes |

**Examples:**
```bash
cv stash                   # Quick stash
cv stash -m "WIP feature"  # With message
cv stash pop               # Apply and remove
cv stash list              # List stashes
cv stash show stash@{0}    # Show contents
```

---

### cv fetch

Download objects and refs from remote.

```bash
cv fetch [remote] [refspec...] [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--all` | Fetch all remotes |
| `-p, --prune` | Remove stale refs |
| `-t, --tags` | Fetch all tags |

**Examples:**
```bash
cv fetch                   # Fetch from origin
cv fetch --all             # Fetch all remotes
cv fetch --prune           # Clean up stale refs
```

---

### cv pull

Pull with automatic knowledge graph sync.

```bash
cv pull [remote] [branch] [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--rebase` | Rebase instead of merge |
| `-f, --ff-only` | Fast-forward only |

---

### cv push

Push with automatic knowledge graph sync.

```bash
cv push [remote] [branch] [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `-u, --set-upstream` | Set upstream branch |
| `--tags` | Push all tags |
| `-f, --force` | Force push (use with caution) |

---

### cv remote

Manage remote repositories.

```bash
cv remote [subcommand] [args...]
```

**Subcommands:**
- (no args) - List remotes
- `add <name> <url>` - Add remote
- `remove <name>` - Remove remote
- `rename <old> <new>` - Rename remote
- `set-url <name> <url>` - Change URL
- `show <name>` - Show remote info

**Examples:**
```bash
cv remote                  # List remotes
cv remote -v               # With URLs
cv remote add upstream URL # Add remote
cv remote --json           # JSON output
```

---

### cv reset

Reset current HEAD.

```bash
cv reset [commit] [files...] [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--soft` | Keep changes staged |
| `--mixed` | Keep changes unstaged (default) |
| `--hard` | Discard changes (DESTRUCTIVE) |

**Examples:**
```bash
cv reset HEAD~1            # Undo last commit (keep changes)
cv reset --soft HEAD~1     # Undo, keep staged
cv reset --hard HEAD~1     # Undo and discard (careful!)
cv reset HEAD file.ts      # Unstage specific file
```

---

### cv revert

Revert commits by creating new commits.

```bash
cv revert [commits...] [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `-n, --no-commit` | Don't auto-commit |
| `--abort` | Abort current revert |
| `--continue` | Continue after conflicts |

**Examples:**
```bash
cv revert HEAD             # Revert last commit
cv revert abc123           # Revert specific commit
cv revert HEAD~3..HEAD     # Revert last 3 commits
cv revert --abort          # Abort in-progress revert
```

---

### cv tag

Create, list, delete, or verify tags.

```bash
cv tag [tagname] [commit] [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `-a, --annotate` | Create annotated tag |
| `-m, --message <msg>` | Tag message (implies -a) |
| `-d, --delete` | Delete tag |
| `-l, --list [pattern]` | List tags |
| `-v, --verify` | Verify tag signature |

**Examples:**
```bash
cv tag                     # List tags
cv tag v1.0.0              # Lightweight tag
cv tag -a v1.0.0 -m "Rel"  # Annotated tag
cv tag -d v1.0.0           # Delete tag
cv tag --json              # JSON output
```

---

## Advanced Workflow Commands

These commands implement modern VCS workflows inspired by Jujutsu, Sapling, and git-absorb.

### cv absorb

Automatically create fixup commits for staged changes.

```bash
cv absorb [options]
```

**What it does:** Analyzes your staged changes, determines which previous commits they should be absorbed into using git blame, and creates `fixup!` commits targeting those commits.

**Options:**
| Option | Description |
|--------|-------------|
| `--and-rebase` | Auto-rebase with --autosquash after |
| `--base <commit>` | Base commit to consider |
| `-n, --dry-run` | Preview without making changes |
| `-v, --verbose` | Show detailed information |

**Examples:**
```bash
# Stage your changes
cv add -A

# See what would be absorbed
cv absorb --dry-run

# Create fixup commits
cv absorb

# Create and auto-squash
cv absorb --and-rebase
```

**Workflow:**
```
$ cv absorb

Analyzing staged changes...

Found 2 commit(s) to absorb into:

  abc1234 Add user authentication
    - src/auth/login.ts

  def5678 Implement session handling
    - src/auth/session.ts

✓ Created fixup for abc1234
✓ Created fixup for def5678

✓ Created 2 fixup commit(s)

To apply fixups, run:
  git rebase -i --autosquash main

Or use: cv absorb --and-rebase
```

---

### cv undo

Undo the last operation using git reflog.

```bash
cv undo [target] [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--hard` | Discard uncommitted changes |
| `-n, --steps <n>` | Number of operations to undo |

**Examples:**
```bash
cv undo                    # Undo last operation (soft)
cv undo HEAD@{3}           # Go back 3 operations
cv undo --hard             # Undo and discard changes
cv undo abc1234            # Restore to specific commit
```

**Output:**
```
Undo operation:

  Current: fe94939 (main)
  Target:  27d7572 "feat: Add git command wrappers"

✓ Restored to 27d7572

Changes are preserved in your working directory.
Use "cv status" to see them.

To redo (go back), use:
  cv undo fe94939
```

---

### cv reflog

Show operation history for use with cv undo.

```bash
cv reflog [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `-n, --count <n>` | Number of entries (default: 20) |

**Examples:**
```bash
cv reflog                  # Show recent operations
cv reflog -n 50            # Show more
cv reflog --json           # JSON output
```

**Output:**
```
Recent operations:

  Use "cv undo HEAD@{N}" to restore to that point

HEAD@{0} fe94939 commit: test: Add tests (2 min ago)
HEAD@{1} 27d7572 commit: feat: Add wrappers (1 hour ago)
HEAD@{2} 9a58272 commit: fix: Windows build (3 hours ago)
HEAD@{3} 3cee7a7 checkout: moving from feature to main (3 hours ago)
HEAD@{4} bfc2692 commit: chore: Bump version (4 hours ago)

Tip: Use "cv undo" to undo the last operation
     Use "cv undo HEAD@{2}" to go back 2 operations
```

---

### cv stack

Manage stacked diffs workflow for incremental PR reviews.

```bash
cv stack [subcommand] [options]
```

**Subcommands:**

#### cv stack status
Show current stack status.

```bash
cv stack status [--base <commit>]
```

**Output:**
```
Stack Status

Base: main

◉ ○ fe94939 Add unit tests
│   branch: stack/feature/3
│   PR: #127

│ ○ 27d7572 Implement feature
│   branch: stack/feature/2
│   PR: #126

│ ○ 9a58272 Add foundation
│   branch: stack/feature/1
│   PR: #125
│
◯ main

Commands:
  cv stack push    - Push branches for each commit
  cv stack submit  - Create PRs for the stack
  cv stack rebase  - Rebase stack on updated base
```

#### cv stack log / cv stack smartlog
Show stack as visual graph.

```bash
cv stack log [--base <commit>]
```

#### cv stack create
Create a named stack from current commits.

```bash
cv stack create <name> [--base <commit>]
```

#### cv stack push
Push all commits in stack as separate branches.

```bash
cv stack push [--force]
```

Creates branches named `stack/<branch>/<n>` for each commit.

#### cv stack submit
Create/update PRs for each commit in stack.

```bash
cv stack submit [--draft]
```

Requires GitHub CLI (gh) to be installed.

#### cv stack rebase
Rebase entire stack on updated base.

```bash
cv stack rebase [--base <commit>]
```

#### cv stack sync
Sync stack with remote (fetch + rebase).

```bash
cv stack sync
```

**Full Stacked Diffs Workflow:**
```bash
# 1. Make commits for your feature
git commit -m "Add foundation"
git commit -m "Implement feature"
git commit -m "Add tests"

# 2. View your stack
cv stack status

# 3. Push stack branches
cv stack push

# 4. Create PRs for review
cv stack submit

# 5. After review, sync with main
cv stack sync

# 6. Force push updates
cv stack push --force
```

---

### cv split

Split a commit into multiple smaller commits.

```bash
cv split [commit] [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--by-file` | Auto-split: one commit per file |
| `-i, --interactive` | Interactive mode: choose files |

**Examples:**
```bash
cv split                   # Show split options
cv split HEAD              # Split last commit
cv split --by-file         # One commit per file
cv split --interactive     # Choose files for each commit
```

**Interactive Mode:**
```
Interactive split mode

For each commit, enter file numbers to include (e.g., "1,3,4" or "1-3")
Enter "done" when finished, "abort" to cancel

   1. src/auth/login.ts
   2. src/auth/session.ts
   3. src/utils/helpers.ts
   4. tests/auth.test.ts

Remaining files: 1, 2, 3, 4
Commit 1 files: 1,2
  Message [Original message]: Implement authentication

✓ Created commit abc1234

Remaining files: 3, 4
Commit 2 files: 3-4
  Message [Original message (part 2)]: Add helpers and tests

✓ Created commit def5678

✓ Created 2 commits
```

**By-File Mode:**
```
Splitting by file...

✓ abc1234 login.ts
✓ def5678 session.ts
✓ ghi9012 helpers.ts
✓ jkl3456 auth.test.ts

✓ Split into 4 commits
```

---

## AI Features

### cv find

Semantic search over your codebase.

```bash
cv find <query> [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `-l, --limit <n>` | Max results (default: 10) |
| `--language <lang>` | Filter by language |
| `--file <path>` | Filter by file path |
| `--min-score <score>` | Minimum similarity (0-1) |

**Examples:**
```bash
cv find "authentication logic"
cv find "error handling" --limit 5
cv find "database queries" --language typescript
```

---

### cv do

Execute tasks with AI assistance.

```bash
cv do <task> [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--plan-only` | Generate plan without code |
| `--yes` | Skip approval prompts |

**Examples:**
```bash
cv do "add logging to error handlers"
cv do "refactor auth module" --plan-only
```

---

### cv explain

Get AI explanations of code.

```bash
cv explain <symbol>
```

**Examples:**
```bash
cv explain authenticateUser
cv explain AuthService
```

---

### cv review

AI code review.

```bash
cv review [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--staged` | Review staged changes |
| `--commit <sha>` | Review specific commit |

---

### cv chat

Interactive AI chat with codebase context.

```bash
cv chat [question]
```

---

### cv context

Generate context for AI coding assistants.

```bash
cv context <query>
```

---

## Platform Integration

### cv pr

Manage pull requests.

```bash
cv pr <command> [options]
```

**Commands:**
- `create` - Create PR
- `list` - List PRs
- `view <n>` - View PR
- `review <n>` - AI review PR

---

### cv release

Manage releases.

```bash
cv release <command> [options]
```

**Commands:**
- `create <version>` - Create release
- `list` - List releases

---

### cv clone

Clone and initialize CV-Git.

```bash
cv clone <url> [directory]
```

---

## Advanced

### cv graph

Query the knowledge graph.

```bash
cv graph <query>
```

**Query Types:**
- `calls <func>` - What calls this function
- `called-by <func>` - What this function calls
- `imports <module>` - What imports this
- `exports <file>` - What a file exports
- `functions` - List all functions
- `classes` - List all classes

---

### cv git

Execute any git command (passthrough).

```bash
cv git <command> [args...]
```

---

## Common Workflows

### Daily Development
```bash
cv status                  # Check status
cv find "feature"          # Find relevant code
cv add -A                  # Stage changes
cv commit --ai             # AI commit message
cv push                    # Push with sync
```

### Code Review with Stacked Diffs
```bash
# Create stack
git commit -m "Part 1"
git commit -m "Part 2"
git commit -m "Part 3"

# Submit for review
cv stack submit

# After feedback, update
cv absorb --and-rebase
cv stack push --force
```

### Fixing Mistakes
```bash
cv reflog                  # See history
cv undo                    # Undo last operation
cv undo HEAD@{3}           # Go back further
```

### Cleaning Up History
```bash
cv split --by-file         # Split large commit
cv absorb                  # Absorb fixups
```

---

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | General error |
| 2 | Invalid arguments |
| 3 | Configuration error |
| 4 | Service unavailable |

---

## Getting Help

```bash
cv --help                  # General help
cv <command> --help        # Command help
cv <command> --options     # Show all options
```

**Resources:**
- Documentation: https://github.com/controlVector/cv-git
- Issues: https://github.com/controlVector/cv-git/issues

---

**Last Updated:** 2026-01-09
**Version:** 0.4.11
