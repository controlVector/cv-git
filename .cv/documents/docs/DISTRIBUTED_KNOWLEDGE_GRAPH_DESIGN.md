---
type: design_spec
status: draft
tags: [architecture, distributed, knowledge-graph, v2.0]
relates_to: [packages/core/src/graph/, packages/core/src/sync/, packages/core/src/vector/]
priority: critical
---

# Distributed Knowledge Graph Architecture

## Executive Summary

This document outlines the architecture for sharing cv-git's knowledge graph across distributed development teams. The goal is to enable multiple developers to collaborate on a codebase while maintaining a consistent, synchronized view of the knowledge graph—including code symbols, documentation, relationships, and vector embeddings.

## Problem Statement

### Current State (Local-Only)

Today, cv-git's knowledge graph is entirely local:

```
Developer Machine
├── FalkorDB (local Redis)     → Graph nodes & edges
├── Qdrant (local)             → Vector embeddings
└── .cv/                       → Sync state, config
```

Each developer has their own isolated knowledge graph. This creates several problems:

1. **Redundant work**: Every developer regenerates the same embeddings
2. **No shared context**: Documentation relationships created by one dev aren't visible to others
3. **PR blindness**: Code reviewers can't see how changes affect the knowledge graph
4. **Onboarding friction**: New team members must run full sync (expensive, slow)

### Desired State (Distributed)

A shared knowledge graph that:
- Syncs automatically with Git operations
- Handles branching and merging gracefully
- Works offline with eventual consistency
- Shares expensive computations (embeddings)
- Preserves human-authored relationships

---

## Data Classification

The knowledge graph contains two fundamentally different types of data:

| Type | Source | Regeneratable? | Cost to Regenerate |
|------|--------|----------------|-------------------|
| **Derived** | Code/docs analysis | Yes | Embeddings: $0.0001/chunk via API |
| **Authored** | Manual relationships, frontmatter | No | Human time (invaluable) |

### Derived Data
- File nodes (from filesystem)
- Symbol nodes (from parsing)
- CALLS, IMPORTS, DEFINES edges (from AST analysis)
- Vector embeddings (from embedding API)
- Inferred document types (from content analysis)

### Authored Data
- Frontmatter metadata (type, tags, status, relates_to)
- Manual DESCRIBES relationships
- Custom tags and annotations
- Document priority/ownership

**Key insight**: Derived data can be regenerated from source code, but it's expensive (API calls for embeddings) and slow (parsing). Authored data cannot be regenerated and must be preserved through version control.

---

## Architecture Options

### Option A: Centralized Server

```
┌─────────────────────────────────────────────────────────┐
│                    Hosted cv-git Server                  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │
│  │  FalkorDB   │  │   Qdrant    │  │  Branch     │     │
│  │  (shared)   │  │  (shared)   │  │  Manager    │     │
│  └─────────────┘  └─────────────┘  └─────────────┘     │
└────────────────────────┬────────────────────────────────┘
                         │ WebSocket / gRPC
        ┌────────────────┼────────────────┐
        │                │                │
   Developer A      Developer B      Developer C
   (branch: feat-x) (branch: main)  (branch: fix-y)
```

**How it works:**
- Single hosted graph instance per repository
- Each branch has isolated namespace in the graph
- All queries go to server
- Real-time sync via WebSocket

**Pros:**
- Simple mental model
- Always consistent
- No merge complexity

**Cons:**
- Requires constant connectivity
- Query latency (network round-trip)
- Single point of failure
- Scaling challenges for large orgs

---

### Option B: Git-Native Storage

```
repository/
├── src/
├── docs/
└── .cv/
    ├── graph/
    │   ├── documents.jsonl
    │   ├── files.jsonl
    │   ├── symbols.jsonl
    │   └── edges.jsonl
    ├── vectors/
    │   └── embeddings.bin (or LFS pointer)
    └── manifest.json
```

**How it works:**
- Graph stored as JSONL files in repository
- Committed alongside code changes
- Git handles branching/merging natively
- Vectors stored via Git LFS or external pointer

**Pros:**
- Fully offline capable
- Familiar Git workflow
- No additional infrastructure
- Full history via Git

**Cons:**
- Repository bloat (vectors are large)
- JSONL merge conflicts are painful
- No real-time collaboration

---

