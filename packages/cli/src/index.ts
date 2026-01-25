#!/usr/bin/env node

/**
 * CV-Git CLI
 * Main entry point for the cv command
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { applyOptionsInterceptor } from './utils/options-interceptor.js';
import { initCommand } from './commands/init.js';
import { syncCommand } from './commands/sync.js';
import { doCommand } from './commands/do.js';
import { findCommand } from './commands/find.js';
import { explainCommand } from './commands/explain.js';
import { reviewCommand } from './commands/review.js';
import { graphCommand } from './commands/graph.js';
import { gitCommand } from './commands/git.js';
import { authCommand } from './commands/auth.js';
import { prCommand } from './commands/pr.js';
import { releaseCommand } from './commands/release.js';
import { configCommand } from './commands/config.js';
import { statusCommand } from './commands/status.js';
import { doctorCommand } from './commands/doctor.js';
import { cloneCommand } from './commands/clone.js';
import { cloneGroupCommand } from './commands/clone-group.js';
import { contextCommand } from './commands/context.js';
import { chatCommand } from './commands/chat.js';
import { pushCommand } from './commands/push.js';
import { pullCommand } from './commands/pull.js';
import { watchCommand } from './commands/watch.js';
import { commitCommand } from './commands/commit.js';
import { hooksCommand } from './commands/hooks.js';
import { designCommand } from './commands/design.js';
import { codeCommand } from './commands/code.js';
import { preferencesCommand } from './commands/preferences.js';
import { createPRDCommand } from './commands/prd.js';
import { importCommand } from './commands/import.js';
import { servicesCommand } from './commands/services.js';
import { createDocsCommand } from './commands/docs.js';
import { createCacheCommand } from './commands/cache.js';
import { verifyCommand } from './commands/verify.js';
import { addCommand } from './commands/add.js';
import { diffCommand } from './commands/diff.js';
import { logCommand } from './commands/log.js';
import { branchCommand } from './commands/branch.js';
import { checkoutCommand, switchCommand } from './commands/checkout.js';
import { stashCommand } from './commands/stash.js';
import { mergeCommand } from './commands/merge.js';
import { fetchCommand } from './commands/fetch.js';
import { remoteCommand } from './commands/remote.js';
import { resetCommand } from './commands/reset.js';
import { revertCommand } from './commands/revert.js';
import { tagCommand } from './commands/tag.js';
import { absorbCommand } from './commands/absorb.js';
import { undoCommand, reflogCommand } from './commands/undo.js';
import { stackCommand } from './commands/stack.js';
import { splitCommand } from './commands/split.js';
import { bugreportCommand } from './commands/bugreport.js';
import { depsCommand } from './commands/deps.js';
import { summaryCommand } from './commands/summary.js';

const program = new Command();

program
  .name('cv')
  .description('AI-Native Version Control with Knowledge Graph & Secure Credentials')
  .version('0.5.3');

// Add commands
program.addCommand(configCommand());        // Configuration management
program.addCommand(preferencesCommand());   // User preferences
program.addCommand(statusCommand());        // Status and information
program.addCommand(summaryCommand());       // Codebase summary
program.addCommand(doctorCommand());        // Health diagnostics
program.addCommand(authCommand());          // Credential management
program.addCommand(prCommand());            // Pull request management
program.addCommand(releaseCommand());       // Release management
program.addCommand(cloneCommand());          // Clone and initialize
program.addCommand(cloneGroupCommand());     // Clone entire group/subgroup
program.addCommand(contextCommand());        // Generate AI context
program.addCommand(chatCommand());           // AI chat with codebase context
program.addCommand(pushCommand());           // Git push with auto-sync
program.addCommand(pullCommand());           // Git pull with auto-sync
program.addCommand(watchCommand());          // File watcher with auto-sync
program.addCommand(commitCommand());         // Git commit with credential identity
program.addCommand(hooksCommand());          // Manage git hooks
program.addCommand(designCommand());         // Design-first scaffolding
program.addCommand(codeCommand());           // AI-powered code editing
program.addCommand(initCommand());
program.addCommand(syncCommand());
program.addCommand(doCommand());
program.addCommand(findCommand());
program.addCommand(explainCommand());
program.addCommand(reviewCommand());
program.addCommand(graphCommand());
program.addCommand(gitCommand());
program.addCommand(addCommand());             // Git add wrapper
program.addCommand(diffCommand());            // Git diff with AI analysis
program.addCommand(logCommand());             // Git log with graph integration
program.addCommand(branchCommand());          // Branch management
program.addCommand(checkoutCommand());        // Git checkout wrapper
program.addCommand(switchCommand());          // Git switch (modern checkout)
program.addCommand(stashCommand());           // Git stash wrapper
program.addCommand(mergeCommand());           // Git merge with conflict help
program.addCommand(fetchCommand());           // Git fetch wrapper
program.addCommand(remoteCommand());          // Git remote wrapper
program.addCommand(resetCommand());           // Git reset wrapper
program.addCommand(revertCommand());          // Git revert wrapper
program.addCommand(tagCommand());             // Git tag wrapper
program.addCommand(absorbCommand());          // Auto-create fixup commits
program.addCommand(undoCommand());            // Undo operations
program.addCommand(reflogCommand());          // Operation history
program.addCommand(stackCommand());           // Stacked diffs workflow
program.addCommand(splitCommand());           // Split commits
program.addCommand(createPRDCommand());     // PRD management (cv prd)
program.addCommand(importCommand());        // Import PRD data from cv-prd exports
program.addCommand(servicesCommand());      // Service discovery and management
program.addCommand(createDocsCommand());    // Documentation management (cv docs)
program.addCommand(createCacheCommand());   // Embedding cache management (cv cache)
program.addCommand(verifyCommand());        // CLI verification (cv verify)
program.addCommand(bugreportCommand());     // Bug reporting (cv bugreport)
program.addCommand(depsCommand());          // Dependency analysis (cv deps)

// Error handler
program.exitOverride((err) => {
  if (err.code === 'commander.help' || err.code === 'commander.version') {
    process.exit(0);
  }
  console.error(chalk.red('Error:'), err.message);
  process.exit(1);
});

// Apply options interceptor to all commands
applyOptionsInterceptor(program);

// Parse arguments
program.parse();
