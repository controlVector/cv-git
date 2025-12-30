---
type: "design_spec"
status: "draft"
tags: ["phase6","implementation","roadmap","git-layer"]
relates_to: ["ARCHITECTURE.md","MCP_INTEGRATION.md","CHANGELOG.md"]
---

# Phase 6: Smart Git Layer Implementation Plan

**Version:** 1.0
**Created:** 2025-12-30
**Status:** Draft - Awaiting User Approval

---

## Executive Summary

Phase 6 transforms CV-Git from a "knowledge graph with git awareness" into a **smart layer on top of git** that leverages semantic understanding to provide genuinely intelligent assistance for commit generation, merge conflict handling, branch workflows, and PR/review automation.

**Key Differentiator:** Unlike existing tools that only see raw diff text, CV-Git knows *what symbols changed*, *who calls them*, and *what breaks when they change*.

---

## Current State (What We Build On)

### Already Implemented

| Component | Location | Status |
|-----------|----------|--------|
| **GitManager** | `packages/core/src/git/index.ts` | Solid - commits, diffs, hooks, branches |
| **Platform Adapters** | `packages/platform/` | GitHub, GitLab, Bitbucket working |
| **AI Code Review** | `cv review` | Working with context gathering |
| **Knowledge Graph** | FalkorDB + Qdrant | Symbol tracking, call graph, vector search |
| **Git Hooks** | `cv hooks install` | post-commit, post-merge for auto-sync |
| **MCP Tools** | `packages/mcp-server/src/tools/` | PR, review, platform tools |
| **Credential Management** | `@cv-git/credentials` | Multi-provider storage |

### Extension Points

1. **GitManager** - Add commit message generation, merge driver
2. **CLI Commands** - Enhance existing `cv commit`, add merge tools
3. **MCP Tools** - Add `cv_commit_generate`, `cv_merge_*`, `cv_branch_*`
4. **AI Module** - Add commit analysis, merge resolution prompts

---

## Research Findings Summary

### 1. AI Commit Message Generation

**Existing Tools (aicommits, OpenCommit):**
- Use `git diff --cached` as input
- Send to LLM with prompt template
- Output: Conventional Commits format

**CV-Git Advantage:**
- Know *which functions/classes* changed (not just lines)
- Detect breaking changes via call graph analysis
- Infer scope from module structure
- Auto-detect commit type (feat/fix/refactor) from semantic analysis

### 2. Smart Merge/Conflict Resolution

**Existing Tools:**
- Line-based (Git default) - causes false conflicts
- SemanticMerge - AST-based but limited languages
- JetBrains - IDE-only

**CV-Git Advantage:**
- Cross-file semantic conflict detection (signature change + caller mismatch)
- Pre-merge conflict prediction
- AI-assisted resolution with full call graph context
- Custom merge driver integration

### 3. Branch Workflow Assistance

**Best Practices:**
- GitHub Flow is the standard
- `gh issue develop` for issue-linked branches
- Branch naming conventions

**CV-Git Advantage:**
- Feature scope analysis (what files will this touch?)
- Conflict prediction before branch creation
- PR size recommendations based on logical boundaries

### 4. PR/Review Enhancement

**Existing Tools (CodeRabbit, PR-Agent):**
- Diff-only analysis
- No codebase context
- Can be noisy

**CV-Git Advantage:**
- Impact analysis (which callers affected?)
- Test suggestions (which tests cover this code?)
- Related changes detection (interface + implementation sync)
- Semantic PR description generation

---

## Implementation Phases

### Phase 6.1: AI Commit Message Generation (Priority: HIGH)

**Effort:** 3-5 days
**Value:** High - Used on every commit

#### 6.1.1 Core: CommitAnalyzer Service

Create `packages/core/src/ai/commit-analyzer.ts`:

```typescript
interface CommitAnalysis {
  // From diff
  filesChanged: string[];
  linesAdded: number;
  linesRemoved: number;

  // From knowledge graph (unique to CV-Git)
  symbolsAdded: SymbolInfo[];
  symbolsModified: SymbolInfo[];
  symbolsRemoved: SymbolInfo[];

  // Impact analysis
  callersAffected: SymbolInfo[];
  modulesAffected: string[];
  complexityDelta: number;

  // Inferred
  suggestedType: 'feat' | 'fix' | 'refactor' | 'docs' | 'test' | 'chore';
  suggestedScope: string;
  isBreakingChange: boolean;
  breakingChangeReason?: string;
}
```

