/**
 * Interactive prompts for CLI
 * Provides confirmation and selection utilities
 */

import chalk from 'chalk';

export type EditAction = 'yes' | 'no' | 'all' | 'diff' | 'skip' | 'quit';

export interface EditPromptResult {
  action: EditAction;
  // For 'all' action, indicates whether to apply all remaining
  applyRemaining?: boolean;
}

/**
 * Get the prompt text for edit confirmation
 */
export function getEditPromptText(
  editNumber: number,
  totalEdits: number,
  fileName: string
): string {
  return chalk.yellow(
    `Apply edit ${editNumber}/${totalEdits} to ${chalk.cyan(fileName)}? ` +
    `[${chalk.bold('y')}]es / [${chalk.bold('n')}]o / [${chalk.bold('a')}]ll / [${chalk.bold('d')}]iff / [${chalk.bold('s')}]kip / [${chalk.bold('q')}]uit: `
  );
}

/**
 * Parse edit action from user input
 */
export function parseEditAction(input: string): EditPromptResult {
  const char = input.trim().toLowerCase() || 'y'; // Default to 'yes'

  let action: EditAction;
  switch (char[0]) {
    case 'y':
      action = 'yes';
      break;
    case 'n':
      action = 'no';
      break;
    case 'a':
      action = 'all';
      break;
    case 'd':
      action = 'diff';
      break;
    case 's':
      action = 'skip';
      break;
    case 'q':
      action = 'quit';
      break;
    default:
      action = 'yes'; // Default to yes for unrecognized input
  }

  return {
    action,
    applyRemaining: action === 'all'
  };
}

/**
 * Show a summary of edit actions
 */
export function formatEditSummary(
  applied: number,
  rejected: number,
  skipped: number
): string {
  const parts: string[] = [];

  if (applied > 0) {
    parts.push(chalk.green(`${applied} applied`));
  }
  if (rejected > 0) {
    parts.push(chalk.red(`${rejected} rejected`));
  }
  if (skipped > 0) {
    parts.push(chalk.yellow(`${skipped} skipped`));
  }

  return parts.join(', ') || chalk.gray('no changes');
}
