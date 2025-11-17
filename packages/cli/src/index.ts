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

const program = new Command();

program
  .name('cv')
  .description('AI-Native Version Control with Knowledge Graph & Secure Credentials')
  .version('0.2.0');

// Add commands
program.addCommand(authCommand());          // NEW: Credential management
program.addCommand(prCommand());            // NEW: Pull request management
program.addCommand(releaseCommand());       // NEW: Release management
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
