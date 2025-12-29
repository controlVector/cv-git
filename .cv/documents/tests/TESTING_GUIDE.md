# CV-Git Testing Guide

## Overview

CV-Git uses a comprehensive testing strategy with integration tests and unit tests.

## Test Structure

```
tests/
├── integration/          # Integration tests (test component interactions)
│   ├── credential-manager.test.mjs
│   ├── platform-adapter.test.mjs
│   └── ...
├── unit/                # Unit tests (test individual functions)
│   ├── example.test.ts
│   └── ...
├── fixtures/            # Test data and mock files
├── run-all.mjs          # Integration test runner
└── README.md            # Test suite overview
```

## Running Tests

### All Tests
```bash
npm test
```

### Integration Tests Only
```bash
npm run test:integration
```

### Unit Tests Only
```bash
npm run test:unit
```

### Watch Mode (for development)
```bash
npm run test:watch
```

### Test Coverage
```bash
npm run test:coverage
```

## Current Test Coverage

### Integration Tests (20 tests)
✅ **Credential Management** (12 tests)
- Initialize credential manager
- Store/retrieve/delete credentials
- Multiple credential types (GitHub, Anthropic, OpenAI)
- Convenience methods
- Update functionality

✅ **Platform Adapter** (8 tests)
- Platform detection from Git URLs
- GitHub adapter creation
- Platform factory pattern
- API/Web URL resolution
- Error handling for unknown platforms

### Unit Tests
✅ **Example Tests** (10 tests)
- Basic assertions
- Async operations
- Object comparisons
- Error handling

## Writing Integration Tests

Integration tests verify that multiple components work together correctly.

### Example: Testing Credential + Platform Integration

```javascript
import { CredentialManager } from '../../packages/credentials/dist/index.js';
import { GitHubAdapter } from '../../packages/platform/dist/index.js';

async function testIntegration() {
  // Setup
  const credentials = new CredentialManager();
  await credentials.init();

  // Store a test credential
  await credentials.store({
    type: CredentialType.GIT_PLATFORM_TOKEN,
    name: 'test',
    platform: GitPlatform.GITHUB,
    token: 'ghp_test123',
    scopes: ['repo']
  });

  // Create adapter with credentials
  const adapter = new GitHubAdapter(credentials);

  // Verify adapter can access credentials
  // ... test assertions

  // Cleanup
  await credentials.delete(CredentialType.GIT_PLATFORM_TOKEN, 'test');
}
```

### Integration Test Template

```javascript
#!/usr/bin/env node

import { /* imports */ } from '../../packages/.../dist/index.js';

async function runTests() {
  console.log('🧪 Testing [Feature Name]\n');

  try {
    let testCount = 0;
    let passedCount = 0;

    // Test 1
    testCount++;
    console.log('Test 1: [Description]');
    // ... test code
    if (/* assertion */) {
      console.log('✅ PASS\n');
      passedCount++;
    } else {
      console.log('❌ FAIL\n');
    }

    // More tests...

    return {
      success: passedCount === testCount,
      testsRun: testCount,
      testsPassed: passedCount,
    };

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    return {
      success: false,
      error: error.message,
    };
  }
}

runTests().then(result => {
  process.exit(result.success ? 0 : 1);
});
```

## Writing Unit Tests

Unit tests verify individual functions in isolation using Vitest.

### Example: Testing a Utility Function

```typescript
import { describe, it, expect } from 'vitest';
import { myFunction } from '@cv-git/shared';

describe('myFunction', () => {
  it('should handle valid input', () => {
    const result = myFunction('input');
    expect(result).toBe('expected');
  });

  it('should throw on invalid input', () => {
    expect(() => myFunction(null)).toThrow();
  });

  it('should handle edge cases', () => {
    expect(myFunction('')).toBe('');
    expect(myFunction('a')).toBe('a');
  });
});
```

### Vitest Features

**Assertions:**
```typescript
expect(value).toBe(expected)           // strict equality
expect(value).toEqual(expected)        // deep equality
expect(value).toBeTruthy()             // truthy check
expect(value).toContain(item)          // array/string contains
expect(value).toHaveLength(n)          // length check
expect(value).toHaveProperty('key')    // object property
expect(() => fn()).toThrow()           // error thrown
```

**Async Testing:**
```typescript
it('async test', async () => {
  const result = await asyncFunction();
  expect(result).toBe('value');
});
```

**Mocking:**
```typescript
import { vi } from 'vitest';

it('mocking example', () => {
  const mock = vi.fn(() => 'mocked');
  expect(mock()).toBe('mocked');
  expect(mock).toHaveBeenCalled();
});
```

## Test Naming Conventions

### Integration Tests
- File: `[component-name].test.mjs`
- Format: ES modules (.mjs)
- Location: `tests/integration/`

### Unit Tests
- File: `[component-name].test.ts`
- Format: TypeScript
- Location: `tests/unit/` or co-located with source in `packages/*/src/`

### Test Descriptions
```typescript
describe('[Component/Feature Name]', () => {
  describe('[Specific functionality]', () => {
    it('should [expected behavior]', () => {
      // test
    });
  });
});
```

## CI/CD Integration

Tests run automatically on:
- Pull requests
- Commits to main branch
- Release builds

GitHub Actions workflow: `.github/workflows/test.yml`

## Test Data and Fixtures

### Test Credentials
- Never use real credentials
- Use clearly labeled test tokens: `ghp_test_...`, `sk-ant-test...`
- Clean up after tests

### Test Repositories
- Use temporary directories
- Clean up after tests
- Use isolated test data

## Debugging Tests

### Run Specific Test
```bash
# Integration test
node tests/integration/credential-manager.test.mjs

# Unit test
npx vitest run tests/unit/example.test.ts
```

### Debug Output
```bash
# Verbose mode
DEBUG=* node tests/integration/[test-name].test.mjs

# Vitest debug
npx vitest --reporter=verbose
```

### VSCode Debugging
Add to `.vscode/launch.json`:
```json
{
  "type": "node",
  "request": "launch",
  "name": "Debug Test",
  "program": "${workspaceFolder}/tests/integration/${fileBasenameNoExtension}.mjs",
  "console": "integratedTerminal"
}
```

## Adding New Tests

1. **Choose test type:**
   - Integration: Multiple components working together
   - Unit: Single function/class in isolation

2. **Create test file:**
   ```bash
   # Integration test
   touch tests/integration/my-feature.test.mjs

   # Unit test
   touch tests/unit/my-feature.test.ts
   ```

3. **Write tests** following templates above

4. **Run tests:**
   ```bash
   npm test
   ```

5. **Update documentation:**
   - Add to TEST_RESULTS.md
   - Update this guide if needed

## Best Practices

### DO
✅ Test one thing per test
✅ Use descriptive test names
✅ Clean up after tests
✅ Test error cases
✅ Test edge cases
✅ Use fixtures for complex data
✅ Keep tests fast
✅ Make tests independent

### DON'T
❌ Use real credentials/API keys
❌ Depend on external services (mock them)
❌ Share state between tests
❌ Test implementation details
❌ Write flaky tests
❌ Skip cleanup
❌ Test third-party code

## Coverage Goals

- **Core functionality:** 80%+ coverage
- **Critical paths:** 100% coverage
- **Utilities:** 90%+ coverage
- **CLI commands:** Integration tests for all

## Getting Help

- Check existing tests for examples
- Read [Vitest documentation](https://vitest.dev/)
- Review TEST_RESULTS.md for manual test results
- Ask in GitHub Discussions

---

**Last Updated:** 2025-11-17
**Version:** 0.2.0
