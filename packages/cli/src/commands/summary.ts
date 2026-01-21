/**
 * cv summary command
 * Display or regenerate the codebase summary
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import {
  configManager,
  createGraphManager,
  createVectorManager,
  createCodebaseSummaryService,
  loadCodebaseSummary,
  generateRepoId,
  readManifest
} from '@cv-git/core';
import { findRepoRoot, getCVDir } from '@cv-git/shared';
import { CredentialManager } from '@cv-git/credentials';
import { addGlobalOptions, createOutput } from '../utils/output.js';
import { ensureFalkorDB, ensureQdrant, ensureOllama } from '../utils/infrastructure.js';
import { getAnthropicApiKey } from '../utils/credentials.js';
import { getPreferences } from '../config.js';

export function summaryCommand(): Command {
  const cmd = new Command('summary');

  cmd
    .description('Display or generate codebase summary')
    .option('--regenerate', 'Force regeneration of the summary')
    .option('--json', 'Output as JSON');

  addGlobalOptions(cmd);

  cmd.action(async (options) => {
    const output = createOutput(options);
    let spinner: any;

    try {
      // Find repository root
      const repoRoot = await findRepoRoot();
      if (!repoRoot) {
        console.error(chalk.red('Not in a CV-Git repository. Run `cv init` first.'));
        process.exit(1);
      }

      // If not regenerating, try to load existing summary first
      if (!options.regenerate) {
        const existingSummary = await loadCodebaseSummary(repoRoot);
        if (existingSummary) {
          if (options.json) {
            console.log(JSON.stringify(existingSummary, null, 2));
          } else {
            displaySummary(existingSummary);
          }
          return;
        }
      }

      // Load configuration
      spinner = output.spinner('Loading configuration...').start();
      const config = await configManager.load(repoRoot);

      // Get Anthropic API key
      const anthropicApiKey = config.ai?.apiKey || await getAnthropicApiKey();
      if (!anthropicApiKey) {
        spinner.fail('Anthropic API key not found');
        console.error(chalk.yellow('Run `cv auth setup anthropic` to configure'));
        process.exit(1);
      }

      spinner.succeed('Configuration loaded');

      // Get repository ID
      const cvDir = getCVDir(repoRoot);
      const manifest = await readManifest(cvDir);
      const repoId = manifest?.repository?.id || generateRepoId(repoRoot);

      // Set up FalkorDB
      spinner = output.spinner('Connecting to FalkorDB...').start();
      const falkorInfo = await ensureFalkorDB({ silent: true });
      if (!falkorInfo) {
        spinner.fail('FalkorDB not available (Docker required)');
        process.exit(1);
      }
      spinner.succeed(`Connected to FalkorDB`);

      // Create graph manager
      const graph = createGraphManager({ url: falkorInfo.url, repoId });
      await graph.connect();

      // Set up vector manager (optional)
      let vector = undefined;
      const prefsManager = getPreferences();
      const prefs = await prefsManager.load();
      const embeddingProvider = config.embedding?.provider || prefs.embeddingProvider || 'ollama';

      // Try to get embedding credentials
      let openaiApiKey = config.ai?.apiKey || process.env.OPENAI_API_KEY;
      let openrouterApiKey = process.env.OPENROUTER_API_KEY;
      let ollamaUrl: string | undefined;

      try {
        const credentials = new CredentialManager();
        await credentials.init();
        if (!openaiApiKey) {
          openaiApiKey = await credentials.getOpenAIKey() || undefined;
        }
        if (!openrouterApiKey) {
          openrouterApiKey = await credentials.getOpenRouterKey() || undefined;
        }
      } catch {
        // Credential manager not available
      }

      // Set up embedding provider
      if (embeddingProvider === 'ollama') {
        const ollamaInfo = await ensureOllama({ silent: true });
        if (ollamaInfo) {
          ollamaUrl = ollamaInfo.url;
        }
      }

      // Set up Qdrant if we have embedding capability
      const hasEmbeddingCapability = ollamaUrl || openaiApiKey || openrouterApiKey;
      if (hasEmbeddingCapability && config.vector) {
        try {
          const qdrantInfo = await ensureQdrant({ silent: true });
          if (qdrantInfo) {
            vector = createVectorManager({
              url: qdrantInfo.url,
              repoId,
              ollamaUrl,
              openrouterApiKey: ollamaUrl ? undefined : openrouterApiKey,
              openaiApiKey: ollamaUrl ? undefined : openaiApiKey,
              vectorSize: embeddingProvider === 'ollama' ? 768 : 1536
            });
            await vector.connect();
          }
        } catch {
          // Continue without vector
        }
      }

      // Create summary service
      spinner = output.spinner('Generating codebase summary...').start();

      const summaryService = createCodebaseSummaryService(
        {
          apiKey: anthropicApiKey,
          model: config.ai?.model,
          maxTokens: config.ai?.maxTokens,
          repoRoot
        },
        graph,
        vector
      );

      // Generate summary
      const summary = await summaryService.generateSummary();

      // Save summary
      await summaryService.saveSummary(summary);

      spinner.succeed('Codebase summary generated');

      // Close connections
      await graph.close();
      if (vector) await vector.close();

      // Display summary
      if (options.json) {
        console.log(JSON.stringify(summary, null, 2));
      } else {
        console.log();
        displaySummary(summary);
      }

    } catch (error: any) {
      if (spinner) {
        spinner.fail(chalk.red('Summary generation failed'));
      }

      console.error(chalk.red(`Error: ${error.message}`));

      if (process.env.CV_DEBUG) {
        console.error(chalk.gray(error.stack));
      }

      process.exit(1);
    }
  });

  return cmd;
}

/**
 * Display summary in a formatted way
 */
