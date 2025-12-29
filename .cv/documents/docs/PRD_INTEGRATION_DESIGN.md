# PRD Integration Design for `cv design` Command

**Status:** v1 Coded - Pending Integration Testing
**Location:** `packages/cli/src/commands/design.ts`
**Dependencies:** `@cv-git/prd-client`, cvPRD backend

---

## Overview

The `--from-prd` flag enables fetching requirements directly from cvPRD and using them to generate architecture designs. This creates a seamless requirements-to-code workflow.

## Usage

```bash
# Single requirement by ID
cv design --from-prd REQ-abc123

# Multiple requirements
cv design --from-prd "REQ-abc123,REQ-def456"

# Search by tag
cv design --from-prd "tag:authentication"

# Semantic search
cv design --from-prd "search:user login flow"

# Entire PRD document
cv design --from-prd "prd:uuid-of-prd"

# With additional context
cv design --from-prd REQ-abc123 "Focus on the API layer"
```

---

## Architecture

### Data Flow

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   cv design     │     │   PRDClient     │     │    cvPRD API    │
│   --from-prd    │────▶│   (prd-client)  │────▶│   (backend)     │
└────────┬────────┘     └────────┬────────┘     └─────────────────┘
         │                       │
         │  PRDDesignContext     │
         │◀──────────────────────┘
         │
         ▼
