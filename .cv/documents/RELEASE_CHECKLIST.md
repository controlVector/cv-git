# GitHub Release Checklist

## ✅ Completed

### Documentation
- [x] **README.md** - Comprehensive project overview with features, quick start, usage examples
- [x] **SETUP.md** - Detailed setup guide with troubleshooting
- [x] **CONTRIBUTING.md** - Contribution guidelines
- [x] **LICENSE** - MIT License
- [x] **.env.example** - Template for API key configuration
- [x] **Architecture docs** - ARCHITECTURE.md, DATA_MODELS.md, etc.
- [x] **Feature docs** - CALL_GRAPH_COMPLETE.md, VECTOR_SEARCH_COMPLETE.md, AI_FEATURES_COMPLETE.md

### Project Configuration
- [x] **.gitignore** - Updated with API key patterns
- [x] **package.json** - Proper metadata and scripts
- [x] **tsconfig.json** - TypeScript configuration
- [x] **Monorepo structure** - Packages organized properly

### Credential Management
- [x] **.env.example** - Clear template with comments
- [x] **Setup verification script** - scripts/setup-check.sh
- [x] **Documentation** - SETUP.md with API key instructions
- [x] **Security** - .gitignore includes all credential patterns

---

## 🔄 Testing Plan

### 1. Build and Install Test
```bash
cd /home/jwscho/cv-git

# Clean build
rm -rf node_modules packages/*/node_modules packages/*/dist
pnpm install
pnpm build

# Link CLI
cd packages/cli
pnpm link --global

# Verify
cv --version
cv --help
```

### 2. Service Setup Test
```bash
# Start services
docker run -d --name falkordb-test -p 6379:6379 falkordb/falkordb
docker run -d --name qdrant-test -p 6333:6333 qdrant/qdrant

# Verify
docker ps
scripts/setup-check.sh
```

### 3. Basic Functionality Test
```bash
# Create test project
mkdir -p /tmp/test-cv-git
cd /tmp/test-cv-git
git init

# Create sample files
cat > index.ts << 'EOF'
export function hello(name: string): string {
  return `Hello, ${name}!`;
}

export function goodbye(name: string): string {
  return `Goodbye, ${name}!`;
}
EOF

# Test cv init
cv init

# Test cv sync
export ANTHROPIC_API_KEY=sk-ant-...
export OPENAI_API_KEY=sk-...
cv sync
```

### 4. Graph Commands Test
```bash
# Test graph stats
cv graph stats

# Test graph files
cv graph files

# Test graph symbols
cv graph symbols

# Test graph calls
cv graph calls hello
```

### 5. Semantic Search Test
```bash
# Test semantic search
cv find "greeting function"
cv find "function that says hello"
```

### 6. AI Commands Test
```bash
# Test explain
cv explain "hello function"

# Test do (plan only for safety)
cv do "add a greet function that takes a language parameter" --plan-only

# Test review
echo "console.log('test')" >> index.ts
git add index.ts
cv review --staged
```

---

## 📦 GitHub Preparation

### Before Pushing

#### 1. Sensitive Data Check
```bash
# Search for any accidentally committed keys
git log --all --full-history --source -- '**/*.key' '**/*.pem'

# Check current files
grep -r "sk-ant-" .
grep -r "sk-proj-" .
grep -r "sk-" . | grep -v node_modules | grep -v "\.example"
```

#### 2. Clean Repository
```bash
# Remove build artifacts
git clean -fdx

# Rebuild
pnpm install
pnpm build
```

#### 3. Git Initialization
```bash
# If not already a git repo
git init

# Add all files
git add .

# Initial commit
git commit -m "feat: initial release of CV-Git MVP

- Complete TypeScript monorepo (CLI + Core + Shared)
- FalkorDB knowledge graph integration
- Qdrant vector database with OpenAI embeddings
- Claude 3.5 Sonnet AI integration
- Commands: init, sync, find, explain, do, review, graph
- Full documentation and setup guides
"
```

#### 4. Create GitHub Repository
```bash
# Using GitHub CLI
gh repo create cv-git --public --description "AI-Native Version Control Layer with Knowledge Graph & Semantic Search"

# Or manually:
# 1. Go to github.com/new
# 2. Name: cv-git
# 3. Description: AI-Native Version Control Layer
# 4. Public
# 5. No README/License (we have them)
# 6. Create
```

#### 5. Push to GitHub
```bash
git remote add origin https://github.com/YOUR_USERNAME/cv-git.git
git branch -M main
git push -u origin main
```

---

## 🔐 Security Checklist

### Pre-Release Security Audit

- [ ] No API keys in code
- [ ] No API keys in git history
- [ ] .env in .gitignore
- [ ] .env.example has no real keys
- [ ] config.json not committed
- [ ] All credential patterns in .gitignore
- [ ] No hardcoded URLs with credentials
- [ ] No debug output with sensitive data

### API Key Best Practices in Docs

- [x] Clear instructions in SETUP.md
- [x] .env.example template
- [x] Environment variable documentation
- [x] Security warnings in .env.example
- [x] Links to get API keys

---

## 📝 Post-Release Tasks

### Immediate
- [ ] Add GitHub repository description
- [ ] Add topics/tags (typescript, ai, knowledge-graph, cli, etc.)
- [ ] Enable GitHub Discussions
- [ ] Enable GitHub Issues
- [ ] Create issue templates
- [ ] Add repository image/banner

### Short Term
- [ ] Set up GitHub Actions for CI
- [ ] Add test suite
- [ ] Create demo video
- [ ] Write blog post
- [ ] Share on social media
- [ ] Submit to awesome lists

### Medium Term
- [ ] Publish to npm
- [ ] Create documentation website
- [ ] Add code coverage
- [ ] Set up automated releases
- [ ] Create Discord/Slack community

---

## 🚀 Release Announcement Template

```markdown
# Introducing CV-Git: AI-Native Version Control 🚀

I'm excited to announce the release of CV-Git, an intelligent wrapper around Git that adds:

🧠 **Knowledge Graph** - Understand your codebase structure with FalkorDB
🔍 **Semantic Search** - Find code using natural language
🤖 **AI-Powered Tools** - Explain, generate, and review code with Claude

**Key Features:**
- `cv find` - Semantic code search
- `cv explain` - AI code explanations
- `cv do` - Generate code from descriptions
- `cv review` - AI code review
- `cv graph` - Query code relationships

**Tech Stack:**
- TypeScript monorepo
- Tree-sitter AST parsing
- FalkorDB (knowledge graph)
- Qdrant (vector search)
- Claude 3.5 Sonnet

**Get Started:**
```bash
git clone https://github.com/YOUR_USERNAME/cv-git
cd cv-git
pnpm install && pnpm build
```

Full docs: [github.com/YOUR_USERNAME/cv-git](https://github.com/YOUR_USERNAME/cv-git)

Feedback welcome! 🙌
```

---

## ✅ Final Checklist

Before announcing:

- [ ] All tests pass
- [ ] Documentation is complete
- [ ] Examples work
- [ ] Setup guide tested
- [ ] README has correct URLs
- [ ] Contributing guide is clear
- [ ] License is correct
- [ ] Repository is public
- [ ] GitHub features enabled
- [ ] CI/CD configured (optional)

---

## 🎯 Success Metrics

Track after release:
- GitHub stars
- Issues/PRs
- Downloads (when on npm)
- Community engagement
- Feature requests
- Bug reports

---

**Ready to share with the world! 🌟**
