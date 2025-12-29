# CV-Git: Auto-Sync and Design-First Scaffolding

## Overview

This document outlines the implementation plan for two key features:
1. **Auto-sync on push** - Keep knowledge graph updated automatically
2. **Design-first scaffolding** - Generate graph structure before code

---

## Part 1: Auto-Sync on Push

### Goal
When a user pushes code, the knowledge graph should automatically update with the changes.

### Implementation

#### 1.1 `cv push` Command
A wrapper around `git push` that also triggers incremental sync.

```bash
# Basic usage
cv push                        # git push + cv sync --incremental

# With git push arguments
cv push origin main            # git push origin main + sync
cv push -u origin feature      # git push -u origin feature + sync

# Skip sync
cv push --skip-sync            # just git push, no sync
cv push --sync-only            # just sync, no push (for testing)
```

**File:** `packages/cli/src/commands/push.ts`

**Logic:**
1. Parse arguments (separate cv flags from git flags)
2. Run `git push` with passthrough args
3. If push succeeds and `--skip-sync` not set, run `cv sync --incremental`
4. Report combined status

#### 1.2 `cv hooks` Command
Install/manage git hooks for automatic sync on commit.

```bash
cv hooks install               # Install post-commit hook
cv hooks uninstall             # Remove cv hooks
cv hooks status                # Show installed hooks
```

**Hook behavior (post-commit):**
- Runs `cv sync --incremental --quiet` after each commit
- Non-blocking (runs in background or quick enough to not annoy)
- Fails silently (don't break git workflow if sync fails)

**File:** `packages/cli/src/commands/hooks.ts`

**Hook script:** `.git/hooks/post-commit`
```bash
#!/bin/sh
# CV-Git auto-sync hook
cv sync --incremental --quiet 2>/dev/null &
```

---

## Part 2: Design-First Scaffolding

### Goal
Allow users to design a system architecture first, generate a knowledge graph from the design, validate it, and then scaffold code from the graph.

### The Inverted Flow

**Current flow (code-first):**
```
Write Code → Parse → Build Graph → Query
```

**New flow (design-first):**
```
Design Intent → Generate Graph → Validate → Scaffold Code → Implement
```

### Implementation

#### 2.1 `cv design` Command

```bash
# From natural language
cv design "authentication system with JWT, refresh tokens, RBAC"

# From PRD reference
cv design --from-prd PRD-123

# Interactive mode
cv design --interactive

# Output options
cv design "..." --output graph      # Just show graph structure
cv design "..." --output diagram    # Mermaid/ASCII diagram
cv design "..." --output scaffold   # Generate stub files
cv design "..." --output all        # Everything
```

**File:** `packages/cli/src/commands/design.ts`

#### 2.2 Design Flow

**Step 1: Parse Design Intent**
- Input: Natural language description or PRD
- Output: Structured requirements

**Step 2: Generate Graph Schema**
AI generates:
```typescript
interface DesignGraph {
  modules: Module[];        // Packages/directories
  types: TypeDefinition[];  // Interfaces, types, enums
  functions: FunctionDef[]; // Function signatures (no implementation)
  relationships: Relation[]; // calls, imports, implements, extends
}
```

**Step 3: Validate Graph**
- No circular dependencies (unless intentional)
- All referenced types exist
- Function signatures are coherent
- Reasonable complexity metrics

**Step 4: Output**
- **Graph view:** Insert nodes into knowledge graph (marked as "planned")
- **Diagram:** Generate Mermaid or ASCII art
- **Scaffold:** Generate stub files with:
  - Directory structure
  - Interface/type definitions
  - Function stubs with TODO comments
  - Import statements

#### 2.3 Graph Node States

Add a `status` field to graph nodes:
```typescript
enum NodeStatus {
  PLANNED = 'planned',      // Designed but not implemented
  STUB = 'stub',            // Scaffold generated
  IMPLEMENTED = 'implemented', // Real code synced
  DEPRECATED = 'deprecated'   // Marked for removal
}
```

This allows:
- Tracking design → implementation progress
- Showing "planned vs actual" in graph queries
- Detecting drift between design and implementation

#### 2.4 Example Session

```bash
$ cv design "user authentication with email/password and OAuth"

🎨 Generating design...

## Proposed Architecture

### Modules
- src/auth/           # Authentication core
- src/auth/providers/ # OAuth providers
- src/auth/middleware/# Express middleware

### Types
- User              # User entity
- AuthToken         # JWT payload
- OAuthProvider     # Provider interface
- AuthConfig        # Configuration

### Functions
- auth/login(email, password) → AuthToken
- auth/register(email, password, name) → User
- auth/refresh(refreshToken) → AuthToken
- auth/logout(token) → void
- providers/google.authenticate(code) → User
- providers/github.authenticate(code) → User
- middleware/requireAuth(req, res, next)
- middleware/requireRole(role)(req, res, next)

### Relationships
- login → validatePassword → generateToken
- middleware/requireAuth → verifyToken
- providers/* implements OAuthProvider

## Validation ✓
- No circular dependencies
- All types defined
- 8 functions, 4 types, 3 modules

? What would you like to do?
  > Generate scaffold files
    Add to knowledge graph (as planned)
    Export Mermaid diagram
    Refine design
    Cancel
```

---

## Execution Order

### Phase 1: cv push (30 min)
1. Create `packages/cli/src/commands/push.ts`
2. Add to CLI index
3. Test with real push

### Phase 2: cv hooks (30 min)
1. Create `packages/cli/src/commands/hooks.ts`
2. Implement install/uninstall/status
3. Test hook execution

### Phase 3: cv design (2-3 hours)
1. Create `packages/cli/src/commands/design.ts`
2. Add design prompt templates to AI manager
3. Implement graph schema generation
4. Add validation logic
5. Implement scaffold generation
6. Add Mermaid diagram export

---

## File Changes Summary

### New Files
- `packages/cli/src/commands/push.ts`
- `packages/cli/src/commands/hooks.ts`
- `packages/cli/src/commands/design.ts`
- `packages/core/src/ai/design.ts` (design prompts and parsing)
- `packages/core/src/scaffold/index.ts` (code generation)

### Modified Files
- `packages/cli/src/index.ts` (add new commands)
- `packages/shared/src/types.ts` (add NodeStatus enum)
- `packages/core/src/graph/index.ts` (support planned nodes)

---

## Success Criteria

### cv push
- [ ] `cv push` runs git push and syncs
- [ ] Git arguments pass through correctly
- [ ] `--skip-sync` works
- [ ] Clear error messages on failure

### cv hooks
- [ ] `cv hooks install` creates working hook
- [ ] Hook runs sync after commit
- [ ] `cv hooks uninstall` removes hook cleanly
- [ ] Hook doesn't break if cv not available

### cv design
- [ ] Natural language → graph schema works
- [ ] Validation catches real issues
- [ ] Scaffold generates compilable code
- [ ] Mermaid export renders correctly
- [ ] Integrates with existing knowledge graph