**Implementation Steps:**
1. Parse staged diff to identify changed files
2. Re-parse changed files with tree-sitter to get symbols
3. Query knowledge graph for:
   - Callers of modified symbols
   - Module boundaries
   - Complexity changes
4. Detect breaking changes (public symbol deleted/modified + external callers)
5. Generate commit message via AI with rich context

#### 6.1.2 CLI: Enhance `cv commit`

```bash
# New flags
cv commit --generate         # Generate message via AI + knowledge graph
cv commit --generate --dry-run  # Show message without committing
cv commit --type feat --scope auth  # Override type/scope

# Interactive flow
cv commit --generate
# Analyzing staged changes...
# - 3 files modified
# - 2 functions changed: validateUser(), createSession()
# - 1 new function: refreshToken()
# - Suggested: feat(auth): add JWT refresh token support
# [A]ccept / [E]dit / [R]egenerate / [C]ancel?
```

#### 6.1.3 MCP Tools

- `cv_commit_analyze` - Return CommitAnalysis JSON
- `cv_commit_generate` - Generate message string

#### 6.1.4 Git Hook Integration

Add `prepare-commit-msg` hook option:
```bash
cv hooks install --commit-msg  # Enable AI commit messages in hook
```

---

### Phase 6.2: Pre-Merge Conflict Detection (Priority: HIGH)

**Effort:** 2-3 days
**Value:** High - Prevents wasted time on doomed merges

#### 6.2.1 Core: ConflictPredictor Service

Create `packages/core/src/merge/conflict-predictor.ts`:

```typescript
interface ConflictPrediction {
  // Textual (git-detectable)
  textualConflicts: {
    file: string;
    severity: 'low' | 'medium' | 'high';
    overlappingLines: number;
  }[];

  // Semantic (CV-Git unique)
  semanticConflicts: {
    type: 'signature_change' | 'deleted_symbol' | 'moved_symbol' | 'type_change';
    symbol: string;
    file: string;
    affectedCallers: string[];
    severity: 'warning' | 'error';
    description: string;
  }[];

  recommendation: 'safe' | 'proceed_with_caution' | 'resolve_first';
}
```

**How It Works:**
1. Get files changed in both branches relative to merge base
2. Find overlapping files (textual conflict potential)
3. Query knowledge graph:
   - Symbol changes in branch A
   - Symbol usages in branch B
   - Detect mismatches (signature changed + old signature used)
4. Return conflict prediction with severity

#### 6.2.2 CLI: `cv merge --preview`

```bash
cv merge --preview feature/auth
# Conflict Prediction for merging feature/auth into main:
#
# Textual Conflicts (Git will detect):
#   - src/api/handler.ts: High (45 overlapping lines)
#
# Semantic Conflicts (CV-Git detected):
#   - ERROR: validateUser() signature changed in feature/auth
#     But main branch added 3 new callers using old signature:
#       - src/routes/login.ts:42
#       - src/routes/register.ts:78
#       - src/middleware/auth.ts:15
#
# Recommendation: Resolve signature conflict before merging
```

#### 6.2.3 MCP Tool

- `cv_merge_preview` - Predict conflicts before merge

---

### Phase 6.3: Smart Merge Driver (Priority: MEDIUM)

**Effort:** 4-6 days
**Value:** Medium-High - Reduces manual conflict resolution

#### 6.3.1 Custom Merge Driver

Create `packages/core/src/merge/driver.ts`:

```typescript
// Entry point: cv merge-driver %O %A %B %L %P
// Called by git when merge conflict occurs

interface MergeDriverResult {
  success: boolean;
  content: string;        // Result to write to %A
  hasConflicts: boolean;  // Exit code 0 vs 1
  autoResolved: string[]; // What was auto-resolved
  manualReview: string[]; // What needs human review
}
```

**Auto-Resolvable Cases:**
1. Import order changes (both added imports, no overlap)
2. Whitespace/formatting differences
3. Non-overlapping additions to same region
4. Declaration order in classes/objects

