/**
 * cv init command
 * Initialize CV-Git in a repository or workspace
 */

import { Command } from 'commander';
import chalk from 'chalk';
import * as path from 'path';
import inquirer from 'inquirer';
import { configManager } from '@cv-git/core';
import * as fs from 'fs';
import {
  ensureDir,
  getCVDir,
  detectProjectType,
  saveWorkspace,
  isWorkspace,
  generateDatabaseName,
  CVWorkspace,
  WorkspaceRepo,
} from '@cv-git/shared';
import { CredentialManager } from '@cv-git/credentials';
import { addGlobalOptions, createOutput } from '../utils/output.js';
import { getPreferences } from '../config.js';
import {
  runPreferencePicker,
  displayPreferenceSummary,
  savePreferences,
  getRequiredServices,
  displayRequiredKeys,
  PreferenceChoices,
} from '../utils/preference-picker.js';
import {
  ensureOllama,
  isDockerAvailable,
  checkSystemRequirements,
  getOllamaStatus,
  startNativeOllama,
  installOllamaNative,
  ensureOllamaModel,
} from '../utils/infrastructure.js';

export function initCommand(): Command {
  const cmd = new Command('init');

  cmd
    .description('Initialize CV-Git in the current repository or workspace')
    .option('--name <name>', 'Repository/workspace name (defaults to directory name)')
    .option('--workspace', 'Force workspace mode (multi-repo)')
    .option('--repo', 'Force single-repo mode')
    .option('--skip-preferences', 'Skip preference picker (for developers testing all providers)')
    .option('-y, --yes', 'Non-interactive mode with defaults (for AI/automation)')
    .option('--platform <platform>', 'Git platform: github, gitlab, bitbucket (default: github)')
    .option('--ai-provider <provider>', 'AI provider: anthropic, openai, openrouter (default: anthropic)')
    .option('--embedding-provider <provider>', 'Embedding provider: ollama, openai, openrouter (default: ollama)');

  addGlobalOptions(cmd);

  cmd.action(async (options) => {
      const output = createOutput(options);

      try {
        const currentDir = process.cwd();
        const projectName = options.name || path.basename(currentDir);
        const prefsManager = getPreferences();

        // Check if preferences already exist (returning user)
        const hasPrefs = await prefsManager.exists();
        let preferences: PreferenceChoices;
        const skipPrefs = options.skipPreferences === true;

        // Non-interactive mode: -y/--yes, --json, or --skip-preferences
        const nonInteractive = options.yes || output.isJson || skipPrefs;

        if (nonInteractive) {
          // Non-interactive mode - use defaults or explicit options
          if (!output.isJson && !skipPrefs) {
            console.log(chalk.gray('Running in non-interactive mode with defaults'));
            console.log();
          } else if (skipPrefs) {
            console.log(chalk.gray('Skipping preferences (developer mode)'));
            console.log();
          }
          preferences = {
            gitPlatform: (options.platform || 'github') as 'github' | 'gitlab' | 'bitbucket',
            aiProvider: (options.aiProvider || 'anthropic') as 'anthropic' | 'openai' | 'openrouter',
            embeddingProvider: (options.embeddingProvider || 'ollama') as 'ollama' | 'openai' | 'openrouter',
          };
          // Save preferences in non-interactive mode too
          if (!hasPrefs) {
            await savePreferences(preferences);
          }
        } else if (!hasPrefs) {
          // First-time setup - run preference picker
          preferences = await runPreferencePicker();
          displayPreferenceSummary(preferences);

          // Confirm preferences
          const { confirmPrefs } = await inquirer.prompt([
            {
              type: 'confirm',
              name: 'confirmPrefs',
              message: 'Continue with these preferences?',
              default: true,
            },
          ]);

          if (!confirmPrefs) {
            // Let them re-pick
            preferences = await runPreferencePicker(preferences);
            displayPreferenceSummary(preferences);
          }

          // Save preferences
          await savePreferences(preferences);
          console.log(chalk.green('Preferences saved!'));
          console.log();

          // If using Ollama for embeddings, set it up
          if (preferences.embeddingProvider === 'ollama') {
            const ollamaResult = await setupOllamaEmbeddings();

            // If system can't handle local AI, offer to switch
            if (ollamaResult === 'cloud-recommended') {
              const { switchToCloud } = await inquirer.prompt([{
                type: 'confirm',
                name: 'switchToCloud',
                message: 'Would you like to switch to cloud embeddings (OpenRouter)?',
                default: true,
              }]);

              if (switchToCloud) {
                preferences.embeddingProvider = 'openrouter';
                await savePreferences(preferences);
                console.log(chalk.green('Switched to OpenRouter for embeddings.'));
                console.log(chalk.gray('Run: cv auth setup openrouter'));
                console.log();
              }
            }
          }
        } else {
          // Load existing preferences
          const existingPrefs = await prefsManager.load();
          preferences = {
            gitPlatform: existingPrefs.gitPlatform,
            aiProvider: existingPrefs.aiProvider,
            embeddingProvider: existingPrefs.embeddingProvider,
          };
        }

        const spinner = output.spinner('Detecting project type...').start();

        // Detect project type
        const detected = await detectProjectType(currentDir);

        // Check if already initialized
        const cvDir = getCVDir(currentDir);
        if (await isWorkspace(currentDir)) {
          spinner.warn(chalk.yellow('CV-Git workspace already initialized in this directory'));
          return;
        }
        try {
          await configManager.load(currentDir);
          spinner.warn(chalk.yellow('CV-Git is already initialized in this directory'));
          return;
        } catch {
          // Not initialized, proceed
        }

        // Determine mode based on detection and options
        let mode: 'workspace' | 'repo';

        if (options.workspace) {
          mode = 'workspace';
        } else if (options.repo) {
          mode = 'repo';
        } else if (detected.type === 'workspace' && detected.childRepos && detected.childRepos.length > 0) {
          // Found child git repos
          if (nonInteractive) {
            // In non-interactive mode, default to workspace mode
            mode = 'workspace';
            spinner.text = 'Initializing CV-Git workspace (non-interactive)...';
          } else {
            // Ask user
            spinner.stop();
            console.log();
            console.log(chalk.cyan(`Found ${detected.childRepos.length} git repositories in this directory:`));
            for (const repo of detected.childRepos) {
              console.log(chalk.gray(`  - ${repo.name}/`));
            }
            console.log();

            const { initMode } = await inquirer.prompt([
              {
                type: 'list',
                name: 'initMode',
                message: 'How would you like to initialize CV-Git?',
                choices: [
                  {
                    name: `Workspace mode - Create unified index across all ${detected.childRepos.length} repos`,
                    value: 'workspace',
                  },
                  {
                    name: 'Skip - Initialize individual repos separately',
                    value: 'skip',
                  },
                ],
              },
            ]);

            if (initMode === 'skip') {
              console.log(chalk.gray('\nTo initialize a single repo, cd into it and run `cv init`'));
              return;
            }

            mode = initMode;
            spinner.start('Initializing CV-Git workspace...');
          }
        } else if (detected.type === 'repo') {
          mode = 'repo';
        } else {
          // Not a git repo - offer to initialize one
          spinner.stop();
          console.log();
          console.log(chalk.yellow('This directory is not a git repository.'));
          console.log();

          if (options.yes) {
            // Non-interactive mode: auto-init git
            console.log(chalk.cyan('Initializing git repository...'));
            const { execSync } = await import('child_process');
            const { writeFileSync, existsSync } = await import('fs');
            execSync('git init -b main', { cwd: currentDir, stdio: 'inherit' });
            // Create initial commit so git commands work
            const readmePath = path.join(currentDir, 'README.md');
            if (!existsSync(readmePath)) {
              writeFileSync(readmePath, `# ${projectName}\n\nInitialized with CV-Git.\n`);
            }
            execSync('git add -A && git commit -m "Initial commit"', { cwd: currentDir, stdio: 'inherit', shell: '/bin/bash' });
            mode = 'repo';
            spinner.start('Initializing CV-Git...');
          } else {
            const { initGit } = await inquirer.prompt([
              {
                type: 'confirm',
                name: 'initGit',
                message: 'Would you like to initialize a git repository here?',
                default: true,
              },
            ]);

            if (initGit) {
              console.log();
              console.log(chalk.cyan('Initializing git repository...'));
              const { execSync } = await import('child_process');
              const { writeFileSync, existsSync } = await import('fs');
              execSync('git init -b main', { cwd: currentDir, stdio: 'inherit' });
              // Create initial commit so git commands work
              const readmePath = path.join(currentDir, 'README.md');
              if (!existsSync(readmePath)) {
                writeFileSync(readmePath, `# ${projectName}\n\nInitialized with CV-Git.\n`);
              }
              execSync('git add -A && git commit -m "Initial commit"', { cwd: currentDir, stdio: 'inherit', shell: '/bin/bash' });
              mode = 'repo';
              spinner.start('Initializing CV-Git...');
            } else {
              console.log(chalk.gray('\nRun `cv init` inside a git repository, or in a folder containing git repos.'));
              process.exit(1);
            }
          }
        }

        // Create .cv directory
        spinner.text = 'Creating .cv directory...';
        await ensureDir(cvDir);
        await ensureDir(path.join(cvDir, 'cache'));
        await ensureDir(path.join(cvDir, 'sessions'));

        if (mode === 'workspace') {
          // Initialize workspace mode
          await initWorkspace(currentDir, projectName, detected.childRepos || [], spinner, output);
        } else {
          // Initialize single repo mode
          await initSingleRepo(currentDir, projectName, spinner, output);
        }

        // Install Claude Code hooks for session knowledge
        await installClaudeHooks(currentDir, nonInteractive);

        spinner.succeed(`CV-Git ${mode === 'workspace' ? 'workspace' : 'repository'} initialized successfully!`);

        if (output.isJson) {
          output.json({ success: true, name: projectName, cvDir, mode, preferences });
        } else {
          console.log();

          // Check which global credentials exist for the selected preferences
          const requiredServices = getRequiredServices(preferences);
          const credentialStatus = await checkGlobalCredentials(requiredServices);

          if (credentialStatus.configured.length > 0) {
            console.log(chalk.bold('Using credentials:'));
            for (const svc of credentialStatus.configured) {
              console.log(chalk.green(`  ✓ ${svc}`));
            }
            console.log();
          }

          if (credentialStatus.missing.length > 0) {
            console.log(chalk.bold('Missing credentials:'));
            for (const svc of credentialStatus.missing) {
              console.log(chalk.yellow(`  • ${svc}`));
            }
            console.log();

            // Skip credential setup prompt in non-interactive mode
            if (!nonInteractive) {
              const { setupMissing } = await inquirer.prompt([
                {
                  type: 'confirm',
                  name: 'setupMissing',
                  message: 'Set up missing credentials now?',
                  default: true,
                },
              ]);

              if (setupMissing) {
                console.log();
                for (const service of credentialStatus.missing) {
                  const { execSync } = await import('child_process');
                  try {
                    execSync(`cv auth setup ${service}`, { stdio: 'inherit' });
                  } catch {
                    console.log(chalk.yellow(`Skipped ${service}. Run 'cv auth setup ${service}' later.`));
                  }
                }
              }
            }
          }

          console.log();
          console.log(chalk.bold('Next steps:'));
          if (credentialStatus.missing.length > 0) {
            console.log(chalk.gray('  1. Set up missing credentials:'));
            console.log(chalk.cyan('     cv auth setup'));
            console.log();
            console.log(chalk.gray('  2. Sync your repository:'));
          } else {
            console.log(chalk.gray('  1. Sync your repository:'));
          }
          console.log(chalk.cyan('     cv sync'));
          console.log();
          console.log(chalk.gray('  Then start using CV-Git:'));
          console.log(chalk.cyan('     cv find "authentication logic"'));
          console.log(chalk.cyan('     cv code "add logging to error handlers"'));
          console.log();
        }

      } catch (error: any) {
        output.error('Failed to initialize CV-Git', error);
        process.exit(1);
      }
    });

  return cmd;
}