function displaySummary(summary: any): void {
  console.log(chalk.bold.cyan('📊 Codebase Summary'));
  console.log(chalk.gray('═'.repeat(60)));
  console.log();

  // Statistics
  console.log(chalk.bold.yellow('📈 Statistics'));
  console.log(`   Files: ${chalk.white(summary.stats.totalFiles)}`);
  console.log(`   Symbols: ${chalk.white(summary.stats.totalSymbols)}`);
  console.log(`   Functions: ${chalk.white(summary.stats.totalFunctions || 0)}`);
  console.log(`   Classes: ${chalk.white(summary.stats.totalClasses || 0)}`);
  if (summary.stats.linesOfCode) {
    console.log(`   Lines of Code: ${chalk.white(summary.stats.linesOfCode.toLocaleString())}`);
  }

  // Languages
  const langs = Object.entries(summary.stats.languages || {})
    .sort((a: any, b: any) => b[1] - a[1])
    .slice(0, 5)
    .map(([lang, count]) => `${lang}(${count})`)
    .join(', ');
  if (langs) {
    console.log(`   Languages: ${chalk.gray(langs)}`);
  }
  console.log();

  // Architecture
  console.log(chalk.bold.yellow('🏗️  Architecture'));
  if (summary.architecture.patterns?.length > 0) {
    console.log(`   Patterns: ${chalk.white(summary.architecture.patterns.join(', '))}`);
  }
  if (summary.architecture.entryPoints?.length > 0) {
    console.log(`   Entry points: ${chalk.gray(summary.architecture.entryPoints.slice(0, 3).join(', '))}`);
  }
  if (summary.architecture.coreModules?.length > 0) {
    console.log(`   Core modules: ${chalk.gray(summary.architecture.coreModules.map((m: any) => m.name).join(', '))}`);
  }
  console.log();

  // Hotspots
  if (summary.dependencies?.hotspots?.length > 0) {
    console.log(chalk.bold.yellow('🔥 Hotspots'));
    summary.dependencies.hotspots.slice(0, 5).forEach((h: string) => {
      console.log(`   ${chalk.gray(h)}`);
    });
    console.log();
  }

  // Conventions
  const conv = summary.conventions;
  if (conv && (conv.naming?.length > 0 || conv.fileStructure?.length > 0 || conv.testing?.length > 0)) {
    console.log(chalk.bold.yellow('📝 Conventions'));
    if (conv.naming?.length > 0) {
      console.log(`   Naming: ${chalk.gray(conv.naming.join(', '))}`);
    }
    if (conv.fileStructure?.length > 0) {
      console.log(`   Structure: ${chalk.gray(conv.fileStructure.join(', '))}`);
    }
    if (conv.testing?.length > 0) {
      console.log(`   Testing: ${chalk.gray(conv.testing.join(', '))}`);
    }
    console.log();
  }

  // Key Abstractions
  const abs = summary.abstractions;
  if (abs && (abs.interfaces?.length > 0 || abs.baseClasses?.length > 0)) {
    console.log(chalk.bold.yellow('🔧 Key Abstractions'));
    if (abs.interfaces?.length > 0) {
      console.log(`   Interfaces: ${chalk.gray(abs.interfaces.slice(0, 5).map((i: any) => i.name).join(', '))}`);
    }
    if (abs.baseClasses?.length > 0) {
      console.log(`   Base Classes: ${chalk.gray(abs.baseClasses.slice(0, 5).map((c: any) => c.name).join(', '))}`);
    }
    console.log();
  }

  // External Dependencies
  if (summary.dependencies?.external?.length > 0) {
    console.log(chalk.bold.yellow('📦 External Dependencies'));
    const deps = summary.dependencies.external.slice(0, 10).join(', ');
    console.log(`   ${chalk.gray(deps)}`);
    if (summary.dependencies.external.length > 10) {
      console.log(`   ${chalk.gray(`... and ${summary.dependencies.external.length - 10} more`)}`);
    }
    console.log();
  }

  // Potential Issues
  if (summary.dependencies?.potentialIssues?.length > 0) {
    console.log(chalk.bold.yellow('⚠️  Potential Issues'));
    summary.dependencies.potentialIssues.forEach((issue: string) => {
      console.log(`   ${chalk.yellow('•')} ${issue}`);
    });
    console.log();
  }

  // Natural Language Summary
  console.log(chalk.bold.yellow('📖 Summary'));
  console.log(chalk.gray('─'.repeat(60)));
  console.log(summary.naturalLanguageSummary);
  console.log();

  console.log(chalk.gray('═'.repeat(60)));
  console.log(chalk.gray(`Generated: ${new Date(summary.generatedAt).toLocaleString()}`));
  console.log();
}
