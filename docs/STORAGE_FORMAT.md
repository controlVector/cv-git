# CV-Git Storage Format Specification

**Version:** 1.0.0
**Status:** Draft
**Date:** 2025-12-11

## Overview

CV-Git stores repository knowledge in the `.cv/` directory. This format is:
- **Portable**: Can be committed to git and shared
- **Versioned**: Schema version for backwards compatibility
- **Extensible**: New node types can be added without breaking existing data
- **Loadable**: Can be loaded into FalkorDB/Qdrant on demand

## Directory Structure

```
.cv/
├── config.json              # Repository configuration
├── manifest.json            # Storage manifest with metadata
├── ingestion.jsonl          # Document ingestion tracking
├── graph/
│   ├── nodes/
│   │   ├── files.jsonl      # File nodes
│   │   ├── symbols.jsonl    # Symbol nodes (functions, classes, etc.)
│   │   ├── modules.jsonl    # Module/package nodes
│   │   ├── commits.jsonl    # Git commit nodes
│   │   ├── documents.jsonl  # Documentation nodes (markdown files)
│   │   ├── prds.jsonl       # PRD requirement nodes
│   │   ├── devops.jsonl     # DevOps nodes (CI/CD, deployments)
│   │   └── tests.jsonl      # Test nodes
│   └── edges/
│       ├── imports.jsonl    # Import relationships
│       ├── calls.jsonl      # Function call relationships
│       ├── contains.jsonl   # Containment (file->symbol, etc.)
│       ├── describes.jsonl  # Document describes code (doc->file/symbol)
│       ├── references.jsonl # Document references another doc
│       ├── implements.jsonl # Code implements requirement
│       ├── depends.jsonl    # Dependency relationships
│       └── triggers.jsonl   # DevOps triggers (commit->deploy, etc.)
├── documents/               # Ingested markdown document storage
│   └── [relative-path]/     # Mirrors original repo structure
│       └── file.md          # Full document content (for archived docs)
├── vectors/
│   ├── code_chunks.jsonl    # Code chunk embeddings
│   ├── doc_chunks.jsonl     # Document section embeddings
│   ├── docstrings.jsonl     # Docstring embeddings
│   ├── commits.jsonl        # Commit message embeddings
│   └── prds.jsonl           # PRD chunk embeddings
├── cache/                   # Temporary cache (gitignored)
└── sessions/                # Chat sessions (optional)
```

## File Formats

### manifest.json

```json
{
  "version": "1.0.0",
  "format": "cv-git-storage",
  "created": "2025-12-11T10:00:00Z",
  "updated": "2025-12-11T15:30:00Z",
  "repository": {
    "id": "a1b2c3d4e5f6",
    "name": "my-project",
    "root": "/home/user/project/my-project",
    "remote": "git@github.com:user/my-project.git"
  },
  "stats": {
    "files": 107,
    "symbols": 3047,
    "relationships": 3998,
    "vectors": 1009,
    "lastSync": "2025-12-11T15:30:00Z",
    "syncDuration": 38.4
  },
  "embedding": {
    "provider": "openrouter",
    "model": "openai/text-embedding-3-small",
    "dimensions": 1536
  },
  "nodeTypes": [
    "file", "symbol", "module", "commit", "document", "prd", "devops", "test"
  ],
  "edgeTypes": [
    "imports", "calls", "contains", "describes", "references", "implements", "depends", "triggers"
  ]
}
```

### Node Files (JSONL)

Each line is a JSON object representing a node:

#### files.jsonl
```jsonl
{"id":"file:src/index.ts","type":"file","path":"src/index.ts","language":"typescript","size":2048,"hash":"abc123","lastModified":"2025-12-11T10:00:00Z"}
{"id":"file:src/utils.ts","type":"file","path":"src/utils.ts","language":"typescript","size":1024,"hash":"def456","lastModified":"2025-12-11T09:00:00Z"}
```