/**
 * Initialize single repo mode
 */
async function initSingleRepo(
  repoRoot: string,
  repoName: string,
  spinner: any,
  output: any
): Promise<void> {
  spinner.text = 'Creating configuration...';
  await configManager.init(repoRoot, repoName);
}

/**
 * Initialize workspace mode
 */
async function initWorkspace(
  workspaceRoot: string,
  workspaceName: string,
  childRepos: WorkspaceRepo[],
  spinner: any,
  output: any
): Promise<void> {
  spinner.text = 'Creating workspace configuration...';

  const workspace: CVWorkspace = {
    version: '1.0.0',
    name: workspaceName,
    root: workspaceRoot,
    repos: childRepos,
    createdAt: new Date().toISOString(),
    graphDatabase: generateDatabaseName(workspaceName),
  };

  await saveWorkspace(workspace);

  // Also create a minimal config.json for compatibility
  spinner.text = 'Creating configuration...';
  await configManager.init(workspaceRoot, workspaceName);
}

/**
 * Check which global credentials are already configured
 */
async function checkGlobalCredentials(services: string[]): Promise<{
  configured: string[];
  missing: string[];
}> {
  const credentials = new CredentialManager();
  await credentials.init();

  const configured: string[] = [];
  const missing: string[] = [];

  for (const service of services) {
    let hasCredential = false;
    try {
      switch (service) {
        case 'github':
          hasCredential = !!(await credentials.getGitPlatformToken('github' as any));
          break;
        case 'gitlab':
          hasCredential = !!(await credentials.getGitPlatformToken('gitlab' as any));
          break;
        case 'bitbucket':
          hasCredential = !!(await credentials.getGitPlatformToken('bitbucket' as any));
          break;
        case 'anthropic':
          hasCredential = !!(await credentials.getAnthropicKey());
          break;
        case 'openai':
          hasCredential = !!(await credentials.getOpenAIKey());
          break;
        case 'openrouter':
          hasCredential = !!(await credentials.getOpenRouterKey());
          break;
      }
    } catch {
      hasCredential = false;
    }

    if (hasCredential) {
      configured.push(service);
    } else {
      missing.push(service);
    }
  }

  return { configured, missing };
}

