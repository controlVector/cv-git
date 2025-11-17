# CV-Git Installation Options

## Current State: Development Requires pnpm

**Why?** The project uses a **monorepo** with multiple packages that depend on each other:
- `@cv-git/cli` depends on `@cv-git/credentials`, `@cv-git/platform`, `@cv-git/core`
- Internal dependencies use `workspace:*` protocol (pnpm-specific)

---

## Option 1: Use pnpm (Current Approach) ✅

**For developers/contributors working on CV-Git itself**

### Install pnpm
```bash
npm install -g pnpm
```

### Build and develop
```bash
cd cv-git
pnpm install
pnpm build
pnpm link --global
```

**Pros:**
- ✅ Fast, efficient package manager
- ✅ Handles monorepo dependencies perfectly
- ✅ One command (`pnpm install`)

**Cons:**
- ❌ Users need to install pnpm first

---

## Option 2: Publish to npm (Recommended for End Users) 🚀

**For users who just want to USE CV-Git**

This is the standard approach for distributing CLI tools. Users won't need pnpm!

### What we'd do:
1. Build packages locally with pnpm
2. Publish to npm registry:
   ```bash
   npm publish @cv-git/credentials
   npm publish @cv-git/platform
   npm publish @cv-git/cli
   ```

### Users install with:
```bash
npm install -g @cv-git/cli
```

**Pros:**
- ✅ Users don't need pnpm
- ✅ Standard npm workflow
- ✅ Easy installation
- ✅ Automatic updates via npm

**Cons:**
- ⚠️ Need to publish to npm (requires npm account)
- ⚠️ Need versioning strategy
- ⚠️ Build step before publishing

### Implementation Plan:
We can add this to the build process:

```json
// packages/cli/package.json
{
  "scripts": {
    "prepublishOnly": "pnpm build"
  }
}
```

Then publish:
```bash
cd packages/cli
npm publish --access public
```

---

## Option 3: Convert to npm Workspaces (Alternative)

**Make the monorepo work with npm instead of pnpm**

### Changes needed:
1. Remove `pnpm-workspace.yaml`
2. Change `workspace:*` to actual version numbers in package.json
3. Use npm workspaces instead

### package.json changes:
```json
// Instead of:
"@cv-git/credentials": "workspace:*"

// Use:
"@cv-git/credentials": "^0.2.0"
```

**Pros:**
- ✅ Works with npm
- ✅ No pnpm requirement

**Cons:**
- ❌ Need to update version numbers manually
- ❌ npm workspaces are slower than pnpm
- ❌ More complex dependency management

---

## Option 4: Single Package Bundle (Simplest)

**Combine everything into one package**

Merge all packages into a single npm package:
```
cv-git/
├── src/
│   ├── credentials/
│   ├── platform/
│   ├── core/
│   ├── cli/
│   └── index.ts
└── package.json (one file!)
```

**Pros:**
- ✅ Simplest installation: `npm install -g cv-git`
- ✅ No monorepo complexity
- ✅ Works with npm, yarn, pnpm

**Cons:**
- ❌ Loses modular architecture
- ❌ Can't publish packages separately
- ❌ Harder to maintain

---

## Recommendation

### For Now (v0.2.0):
**Keep pnpm for development** - It's the best tool for monorepos

**Add installation instructions:**
```markdown
# For Developers (working on CV-Git):
npm install -g pnpm
cd cv-git
pnpm install && pnpm build

# For End Users (coming soon):
npm install -g @cv-git/cli
```

### For v0.3.0 (Next Release):
**Publish to npm** - Let users install without pnpm:

1. Set up npm publishing workflow
2. Add prepublish build scripts
3. Publish packages to npm registry
4. Users just: `npm install -g @cv-git/cli`

This way:
- **Developers** use pnpm (best for development)
- **Users** use npm (don't need pnpm at all!)

---

## Quick Start Guide for Each Approach

### If you have pnpm (developers):
```bash
# Install pnpm (one time)
npm install -g pnpm

# Clone and build
git clone https://github.com/controlVector/cv-git.git
cd cv-git
pnpm install
pnpm build
cd packages/cli
pnpm link --global

# Use cv
cv --help
```

### If you only have npm (future, after publishing):
```bash
# Install globally (once we publish to npm)
npm install -g @cv-git/cli

# Use cv
cv --help
```

### For testing locally with npm (workaround):
```bash
# Build each package individually
cd packages/shared && npm run build
cd ../credentials && npm install && npm run build
cd ../platform && npm install && npm run build
cd ../core && npm install && npm run build
cd ../cli && npm install && npm run build
npm link

# Use cv
cv --help
```

---

## What Should We Do Right Now?

### Short Term (Today):
1. ✅ Keep pnpm for development (already set up)
2. ✅ Document pnpm installation in README
3. ✅ Add `pnpm-workspace.yaml` (done!)

### Medium Term (Before public release):
1. [ ] Set up npm publishing workflow
2. [ ] Add prepublish build scripts
3. [ ] Test publishing to npm
4. [ ] Update README with both installation methods

### Long Term (Future):
1. [ ] Consider GitHub Actions for automated publishing
2. [ ] Semantic versioning automation
3. [ ] Changelog generation

---

## The Bottom Line

**For development:** pnpm is required (but easy to install: `npm install -g pnpm`)

**For users:** We'll publish to npm so they can just `npm install -g @cv-git/cli`

**Best of both worlds:**
- Developers get the best monorepo experience (pnpm)
- Users get the simplest installation (npm)

---

## Let's Test with pnpm Now!

Now that pnpm is installed, let's build the project:

```bash
cd /home/jwscho/cv-git
pnpm install
pnpm build
```

This will:
1. Install all dependencies
2. Build all packages in order
3. Link internal dependencies
4. Create distributable files

Ready? 🚀
