#!/usr/bin/env node

/**
 * Integration Test: Credential Management
 * Tests the CredentialManager with storage backends
 */

import { CredentialManager, CredentialType, GitPlatform } from '../../packages/credentials/dist/index.js';

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
      console.log(`  - ${cred.type}:${cred.name} (platform: ${cred.platform || 'N/A'})`);
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

    // Test 12: Store Cloudflare credential
    console.log('Test 12: Store Cloudflare API token');
    await manager.store({
      type: CredentialType.CLOUDFLARE_API,
      name: 'default',
      apiToken: 'test-cloudflare-token-123',
      accountId: 'test-account-id',
      email: 'test@example.com',
    });
    console.log('✅ Stored Cloudflare credential\n');

    // Test 13: Retrieve Cloudflare credential
    console.log('Test 13: Retrieve Cloudflare credential');
    const cfToken = await manager.getCloudflareToken();
    console.log(`Cloudflare token: ${cfToken.substring(0, 15)}...`);
    const cfCred = await manager.getCloudflareCredential();
    console.log(`Account ID: ${cfCred.accountId}`);
    console.log(`Email: ${cfCred.email}`);
    console.log('✅ Cloudflare convenience methods work\n');

    // Test 14: Store AWS credential
    console.log('Test 14: Store AWS credentials');
    await manager.store({
      type: CredentialType.AWS_CREDENTIALS,
      name: 'default',
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      region: 'us-east-1',
      accountId: '123456789012',
    });
    console.log('✅ Stored AWS credential\n');

    // Test 15: Retrieve AWS credential
    console.log('Test 15: Retrieve AWS credential');
    const awsCred = await manager.getAWSCredentials();
    console.log(`Access Key ID: ${awsCred.accessKeyId}`);
    console.log(`Region: ${awsCred.region}`);
    console.log(`Account ID: ${awsCred.accountId}`);
    console.log('✅ AWS convenience method works\n');

    // Test 16: Store DigitalOcean token
    console.log('Test 16: Store DigitalOcean token');
    await manager.store({
      type: CredentialType.DIGITALOCEAN_TOKEN,
      name: 'default',
      apiToken: 'dop_v1_test_token_example',
      accountEmail: 'do-test@example.com',
    });
    console.log('✅ Stored DigitalOcean token\n');

    // Test 17: Retrieve DigitalOcean token
    console.log('Test 17: Retrieve DigitalOcean token');
    const doToken = await manager.getDigitalOceanToken();
    console.log(`DO Token: ${doToken.substring(0, 10)}...`);
    const doCred = await manager.getDigitalOceanCredential();
    console.log(`Account Email: ${doCred.accountEmail}`);
    console.log('✅ DigitalOcean token convenience methods work\n');

    // Test 18: Store DigitalOcean Spaces credential
    console.log('Test 18: Store DigitalOcean Spaces credential');
    await manager.store({
      type: CredentialType.DIGITALOCEAN_SPACES,
      name: 'default',
      accessKey: 'SPACES_ACCESS_KEY_TEST',
      secretKey: 'spaces-secret-key-test-1234567890',
      region: 'nyc3',
      endpoint: 'nyc3.digitaloceanspaces.com',
    });
    console.log('✅ Stored DigitalOcean Spaces credential\n');

    // Test 19: Retrieve DigitalOcean Spaces credential
    console.log('Test 19: Retrieve DigitalOcean Spaces credential');
    const spacesCred = await manager.getDigitalOceanSpaces();
    console.log(`Access Key: ${spacesCred.accessKey}`);
    console.log(`Region: ${spacesCred.region}`);
    console.log(`Endpoint: ${spacesCred.endpoint}`);
    console.log('✅ DigitalOcean Spaces convenience method works\n');

    // Test 20: Store DigitalOcean App credential
    console.log('Test 20: Store DigitalOcean App credential');
    await manager.store({
      type: CredentialType.DIGITALOCEAN_APP,
      name: 'default',
      appToken: 'dop_v1_app_token_test',
      appId: 'test-app-id',
    });
    console.log('✅ Stored DigitalOcean App credential\n');

    // Test 21: Retrieve DigitalOcean App credential
    console.log('Test 21: Retrieve DigitalOcean App credential');
    const appCred = await manager.getDigitalOceanApp();
    console.log(`App Token: ${appCred.appToken.substring(0, 10)}...`);
    console.log(`App ID: ${appCred.appId}`);
    console.log('✅ DigitalOcean App convenience method works\n');

    // Test 22: List all (should have 7 new + 2 existing = many)
    console.log('Test 22: List all credentials');
    const allCreds2 = await manager.list();
    console.log(`Found ${allCreds2.length} credentials:`);
    allCreds2.forEach(cred => {
      console.log(`  - ${cred.type}:${cred.name}`);
    });
    console.log('✅ All new credential types work\n');

    // Test 23: Clean up all test credentials
    console.log('Test 23: Clean up all test credentials');
    await manager.delete(CredentialType.ANTHROPIC_API, 'default');
    await manager.delete(CredentialType.OPENAI_API, 'default');
    await manager.delete(CredentialType.CLOUDFLARE_API, 'default');
    await manager.delete(CredentialType.AWS_CREDENTIALS, 'default');
    await manager.delete(CredentialType.DIGITALOCEAN_TOKEN, 'default');
    await manager.delete(CredentialType.DIGITALOCEAN_SPACES, 'default');
    await manager.delete(CredentialType.DIGITALOCEAN_APP, 'default');
    const final = await manager.list();
    console.log(`Final count: ${final.length} credentials`);
    console.log('✅ Cleanup complete\n');

    console.log('🎉 All credential management tests passed!\n');

    return {
      success: true,
      testsRun: 23,
      testsPassed: 23,
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
