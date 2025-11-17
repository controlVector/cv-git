# CV-Git Testing Guide

## ✅ What's Been Verified

### Repository
- ✅ Successfully pushed to GitHub: https://github.com/controlVector/cv-git
- ✅ 47 files, 13,604 lines of code
- ✅ No API keys or secrets committed
- ✅ All documentation included
- ✅ `.gitignore` properly configured

### Code Quality
- ✅ TypeScript strict mode
- ✅ Proper monorepo structure
- ✅ All imports/exports configured
- ✅ No syntax errors in source files

---

## 🧪 Manual Testing Required

### 1. Fresh Installation Test (10 minutes)

**On a clean machine or directory:**

```bash
# Install pnpm
npm install -g pnpm

# Clone from GitHub
git clone https://github.com/controlVector/cv-git.git
cd cv-git

# Install dependencies
pnpm install

# Build project
pnpm build

# Expected output:
# - packages/shared builds successfully
# - packages/core builds successfully
# - packages/cli builds successfully
# - No TypeScript errors
```

**Success criteria:**
- All packages build without errors
- `dist/` folders created in each package
- No dependency resolution errors

### 2. CLI Installation Test (5 minutes)

```bash
# Link CLI globally
cd packages/cli
pnpm link --global

# Verify installation
cv --version
# Expected: 0.1.0

cv --help
# Expected: Shows all commands (init, sync, do, find, explain, review, graph, git)
```

**Success criteria:**
- `cv` command is available globally
- All commands listed in help output
- Version number displays correctly

### 3. Service Setup Test (5 minutes)

```bash
# Start required services
docker run -d --name falkordb -p 6379:6379 falkordb/falkordb
docker run -d --name qdrant -p 6333:6333 qdrant/qdrant

# Verify services
docker ps
# Expected: Both containers running

# Run setup check
./scripts/setup-check.sh
# Expected: Checks pass for Node.js, Docker, services
```

**Success criteria:**
- FalkorDB container running on port 6379
- Qdrant container running on port 6333
- Setup script reports success

### 4. Basic Functionality Test (10 minutes)

**Create a test project:**

```bash
# Create test directory
mkdir -p ~/cv-test-project
cd ~/cv-test-project

# Initialize git
git init

# Create sample TypeScript files
cat > auth.ts << 'EOF'
/**
 * Authenticates a user with email and password
 */
export function authenticateUser(email: string, password: string): string {
  if (!email || !password) {
    throw new Error('Missing credentials');
  }

  const isValid = validatePassword(password);
  if (!isValid) {
    throw new Error('Invalid password');
  }

  return generateToken(email);
}

/**
 * Validates password strength
 */
function validatePassword(password: string): boolean {
  return password.length >= 8;
}

/**
 * Generates authentication token
 */
function generateToken(email: string): string {
  return `token-${email}-${Date.now()}`;
}
EOF

cat > database.ts << 'EOF'
/**
 * Database connection manager
 */
export class DatabaseManager {
  private connection: any;

  async connect(url: string): Promise<void> {
    this.connection = await createConnection(url);
  }

  async query(sql: string): Promise<any[]> {
    return this.connection.execute(sql);
  }

  async close(): Promise<void> {
    await this.connection.close();
  }
}

async function createConnection(url: string): Promise<any> {
  // Mock connection
  return { execute: async () => [], close: async () => {} };
}
EOF

# Set API keys
export ANTHROPIC_API_KEY=sk-ant-your-key
export OPENAI_API_KEY=sk-your-key

# Initialize CV-Git
cv init
# Expected: Creates .cv/config.json

# Sync codebase
cv sync
# Expected:
# - Parses 2 files
# - Extracts ~6 symbols
# - Creates knowledge graph
# - Generates embeddings
# - Completes successfully
```

**Success criteria:**
- `cv init` creates `.cv/` directory and config
- `cv sync` completes without errors
- Shows file count, symbol count, relationships
- No crashes or exceptions

### 5. Graph Commands Test (5 minutes)

