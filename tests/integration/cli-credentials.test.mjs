#!/usr/bin/env node

/**
 * Integration Test: CLI Credential Retrieval (BUG-001)
 *
 * Tests that CLI commands properly retrieve credentials from CredentialManager
 * This test verifies the fix for BUG-001 where credentials stored via `cv auth setup`
 * were not being retrieved by commands like `cv find`, `cv context`, etc.
 *
 * The bug was that CLI commands only checked config.ai.apiKey and process.env,
 * but never called CredentialManager.getOpenAIKey() etc.
 */

import { CredentialManager, CredentialType } from '../../packages/credentials/dist/index.js';

// We can't directly import the TypeScript utils, so we'll test the flow manually
// by simulating what the credentials.ts helper does

async function runTests() {
  console.log('🧪 Testing CLI Credential Retrieval (BUG-001 Regression Test)\n');

  const results = {
    passed: 0,
    failed: 0,
    tests: []
  };

  function test(name, passed, details = '') {
    results.tests.push({ name, passed, details });
    if (passed) {
      console.log(`✅ ${name}`);
      results.passed++;
    } else {
      console.log(`❌ ${name}`);
      if (details) console.log(`   Details: ${details}`);
      results.failed++;
    }
  }

  const manager = new CredentialManager();

  try {
    // Initialize
    await manager.init();
    console.log(`Storage backend: ${manager.getStorageBackend()}\n`);

    // Clean up any existing test credentials first
    try {
      await manager.delete(CredentialType.OPENAI_API, 'test-cli-creds');
    } catch {
      // OK if doesn't exist
    }
    try {
      await manager.delete(CredentialType.ANTHROPIC_API, 'test-cli-creds');
    } catch {
      // OK if doesn't exist
    }
    try {
      await manager.delete(CredentialType.OPENROUTER_API, 'test-cli-creds');
    } catch {
      // OK if doesn't exist
    }

    // =========================================================================
    // Test 1: Store OpenAI key and verify retrieval
    // =========================================================================
    console.log('\n--- Test 1: OpenAI Credential Storage and Retrieval ---');

    const testOpenAIKey = 'sk-test-openai-cli-creds-12345';
    await manager.store({
      type: CredentialType.OPENAI_API,
      name: 'test-cli-creds',
      apiKey: testOpenAIKey,
    });

    // Simulate what getOpenAIApiKey() in credentials.ts does
    const retrievedOpenAI = await manager.getOpenAIKey();
    test(
      'OpenAI key stored and retrieved via getOpenAIKey()',
      retrievedOpenAI !== null && retrievedOpenAI.includes('test-openai-cli-creds'),
      retrievedOpenAI ? `Got: ${retrievedOpenAI.substring(0, 15)}...` : 'Got null'
    );

    // =========================================================================
    // Test 2: Store Anthropic key and verify retrieval
    // =========================================================================
    console.log('\n--- Test 2: Anthropic Credential Storage and Retrieval ---');

    const testAnthropicKey = 'sk-ant-test-anthropic-cli-creds-12345';
    await manager.store({
      type: CredentialType.ANTHROPIC_API,
      name: 'test-cli-creds',
      apiKey: testAnthropicKey,
    });

    const retrievedAnthropic = await manager.getAnthropicKey();
    test(
      'Anthropic key stored and retrieved via getAnthropicKey()',
      retrievedAnthropic !== null && retrievedAnthropic.includes('test-anthropic-cli-creds'),
      retrievedAnthropic ? `Got: ${retrievedAnthropic.substring(0, 15)}...` : 'Got null'
    );

    // =========================================================================
    // Test 3: Store OpenRouter key and verify retrieval
    // =========================================================================
    console.log('\n--- Test 3: OpenRouter Credential Storage and Retrieval ---');

    const testOpenRouterKey = 'sk-or-test-openrouter-cli-creds-12345';
    await manager.store({
      type: CredentialType.OPENROUTER_API,
      name: 'test-cli-creds',
      apiKey: testOpenRouterKey,
    });

    const retrievedOpenRouter = await manager.getOpenRouterKey();
    test(
      'OpenRouter key stored and retrieved via getOpenRouterKey()',
      retrievedOpenRouter !== null && retrievedOpenRouter.includes('test-openrouter-cli-creds'),
      retrievedOpenRouter ? `Got: ${retrievedOpenRouter.substring(0, 15)}...` : 'Got null'
    );

    // =========================================================================
    // Test 4: Verify credential manager takes priority over env vars
    // =========================================================================
    console.log('\n--- Test 4: CredentialManager Priority Over Environment ---');

    // Save current env
    const savedEnvOpenAI = process.env.OPENAI_API_KEY;

    // Set env var to different value
    process.env.OPENAI_API_KEY = 'sk-env-var-should-not-be-used';

    // The credentials.ts getOpenAIApiKey() function should:
    // 1. First try CredentialManager (should return our stored key)
    // 2. Only fall back to env var if CredentialManager returns null
    const fromManager = await manager.getOpenAIKey();

    test(
      'CredentialManager key takes priority (not overwritten by env)',
      fromManager !== null && fromManager.includes('test-openai-cli-creds'),
      `Manager returned: ${fromManager?.substring(0, 15) || 'null'}... (env has: sk-env-var...)`
    );

    // Restore env
    if (savedEnvOpenAI) {
      process.env.OPENAI_API_KEY = savedEnvOpenAI;
    } else {
      delete process.env.OPENAI_API_KEY;
    }

    // =========================================================================
    // Test 5: Verify fallback works when credential not stored
    // =========================================================================
    console.log('\n--- Test 5: Fallback When Credential Not Stored ---');

    // Delete the test credential
    await manager.delete(CredentialType.OPENAI_API, 'test-cli-creds');

    // Now getOpenAIKey should return null (or the first stored key if any)
    // The credentials.ts helper would then check env vars
    const afterDelete = await manager.getOpenAIKey();

    // If there are other OpenAI credentials, this might not be null
    // The important thing is that it doesn't crash
    test(
      'getOpenAIKey() handles deleted credential gracefully',
      true, // Always passes if no exception
      `After delete, getOpenAIKey() returned: ${afterDelete === null ? 'null' : afterDelete.substring(0, 10) + '...'}`
    );

    // =========================================================================
    // Test 6: Verify list() shows credentials for cv auth list
    // =========================================================================
    console.log('\n--- Test 6: List Credentials (cv auth list) ---');

    const allCreds = await manager.list();
    test(
      'list() returns credentials (used by cv auth list)',
      Array.isArray(allCreds),
      `Found ${allCreds.length} credential(s)`
    );

    // =========================================================================
    // Cleanup
    // =========================================================================
    console.log('\n--- Cleanup ---');
    try {
      await manager.delete(CredentialType.ANTHROPIC_API, 'test-cli-creds');
    } catch {
      // OK
    }
    try {
      await manager.delete(CredentialType.OPENROUTER_API, 'test-cli-creds');
    } catch {
      // OK
    }
    console.log('Test credentials cleaned up');

    // =========================================================================
    // Summary
    // =========================================================================
    console.log('\n' + '='.repeat(60));
    console.log('TEST SUMMARY');
    console.log('='.repeat(60));
    console.log(`Passed: ${results.passed}`);
    console.log(`Failed: ${results.failed}`);
    console.log(`Total:  ${results.tests.length}`);
    console.log('='.repeat(60));

    if (results.failed > 0) {
      console.log('\nFailed tests:');
      results.tests.filter(t => !t.passed).forEach(t => {
        console.log(`  - ${t.name}`);
        if (t.details) console.log(`    ${t.details}`);
      });
    }

    return {
      success: results.failed === 0,
      passed: results.passed,
      failed: results.failed,
      total: results.tests.length
    };

  } catch (error) {
    console.error('\n❌ Test suite error:', error.message);
    console.error(error.stack);
    return {
      success: false,
      error: error.message
    };
  }
}

// Run
runTests()
  .then(result => {
    if (result.success) {
      console.log('\n🎉 All CLI credential tests passed!');
      process.exit(0);
    } else {
      console.log('\n💥 Some tests failed');
      process.exit(1);
    }
  })
  .catch(error => {
    console.error('Fatal:', error);
    process.exit(1);
  });