### Option C: Hybrid Architecture (Recommended)

```
┌──────────────────────────────────────────────────────────────┐
│                      Hosted Backend                           │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐  │
│  │ Graph Storage  │  │ Vector Storage │  │  Embedding     │  │
│  │ (per-branch)   │  │ (content-addr) │  │  Service       │  │
│  └────────────────┘  └────────────────┘  └────────────────┘  │
└─────────────────────────────┬────────────────────────────────┘
                              │
                         cv push/pull
                              │
┌─────────────────────────────┴────────────────────────────────┐
│                       Local Working Copy                      │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐  │
│  │ Local FalkorDB │  │ Local Qdrant   │  │ .cv/ metadata  │  │
│  │ (fast queries) │  │ (fast search)  │  │ (committed)    │  │
│  └────────────────┘  └────────────────┘  └────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

**How it works:**
- Local databases for fast queries (offline capable)
- Remote server for sharing and sync
- Content-addressed vector storage (deduplication)
- Authored metadata committed to Git
- `cv push` / `cv pull` sync graph state

This combines the best of both worlds: offline speed with collaborative sharing.

---

## Content-Addressed Vector Storage

### The Deduplication Opportunity

Embeddings are deterministic: the same text with the same model produces the same vector. We can exploit this:

```typescript
function computeEmbeddingId(text: string, model: string): string {
  return hash(`${model}:${text}`);
}

// Two developers embedding the same function get the same ID
// Vector is stored once, referenced by both
```

### Storage Model

```
vectors/
├── openai-text-embedding-3-small/
│   ├── a1b2c3d4.vec    # 1536 floats = 6KB
│   ├── e5f6g7h8.vec
│   └── ...
└── index.json          # Maps embedding_id → file
```

### Benefits

1. **Storage efficiency**: Same code = same embedding = stored once
2. **Merge simplicity**: No conflicts possible (content-addressed)
3. **Cache sharing**: Team shares embedding cache, reduces API costs
4. **Bandwidth optimization**: Only transfer new embeddings

---

## Graph State Granularity

### Question: Per-Commit vs Per-Branch?

#### Option 1: Graph State Per Commit

Every commit has an associated graph snapshot.

```
commit abc123 → graph_state_xyz
commit def456 → graph_state_uvw
```

**Pros:**
- `git checkout` any commit = exact graph state
- Perfect reproducibility
- Bisect works with graph context

**Cons:**
- Storage intensive (many snapshots)
- Snapshot creation on every commit
- Complex garbage collection

#### Option 2: Graph State Per Branch Tip

Only branch tips have graph state; historical commits regenerate on demand.

```
main (tip)     → graph_state_abc
feat-x (tip)   → graph_state_def
fix-y (tip)    → graph_state_ghi
```

**Pros:**
- Much less storage
- Simpler model
- Faster commits

**Cons:**
- Checking out old commits requires regeneration
- Less reproducibility

#### Recommendation: Hybrid with Checkpoints

```
Branch tips:     Always have current graph state
Tagged commits:  Snapshot preserved (releases, milestones)
Other commits:   Regenerate on demand, cache locally
```

This balances storage efficiency with practical needs:
- Day-to-day work uses branch tip (always fresh)
- Releases are reproducible (tagged snapshots)
- Historical exploration works but may be slower

---

## Conflict Resolution

### Conflict Types

| Conflict Type | Example | Resolution Strategy |
|--------------|---------|---------------------|
| **Node collision** | Both branches modify same symbol's docstring | Notify, require human decision |
| **Edge conflict** | Branch A adds edge, Branch B deletes source node | Auto-resolve (edge removed) |
| **Authored conflict** | Both modify same frontmatter | Notify, merge or choose |
| **Vector conflict** | N/A - content-addressed | No conflicts possible |

### Notification-Based Resolution

Rather than blocking merges, use a notification system:

```typescript
interface ConflictNotification {
  type: 'graph_conflict';
  repository: string;
  branch: string;
  target_branch: string;
  conflicts: GraphConflict[];
  affected_users: string[];      // Users who touched conflicting nodes
  lead_developer?: string;       // From CODEOWNERS or config
  created_at: string;
}

