# Testing CV-Git on Windows

## Prerequisites

- Windows 10 or Windows 11 (x64)
- Node.js >= 20 installed from https://nodejs.org/en/download
  - During install: check "Add to PATH" (required)
- A terminal: PowerShell 7+ or Windows Terminal recommended
  - Do NOT use Git Bash for install testing — it masks Windows path issues
- Internet connection (npm downloads `@ladybugdb/core` native binaries)

## Install from npm

Open PowerShell as a regular user (not Administrator):

```powershell
# Install globally
npm install -g @controlvector/cv-git

# Verify the binary is in PATH
cv --version

# Verify the correct backend is detected
cv doctor
# Look for: Graph backend: LadybugDB
```

## Test from a local build (before publishing)

```powershell
# 1. Install dependencies
pnpm install

# 2. Build all packages
pnpm build

# 3. Run the test suite
pnpm test

# 4. Pack the CLI package
cd packages/cli
npm pack
# Creates: controlvector-cv-git-1.2.0.tgz

# 5. Install the tarball globally
npm install -g controlvector-cv-git-1.2.0.tgz

# 6. Verify
cv --version
cv doctor
```

## Smoke tests

Run these after every install:

```powershell
# 1. Version check
cv --version

# 2. Help output
cv --help

# 3. Backend detection (must show LadybugDB on Windows)
$env:CV_GIT_GRAPH_BACKEND = ""
cv doctor
# Look for: "Graph backend: LadybugDB"

# 4. Init in a test repo
mkdir C:\tmp\cv-git-test
cd C:\tmp\cv-git-test
git init
cv init
# Should complete without errors and NOT mention Docker

# 5. Status check
cv status

# 6. Backend override
$env:CV_GIT_GRAPH_BACKEND = "ladybugdb"
cv doctor
$env:CV_GIT_GRAPH_BACKEND = ""
```

## Troubleshooting

### `@ladybugdb/core` build error during npm install

LadybugDB is a native C++ addon and requires build tools on Windows:

```powershell
# Install Windows build tools (run PowerShell as Administrator)
npm install -g windows-build-tools
# OR install Visual Studio Build Tools:
# https://visualstudio.microsoft.com/visual-cpp-build-tools/
```

### `cv` command not found after global install

```powershell
# Check where npm global bin is
npm config get prefix
# Add <prefix> to your PATH if needed
# Example: C:\Users\YourName\AppData\Roaming\npm
```

### Graph backend shows `redis` instead of `ladybugdb`

```powershell
echo $env:CV_GIT_GRAPH_BACKEND
# If set, clear it:
$env:CV_GIT_GRAPH_BACKEND = ""
cv doctor
```

## npm registry

All installs pull from the public npm registry: https://registry.npmjs.org

```powershell
# Verify registry
npm config get registry

# Install specific version
npm install -g @controlvector/cv-git@1.2.0

# Install latest
npm install -g @controlvector/cv-git@latest
```