/**
 * Install Claude Code hooks for session knowledge bidirectional flow.
 * Writes hook scripts into .claude/hooks/ and merges hook config into .claude/settings.json.
 */
async function installClaudeHooks(repoRoot: string, nonInteractive: boolean): Promise<void> {
  const claudeDir = path.join(repoRoot, '.claude');
  const hooksDir = path.join(claudeDir, 'hooks');
  const settingsPath = path.join(claudeDir, 'settings.json');

  await ensureDir(claudeDir);
  await ensureDir(hooksDir);

  // Hook templates (embedded to survive esbuild bundling)
  const hookTemplates: Record<string, string> = {
    'session-start.sh': HOOK_SESSION_START,
    'context-turn.sh': HOOK_CONTEXT_TURN,
    'context-checkpoint.sh': HOOK_CONTEXT_CHECKPOINT,
    'session-end.sh': HOOK_SESSION_END,
  };

  for (const [filename, content] of Object.entries(hookTemplates)) {
    const dest = path.join(hooksDir, filename);

    // Don't overwrite existing hooks (user may have customized)
    if (fs.existsSync(dest)) continue;

    fs.writeFileSync(dest, content, { mode: 0o755 });
  }

  // Merge settings.json
  const hooksConfig: Record<string, any[]> = {
    SessionStart: [{ hooks: [{ type: 'command', command: 'bash .claude/hooks/session-start.sh' }] }],
    SessionEnd: [{ hooks: [{ type: 'command', command: 'bash .claude/hooks/session-end.sh' }] }],
    PreCompact: [{ hooks: [{ type: 'command', command: 'bash .claude/hooks/context-checkpoint.sh' }] }],
    Stop: [{ hooks: [{ type: 'command', command: 'bash .claude/hooks/context-turn.sh' }] }],
  };

  let existingSettings: any = {};
  if (fs.existsSync(settingsPath)) {
    try {
      existingSettings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    } catch {
      existingSettings = {};
    }
  }

  if (!existingSettings.hooks) {
    existingSettings.hooks = {};
  }

  for (const [event, hooks] of Object.entries(hooksConfig)) {
    if (!existingSettings.hooks[event]) {
      existingSettings.hooks[event] = hooks;
    } else {
      const existing = existingSettings.hooks[event] as any[];
      const existingCommands = new Set(existing.map((h: any) => h.hooks?.[0]?.command));
      for (const hook of hooks) {
        if (!existingCommands.has(hook.hooks?.[0]?.command)) {
          existing.push(hook);
        }
      }
    }
  }

  fs.writeFileSync(settingsPath, JSON.stringify(existingSettings, null, 2) + '\n');

  if (!nonInteractive) {
    console.log(chalk.green('  ✓ Claude Code hooks installed (.claude/hooks/)'));
  }
}

