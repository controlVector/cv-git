---
type: design_spec
status: draft
tags: [documentation, ingestion, architecture]
relates_to: [packages/core/src/storage/, packages/cli/src/commands/docs.ts]
---

# Markdown Ingestion Design

## Problem Statement

cv-git repositories can accumulate many markdown documentation files that:
1. Clutter the GitHub repository view
2. Contain valuable knowledge that should be searchable
3. Have relationships to code that should be preserved

**Goal**: Allow markdown files to be "ingested" into the cv-git knowledge system and optionally removed from the main git repository, while preserving all content, relationships, and searchability.

## Design Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     Original Repository                          │
│  src/                                                            │
│  docs/                                                           │
│  ├── DESIGN.md  ──────┐                                          │
│  ├── API.md     ──────┤  cv docs ingest                          │
│  └── ADR/       ──────┤                                          │
└───────────────────────┼──────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────────┐
│                    .cv/ Knowledge Store                          │
│  .cv/                                                            │
│  ├── documents/          # Full document content                 │
│  │   └── docs/                                                   │
│  │       ├── DESIGN.md   # Preserved content                     │
│  │       └── API.md                                              │
│  ├── authored.jsonl      # Manual relationships                  │
│  ├── embeddings/         # Vector cache                          │
│  │   ├── index.json                                              │
│  │   └── vectors/                                                │
│  └── manifest.json       # Ingestion metadata                    │
└─────────────────────────────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Graph + Vector DBs                            │
│  - Document nodes with full metadata                             │
│  - DESCRIBES relationships to code                               │
│  - Semantic search via embeddings                                │
└─────────────────────────────────────────────────────────────────┘
```

## Commands

### `cv docs ingest <file|pattern>`

Ingest markdown files into the knowledge system.

```bash
# Ingest a single file
cv docs ingest docs/DESIGN.md

# Ingest with pattern
cv docs ingest "docs/**/*.md"

# Ingest and archive (remove from git)
cv docs ingest docs/DESIGN.md --archive

# Ingest all docs, keeping README
cv docs ingest "docs/**/*.md" --archive --keep "README.md"
```

**What happens:**
1. Parse document (frontmatter, sections, links)
2. Copy content to `.cv/documents/<path>`
3. Create/update graph nodes
4. Generate embeddings
5. Store authored metadata
6. If `--archive`: move original to `.cv/documents/`, add to `.gitignore`

### `cv docs archive <file>`

Archive an already-ingested document (remove from git).

```bash
cv docs archive docs/OLD_DESIGN.md
```

**What happens:**
1. Verify file is already ingested
2. Move to `.cv/documents/` if not already there
3. Add original path to `.cv/archived-paths.txt`
4. Optionally create stub file with link

### `cv docs restore <file>`

Restore an archived document back to the repository.

```bash
cv docs restore docs/OLD_DESIGN.md
```

**What happens:**
1. Copy from `.cv/documents/<path>` to original location
2. Remove from archived-paths list
3. Keep in knowledge graph (already indexed)

### `cv docs list --ingested`

List all ingested documents.

```bash
cv docs list --ingested
cv docs list --archived  # Only show archived
cv docs list --active    # Only show still in repo
```

## Storage Structure

```
.cv/
├── documents/              # Ingested document storage
│   └── [relative-path]/    # Mirrors original structure
│       └── file.md
├── ingestion.jsonl         # Ingestion metadata
├── authored.jsonl          # Manual relationships
├── embeddings/             # Vector cache
│   ├── index.json
│   └── vectors/
└── manifest.json
```

### Ingestion Metadata Format

```jsonl
{"path":"docs/DESIGN.md","ingestedAt":"2025-01-15T10:00:00Z","hash":"abc123","archived":false,"gitCommit":"def456"}
{"path":"docs/API.md","ingestedAt":"2025-01-15T10:05:00Z","hash":"xyz789","archived":true,"archivedAt":"2025-01-16T09:00:00Z"}
```

## Workflow Examples

### 1. Initial Documentation Setup

```bash
# Start with many markdown files
$ tree docs/
docs/
├── README.md
├── ARCHITECTURE.md
├── API/
│   ├── auth.md
│   └── users.md
└── ADR/
    ├── 0001-typescript.md
    └── 0002-database.md

# Index all into knowledge graph
$ cv docs sync

# Later, clean up the repo
$ cv docs ingest "docs/**/*.md" --archive --keep "README.md"

# Now repo is lean
$ tree docs/
docs/
└── README.md

# But knowledge is preserved
$ cv docs search "authentication"
# Returns results from archived docs/API/auth.md

$ cv docs list --archived
docs/ARCHITECTURE.md
docs/API/auth.md
docs/API/users.md
docs/ADR/0001-typescript.md
docs/ADR/0002-database.md
```

### 2. Restore for Editing

```bash
# Need to update a doc
$ cv docs restore docs/API/auth.md

# Edit the file
$ vim docs/API/auth.md

# Re-ingest and archive
$ cv docs ingest docs/API/auth.md --archive
```

### 3. New Developer Onboarding

```bash
# Clone repo
$ git clone <repo>

# All docs are in .cv/ (committed or synced)
$ cv docs list --ingested
docs/ARCHITECTURE.md (archived)
docs/API/auth.md (archived)
...

# Search works immediately
$ cv docs search "getting started"

# Restore any docs you need to read
$ cv docs restore docs/ARCHITECTURE.md
```

## Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Storage location | `.cv/documents/` | Keeps with cv-git's `.cv/` convention |
| Commit .cv/documents | Yes | Enables distributed sharing |
| Stub files | Optional | Some teams want placeholders |
| Pattern support | Yes | Bulk operations are common |
| Preserve structure | Yes | Maintains mental model |

## Future Considerations

1. **Remote Storage**: Later, `.cv/documents/` could sync to hosted backend
2. **Partial Sync**: Don't download all docs, fetch on demand
3. **Conflict Resolution**: What if someone edits archived doc directly?
4. **Search UI**: Web interface for browsing ingested docs

## Implementation Plan

1. Create `IngestManager` in `packages/core/src/storage/`
2. Add `cv docs ingest` command
3. Add `cv docs archive` and `cv docs restore`
4. Update `cv docs list` with ingestion status
5. Update `cv docs search` to include archived docs
