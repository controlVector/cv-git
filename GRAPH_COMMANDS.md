# CV-Git Graph Query Commands

Complete guide to querying the knowledge graph with `cv graph`.

---

## Overview

After running `cv sync`, your codebase is stored as a knowledge graph in FalkorDB. The `cv graph` command provides powerful tools to explore and query this graph.

### Available Commands

```bash
cv graph stats              # Show graph statistics
cv graph files              # List files with metadata
cv graph symbols            # List symbols (functions, classes, etc.)
cv graph calls [symbol]     # Show function call relationships
cv graph imports [file]     # Show file import relationships
cv graph inspect <symbol>   # Inspect a symbol in detail
cv graph query <cypher>     # Run custom Cypher queries
```

---

## 1. `cv graph stats`

Show high-level statistics about the knowledge graph.

### Usage

```bash
cv graph stats
```

### Output

```
Knowledge Graph Statistics
──────────────────────────────────────────────────
  Files:         50
  Symbols:       300
  Modules:       12
  Commits:       0
  Relationships: 450
──────────────────────────────────────────────────
```

### Use Cases
- Quick health check after sync
- Understand codebase size
- Track growth over time

---

## 2. `cv graph files`

List files in the graph with metadata.

### Usage

```bash
# List all files
cv graph files

# Filter by language
cv graph files --language typescript

# Sort by complexity
cv graph files --sort complexity

# Limit results
cv graph files --limit 10
```

### Options

| Option | Description | Default |
|--------|-------------|---------|
| `-l, --language <lang>` | Filter by language | all |
| `--limit <n>` | Limit results | 20 |
| `--sort <field>` | Sort by: path, complexity, size | path |

### Output

```
┌──────────────────────────────────┬─────────────┬─────┬────────────┐
│ Path                             │ Language    │ LOC │ Complexity │
├──────────────────────────────────┼─────────────┼─────┼────────────┤
│ packages/core/src/graph/index.ts │ typescript  │ 627 │ 45         │
│ packages/core/src/parser/index.ts│ typescript  │ 657 │ 38         │
│ packages/cli/src/commands/sync.ts│ typescript  │ 197 │ 12         │
└──────────────────────────────────┴─────────────┴─────┴────────────┘

Showing 20 files
```

### Use Cases
- Find most complex files
- Filter by language
- Audit codebase size
- Identify refactoring candidates

---

## 3. `cv graph symbols`

List symbols (functions, classes, methods, etc.) with filtering.

### Usage

```bash
# List all symbols
cv graph symbols

# Filter by kind
cv graph symbols --kind function
cv graph symbols --kind class
cv graph symbols --kind method

# Filter by file
cv graph symbols --file auth

# Sort by complexity
cv graph symbols --sort complexity

# Combine filters
cv graph symbols --kind function --file service --limit 10
```

### Options

| Option | Description | Default |
|--------|-------------|---------|
| `-k, --kind <kind>` | Filter by: function, class, method, interface, type, variable, constant | all |
| `-f, --file <path>` | Filter by file path (substring match) | all |
| `--limit <n>` | Limit results | 50 |
| `--sort <field>` | Sort by: name, complexity, line | name |

### Output

```
┌─────────────────────┬────────┬──────────────────────────────┬──────┬────────────┐
│ Name                │ Kind   │ File                         │ Line │ Complexity │
├─────────────────────┼────────┼──────────────────────────────┼──────┼────────────┤
│ createGraphManager  │ function│ packages/core/src/graph/...  │ 625  │ 1          │
│ GraphManager        │ class  │ packages/core/src/graph/...  │ 25   │ 35         │
│ connect             │ method │ packages/core/src/graph/...  │ 37   │ 8          │
│ query               │ method │ packages/core/src/graph/...  │ 133  │ 6          │
└─────────────────────┴────────┴──────────────────────────────┴──────┴────────────┘

Showing 50 symbols
```

### Symbol Kinds