// ── Embedded hook templates ──────────────────────────────────────────

const HOOK_SESSION_START = `#!/usr/bin/env bash
# Claude Code hook: SessionStart
# Queries CV-Git knowledge graph for prior session knowledge.
set -euo pipefail

input=$(cat)
session_id=$(echo "$input" | grep -o '"session_id":"[^"]*"' | head -1 | cut -d'"' -f4 || true)

if [[ -n "$session_id" && -n "\${CLAUDE_ENV_FILE:-}" ]]; then
  echo "CV_SESSION_ID=\${session_id}" >> "$CLAUDE_ENV_FILE"
fi

files_csv=""
if git rev-parse --git-dir >/dev/null 2>&1; then
  changed=$(git diff --name-only HEAD 2>/dev/null | head -10 | tr '\\n' ',' || true)
  changed="\${changed%,}"
  [[ -n "$changed" ]] && files_csv="$changed"
fi

if [[ -n "$files_csv" ]]; then
  cv knowledge query --files "$files_csv" --exclude-session "\${session_id:-}" --limit 5 2>/dev/null || true
fi
`;

const HOOK_CONTEXT_TURN = `#!/usr/bin/env bash
# Claude Code hook: Stop (egress + pull)
set -euo pipefail

if [[ -z "\${CV_SESSION_ID:-}" ]]; then exit 0; fi

input=$(cat)

turn_file="/tmp/cv-turn-\${CV_SESSION_ID}"
if [[ -f "$turn_file" ]]; then
  turn_number=$(( $(cat "$turn_file") + 1 ))
else
  turn_number=1
fi
echo "$turn_number" > "$turn_file"

transcript_segment=""
if command -v python3 >/dev/null 2>&1; then
  transcript_segment=$(python3 -c "
import sys, json
try:
    d = json.loads(sys.stdin.read())
    print(d.get('last_assistant_message', '')[:2000])
except:
    print('')
" <<< "$input" 2>/dev/null || true)
fi

files_csv=""
if git rev-parse --git-dir >/dev/null 2>&1; then
  changed=$(git diff --name-only HEAD 2>/dev/null | head -20 | tr '\\n' ',' || true)
  changed="\${changed%,}"
  [[ -n "$changed" ]] && files_csv="$changed"
fi

if [[ -n "$transcript_segment" ]]; then
  cv knowledge egress \\
    --session-id "$CV_SESSION_ID" \\
    --turn "$turn_number" \\
    --transcript "$transcript_segment" \\
    \${files_csv:+--files "$files_csv"} \\
    --concern "codebase" \\
    >/dev/null 2>&1 &
fi

if [[ -n "$files_csv" ]]; then
  cv knowledge query --files "$files_csv" --exclude-session "$CV_SESSION_ID" --limit 3 2>/dev/null || true
fi
`;