**AI-Assisted Cases:**
1. Logic conflicts with clear intent
2. Feature additions to same function
3. Configuration merges

**Always Manual:**
1. Delete vs modify conflicts
2. Type/signature changes
3. Complex logic interweaving

#### 6.3.2 Installation

```bash
cv merge setup
# Adds to .git/config:
# [merge "cv-smart-merge"]
#     name = CV-Git Smart Merge Driver
#     driver = cv merge-driver %O %A %B %L %P
#
# Adds to .gitattributes:
# *.ts merge=cv-smart-merge
# *.tsx merge=cv-smart-merge
# *.js merge=cv-smart-merge
# *.py merge=cv-smart-merge
```

---

### Phase 6.4: Enhanced PR Creation (Priority: MEDIUM)

**Effort:** 2-3 days
**Value:** Medium - Better PR quality

#### 6.4.1 Smart PR Description Generation

Enhance existing `cv pr create`:

```bash
cv pr create --auto-description
# Generates:
# ## Summary
# [AI-generated summary from commits + knowledge graph context]
#
# ## Changes
# - feat(auth): add JWT refresh token support
# - fix(auth): handle expired token edge case
#
# ## Impact Analysis
# - Scope: 5 symbols changed
# - Affected Callers: 12 functions
# - Risk Level: Medium
#
# ## Test Plan
# - [ ] Run: tests/auth/jwt.test.ts (covers refreshToken)
# - [ ] Add tests for: handleExpiredToken (no coverage)
#
# ## Related Files
# - src/middleware/auth.ts (affected caller)
# - src/routes/protected.ts (affected caller)
```

#### 6.4.2 Impact Analysis Integration

Add to PR description:
- Which callers are affected by changes
- Which tests cover the changed code
- What documentation might need updates

---

### Phase 6.5: Enhanced Code Review (Priority: MEDIUM)

**Effort:** 2-3 days
**Value:** Medium - Better review quality

#### 6.5.1 Knowledge-Enhanced Review Prompt

Current `cv review` already works. Enhance with:

```typescript
// Add to review context
interface EnhancedReviewContext {
  // Existing
  diff: string;
  relatedCode: CodeChunk[];

  // New
  impactAnalysis: {
    directlyChanged: SymbolInfo[];
    indirectlyAffected: SymbolInfo[];
    breakingChanges: BreakingChange[];
  };

  testCoverage: {
    covered: string[];      // Tests that cover changed code
    uncovered: string[];    // Changed code without tests
  };

  relatedChanges: {
    file: string;
    reason: string;         // e.g., "Interface may need update"
  }[];
}
```

#### 6.5.2 MCP Tool Enhancement

Update `cv_review`:
- Add `includeImpactAnalysis` parameter
- Add `suggestTests` parameter
- Return structured review with sections

---

### Phase 6.6: Branch Workflow Tools (Priority: LOW)

**Effort:** 2-3 days
**Value:** Low-Medium - Nice to have

#### 6.6.1 Feature Scope Analysis

```bash
cv branch analyze "add JWT authentication"
# Analyzing feature scope...
#
# Primary files likely affected:
#   - src/auth/jwt.ts (new)
#   - src/middleware/auth.ts
#   - src/routes/protected.ts
#
# Related symbols found:
#   - AuthMiddleware (src/middleware/auth.ts)
#   - ProtectedRoute (src/routes/protected.ts)
#
# Estimated complexity: Medium (5-8 files)
# Suggested branch: feature/add-jwt-authentication
```

#### 6.6.2 Branch Conflict Prediction

```bash
cv branch check feature/my-work target:main
# Checking for potential conflicts...
#
# Direct file conflicts: 2 files
# Semantic conflicts: 1 issue
#   - main added calls to getUserById() which you modified
#
# Recommendation: Rebase or merge main before continuing
```

---

## Priority Matrix

| Phase | Feature | Effort | Value | Priority |
|-------|---------|--------|-------|----------|
| 6.1 | AI Commit Messages | 3-5 days | High | **1st** |
| 6.2 | Conflict Prediction | 2-3 days | High | **2nd** |
| 6.4 | Enhanced PR Creation | 2-3 days | Medium | **3rd** |
| 6.5 | Enhanced Review | 2-3 days | Medium | **4th** |
| 6.3 | Smart Merge Driver | 4-6 days | Medium | **5th** |
| 6.6 | Branch Workflows | 2-3 days | Low | **6th** |

