/**
 * Visual formatting utilities for CLI output
 * Provides dividers, boxes, and visual hierarchy
 */

import chalk from 'chalk';

// Box drawing characters
const BOX = {
  topLeft: '┌',
  topRight: '┐',
  bottomLeft: '└',
  bottomRight: '┘',
  horizontal: '─',
  vertical: '│',
  teeRight: '├',
  teeLeft: '┤',
};

// Terminal width (default to 80 if not available)
function getTerminalWidth(): number {
  return process.stdout.columns || 80;
}

/**
 * Create a horizontal divider line
 */
export function divider(
  style: 'light' | 'heavy' | 'double' = 'light',
  width?: number
): string {
  const w = width || Math.min(getTerminalWidth(), 80);
  const chars = {
    light: '─',
    heavy: '━',
    double: '═',
  };
  return chalk.gray(chars[style].repeat(w));
}

/**
 * Create a labeled divider
 * Example: ──── Edits ────
 */
export function labeledDivider(
  label: string,
  style: 'light' | 'heavy' = 'light',
  width?: number
): string {
  const w = width || Math.min(getTerminalWidth(), 80);
  const chars = {
    light: '─',
    heavy: '━',
  };
  const char = chars[style];

  const labelWithPadding = ` ${label} `;
  const remainingWidth = w - labelWithPadding.length;
  const leftWidth = Math.floor(remainingWidth / 2);
  const rightWidth = remainingWidth - leftWidth;

  return (
    chalk.gray(char.repeat(leftWidth)) +
    chalk.bold(labelWithPadding) +
    chalk.gray(char.repeat(rightWidth))
  );
}

/**
 * Create a section header with visual emphasis
 */
export function sectionHeader(title: string, icon?: string): string {
  const iconStr = icon ? `${icon} ` : '';
  return `\n${chalk.bold.cyan(iconStr + title)}\n${divider('light')}\n`;
}

/**
 * Create a box around content
 */
export function box(
  content: string,
  options?: {
    title?: string;
    padding?: number;
    width?: number;
    borderColor?: typeof chalk;
  }
): string {
  const { title, padding = 1, width, borderColor = chalk.gray } = options || {};
  const maxWidth = width || Math.min(getTerminalWidth() - 2, 78);

  // Split content into lines and handle long lines
  const lines = content.split('\n').flatMap((line) => {
    if (line.length <= maxWidth - padding * 2 - 2) {
      return [line];
    }
    // Word wrap long lines
    const words = line.split(' ');
    const wrapped: string[] = [];
    let current = '';
    for (const word of words) {
      if (current.length + word.length + 1 <= maxWidth - padding * 2 - 2) {
        current = current ? `${current} ${word}` : word;
      } else {
        if (current) wrapped.push(current);
        current = word;
      }
    }
    if (current) wrapped.push(current);
    return wrapped.length > 0 ? wrapped : [''];
  });

  // Calculate content width
  const contentWidth = Math.max(
    ...lines.map((l) => stripAnsi(l).length),
    title ? stripAnsi(title).length + 2 : 0
  );
  const boxWidth = Math.min(contentWidth + padding * 2 + 2, maxWidth);

  // Build box
  const result: string[] = [];
  const pad = ' '.repeat(padding);

  // Top border
  if (title) {
    const titlePadded = ` ${title} `;
    const remaining = boxWidth - 2 - titlePadded.length;
    const left = Math.floor(remaining / 2);
    const right = remaining - left;
    result.push(
      borderColor(BOX.topLeft + BOX.horizontal.repeat(left)) +
        chalk.bold(titlePadded) +
        borderColor(BOX.horizontal.repeat(right) + BOX.topRight)
    );
  } else {
    result.push(
      borderColor(BOX.topLeft + BOX.horizontal.repeat(boxWidth - 2) + BOX.topRight)
    );
  }

  // Content lines
  for (const line of lines) {
    const visibleLength = stripAnsi(line).length;
    const rightPad = boxWidth - 2 - padding * 2 - visibleLength;
    result.push(
      borderColor(BOX.vertical) +
        pad +
        line +
        ' '.repeat(Math.max(0, rightPad)) +
        pad +
        borderColor(BOX.vertical)
    );
  }

  // Bottom border
  result.push(
    borderColor(BOX.bottomLeft + BOX.horizontal.repeat(boxWidth - 2) + BOX.bottomRight)
  );

  return result.join('\n');
}