- **function** - Top-level functions
- **method** - Class methods
- **class** - Class declarations
- **interface** - TypeScript interfaces
- **type** - TypeScript type aliases
- **variable** - Variables (let/var)
- **constant** - Constants (const)

### Use Cases
- Find all functions in a module
- List classes for documentation
- Identify complex methods
- Search for specific symbol types

---

## 4. `cv graph calls [symbol]`

Show function call relationships (when implemented).

### Usage

```bash
# Show symbols with most calls
cv graph calls

# Show what calls a specific symbol
cv graph calls authenticateUser --callers

# Show what a symbol calls
cv graph calls AuthService --callees
```

### Options

| Option | Description |
|--------|-------------|
| `--callers` | Show what calls this symbol |
| `--callees` | Show what this symbol calls |
| `--depth <n>` | Traversal depth (future) |

### Output (when available)

```
Callers of authenticateUser:

  ▸ loginHandler
    src/routes/auth.ts:45

  ▸ refreshToken
    src/services/token.ts:78
```

### Current Status
⚠️ **Note**: Call graph extraction is not yet implemented. The sync engine currently creates File and Symbol nodes, but does not yet extract CALLS relationships. This will be added in the next phase.

---

## 5. `cv graph imports [file]`

Show file import relationships.

### Usage

```bash
# Show files with most imports
cv graph imports

# Show what a file imports
cv graph imports packages/core/src/sync/index.ts

# Show what files import this file (dependents)
cv graph imports packages/core/src/graph/index.ts --dependents
```

### Options

| Option | Description |
|--------|-------------|
| `--dependents` | Show files that import this file |
| `--dependencies` | Show files this file imports (default) |

### Output: Most Imports

```
Files with Most Imports
┌──────────────────────────────────────────┬────────────┬─────────┐
│ File                                     │ Language   │ Imports │
├──────────────────────────────────────────┼────────────┼─────────┤
│ packages/core/src/sync/index.ts          │ typescript │ 5       │
│ packages/cli/src/commands/sync.ts        │ typescript │ 4       │
│ packages/core/src/graph/index.ts         │ typescript │ 3       │
└──────────────────────────────────────────┴────────────┴─────────┘
```

### Output: Dependencies

```
packages/core/src/sync/index.ts imports:

  ▸ packages/shared/src/types.ts
  ▸ packages/shared/src/utils.ts
  ▸ packages/core/src/git/index.ts
  ▸ packages/core/src/parser/index.ts
  ▸ packages/core/src/graph/index.ts

5 import(s)
```

### Output: Dependents

```
Files that import packages/core/src/graph/index.ts:

  ▸ packages/core/src/sync/index.ts
  ▸ packages/cli/src/commands/sync.ts
  ▸ packages/cli/src/commands/graph.ts

3 dependent(s)
```

### Use Cases
- Understand module dependencies
- Find tightly coupled files
- Identify breaking change impact
- Refactor import structure

---

## 6. `cv graph inspect <symbol>`

Inspect a symbol in detail.

### Usage

```bash
# Inspect by name (finds partial matches)
cv graph inspect GraphManager
cv graph inspect authenticateUser
cv graph inspect connect
```

### Output

```
Symbol Details
──────────────────────────────────────────────────────────────────────
  Name:          GraphManager
  Qualified:     packages/core/src/graph/index.ts:GraphManager
  Kind:          class
  File:          packages/core/src/graph/index.ts
  Lines:         25-620
  Visibility:    public
  Async:         No
  Static:        No
  Complexity:    35
  Documentation:
    /**
     * FalkorDB Graph Manager
     * Manages the knowledge graph using FalkorDB
──────────────────────────────────────────────────────────────────────
```

### Details Shown

- Full qualified name
- Symbol kind (function, class, etc.)
- File location and line range
- Visibility (public/private/protected)
- Async and static modifiers
- Cyclomatic complexity
- Function signature
- Return type (if applicable)
- JSDoc documentation (first 3 lines)

### Use Cases
- Quick reference for symbol details
- Find symbol location
- Check complexity before refactoring
- View documentation

---