const HOOK_CONTEXT_CHECKPOINT = `#!/usr/bin/env bash
# Claude Code hook: PreCompact
set -euo pipefail

if [[ -z "\${CV_SESSION_ID:-}" ]]; then exit 0; fi

input=$(cat)

summary=""
if command -v python3 >/dev/null 2>&1; then
  summary=$(python3 -c "
import sys, json
try:
    d = json.loads(sys.stdin.read())
    print(d.get('summary', '')[:5000])
except:
    print('')
" <<< "$input" 2>/dev/null || true)
fi

files_csv=""
if git rev-parse --git-dir >/dev/null 2>&1; then
  changed=$(git diff --name-only HEAD 2>/dev/null || true)
  staged=$(git diff --name-only --cached 2>/dev/null || true)
  all_files=$(echo -e "\${changed}\\n\${staged}" | sort -u | head -30 | tr '\\n' ',' || true)
  all_files="\${all_files%,}"
  [[ -n "$all_files" ]] && files_csv="$all_files"
fi

if [[ -n "$summary" ]]; then
  cv knowledge egress \\
    --session-id "$CV_SESSION_ID" \\
    --turn 9999 \\
    --transcript "$summary" \\
    \${files_csv:+--files "$files_csv"} \\
    --concern "checkpoint" \\
    >/dev/null 2>&1 || true
fi
`;