#### symbols.jsonl
```jsonl
{"id":"sym:src/index.ts:MyClass","type":"symbol","kind":"class","name":"MyClass","file":"src/index.ts","line":10,"endLine":50,"complexity":15,"docstring":"Main application class"}
{"id":"sym:src/index.ts:myFunction","type":"symbol","kind":"function","name":"myFunction","file":"src/index.ts","line":55,"endLine":70,"complexity":5,"signature":"(x: number) => string"}
```

#### documents.jsonl
```jsonl
{"id":"doc:docs/ARCHITECTURE.md","type":"document","path":"docs/ARCHITECTURE.md","title":"System Architecture","docType":"design_spec","status":"active","wordCount":2450,"sectionCount":8,"archived":false,"tags":["architecture","design"],"frontmatter":{"author":"team","version":"1.0"}}
{"id":"doc:docs/API.md","type":"document","path":"docs/API.md","title":"API Reference","docType":"api_doc","status":"active","wordCount":1200,"sectionCount":5,"archived":true,"archivedAt":"2025-01-15T10:00:00Z","tags":["api"]}
```

#### prds.jsonl (Future)
```jsonl
{"id":"prd:REQ-001","type":"prd","name":"User Authentication","priority":"high","status":"implemented","file":"docs/auth.md","chunkIds":["chunk:REQ-001-1","chunk:REQ-001-2"]}
```

#### devops.jsonl (Future)
```jsonl
{"id":"devops:deploy-prod","type":"devops","kind":"deployment","name":"Production Deploy","trigger":"tag:v*","status":"active","lastRun":"2025-12-11T12:00:00Z"}
{"id":"devops:ci-test","type":"devops","kind":"pipeline","name":"CI Tests","trigger":"push:main","status":"active"}
```

### Edge Files (JSONL)

Each line represents a relationship:

#### imports.jsonl
```jsonl
{"source":"file:src/index.ts","target":"file:src/utils.ts","type":"imports","metadata":{"importType":"named","symbols":["helper","format"]}}
```

#### calls.jsonl
```jsonl
{"source":"sym:src/index.ts:myFunction","target":"sym:src/utils.ts:helper","type":"calls","metadata":{"line":60,"count":1}}
```

#### describes.jsonl
```jsonl
{"source":"doc:docs/ARCHITECTURE.md","target":"file:src/index.ts","type":"describes","metadata":{"section":"Overview","confidence":0.9}}
{"source":"doc:docs/API.md","target":"sym:src/api/routes.ts:handleRequest","type":"describes","metadata":{"section":"Endpoints","confidence":0.85}}
```

#### references.jsonl
```jsonl
{"source":"doc:docs/ARCHITECTURE.md","target":"doc:docs/API.md","type":"references","metadata":{"linkText":"API documentation","line":45}}
```

#### implements.jsonl
```jsonl
{"source":"sym:src/auth/login.ts:handleLogin","target":"prd:REQ-001","type":"implements","metadata":{"coverage":0.8,"verified":true}}
```

### Vector Files (JSONL)

Each line contains text, embedding, and metadata:

#### code_chunks.jsonl
```jsonl
{"id":"vec:src/index.ts:10-50","text":"class MyClass {...}","embedding":[0.1,0.2,...],"metadata":{"file":"src/index.ts","startLine":10,"endLine":50,"symbolName":"MyClass","language":"typescript"}}
```

## Loading Strategy

### On `cv init` / `cv sync`
1. Generate unique repo ID (hash of remote URL or path)
2. Sync to FalkorDB/Qdrant using repo-specific database/collection names
3. Export to `.cv/graph/` and `.cv/vectors/` files

### On `cv find` / `cv explain` / etc.
1. Check if repo's data is loaded in DB (by repo ID)
2. If not loaded, auto-load from `.cv/` files
3. Execute query against DB

### On repo switch
1. Previous repo's data remains in DB (LRU eviction if needed)
2. New repo's data loaded from its `.cv/` files
3. No data loss - each repo maintains its own `.cv/` directory

## Database Naming Convention

