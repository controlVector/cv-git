# CV-Git Setup Guide

Complete step-by-step guide to set up CV-Git for the first time.

---

## Prerequisites

### 1. Node.js and Package Manager

**Install Node.js 18+:**
```bash
# Using nvm (recommended)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
nvm install 18
nvm use 18

# Or download from nodejs.org
```

**Install pnpm (recommended) or use npm:**
```bash
npm install -g pnpm
```

### 2. Docker

**Install Docker:**
- **Mac:** [Docker Desktop for Mac](https://docs.docker.com/desktop/install/mac-install/)
- **Windows:** [Docker Desktop for Windows](https://docs.docker.com/desktop/install/windows-install/)
- **Linux:** 
  ```bash
  curl -fsSL https://get.docker.com -o get-docker.sh
  sudo sh get-docker.sh
  ```

**Verify installation:**
```bash
docker --version
```

### 3. API Keys

You'll need two API keys:

#### Anthropic API Key (Required for AI features)

1. Go to [https://console.anthropic.com/](https://console.anthropic.com/)
2. Sign up or log in
3. Navigate to API Keys
4. Create a new key
5. Copy the key (starts with `sk-ant-`)

**Cost:** Pay-as-you-go, ~$20-30/month for typical usage

#### OpenAI API Key (Required for semantic search)

1. Go to [https://platform.openai.com/api-keys](https://platform.openai.com/api-keys)
2. Sign up or log in
3. Create a new secret key
4. Copy the key (starts with `sk-`)

**Cost:** ~$0.50/month for embeddings

---

## Installation

### Step 1: Clone and Install

```bash
# Clone the repository
git clone https://github.com/yourusername/cv-git.git
cd cv-git

# Install dependencies
pnpm install
# or
npm install

# Build the project
pnpm build
# or
npm run build

# This will take a few minutes the first time
```

### Step 2: Link CLI Globally

```bash
# Link the cv command globally
cd packages/cli
pnpm link --global
# or
npm link

# Verify installation
cv --version
```

### Step 3: Start Required Services

```bash
# Start FalkorDB (knowledge graph database)
docker run -d \
  --name falkordb \
  -p 6379:6379 \
  --restart unless-stopped \
  falkordb/falkordb

# Start Qdrant (vector database)
docker run -d \
  --name qdrant \
  -p 6333:6333 \
  --restart unless-stopped \
  qdrant/qdrant

# Verify services are running
docker ps

# You should see both falkordb and qdrant running
```

**Troubleshooting:**
- If ports are in use: `docker ps` and `docker stop <container>`
- If containers won't start: Check Docker Desktop is running
- To view logs: `docker logs falkordb` or `docker logs qdrant`

### Step 4: Configure API Keys

**Option A: Environment Variables (Recommended)**

Add to your shell profile (`~/.bashrc`, `~/.zshrc`, or `~/.bash_profile`):

```bash
# CV-Git API Keys
export ANTHROPIC_API_KEY=sk-ant-your-key-here
export OPENAI_API_KEY=sk-your-key-here
```

Then reload:
```bash
source ~/.bashrc  # or ~/.zshrc
```

**Option B: Project .env File**

```bash
# Copy the example
cp .env.example .env

# Edit with your keys
nano .env
# or
code .env

# Add your keys:
# ANTHROPIC_API_KEY=sk-ant-...
# OPENAI_API_KEY=sk-...
```

**Verify configuration:**
```bash
echo $ANTHROPIC_API_KEY
echo $OPENAI_API_KEY
```

---

## Initial Setup in Your Project

### Step 1: Navigate to Your Project

```bash
cd /path/to/your/project
```

### Step 2: Initialize CV-Git

```bash
cv init

# This creates .cv/config.json with default settings
```

**What this does:**
- Creates `.cv/` directory for CV-Git metadata
- Generates `config.json` with default settings
- Validates your environment

### Step 3: Sync Your Codebase

```bash
cv sync

# First sync will take a few minutes
# It will:
# 1. Parse all TypeScript/JavaScript files
# 2. Build knowledge graph in FalkorDB
# 3. Generate vector embeddings with OpenAI
# 4. Store embeddings in Qdrant
```

**What to expect:**
```
✓ Loading configuration
✓ Connecting to FalkorDB
✓ Connecting to Qdrant
  Parsing files... 50/50
✓ Successfully parsed 50 files
  Creating file nodes...
  Creating symbol nodes...
  Creating import relationships...
  Creating call relationships...
✓ Graph update complete
  Generating embeddings...
✓ Stored 250 embeddings
Sync completed in 45.2s
- Files: 50
- Symbols: 250
- Relationships: 450
- Vectors: 250
```

---

## Verify Installation

### Test Commands

```bash
# 1. Check graph statistics
cv graph stats

# 2. Try semantic search
cv find "function that handles authentication"

# 3. Get AI explanation
cv explain "authenticateUser"

# 4. View call graph
cv graph calls
```

### Expected Results

If everything is working:
- `cv graph stats` shows your codebase statistics
- `cv find` returns relevant code chunks
- `cv explain` provides AI-generated explanations
- `cv graph calls` shows function call relationships

---

## Common Issues

### "Not in a CV-Git repository"

**Solution:** Run `cv init` in your project directory

### "Anthropic API key not found"

**Solution:** 
```bash
# Check if key is set
echo $ANTHROPIC_API_KEY

# If empty, set it
export ANTHROPIC_API_KEY=sk-ant-...

# Or add to .env file
```

### "Could not connect to Qdrant"

**Solution:**
```bash
# Check if Qdrant is running
docker ps | grep qdrant

# If not running, start it
docker run -d --name qdrant -p 6333:6333 qdrant/qdrant

# Check logs
docker logs qdrant
```

### "Could not connect to FalkorDB"

**Solution:**
```bash
# Check if FalkorDB is running
docker ps | grep falkordb

# If not running, start it
docker run -d --name falkordb -p 6379:6379 falkordb/falkordb

# Check logs
docker logs falkordb
```

### "No changes to sync" after cv sync

This is normal if:
- You've already synced
- No files match the sync patterns
- All files are excluded by patterns

### Build Errors

```bash
# Clean and rebuild
rm -rf node_modules packages/*/node_modules
rm -rf packages/*/dist
pnpm install
pnpm build
```

---

## Advanced Configuration

### Custom Service URLs

Edit `.cv/config.json` in your project:

```json
{
  "graph": {
    "url": "redis://your-falkordb-host:6379"
  },
  "vector": {
    "url": "http://your-qdrant-host:6333"
  }
}
```

### Exclude Patterns

Customize what files to sync:

```json
{
  "sync": {
    "excludePatterns": [
      "node_modules/**",
      "dist/**",
      "**/*.test.ts",
      "**/*.spec.ts"
    ]
  }
}
```

### Different AI Models

Use a different Claude model:

```bash
export CV_AI_MODEL=claude-3-opus-20240229
```

---

## Stopping Services

When you're done:

```bash
# Stop services (data is preserved)
docker stop falkordb qdrant

# Restart later
docker start falkordb qdrant

# Remove completely (deletes all data!)
docker rm -f falkordb qdrant
```

---

## Updating CV-Git

```bash
cd /path/to/cv-git
git pull
pnpm install
pnpm build
```

---

## Getting Help

- **Documentation:** [docs/](docs/)
- **Issues:** [GitHub Issues](https://github.com/yourusername/cv-git/issues)
- **Discussions:** [GitHub Discussions](https://github.com/yourusername/cv-git/discussions)

---

## Next Steps

Once setup is complete:

1. Read the [Usage Guide](README.md#usage-examples)
2. Try the [Example Workflows](docs/EXAMPLES.md) (coming soon)
3. Explore the [API Documentation](docs/API.md) (coming soon)

**Happy coding with CV-Git! 🚀**