const HOOK_SESSION_END = `#!/usr/bin/env bash
# Claude Code hook: SessionEnd
set -euo pipefail

if [[ -z "\${CV_SESSION_ID:-}" ]]; then exit 0; fi
rm -f "/tmp/cv-turn-\${CV_SESSION_ID}" 2>/dev/null || true
`;

/**
 * Set up Ollama for local embeddings with smart detection
 */
async function setupOllamaEmbeddings(): Promise<'success' | 'skipped' | 'cloud-recommended'> {
  console.log(chalk.bold('\n🔍 Checking system for local AI capabilities...\n'));

  // Step 1: Check system requirements
  const sysReqs = checkSystemRequirements();

  console.log(chalk.gray('System Resources:'));
  console.log(chalk.gray(`  RAM: ${sysReqs.totalMemoryGB.toFixed(1)}GB total, ${sysReqs.availableMemoryGB.toFixed(1)}GB available`));
  console.log(chalk.gray(`  Disk: ${sysReqs.freeDiskGB.toFixed(1)}GB free`));
  console.log();

  // If system doesn't meet minimum requirements, recommend cloud
  if (!sysReqs.meetsMinimum) {
    console.log(chalk.yellow('⚠ Your system may struggle with local AI:'));
    sysReqs.issues.forEach(issue => console.log(chalk.yellow(`  - ${issue}`)));
    console.log();
    console.log(chalk.cyan('💡 Recommendation: Use a cloud embedding provider (OpenRouter or OpenAI)'));
    console.log(chalk.gray('   These provide faster embeddings without local resource usage.'));
    console.log(chalk.gray('   Run: cv config set embedding.provider openrouter'));
    console.log();
    return 'cloud-recommended';
  }

  if (!sysReqs.meetsRecommended) {
    console.log(chalk.yellow('⚠ Note: Your system meets minimum requirements but may be slow:'));
    sysReqs.issues.forEach(issue => console.log(chalk.yellow(`  - ${issue}`)));
    console.log();
  }

  // Step 2: Check current Ollama status
  console.log(chalk.gray('Checking Ollama installation...'));
  const ollamaStatus = await getOllamaStatus();

  // Case A: Ollama is already running
  if (ollamaStatus.running && ollamaStatus.url) {
    console.log(chalk.green(`✓ Ollama is already running (${ollamaStatus.installedVia})`));
    console.log(chalk.gray(`  URL: ${ollamaStatus.url}`));

    // Check for embedding model
    const hasEmbeddingModel = ollamaStatus.models.some(m => m.includes('nomic-embed'));
    if (hasEmbeddingModel) {
      console.log(chalk.green('✓ nomic-embed-text model ready'));
    } else {
      console.log(chalk.gray('  Pulling nomic-embed-text model...'));
      const port = parseInt(ollamaStatus.url.match(/:(\d+)/)?.[1] || '11434');
      const modelReady = await ensureOllamaModel(port, 'nomic-embed-text');
      if (modelReady) {
        console.log(chalk.green('✓ nomic-embed-text model ready'));
      } else {
        console.log(chalk.yellow('⚠ Model will be downloaded on first sync'));
      }
    }
    console.log();
    return 'success';
  }

  // Case B: Ollama is installed but not running
  if (ollamaStatus.installed && !ollamaStatus.running) {
    console.log(chalk.yellow(`⚠ Ollama is installed (${ollamaStatus.installedVia}) but not running`));

    if (ollamaStatus.installedVia === 'native') {
      console.log(chalk.gray('  Attempting to start Ollama...'));
      const started = await startNativeOllama();
      if (started) {
        console.log(chalk.green('✓ Ollama started successfully'));
        console.log(chalk.gray('  Pulling nomic-embed-text model...'));
        const modelReady = await ensureOllamaModel(11434, 'nomic-embed-text');
        if (modelReady) {
          console.log(chalk.green('✓ nomic-embed-text model ready'));
        }
        console.log();
        return 'success';
      } else {
        console.log(chalk.yellow('⚠ Could not start Ollama automatically'));
        console.log(chalk.gray('  Please start Ollama manually: ollama serve'));
      }
    } else {
      // Docker container exists but stopped
      console.log(chalk.gray('  Starting Ollama container...'));
      const result = await ensureOllama({ pullModel: true, model: 'nomic-embed-text' });
      if (result) {
        console.log(chalk.green('✓ Ollama container started'));
        if (result.modelReady) {
          console.log(chalk.green('✓ nomic-embed-text model ready'));
        }
        console.log(chalk.gray(`  URL: ${result.url}`));
        console.log();
        return 'success';
      }
    }
  }

  // Case C: Ollama not installed - offer to install
  console.log(chalk.gray('Ollama is not installed.'));
  console.log();

  // Check if we can install natively
  if (ollamaStatus.canInstallNative) {
    const { installChoice } = await inquirer.prompt([{
      type: 'list',
      name: 'installChoice',
      message: 'How would you like to set up Ollama?',
      choices: [
        { name: '🚀 Install Ollama natively (recommended)', value: 'native' },
        { name: '🐳 Use Docker container', value: 'docker' },
        { name: '☁️  Skip - use cloud embeddings instead', value: 'skip' },
      ],
    }]);

    if (installChoice === 'native') {
      console.log();
      console.log(chalk.gray('Installing Ollama...'));
      const installed = await installOllamaNative({
        onProgress: (msg) => console.log(chalk.gray(`  ${msg}`)),
      });

      if (installed) {
        console.log(chalk.green('✓ Ollama installed successfully'));

        // Start Ollama
        console.log(chalk.gray('  Starting Ollama...'));
        const started = await startNativeOllama();
        if (started) {
          console.log(chalk.green('✓ Ollama started'));
          console.log(chalk.gray('  Pulling nomic-embed-text model...'));
          const modelReady = await ensureOllamaModel(11434, 'nomic-embed-text');
          if (modelReady) {
            console.log(chalk.green('✓ nomic-embed-text model ready'));
          }
          console.log();
          return 'success';
        } else {
          console.log(chalk.yellow('⚠ Please start Ollama manually: ollama serve'));
        }
      } else {
        console.log(chalk.yellow('⚠ Installation failed. Falling back to Docker...'));
      }
    }

    if (installChoice === 'docker' || (installChoice === 'native' && !ollamaStatus.installed)) {
      // Fall through to Docker setup
    }

    if (installChoice === 'skip') {
      console.log();
      console.log(chalk.cyan('💡 To use cloud embeddings, run:'));
      console.log(chalk.gray('   cv auth setup openrouter'));
      console.log(chalk.gray('   cv config set embedding.provider openrouter'));
      console.log();
      return 'skipped';
    }
  }

  // Case D: Try Docker as fallback
  if (!isDockerAvailable()) {
    console.log(chalk.yellow('⚠ Docker is not available.'));
    console.log();
    console.log(chalk.cyan('💡 Options:'));
    console.log(chalk.gray('   1. Install Ollama: https://ollama.com/download'));
    console.log(chalk.gray('   2. Install Docker: https://docs.docker.com/get-docker/'));
    console.log(chalk.gray('   3. Use cloud embeddings: cv auth setup openrouter'));
    console.log();
    return 'skipped';
  }

  console.log(chalk.gray('Starting Ollama via Docker...'));

  try {
    const result = await ensureOllama({
      pullModel: true,
      model: 'nomic-embed-text',
    });

    if (result) {
      if (result.started) {
        console.log(chalk.green('✓ Ollama container started'));
      } else {
        console.log(chalk.green('✓ Ollama container already running'));
      }

      if (result.modelReady) {
        console.log(chalk.green('✓ nomic-embed-text model ready'));
      } else {
        console.log(chalk.yellow('⚠ Model will be downloaded on first sync'));
      }

      console.log(chalk.gray(`  URL: ${result.url}`));
      console.log();
      return 'success';
    } else {
      console.log(chalk.yellow('⚠ Could not start Ollama container'));
      console.log(chalk.gray('  Embeddings will be set up during first sync'));
      console.log();
      return 'skipped';
    }
  } catch (error: any) {
    console.log(chalk.yellow(`⚠ Ollama setup warning: ${error.message}`));
    console.log(chalk.gray('  Embeddings will be set up during first sync'));
    console.log();
    return 'skipped';
  }
}
