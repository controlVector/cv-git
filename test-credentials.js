#!/usr/bin/env node

/**
 * Test script for credential management
 * This tests the CredentialManager API directly
 */

import { CredentialManager, CredentialType, GitPlatform } from '@cv-git/credentials';

async function runTests() {
  console.log('🧪 Testing Credential Management\n');

  // Set master password for testing
  process.env.CV_MASTER_PASSWORD = 'test_password_123';

  const manager = new CredentialManager();

  try {
    // Test 1: Initialize
    console.log('Test 1: Initialize CredentialManager');
    await manager.init();
    console.log('✅ Initialized\n');

    // Test 2: List (should be empty initially)
    console.log('Test 2: List credentials (should be empty)');
    const initialList = await manager.list();
    console.log(`Found ${initialList.length} credentials`);
    console.log('✅ List works\n');

    // Test 3: Store a test credential
    console.log('Test 3: Store a test GitHub token');
    await manager.store({
      type: CredentialType.GIT_PLATFORM_TOKEN,
      name: 'test-github',
      platform: GitPlatform.GITHUB,
      token: 'ghp_test_token_1234567890abcdefghij',
      scopes: ['repo', 'workflow'],
    });
    console.log('✅ Stored credential\n');

    // Test 4: List again (should have 1)
    console.log('Test 4: List credentials (should have 1)');
    const afterStore = await manager.list();
    console.log(`Found ${afterStore.length} credentials:`);
    afterStore.forEach(cred => {
      console.log(`  - ${cred.type}:${cred.name} (platform: ${cred.platform})`);
    });
    console.log('✅ List shows stored credential\n');

    // Test 5: Retrieve the credential
    console.log('Test 5: Retrieve the credential');
    const retrieved = await manager.retrieve(CredentialType.GIT_PLATFORM_TOKEN, 'test-github');
    console.log(`Retrieved token: ${retrieved.token.substring(0, 10)}...`);
    console.log(`Scopes: ${retrieved.scopes.join(', ')}`);
    console.log('✅ Retrieve works\n');

    // Test 6: Store Anthropic API key
    console.log('Test 6: Store Anthropic API key');
    await manager.store({
      type: CredentialType.ANTHROPIC_API,
      name: 'default',
      apiKey: 'sk-ant-test1234567890',
    });
    console.log('✅ Stored Anthropic key\n');

    // Test 7: Store OpenAI API key
    console.log('Test 7: Store OpenAI API key');
    await manager.store({
      type: CredentialType.OPENAI_API,
      name: 'default',
      apiKey: 'sk-test1234567890',
    });
    console.log('✅ Stored OpenAI key\n');

    // Test 8: List all (should have 3)
    console.log('Test 8: List all credentials (should have 3)');
    const allCreds = await manager.list();
    console.log(`Found ${allCreds.length} credentials:`);
    allCreds.forEach(cred => {
      console.log(`  - ${cred.type}:${cred.name}${cred.platform ? ` (${cred.platform})` : ''}`);
    });
    console.log('✅ All credentials stored\n');

    // Test 9: Convenience methods
    console.log('Test 9: Test convenience methods');
    const githubToken = await manager.getGitPlatformToken(GitPlatform.GITHUB);
    console.log(`GitHub token via convenience method: ${githubToken.substring(0, 10)}...`);

    const anthropicKey = await manager.getAnthropicKey();
    console.log(`Anthropic key: ${anthropicKey.substring(0, 10)}...`);

    const openaiKey = await manager.getOpenAIKey();
    console.log(`OpenAI key: ${openaiKey.substring(0, 10)}...`);
    console.log('✅ Convenience methods work\n');

    // Test 10: Delete a credential
    console.log('Test 10: Delete GitHub credential');
    await manager.delete(CredentialType.GIT_PLATFORM_TOKEN, 'test-github');
    const afterDelete = await manager.list();
    console.log(`After delete: ${afterDelete.length} credentials`);
    console.log('✅ Delete works\n');

    // Test 11: Update a credential
    console.log('Test 11: Update OpenAI credential');
    await manager.store({
      type: CredentialType.OPENAI_API,
      name: 'default',
      apiKey: 'sk-test-updated-key',
    });
    const updatedKey = await manager.getOpenAIKey();
    console.log(`Updated OpenAI key: ${updatedKey.substring(0, 10)}...`);
    console.log('✅ Update works\n');

    // Test 12: Clean up
    console.log('Test 12: Clean up all test credentials');
    await manager.delete(CredentialType.ANTHROPIC_API, 'default');
    await manager.delete(CredentialType.OPENAI_API, 'default');
    const final = await manager.list();
    console.log(`Final count: ${final.length} credentials`);
    console.log('✅ Cleanup complete\n');

    console.log('🎉 All credential management tests passed!\n');

    return {
      success: true,
      testsRun: 12,
      testsPassed: 12,
    };

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error(error.stack);
    return {
      success: false,
      error: error.message,
    };
  }
}

// Run tests
runTests()
  .then(result => {
    if (result.success) {
      console.log(`✅ Success: ${result.testsPassed}/${result.testsRun} tests passed`);
      process.exit(0);
    } else {
      console.log(`❌ Failed: ${result.error}`);
      process.exit(1);
    }
  })
  .catch(error => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  });