┌─────────────────┐     ┌─────────────────┐
│  OpenRouter AI  │────▶│  DesignSchema   │
│  (generation)   │     │  (output)       │
└─────────────────┘     └────────┬────────┘
                                 │
         ┌───────────────────────┼───────────────────────┐
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Scaffold Files │     │ Knowledge Graph │     │  Link to cvPRD  │
│  (src/*.ts)     │     │  (FalkorDB)     │     │  (traceability) │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

### Type Definitions

```typescript
/**
 * Source specification for PRD-based design
 */
interface PRDDesignSource {
  type: 'chunk' | 'search' | 'tag' | 'prd';
  ids?: string[];      // Chunk IDs (REQ-xxx, CHUNK-xxx)
  query?: string;      // Search query
  tag?: string;        // Tag filter
  prdId?: string;      // Full PRD ID
}

/**
 * Aggregated context from PRD for design generation
 */
interface PRDDesignContext {
  source: PRDDesignSource;
  requirements: Array<{
    id: string;
    text: string;
    type: string;
    priority?: string;
    status?: string;
  }>;
  constraints: string[];
  acceptanceCriteria: string[];
  dependencies: string[];
  relatedChunks: string[];
  totalTokens: number;
}
```

---

## Implementation Plan

### 1. Configuration

Add PRD settings to `cv-git.config.json`:

```json
{
  "prd": {
    "url": "http://localhost:8000",
    "apiKey": "${CVPRD_API_KEY}"
  }
}
```

Update `packages/shared/src/types/config.ts`:

```typescript
interface CVGitConfig {
  // ... existing fields
  prd?: {
    url: string;
    apiKey?: string;
  };
}
```

### 2. Functions to Implement

#### `parsePRDReference(ref: string): PRDDesignSource`
**Status:** ✅ Implemented

Parses the `--from-prd` flag value into a structured source object.

```typescript
parsePRDReference("REQ-abc123")           // → { type: 'chunk', ids: ['REQ-abc123'] }
parsePRDReference("REQ-abc,REQ-def")      // → { type: 'chunk', ids: ['REQ-abc', 'REQ-def'] }
parsePRDReference("tag:authentication")   // → { type: 'tag', tag: 'authentication' }
parsePRDReference("search:user login")    // → { type: 'search', query: 'user login' }
parsePRDReference("prd:uuid")             // → { type: 'prd', prdId: 'uuid' }
```

#### `buildPRDEnrichedPrompt(context, description?): string`
**Status:** ✅ Implemented

Builds an AI prompt enriched with requirement context.

#### `fetchPRDContext(client, source): Promise<PRDDesignContext>`
**Status:** 📋 Designed (see design.ts)

Fetches requirements from cvPRD based on the source type:

| Source Type | PRDClient Method | Notes |
|-------------|------------------|-------|
| `chunk` | `getContext(id, { strategy: 'expanded' })` | Gets dependencies |
| `search` | `search({ query, filters })` | Semantic search |
| `tag` | `findByTag(tag, limit)` | Filter by tag |
| `prd` | `getChunksForPRD(prdId)` | All chunks |

#### `linkDesignToPRD(client, context, schema, files): Promise<void>`
**Status:** 📋 Designed (see design.ts)

Links generated scaffold files back to cvPRD requirements for traceability.

### 3. Integration Points

#### In Command Action (design.ts:400-413)

```typescript
if (options.fromPrd) {
  // 1. Load PRD config
  const config = await configManager.load(repoRoot);
  if (!config.prd?.url) {
    console.error(chalk.red('PRD not configured. Add prd.url to cv-git.config.json'));
    process.exit(1);
  }

  // 2. Create client
  const client = new PRDClient({
    baseUrl: config.prd.url,
    apiKey: config.prd.apiKey || process.env.CVPRD_API_KEY
  });

  // 3. Check availability
  if (!await client.isAvailable()) {
    console.error(chalk.yellow('cvPRD not available. Falling back to description mode.'));
    // Continue without PRD context
  } else {
    // 4. Fetch context
    const source = parsePRDReference(options.fromPrd);
    const prdContext = await fetchPRDContext(client, source);

    // 5. Build enriched prompt
    designPrompt = buildPRDEnrichedPrompt(prdContext, description);

    // Store for later linking
    prdContextForLinking = prdContext;
  }
}
```

#### After Scaffold Generation

```typescript
if (prdContextForLinking && generatedFiles.length > 0) {
  const linkSpinner = ora('Linking to cvPRD...').start();
  try {
    await linkDesignToPRD(client, prdContextForLinking, designSchema, generatedFiles);
    linkSpinner.succeed('Linked to requirements');
  } catch (error) {
    linkSpinner.warn('Could not link to cvPRD');
  }
}
```

---

## PRDClient Methods Used

From `@cv-git/prd-client`:

| Method | Purpose |
|--------|---------|
| `isAvailable()` | Health check |
| `getChunk(id)` | Single requirement |
| `getContext(id, options)` | Requirement with dependencies |
| `getChunksForPRD(prdId)` | All chunks from a PRD |
| `search(request)` | Semantic search |
| `findByTag(tag, limit)` | Filter by tag |
| `linkImplementation(id, data)` | Link code to requirement |
| `PRDClient.formatContextForPrompt(ctx)` | Format for AI |

---

## Output Enhancements

### Design Display with Traceability

```
## Design: User Authentication System

Based on Requirements:
  • REQ-abc123: Users shall authenticate via OAuth2 [critical]
  • REQ-def456: System shall support SSO [high]

Constraints:
  ⚠ Must comply with GDPR data protection requirements
  ⚠ Session timeout must be configurable

### Modules

  auth/ - Authentication module
    ↳ Implements: REQ-abc123, REQ-def456

  session/ - Session management
    ↳ Implements: REQ-def456

### Summary

  3 modules, 5 types, 8 functions
  Covers 2 requirements, 2 constraints
```

---

## Error Handling

| Scenario | Behavior |
|----------|----------|
| cvPRD unavailable | Warn, fall back to description-only mode |
| Chunk not found | List available chunks, suggest search |
| No requirements match | Suggest broader search |
| Network timeout | Retry once, then fall back |
| Invalid reference format | Show usage examples |

---

## Testing Plan

### Unit Tests

```typescript
describe('parsePRDReference', () => {
  it('parses single chunk ID', () => {
    expect(parsePRDReference('REQ-abc')).toEqual({
      type: 'chunk',
      ids: ['REQ-abc']
    });
  });

  it('parses tag search', () => {
    expect(parsePRDReference('tag:auth')).toEqual({
      type: 'tag',
      tag: 'auth'
    });
  });

  // ... more tests
});
```

### Integration Tests

1. Mock cvPRD API responses
2. Test full flow from `--from-prd` to scaffold generation
3. Verify requirement linking

### E2E Tests

1. Start cvPRD backend
2. Create test PRD with requirements
3. Run `cv design --from-prd REQ-xxx`
4. Verify generated files
5. Verify requirement status updated in cvPRD

---

## Implementation Checklist

- [x] Add `prd` config section to config schema (cvprd in shared/types.ts)
- [x] Uncomment PRDClient import in design.ts
- [x] Implement `fetchPRDContext()` function
- [x] Implement `linkDesignToPRD()` function
- [x] Implement `displayDesignWithPRDContext()` function
- [x] Wire up the flow in command action
- [x] Add error handling for cvPRD unavailability
- [x] Update help text with PRD examples
- [ ] Write unit tests
- [ ] Write integration tests with cvPRD backend
- [ ] Update CLI documentation

## Known Issues / TODOs

- **Port handling:** cvPRD backend port configuration needs to be addressed (issue on cvPRD side)
- **Integration testing:** Need end-to-end testing with running cvPRD instance
- **Commit SHA linking:** Currently uses 'scaffold' placeholder; should link actual commit after files are committed

---

## Related Files

| File | Purpose |
|------|---------|
| `packages/cli/src/commands/design.ts` | Main implementation |
| `packages/prd-client/src/client.ts` | PRDClient class |
| `packages/prd-client/src/types.ts` | Type definitions |
| `packages/shared/src/types/config.ts` | Config schema |
| `/home/jwscho/cvPRD/API_SPEC.md` | cvPRD API reference |

---

## Timeline

| Phase | Tasks | Estimate |
|-------|-------|----------|
| 1 | Config schema + client setup | 1 hour |
| 2 | Implement fetchPRDContext | 2 hours |
| 3 | Implement linkDesignToPRD | 1 hour |
| 4 | Wire up flow + error handling | 2 hours |
| 5 | Testing + documentation | 2 hours |
| **Total** | | **~8 hours** |