## 7. `cv graph query <cypher>`

Run custom Cypher queries against the graph.

### Usage

```bash
# Simple query
cv graph query "MATCH (f:File) RETURN f.path LIMIT 5"

# Complex query
cv graph query "MATCH (f:File)-[:DEFINES]->(s:Symbol) WHERE s.complexity > 10 RETURN f.path, s.name, s.complexity ORDER BY s.complexity DESC"

# JSON output
cv graph query "MATCH (s:Symbol) WHERE s.kind = 'class' RETURN s" --json
```

### Options

| Option | Description |
|--------|-------------|
| `--json` | Output as JSON instead of table |

### Output: Table Format

```
┌──────────────────────────────┬─────────────────┬────────────┐
│ path                         │ name            │ complexity │
├──────────────────────────────┼─────────────────┼────────────┤
│ packages/core/src/graph/...  │ GraphManager    │ 35         │
│ packages/core/src/parser/... │ CodeParser      │ 28         │
│ packages/core/src/sync/...   │ SyncEngine      │ 15         │
└──────────────────────────────┴─────────────────┴────────────┘

3 row(s)
```

### Cypher Query Examples

#### Find All Classes
```cypher
MATCH (s:Symbol)
WHERE s.kind = 'class'
RETURN s.name, s.file, s.complexity
ORDER BY s.complexity DESC
```

#### Find High-Complexity Functions
```cypher
MATCH (s:Symbol)
WHERE s.kind = 'function' AND s.complexity > 10
RETURN s.name, s.file, s.complexity
ORDER BY s.complexity DESC
LIMIT 10
```

#### Find Files Without Symbols
```cypher
MATCH (f:File)
WHERE NOT (f)-[:DEFINES]->(:Symbol)
RETURN f.path, f.linesOfCode
```

#### Count Symbols by Kind
```cypher
MATCH (s:Symbol)
RETURN s.kind, count(s) as count
ORDER BY count DESC
```

#### Find Symbols with Documentation
```cypher
MATCH (s:Symbol)
WHERE s.docstring IS NOT NULL AND s.docstring <> ''
RETURN s.name, s.kind, s.file
LIMIT 20
```

#### Find Public Async Functions
```cypher
MATCH (s:Symbol)
WHERE s.kind = 'function'
  AND s.isAsync = true
  AND s.visibility = 'public'
RETURN s.name, s.file, s.returnType
```

#### File Import Analysis
```cypher
MATCH (f:File)-[i:IMPORTS]->(target:File)
RETURN f.path, count(i) as importCount, collect(target.path) as imports
ORDER BY importCount DESC
LIMIT 10
```

#### Symbol Definitions by File
```cypher
MATCH (f:File)-[:DEFINES]->(s:Symbol)
RETURN f.path, count(s) as symbolCount
ORDER BY symbolCount DESC
LIMIT 10
```

### Use Cases
- Custom analysis queries
- Data export (with --json)
- Complex graph traversals
- Research and exploration

---

## Common Workflows

### 1. Explore a New Codebase

```bash
# Get overview
cv graph stats

# List main files
cv graph files --limit 20

# Find entry points (likely main/index files)
cv graph symbols --kind function | grep -i main

# Understand module structure
cv graph imports
```

### 2. Find Refactoring Candidates

```bash
# Find complex files
cv graph files --sort complexity --limit 10

# Find complex functions
cv graph symbols --kind function --sort complexity --limit 10

# Inspect the most complex
cv graph inspect <function-name>
```

### 3. Understand Dependencies

```bash
# Files with most imports
cv graph imports

# What does this file depend on?
cv graph imports src/services/auth.ts

# What depends on this file?
cv graph imports src/utils/common.ts --dependents
```

### 4. Documentation Audit

```bash
# Find all classes (for documentation)
cv graph symbols --kind class

# Find interfaces
cv graph symbols --kind interface

# Check specific symbol
cv graph inspect AuthService
```

### 5. Complexity Analysis