```
FalkorDB:
  - Graph: cv_{repo_id}  (e.g., cv_a1b2c3d4)

Qdrant:
  - Collection: {repo_id}_code_chunks
  - Collection: {repo_id}_docstrings
  - Collection: {repo_id}_commits
  - Collection: {repo_id}_prds
```

## Backwards Compatibility

### Version Migrations

When loading `.cv/` files:
1. Read `manifest.json` version
2. Apply migrations if version < current
3. Update manifest version after migration

### Adding New Node/Edge Types

New types are additive - old data continues to work:
- New node files (e.g., `devops.jsonl`) simply don't exist in old repos
- Queries for new types return empty results until sync adds them
- `nodeTypes` and `edgeTypes` in manifest track what's available

### Schema Evolution

Each node/edge type can have optional fields:
```jsonl
// v1.0 - original
{"id":"sym:x","type":"symbol","name":"foo","file":"a.ts","line":1}

// v1.1 - added complexity (optional)
{"id":"sym:x","type":"symbol","name":"foo","file":"a.ts","line":1,"complexity":5}

// v1.2 - added security annotations (optional)
{"id":"sym:x","type":"symbol","name":"foo","file":"a.ts","line":1,"complexity":5,"security":{"level":"public","audit":"2025-01-01"}}
```

## .gitignore Recommendations

```gitignore
# CV-Git - Selective ignoring for portability
# Ignore temporary/cache files
.cv/cache/
.cv/sessions/
.cv/embeddings/
.cv/delta_state.json

# Optional: exclude large vector files (uncomment if needed)
# .cv/vectors/

# DO NOT ignore these - they enable portable knowledge graphs:
# .cv/config.json      - repository configuration
# .cv/manifest.json    - storage manifest with metadata
# .cv/ingestion.jsonl  - document ingestion tracking
# .cv/graph/           - graph nodes and edges (JSONL)
# .cv/documents/       - ingested/archived markdown docs
# .cv/vectors/         - vector embeddings (optional, can be regenerated)
```

### What Gets Committed

| Path | Committed | Purpose |
|------|-----------|---------|
| `.cv/config.json` | ✅ Yes | Repo settings (no secrets) |
| `.cv/manifest.json` | ✅ Yes | Schema version, stats |
| `.cv/ingestion.jsonl` | ✅ Yes | Track ingested documents |
| `.cv/graph/` | ✅ Yes | Knowledge graph (nodes/edges) |
| `.cv/documents/` | ✅ Yes | Archived markdown docs |
| `.cv/vectors/` | ⚠️ Optional | Large, can regenerate |
| `.cv/cache/` | ❌ No | Temporary data |
| `.cv/sessions/` | ❌ No | Local chat history |

## Implementation Phases

### Phase 1: Basic File Storage ✅
- [x] Write nodes/edges to JSONL on sync
- [x] Generate repo-specific database names (`cv_{repo_id}`)
- [x] Load from files when DB is empty
- [x] Export vectors to JSONL (21MB for cv-git codebase)

### Phase 2: Auto-loading ✅
- [x] Detect when vectors are missing from DB
- [x] Auto-load `.cv/` files into DB on `cv find`
- [ ] LRU eviction for memory management (future)

### Phase 3: Document Ingestion 🚧 (v0.3.9)
- [x] Markdown parser with frontmatter, headings, links
- [x] IngestManager for `.cv/documents/` storage
- [x] CLI commands: `cv docs ingest/archive/restore/list`
- [x] Delta sync manager for change tracking
- [ ] Wire ingest → graph pipeline (Document nodes)
- [ ] DESCRIBES edges from docs to code
- [ ] Auto-embed on ingest
- [ ] Git integration for --archive flag

### Phase 4: Incremental Sync
- [x] Track file hashes for change detection (DeltaSyncManager)
- [ ] Only update changed nodes/edges
- [ ] Merge strategy for concurrent edits

### Phase 5: Extended Node Types
- [ ] PRD nodes (integrate with cv-prd)
- [ ] DevOps nodes (CI/CD pipelines)
- [ ] Test nodes (test coverage mapping)