interface GraphConflict {
  node_type: 'symbol' | 'document' | 'file';
  node_id: string;
  ours: NodeState;
  theirs: NodeState;
  base: NodeState;
  suggested_resolution: 'ours' | 'theirs' | 'manual';
}
```

### Hook System

```yaml
# .cv/hooks.yaml
on_graph_conflict:
  # Notify affected developers
  - action: notify
    channels: [slack, email]
    recipients:
      - affected_users
      - lead_developer

  # Auto-resolve trivial conflicts
  - action: auto_resolve
    when:
      - conflict_type: docstring_only
        strategy: prefer_longer
      - conflict_type: timestamp_only
        strategy: prefer_newer

  # Escalate complex conflicts
  - action: escalate
    when:
      - conflict_type: structural
      - conflict_count: "> 10"
    to: lead_developer
    block_merge: true
```

### Resolution Workflow

```
1. Developer opens PR: feat-x → main

2. cv-git detects graph conflicts:
   - Symbol `AuthService` modified in both branches
   - Document `AUTH.md` has different tags

3. Notification sent:
   - To: @alice (modified AuthService in feat-x)
   - To: @bob (modified AuthService in main)
   - CC: @lead (CODEOWNERS)

4. Resolution options:
   a) Auto-resolve via hooks (if configured)
   b) Manual resolution in PR UI
   c) CLI: `cv graph resolve --ours` or `--theirs`

5. Once resolved, merge proceeds normally
```

---

## Offline Capability

### Design Principle: Offline-First

The system should be fully functional without network connectivity, with sync happening opportunistically.

### Offline Operations (Full Support)

| Operation | Offline Behavior |
|-----------|------------------|
| `cv sync` | Uses local parsing, skips embedding upload |
| `cv context` | Queries local graph and vectors |
| `cv docs search` | Searches local vector DB |
| `cv find` | Searches local graph |
| `cv commit` | Records graph delta locally |

### Online-Required Operations

| Operation | Why Online Required |
|-----------|---------------------|
| `cv push` | Uploads graph state to server |
| `cv pull` | Downloads graph state from server |
| `cv graph merge` (remote) | Requires server-side merge |
| Embedding generation | API calls (unless local model) |

### Sync Strategy

```typescript
enum SyncMode {
  OFFLINE,      // No network, use local only
  LAZY,         // Sync on explicit push/pull
  EAGER,        // Sync on every commit
  REALTIME      // WebSocket live sync
}

// Default: LAZY (like Git)
// Can be configured per-repo or globally
```

### Offline Queue

When offline, changes queue locally:

```
.cv/
└── pending/
    ├── graph_deltas/
    │   ├── 001_add_symbol_foo.json
    │   └── 002_update_doc_readme.json
    └── embeddings_pending/
        └── chunks_to_embed.jsonl
```

On reconnect:
1. Push pending graph deltas
2. Request embedding generation for pending chunks
3. Pull any remote changes
4. Resolve conflicts if any

---

## Cost Model Considerations

### Current Costs (Per Operation)

| Operation | Cost | Provider |
|-----------|------|----------|
| Embedding (small) | $0.00002/1K tokens | OpenAI |
| Embedding (large) | $0.00013/1K tokens | OpenAI |
| Graph storage | ~$0.01/GB/month | Self-hosted |
| Vector storage | ~$0.02/GB/month | Self-hosted |

### Typical Repository Costs

For a medium codebase (10K symbols, 100 docs):
- Initial sync: ~500K tokens → ~$0.01-0.07
- Incremental sync: ~10K tokens → ~$0.0002-0.001
- Storage: ~100MB → ~$0.01/month

### Pricing Model Options

#### Option A: Per-Seat
```
Free:       1 user, 3 repos, local only
Team:       $10/user/month, unlimited repos, shared graph
Enterprise: $25/user/month, SSO, audit logs, SLA
```

#### Option B: Per-Repository
```
Free:       Public repos, 100MB graph storage
Pro:        $5/repo/month, 1GB storage, 5 collaborators
Team:       $20/repo/month, unlimited storage & collaborators
```

#### Option C: Usage-Based
```
Free tier:  1000 embeddings/month, 100MB storage
Pay-as-go:  $0.10 per 1000 embeddings, $0.05/GB storage
```

#### Option D: Hybrid (Recommended for Launch)
```
Free tier:  Local-only, unlimited
Cloud sync: $10/month flat for early adopters
            Includes: 10 repos, 5GB storage, 100K embeddings
