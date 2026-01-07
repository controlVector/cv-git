# CV-Hub Testing, Bugs, Errata & Next Steps

**Last Updated:** 2026-01-06
**Status:** Active Development

---

## Current Status Summary

### What's Working
- User registration and login (email/password)
- JWT authentication with refresh tokens
- App Store with public browsing
- App downloads from DigitalOcean Spaces (self-hosted)
- Download tracking and analytics
- GitHub OAuth for account linking
- Organization creation and management
- Repository code browsing (files, commits, blame)

### What's Partially Working
- Repository list (API exists, UI partially wired)
- GitHub repo sync (OAuth connected, import not fully tested)

### What's Not Working / Mock Data
- Dashboard stats (hardcoded)
- Pull Requests (mock data, no backend)
- Knowledge Graph (mock data, no FalkorDB)
- Semantic Search (mock data, no Qdrant)
- AI Assistant (mock responses, no LLM integration)

---

## Bugs & Issues Found

### Critical

#### 1. API URL Routing Confusion
**Issue:** Frontend used relative `/api/v1/*` paths but API is on separate subdomain.
**Fix Applied:** Updated to use `API_BASE_URL` from `VITE_API_URL` env var.
**Files Changed:**
- `apps/web/src/lib/api.ts` - Export `API_BASE_URL`
- `apps/web/src/components/DownloadButton.tsx` - Use full API URL
- `apps/web/src/pages/apps/AppDetail.tsx` - Use full API URL

#### 2. GitHub OAuth Redirect Wrong Path
**Issue:** Callback redirected to `/settings/connections` instead of `/dashboard/settings/connections`.
**Fix Applied:** Updated all redirect URLs in `github-oauth.ts`.
**Files Changed:**
- `apps/api/src/routes/github-oauth.ts`

#### 3. Download Blank Page (Firefox)
**Issue:** Redirecting to GitHub releases caused blank page in Firefox.
**Fix Applied:** Stream files from S3 instead of redirect.
**Files Changed:**
- `apps/api/src/routes/app-store.ts` - Stream from storage if S3 configured

### Medium

#### 4. TypeScript Buffer/Uint8Array Mismatch
**Issue:** `Buffer` not assignable to `BodyInit` in Response constructor.
**Fix Applied:** Wrap with `new Uint8Array(buffer)`.
**Location:** `apps/api/src/routes/app-store.ts:224`

#### 5. Download Tracking Missing Context
**Issue:** Downloads tracked but without IP/User-Agent metadata.
**Fix Applied:** Pass request context to `getAssetForDownload()`.
**Location:** `apps/api/src/routes/app-store.ts:194-200`

### Low / Cosmetic

#### 6. Missing Routes
- `/repositories/new` - No component
- `/pull-requests/new` - No component
- `/pull-requests/:id` - No component
- `/repositories/:owner/:repo/graph` - No route
- `/repositories/:owner/:repo/settings` - No route

#### 7. Stubbed Functions (Console.log Only)
- `handleSyncGraph()` in RepositoryDetail.tsx
- Context menu actions in Repositories.tsx
- Graph toolbar buttons in KnowledgeGraph.tsx

---

## Testing Results

### Authentication Flow
| Test | Status | Notes |
|------|--------|-------|
| Register new user | PASS | Email verification optional |
| Login with email/password | PASS | |
| JWT token refresh | PASS | |
| Logout | PASS | |
| Password reset | NOT TESTED | Email service not configured |

### App Store
| Test | Status | Notes |
|------|--------|-------|
| Browse apps (public) | PASS | No auth required |
| View app details | PASS | |
| Download (Linux) | PASS | Streams from Spaces |
| Download (macOS) | PASS | Falls back to GitHub redirect |
| Download (Windows) | PASS | Falls back to GitHub redirect |
| Download tracking | PASS | Count increments correctly |

### GitHub Integration
| Test | Status | Notes |
|------|--------|-------|
| OAuth flow start | PASS | Redirects to GitHub |
| OAuth callback | PASS | After fixing redirect path |
| View connection status | PASS | |
| List user repos | NOT TESTED | Need connected account |
| Disconnect | NOT TESTED | |

### Repository Browsing
| Test | Status | Notes |
|------|--------|-------|
| File tree | PASS | |
| File content view | PASS | |
| Commit history | PASS | |
| Commit detail | PASS | |
| Blame view | PASS | |
| Branch switching | PARTIAL | UI exists, limited testing |

---

## Errata & Gotchas

### Infrastructure

1. **API subdomain required** - API must be on `api.hub.controlvector.io`, not path-based routing on main domain. Ingress routes by host, not path prefix.

2. **VITE_API_URL includes /api** - The env var is `https://api.hub.controlvector.io/api` (with trailing `/api`), so code should use `${API_BASE_URL}/v1/...` not `${API_BASE_URL}/api/v1/...`.