```bash
# View statistics
cv graph stats
# Expected: Shows 2 files, ~6 symbols

# List files
cv graph files
# Expected: Lists auth.ts and database.ts

# List symbols
cv graph symbols
# Expected: Shows authenticateUser, validatePassword, generateToken, DatabaseManager, etc.

# View calls
cv graph calls authenticateUser
# Expected: Shows what authenticateUser calls

# Get callers
cv graph calls validatePassword --callers
# Expected: Shows authenticateUser calls validatePassword
```

**Success criteria:**
- All graph commands return results
- Data matches the code structure
- No connection errors

### 6. Semantic Search Test (5 minutes)

```bash
# Search for authentication code
cv find "authentication function"
# Expected: Returns authenticateUser with high relevance score

# Search for database code
cv find "database connection"
# Expected: Returns DatabaseManager.connect

# Search with filter
cv find "password" --language typescript
# Expected: Returns validatePassword
```

**Success criteria:**
- Semantic search returns relevant results
- Relevance scores > 0.6
- Results include code snippets
- No API errors

### 7. AI Commands Test (10 minutes)

**Set API keys first:**
```bash
export ANTHROPIC_API_KEY=sk-ant-your-real-key
export OPENAI_API_KEY=sk-your-real-key
```

**Test cv explain:**
```bash
cv explain "authenticateUser"
# Expected:
# - Gathers context (shows relevant code)
# - Streams explanation from Claude
# - Explains what/how/why
# - No errors
```

**Test cv do (plan only):**
```bash
cv do "add logging to authentication" --plan-only
# Expected:
# - Gathers context
# - Generates plan with steps
# - Shows complexity estimate
# - Lists affected files
```

**Test cv review:**
```bash
# Make a change
echo "// TODO: add tests" >> auth.ts
git add auth.ts

# Review staged changes
cv review --staged
# Expected:
# - Shows diff
# - Provides multi-aspect review
# - Gives actionable feedback
```

**Success criteria:**
- All AI commands connect to Claude
- Responses are relevant and helpful
- Streaming works (tokens appear in real-time)
- No rate limit or API errors

---

## 🐛 Common Issues and Solutions

### Issue: "pnpm: command not found"
**Solution:** Install pnpm globally
```bash
npm install -g pnpm
```

### Issue: "Could not connect to FalkorDB"
**Solution:** Start FalkorDB
```bash
docker run -d --name falkordb -p 6379:6379 falkordb/falkordb
```

### Issue: "Anthropic API key not found"
**Solution:** Set environment variable
```bash
export ANTHROPIC_API_KEY=sk-ant-your-key
```

### Issue: "No results found" in cv find
**Solution:** Run cv sync first
```bash
cv sync
```

### Issue: Build errors about missing dependencies
**Solution:** Clean install
```bash
rm -rf node_modules packages/*/node_modules
pnpm install
pnpm build
```

---

## 📊 Test Results Template

**Date:** _______

**Environment:**
- OS: _______
- Node.js: _______
- pnpm: _______
- Docker: _______

**Test Results:**
- [ ] Fresh installation
- [ ] CLI installation
- [ ] Service setup
- [ ] Basic functionality
- [ ] Graph commands
- [ ] Semantic search
- [ ] AI commands

**Issues Found:**
1. _______
2. _______

**Notes:**
_______

---

## ✅ Definition of Success

CV-Git is working correctly if:

1. **Installation:** Clean clone → install → build works without errors
2. **CLI:** `cv` command available globally, all commands listed
3. **Services:** FalkorDB and Qdrant running and connectable
4. **Sync:** Successfully parses files and builds knowledge graph
5. **Graph:** Query commands return accurate results
6. **Search:** Semantic search finds relevant code
7. **AI:** Claude-powered commands provide helpful responses
8. **Docs:** README and SETUP.md are clear and accurate

---

## 🚀 After Testing

Once all tests pass:

1. **Update README** if any issues found
2. **Create GitHub Release** (v0.1.0)
3. **Announce** on social media
4. **Submit to lists:**
   - awesome-typescript
   - awesome-ai-tools
   - awesome-cli-apps
5. **Share with community**

---

**Happy Testing! 🧪**