**Recommended Order:** 6.1 → 6.2 → 6.4 → 6.5 → 6.3 → 6.6

**Total Estimated Effort:** 15-23 days

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    CV-Git Smart Git Layer                        │
└─────────────────────────────────────────────────────────────────┘
                                │
        ┌───────────────────────┼───────────────────────┐
        │                       │                       │
        ▼                       ▼                       ▼
┌───────────────┐     ┌───────────────┐     ┌───────────────┐
│ CommitAnalyzer│     │ConflictPredict│     │ PR/Review     │
│               │     │               │     │ Enhancer      │
│ - Parse diff  │     │ - Branch diff │     │ - Impact      │
│ - Query graph │     │ - Query graph │     │ - Tests       │
│ - Gen message │     │ - Predict     │     │ - Description │
└───────┬───────┘     └───────┬───────┘     └───────┬───────┘
        │                     │                     │
        └─────────────────────┼─────────────────────┘
                              │
                              ▼
        ┌─────────────────────────────────────────────┐
        │              Knowledge Graph                 │
        │                                              │
        │  ┌─────────┐  ┌─────────┐  ┌─────────────┐  │
        │  │ Symbols │  │  CALLS  │  │   Commits   │  │
        │  │         │◄─┤         │  │             │  │
        │  │function │  │ edges   │  │  MODIFIES   │  │
        │  │class    │  │         │  │  edges      │  │
        │  └─────────┘  └─────────┘  └─────────────┘  │
        │                                              │
        └─────────────────────────────────────────────┘
                              │
                              ▼
        ┌─────────────────────────────────────────────┐
        │               AI Layer (Claude)              │
        │                                              │
        │  - Commit message generation                 │
        │  - Conflict resolution suggestions           │
        │  - Code review with semantic context         │
        │  - PR description synthesis                  │
        └─────────────────────────────────────────────┘
```

---

## File Structure (New Files)

```
packages/
├── core/src/
│   ├── ai/
│   │   ├── commit-analyzer.ts    # NEW - Commit analysis
│   │   └── index.ts              # MODIFY - Add methods
│   └── merge/
│       ├── conflict-predictor.ts # NEW - Predict conflicts
│       ├── driver.ts             # NEW - Merge driver
│       └── index.ts              # NEW - Exports
├── cli/src/commands/
│   ├── commit.ts                 # MODIFY - Add --generate
│   ├── merge.ts                  # NEW - Merge tools
│   └── branch.ts                 # NEW - Branch analysis
└── mcp-server/src/tools/
    ├── commit.ts                 # NEW - Commit MCP tools
    ├── merge.ts                  # NEW - Merge MCP tools
    └── branch.ts                 # NEW - Branch MCP tools
```

---

## Success Metrics

### Phase 6.1 (AI Commits)
- Commit message acceptance rate > 70%
- Time saved per commit: 30-60 seconds
- Breaking change detection accuracy > 90%

### Phase 6.2 (Conflict Prediction)
- Semantic conflict detection rate > 80%
- False positive rate < 20%
- User satisfaction with predictions

### Phase 6.3 (Smart Merge)
- Auto-resolution rate for simple conflicts > 60%
- No incorrect auto-resolutions (critical)
- Reduced manual merge time by 30%

### Phase 6.4 & 6.5 (PR/Review)
- PR description quality improvement
- Review coverage of critical changes
- Reduced review cycles

---

## Next Steps

1. **Review this plan** - Get user feedback on priorities
2. **Start Phase 6.1** - AI Commit Message Generation
3. **Iterate** - Adjust based on real-world usage

---

## Appendix: Key Research Sources

1. **AI Commit Tools:** aicommits, OpenCommit, Conventional Commits spec
2. **Semantic Merge:** SemanticMerge, GumTree, JDime research
3. **Git Custom Drivers:** gitattributes documentation
4. **PR/Review Tools:** CodeRabbit, PR-Agent, GitHub Copilot Review
5. **Branch Workflows:** GitHub Flow, `gh issue develop` CLI

---

*This plan builds on CV-Git's existing infrastructure and leverages the unique advantage of the knowledge graph to provide capabilities that no other tool offers.*