/**
 * Format an edit proposal with visual emphasis
 */
export function editBox(
  fileName: string,
  editType: 'create' | 'modify' | 'delete',
  diffContent: string
): string {
  const icons = {
    create: chalk.green('+'),
    modify: chalk.yellow('~'),
    delete: chalk.red('-'),
  };
  const colors = {
    create: chalk.green,
    modify: chalk.yellow,
    delete: chalk.red,
  };

  const header = `${icons[editType]} ${colors[editType](fileName)} (${editType})`;
  const border = colors[editType];

  return box(diffContent, {
    title: header,
    borderColor: border,
    padding: 1,
  });
}

/**
 * Format a summary block
 */
export function summaryBlock(items: { label: string; value: string }[]): string {
  const maxLabelLen = Math.max(...items.map((i) => i.label.length));
  const lines = items.map(
    (item) =>
      chalk.gray(item.label.padEnd(maxLabelLen)) + '  ' + item.value
  );
  return lines.join('\n');
}

/**
 * Format a status line with icon
 */
export function statusLine(
  status: 'success' | 'error' | 'warning' | 'info' | 'pending',
  message: string
): string {
  const icons = {
    success: chalk.green('✓'),
    error: chalk.red('✗'),
    warning: chalk.yellow('⚠'),
    info: chalk.blue('ℹ'),
    pending: chalk.gray('○'),
  };
  return `${icons[status]} ${message}`;
}

/**
 * Strip ANSI escape codes for length calculation
 */
function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
}

/**
 * Create visual spacing
 */
export function spacer(lines: number = 1): string {
  return '\n'.repeat(lines);
}

/**
 * Indent content by specified amount
 */
export function indent(content: string, spaces: number = 2): string {
  const pad = ' '.repeat(spaces);
  return content
    .split('\n')
    .map((line) => pad + line)
    .join('\n');
}

/**
 * Colorize diff output for terminal display
 */
export function colorizeDiff(diffText: string): string {
  const lines = diffText.split('\n');
  const colored: string[] = [];

  for (const line of lines) {
    if (line.startsWith('+++') || line.startsWith('---')) {
      // File headers - bold
      colored.push(chalk.bold(line));
    } else if (line.startsWith('@@')) {
      // Hunk headers - cyan
      colored.push(chalk.cyan(line));
    } else if (line.startsWith('+')) {
      // Added lines - green
      colored.push(chalk.green(line));
    } else if (line.startsWith('-')) {
      // Removed lines - red
      colored.push(chalk.red(line));
    } else {
      // Context lines - dim
      colored.push(chalk.gray(line));
    }
  }

  return colored.join('\n');
}

/**
 * Format a file diff with box styling
 */
export function formatDiffBox(
  fileName: string,
  editType: 'create' | 'modify' | 'delete',
  diffText: string
): string {
  const typeLabels = {
    create: chalk.green.bold('CREATE'),
    modify: chalk.yellow.bold('MODIFY'),
    delete: chalk.red.bold('DELETE'),
  };

  const typeColors = {
    create: chalk.green,
    modify: chalk.yellow,
    delete: chalk.red,
  };

  const color = typeColors[editType];
  const label = typeLabels[editType];

  // Build header
  const header = `${label} ${color(fileName)}`;

  // Colorize the diff content
  const coloredDiff = colorizeDiff(diffText);

  // Build the formatted output
  const lines: string[] = [];
  lines.push(color('┌' + '─'.repeat(76) + '┐'));
  lines.push(color('│') + ' ' + header + ' '.repeat(Math.max(0, 75 - stripAnsi(header).length)) + color('│'));
  lines.push(color('├' + '─'.repeat(76) + '┤'));

  // Add diff lines
  for (const diffLine of coloredDiff.split('\n')) {
    const visibleLen = stripAnsi(diffLine).length;
    const padding = Math.max(0, 75 - visibleLen);
    lines.push(color('│') + ' ' + diffLine + ' '.repeat(padding) + color('│'));
  }

  lines.push(color('└' + '─'.repeat(76) + '┘'));

  return lines.join('\n');
}
