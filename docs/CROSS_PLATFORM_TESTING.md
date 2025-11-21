# Cross-Platform Testing Guide

## Platform Support

CV-Git supports:
- **Linux** (tested)
- **macOS** (untested)
- **Windows** (untested)

## Platform-Specific Components

### Credential Storage

Uses `keytar` library for native OS credential storage:
- **macOS**: Keychain
- **Windows**: Credential Manager
- **Linux**: Secret Service API (gnome-keyring, kwallet)

Fallback: Encrypted file storage (`~/.cv/credentials.enc`)

### File Paths

All paths use:
- `os.homedir()` for cross-platform home directory
- `path.join()` for path construction

## Testing Checklist

### Prerequisites
- [ ] Node.js 18+
- [ ] pnpm 8+
- [ ] Docker (for FalkorDB and Qdrant)
- [ ] Git

### Core Functionality
- [ ] `pnpm install` completes without errors
- [ ] `pnpm build` compiles all packages
- [ ] `pnpm link --global --dir packages/cli` makes `cv` command available
- [ ] `cv --version` shows version

### Commands to Test
```bash
# Basic
cv --help
cv init
cv status
cv doctor

# Config
cv config list
cv config get ai.model
cv config set features.test true

# Services (requires Docker)
cv sync
cv find "test query"
cv graph stats
```

### Platform-Specific Tests

#### macOS
- [ ] Keychain storage works
- [ ] `cv config edit` opens default editor

#### Windows
- [ ] Credential Manager storage works
- [ ] Paths with spaces work correctly
- [ ] PowerShell and CMD compatibility

#### Linux
- [ ] gnome-keyring or kwallet works
- [ ] OR encrypted file fallback works

## Known Issues

None currently identified.

## Reporting Issues

If you encounter platform-specific issues:
1. Run `cv doctor --json` and include output
2. Include OS version and Node.js version
3. Report at https://github.com/controlVector/cv-git/issues
