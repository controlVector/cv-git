# CV-Git CLI Commands Reference

**Version:** 1.1.0
**Last Updated:** 2026-03-26

The authoritative reference for all CV-Git CLI commands is the built-in help:

```bash
# List all commands
cv --help

# Get help for any command
cv <command> --help

# Get help for subcommands
cv graph --help
cv deploy push --help
cv auth setup --help
```

## Command Categories

### Setup & Configuration
`cv init`, `cv auth`, `cv config`, `cv doctor`, `cv preferences`, `cv services`

### AI-Powered
`cv find`, `cv explain`, `cv do`, `cv review`, `cv chat`, `cv context`

### Knowledge Graph
`cv sync`, `cv graph` (stats, files, symbols, calls, imports, inspect, query, path, neighborhood, impact, bridge, info, hubs)

### Git Wrappers
`cv add`, `cv commit`, `cv push`, `cv pull`, `cv checkout`, `cv switch`, `cv branch`, `cv merge`, `cv stash`, `cv fetch`, `cv remote`, `cv reset`, `cv revert`, `cv tag`, `cv diff`, `cv log`, `cv clone`, `cv clone-group`

### Advanced Git
`cv absorb`, `cv undo`, `cv reflog`, `cv stack`, `cv split`

### Deploy (experimental)
`cv deploy` (init, list, push, rollback, status, diff, report)

### Agent (experimental)
`cv agent`, `cv connect`

### Pull Requests & Releases
`cv pr` (create, list, view, merge), `cv release` (create, list, view, delete, publish)

### Documentation & Knowledge
`cv docs`, `cv knowledge`, `cv summary`, `cv prd`, `cv import`

### Utilities
`cv deps`, `cv cache`, `cv verify`, `cv bugreport`, `cv watch`, `cv hooks`, `cv design`, `cv code`

## Global Options

Most commands support these flags (via `addGlobalOptions`):

| Flag | Description |
|------|-------------|
| `--json` | Output as JSON |
| `--quiet` | Suppress output |
| `--verbose` | Show verbose/debug output |
| `--options` | Show available options for the command |

Note: Parent commands like `cv graph`, `cv pr`, and `cv release` may not pass these flags to all subcommands. Use `cv <command> <subcommand> --help` to check.