3. **S3 file keys must match exactly** - Storage key is `releases/{appId}/{version}/{fileName}`. The `fileName` must match what's in the database `release_assets.file_name` column exactly (case-sensitive).

4. **Monorepo Docker builds** - Use `Dockerfile.api` and `Dockerfile.web` from repo root, NOT the Dockerfiles in app directories (those are for standalone builds).

5. **Spaces public access** - Files need `x-amz-acl: public-read` header on upload to be publicly accessible. The upload script handles this.

### Database

1. **Table names** - Tables are `apps`, `releases`, `release_assets` (not `app_releases`, `app_release_assets`).

2. **UUID columns** - All IDs are UUIDs, not integers. `apps.id` is a string like `cv-git`, not UUID (special case).

3. **Download counts in multiple places** - Count is tracked in:
   - `apps.total_downloads`
   - `releases.download_count`
   - `release_assets.download_count`
   - `download_events` table (detailed analytics)

### Frontend

1. **SPA routing** - Nginx must redirect all 404s to index.html for React Router to work. This is configured in `nginx.conf`.

2. **Hard refresh needed after deploy** - Browser may cache old JS bundle. Users need Ctrl+Shift+R after deployments.

3. **Mock data locations** - Search for `mock` in codebase to find all hardcoded data:
   - Dashboard.tsx: stats, recentRepos, aiInsights
   - PullRequests.tsx: mockPRs
   - KnowledgeGraph.tsx: mockNodes, mockEdges
   - Search.tsx: mockResults
   - AIAssistant.tsx: mockMessages

---

## Next Steps

### Immediate (Ready to Do)

1. **Import controlvector repos from GitHub**
   - GitHub OAuth is configured and working
   - Need to test actual repo import flow
   - Sync releases from GitHub to cv-hub

2. **Wire Repositories.tsx to real API**
   - API exists at `GET /api/v1/repos`
   - Just need to replace mock data with useQuery
   - ~30 minutes of work

3. **Wire Dashboard stats**
   - Create aggregation endpoint
   - Replace hardcoded numbers
   - ~2 hours of work

### Short Term (This Week)

4. **Test full GitHub OAuth flow**
   - Connect account
   - List repos
   - Import a repo
   - Verify sync works

5. **Add more release assets to Spaces**
   - Currently only Linux .deb for cv-git
   - Upload Windows/macOS builds when available
   - cv-prd has AppImage uploaded

6. **Create `/repositories/new` page**
   - Decide on user vs org ownership model
   - Allow creating empty repos
   - Allow importing from GitHub

### Medium Term (This Month)

7. **Sprint 3: Graph Infrastructure**
   - Set up FalkorDB
   - Set up Qdrant
   - Build graph sync worker
   - This unblocks: Knowledge Graph, Search, AI Assistant

8. **Sprint 7: Pull Request Service**
   - PR database tables exist
   - Build service layer (create, list, review, merge)
   - Wire up UI

9. **Email Service**
   - Configure SMTP or email provider
   - Enable password reset flow
   - Enable email verification

### Long Term

10. **AI Features**
    - LLM integration (OpenRouter/Anthropic)
    - Code review suggestions
    - Commit message generation
    - RAG with graph/vector context

11. **CI/CD Integration**
    - GitHub Actions integration
    - Build status badges
    - Automated deployments

---

## Session Log (2026-01-06)

### Accomplished
1. Set up DigitalOcean Spaces for file storage
2. Created S3-compatible storage service
3. Uploaded cv-git and cv-prd releases to Spaces
4. Fixed download endpoint to stream from S3
5. Fixed frontend API URL configuration
6. Added download tracking with request context
7. Rebuilt and deployed web frontend
8. Rebuilt and deployed API
9. Created this documentation

### Credentials Created
- DigitalOcean Spaces access key
- GitHub OAuth app for user linking

### Files Modified
- `apps/api/src/routes/app-store.ts` - S3 streaming, tracking context
- `apps/api/src/routes/github-oauth.ts` - Fixed redirect URLs
- `apps/api/src/services/storage.service.ts` - S3 provider
- `apps/api/src/config/env.ts` - S3 and GitHub OAuth config
- `apps/web/src/lib/api.ts` - Export API_BASE_URL
- `apps/web/src/components/DownloadButton.tsx` - Use API_BASE_URL
- `apps/web/src/pages/apps/AppDetail.tsx` - Use API_BASE_URL
- `apps/web/src/pages/settings/ConnectionsPage.tsx` - GitHub connect UI
- `Dockerfile.web` - VITE_API_URL build arg

### Files Created
- `apps/api/scripts/upload-to-spaces.ts` - S3 upload utility
- `apps/api/src/db/schema/user-connections.ts` - OAuth tokens schema
- `apps/api/src/services/github-oauth.service.ts` - OAuth service
