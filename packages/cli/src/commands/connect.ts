/**
 * cv connect command
 * Read-only command showing how to connect a Claude Code session to this machine.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { addGlobalOptions, createOutput } from '../utils/output.js';
import {
  readCredentials,
  getMachineName,
  findCredentialFile,
} from '../utils/cv-hub-credentials.js';

export function connectCommand(): Command {
  const cmd = new Command('connect');
  cmd.description('Show connection instructions for linking Claude Code to this machine');

  addGlobalOptions(cmd);

  cmd.action(async (options) => {
    const output = createOutput(options);

    const creds = await readCredentials();
    const machineName = await getMachineName();
    const credFile = await findCredentialFile();
    const hasApi = !!(creds.CV_HUB_PAT && creds.CV_HUB_API);

    if (output.isJson) {
      console.log(JSON.stringify({
        machine_name: machineName,
        api_url: creds.CV_HUB_API || null,
        has_pat: !!creds.CV_HUB_PAT,
        credential_file: credFile,
        ready: hasApi && !!creds.CV_HUB_MACHINE_NAME,
      }, null, 2));
      return;
    }

    console.log();
    console.log(chalk.bold('CV-Hub Connection Instructions'));
    console.log(chalk.gray('─'.repeat(40)));
    console.log();

    // Machine name
    if (creds.CV_HUB_MACHINE_NAME) {
      console.log(chalk.green(`  Machine name:  ${machineName}`));
    } else {
      console.log(chalk.yellow(`  Machine name:  ${machineName} (auto-detected)`));
      console.log(chalk.gray(`    Run "cv init" to set a custom name`));
    }
    console.log();

    // Connection status
    if (hasApi) {
      console.log(chalk.green('  Status:  Ready to connect'));
      console.log(chalk.gray(`  API:     ${creds.CV_HUB_API}`));
    } else {
      console.log(chalk.red('  Status:  Not configured'));
      console.log(chalk.gray(`  Run "cv auth login" to authenticate with CV-Hub`));
      console.log();
      return;
    }

    console.log();
    console.log(chalk.bold('  To connect from chat, say:'));
    console.log();
    console.log(chalk.cyan(`    "Connect me to ${machineName}"`));
    console.log();
    console.log(chalk.gray('  The chat bridge will route tasks to any active'));
    console.log(chalk.gray('  Claude Code session registered on this machine.'));
    console.log();
  });

  return cmd;
}