Enterprise: Contact sales
```

### Getting Market Data

To validate pricing, we need users. Proposed approach:

1. **Launch free tier** - Local-only, full functionality
2. **Waitlist for cloud** - Gauge interest, collect use cases
3. **Beta program** - Free cloud for feedback
4. **Usage telemetry** (opt-in) - Understand actual usage patterns
5. **Iterate pricing** - Based on real data

---

## Implementation Roadmap

### Phase 1: Foundation (Current + Near-term)

**Goal:** Prepare for distributed architecture without breaking local-only usage.

- [x] Document types and classification
- [x] Markdown knowledge graph integration
- [ ] Content-addressed embedding storage locally
- [ ] Graph export/import (JSONL format)
- [ ] Authored metadata in `.cv/authored.jsonl`

### Phase 2: Sync Protocol

**Goal:** Enable push/pull of graph state.

- [ ] Define graph sync protocol (delta-based)
- [ ] `cv graph export` / `cv graph import`
- [ ] `cv push --graph` / `cv pull --graph`
- [ ] Conflict detection
- [ ] Local pending queue

### Phase 3: Hosted Backend

**Goal:** Shared graph infrastructure.

- [ ] Graph storage service (branch-aware)
- [ ] Vector storage service (content-addressed)
- [ ] Embedding service (shared cache)
- [ ] Authentication & authorization
- [ ] Repository linking (GitHub/GitLab)

### Phase 4: Collaboration Features

**Goal:** Team workflow integration.

- [ ] PR graph diffs
- [ ] Conflict notification hooks
- [ ] Resolution UI (web + CLI)
- [ ] CODEOWNERS integration
- [ ] Activity feed

### Phase 5: Self-Hosting

**Goal:** Enterprise deployment option.

- [ ] Docker Compose setup
- [ ] Kubernetes Helm charts
- [ ] Admin dashboard
- [ ] Backup/restore
- [ ] cv-git dogfooding (use cv-git to host cv-git)

---

## Open Questions

1. **Graph schema versioning**: How do we handle schema changes across cv-git versions?

2. **Large monorepo support**: At what scale does the per-branch model break down?

3. **Cross-repo graphs**: Can relationships span repositories (microservices)?

4. **Embedding model migration**: When we upgrade embedding models, how do we handle the transition?

5. **Deletion propagation**: When a file is deleted, how long do we retain its graph history?

---

## Appendix: Data Formats

### Graph Delta Format

```json
{
  "version": "1.0",
  "base_commit": "abc123",
  "target_commit": "def456",
  "timestamp": "2025-01-15T10:30:00Z",
  "deltas": [
    {
      "operation": "upsert_node",
      "node_type": "Symbol",
      "node_id": "src/auth.ts:AuthService",
      "data": { "name": "AuthService", "kind": "class", ... }
    },
    {
      "operation": "add_edge",
      "edge_type": "CALLS",
      "from": "src/auth.ts:login",
      "to": "src/auth.ts:validateToken"
    },
    {
      "operation": "delete_node",
      "node_type": "Symbol",
      "node_id": "src/old.ts:deprecatedFunc"
    }
  ]
}
```

### Authored Metadata Format

```json
{
  "version": "1.0",
  "entries": [
    {
      "path": "docs/AUTH.md",
      "type": "document",
      "frontmatter": {
        "type": "design_spec",
        "status": "active",
        "tags": ["security", "authentication"],
        "relates_to": ["src/auth/", "src/middleware/auth.ts"]
      },
      "manual_edges": [
        { "type": "DESCRIBES", "target": "src/auth/" }
      ]
    }
  ]
}
```

### Embedding Reference Format

```json
{
  "chunk_id": "src/auth.ts:10-50",
  "embedding_id": "a1b2c3d4e5f6",
  "model": "openai/text-embedding-3-small",
  "dimensions": 1536,
  "created_at": "2025-01-15T10:30:00Z"
}
```

---

## References

- [Git Internals - Content Addressable Storage](https://git-scm.com/book/en/v2/Git-Internals-Git-Objects)
- [CRDTs for Distributed Systems](https://crdt.tech/)
- [FalkorDB Documentation](https://docs.falkordb.com/)
- [Qdrant Architecture](https://qdrant.tech/documentation/concepts/)
