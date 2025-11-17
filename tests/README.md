# CV-Git Test Suite

## Structure

```
tests/
├── unit/           # Unit tests for individual components
├── integration/    # Integration tests for component interactions
├── e2e/           # End-to-end tests for full workflows
└── fixtures/      # Test data and fixtures
```

## Running Tests

### All Tests
```bash
npm test
```

### Specific Test Suite
```bash
# Integration tests
npm run test:integration

# Unit tests
npm run test:unit

# E2E tests
npm run test:e2e
```

### Individual Test File
```bash
node tests/integration/credential-manager.test.mjs
```

## Test Coverage

Run test coverage report:
```bash
npm run test:coverage
```

## Writing Tests

### Integration Tests
Test how components work together:
- Credential manager + storage backends
- Platform adapter + credentials
- CLI commands + core services

### Unit Tests
Test individual functions and classes:
- Parser functions
- Graph queries
- Utility functions

### E2E Tests
Test complete user workflows:
- Initialize repo → sync → query graph
- Setup credentials → create PR
- Full AI-assisted commit workflow

## Test Results

See [TEST_RESULTS.md](../TEST_RESULTS.md) for manual testing documentation.