```bash
# Most complex files
cv graph query "MATCH (f:File) RETURN f.path, f.complexity ORDER BY f.complexity DESC LIMIT 10"

# Average complexity by language
cv graph query "MATCH (f:File) RETURN f.language, avg(f.complexity) as avgComplexity"

# Functions over complexity threshold
cv graph query "MATCH (s:Symbol) WHERE s.kind = 'function' AND s.complexity > 15 RETURN s.name, s.file, s.complexity"
```

---

## Tips & Best Practices

### 1. Use Filters to Narrow Results

Start broad, then filter:
```bash
cv graph symbols --limit 100
cv graph symbols --kind function --limit 50
cv graph symbols --kind function --file auth --limit 20
```

### 2. Sort for Insights

Different sorts reveal different insights:
```bash
cv graph files --sort complexity  # Find complex files
cv graph files --sort size        # Find large files
cv graph symbols --sort complexity # Find complex functions
```

### 3. Combine with Shell Tools

```bash
# Find all auth-related symbols
cv graph symbols --limit 1000 | grep -i auth

# Count symbol types
cv graph query "MATCH (s:Symbol) RETURN s.kind, count(*) as c" | tail -n +4

# Export to CSV
cv graph symbols --limit 1000 > symbols.txt
```

### 4. Use inspect for Deep Dives

When a query returns interesting results, use `inspect` for details:
```bash
cv graph symbols --sort complexity --limit 5
cv graph inspect <top-result>
```

### 5. Custom Queries for Analysis

The `query` command is powerful for custom analysis:
```bash
# Distribution of symbol kinds
cv graph query "MATCH (s:Symbol) RETURN s.kind, count(s)"

# Files with no imports (possible entry points)
cv graph query "MATCH (f:File) WHERE NOT (f)-[:IMPORTS]->() RETURN f.path"

# Average LOC by language
cv graph query "MATCH (f:File) RETURN f.language, avg(f.linesOfCode)"
```

---

## Graph Schema Reference

### Node Types

- **File**: Source files
  - Properties: path, language, linesOfCode, complexity, size, gitHash

- **Symbol**: Functions, classes, methods, etc.
  - Properties: name, qualifiedName, kind, file, startLine, endLine, signature, docstring, complexity, visibility, isAsync, isStatic

- **Module**: Packages/directories (future)
- **Commit**: Git commits (future)

### Relationship Types

- **File → DEFINES → Symbol**: File defines a symbol
- **File → IMPORTS → File**: File imports another file
- **Symbol → CALLS → Symbol**: Symbol calls another symbol (future)
- **Symbol → INHERITS → Symbol**: Class inheritance (future)
- **Commit → MODIFIES → File**: Commit modifies file (future)
- **Commit → TOUCHES → Symbol**: Commit touches symbol (future)

---

## Troubleshooting

### "No results found"

Make sure you've run `cv sync` first:
```bash
cv sync
```

### "Failed to connect to graph"

Make sure FalkorDB is running:
```bash
docker ps | grep falkordb
# If not running:
docker run -d --name falkordb -p 6379:6379 falkordb/falkordb
```

### Query syntax errors

Use proper Cypher syntax. Common mistakes:
```bash
# ❌ Wrong: forgot quotes
cv graph query "MATCH (f:File) WHERE f.language = typescript RETURN f"

# ✅ Correct: quoted string
cv graph query "MATCH (f:File) WHERE f.language = 'typescript' RETURN f"
```

### Large result sets

Use LIMIT to control output:
```bash
cv graph query "MATCH (s:Symbol) RETURN s LIMIT 10"
```

---

## Next Steps

With the graph query commands, you can:

1. ✅ **Explore** your codebase structure
2. ✅ **Analyze** complexity and dependencies
3. ✅ **Find** symbols and files quickly
4. ✅ **Inspect** code details without opening files
5. ✅ **Export** data for external analysis

**Coming next:**
- 🔜 Vector search with `cv find`
- 🔜 AI-powered explanations with `cv explain`
- 🔜 Task execution with `cv do`

---

**Happy graph querying!** 🎯
