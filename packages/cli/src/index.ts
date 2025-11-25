#!/usr/bin/env node

/**
 * CV-Git CLI
 * Main entry point for the cv command
 */

import { Command } from 'commander';
import chalk from 'chalk';
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

const program = new Command();

program
  .name('cv')
  .description('AI-Native Version Control with Knowledge Graph & Secure Credentials')
  .version('0.2.0');

// Add commands
program.addCommand(configCommand());        // Configuration management
program.addCommand(statusCommand());        // Status and information
program.addCommand(doctorCommand());        // Health diagnostics
program.addCommand(authCommand());          // Credential management
program.addCommand(prCommand());            // Pull request management
program.addCommand(releaseCommand());       // Release management
program.addCommand(cloneCommand());          // Clone and initialize
program.addCommand(cloneGroupCommand());     // Clone entire group/subgroup
program.addCommand(contextCommand());        // Generate AI context
program.addCommand(chatCommand());           // AI chat with codebase context
program.addCommand(initCommand());
program.addCommand(syncCommand());
program.addCommand(doCommand());
program.addCommand(findCommand());
program.addCommand(explainCommand());
program.addCommand(reviewCommand());
program.addCommand(graphCommand());
program.addCommand(gitCommand());

// Error handler
program.exitOverride((err) => {
  if (err.code === 'commander.help' || err.code === 'commander.version') {
    process.exit(0);
  }
  console.error(chalk.red('Error:'), err.message);
  process.exit(1);
});

// Parse arguments
program.parse();
