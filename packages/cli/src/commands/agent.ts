/**
 * cv agent command
 *
 * Listens for tasks dispatched from Claude.ai via CV-Hub and executes them
 * with Claude Code. The agent registers as an executor, polls for tasks,
 * launches Claude Code in print mode, and reports results back.
 *
 * Usage:
 *   cv agent                          # Start listening in current directory
 *   cv agent --machine z840-primary   # Override machine name
 *   cv agent --poll-interval 10       # Check every 10 seconds
 *   cv agent --auto-approve           # Don't prompt for file changes
 */

import { Command } from 'commander';
import { spawn, execSync, type ChildProcess } from 'node:child_process';
import { promises as fs } from 'node:fs';
import chalk from 'chalk';
import { addGlobalOptions, createOutput } from '../utils/output.js';
import {
  readCredentials,
  getMachineName,
  type CVHubCredentials,
} from '../utils/cv-hub-credentials.js';

// ============================================================================
// Types
// ============================================================================

interface AgentOptions {
  machine?: string;
  pollInterval: string;
  workingDir: string;
  autoApprove: boolean;
  verbose?: boolean;
  json?: boolean;
}

interface AgentState {
  executorId: string;
  currentTaskId: string | null;
  completedCount: number;
  failedCount: number;
  lastPoll: number;
  lastTaskEnd: number;
  running: boolean;
}

interface Task {
  id: string;
  title: string;
  description?: string;
  task_type: string;
  priority: string;
  status: string;
  input?: { description?: string; context?: string; instructions?: string[]; constraints?: string[] };
  repository_id?: string;
  branch?: string;
  file_paths?: string[];
  timeout_at?: string;
  metadata?: Record<string, unknown>;
}

// ============================================================================
// API helpers
// ============================================================================

async function apiCall(
  creds: CVHubCredentials,
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  const url = `${creds.CV_HUB_API}${path}`;
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${creds.CV_HUB_PAT}`,
    'Content-Type': 'application/json',
  };
  return fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function registerExecutor(
  creds: CVHubCredentials,
  machineName: string,
  workingDir: string,
): Promise<{ id: string; name: string }> {
  const hostname = (await import('node:os')).hostname();
  const res = await apiCall(creds, 'POST', '/api/v1/executors', {
    name: `cv-agent:${machineName}`,
    machine_name: machineName,
    type: 'claude_code',
    workspace_root: workingDir,
    capabilities: {
      tools: ['bash', 'read', 'write', 'edit', 'glob', 'grep'],
      maxConcurrentTasks: 1,
    },
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to register executor: ${res.status} ${err}`);
  }

  const data = await res.json() as any;
  return { id: data.executor.id, name: data.executor.name };
}

async function pollForTask(
  creds: CVHubCredentials,
  executorId: string,
): Promise<Task | null> {
  const res = await apiCall(creds, 'POST', `/api/v1/executors/${executorId}/poll`);
  if (!res.ok) throw new Error(`Poll failed: ${res.status}`);
  const data = await res.json() as any;
  return data.task || null;
}

async function startTask(
  creds: CVHubCredentials,
  executorId: string,
  taskId: string,
): Promise<void> {
  const res = await apiCall(creds, 'POST', `/api/v1/executors/${executorId}/tasks/${taskId}/start`);
  if (!res.ok) throw new Error(`Start failed: ${res.status}`);
}

async function completeTask(
  creds: CVHubCredentials,
  executorId: string,
  taskId: string,
  result: Record<string, unknown>,
): Promise<void> {
  const res = await apiCall(creds, 'POST', `/api/v1/executors/${executorId}/tasks/${taskId}/complete`, result);
  if (!res.ok) throw new Error(`Complete failed: ${res.status}`);
}

async function failTask(
  creds: CVHubCredentials,
  executorId: string,
  taskId: string,
  error: string,
): Promise<void> {
  const res = await apiCall(creds, 'POST', `/api/v1/executors/${executorId}/tasks/${taskId}/fail`, { error });
  if (!res.ok) throw new Error(`Fail failed: ${res.status}`);
}

async function sendHeartbeat(
  creds: CVHubCredentials,
  executorId: string,
  taskId?: string,
  message?: string,
): Promise<void> {
  // Executor heartbeat
  await apiCall(creds, 'POST', `/api/v1/executors/${executorId}/heartbeat`).catch(() => {});
  // Task heartbeat (if running)
  if (taskId) {
    const body = message ? { message, log_type: 'heartbeat' } : undefined;
    await apiCall(creds, 'POST', `/api/v1/executors/${executorId}/tasks/${taskId}/heartbeat`, body).catch(() => {});
  }
}

async function sendTaskLog(
  creds: CVHubCredentials,
  executorId: string,
  taskId: string,
  logType: string,
  message: string,
  details?: Record<string, unknown>,
  progressPct?: number,
): Promise<void> {
  await apiCall(creds, 'POST', `/api/v1/executors/${executorId}/tasks/${taskId}/log`, {
    log_type: logType,
    message,
    ...(details ? { details } : {}),
    ...(progressPct !== undefined ? { progress_pct: progressPct } : {}),
  }).catch(() => {});
}

async function markOffline(
  creds: CVHubCredentials,
  executorId: string,
): Promise<void> {
  await apiCall(creds, 'POST', `/api/v1/executors/${executorId}/offline`).catch(() => {});
}

// ============================================================================
// Claude Code launcher
// ============================================================================

function buildClaudePrompt(task: Task): string {
  let prompt = '';
  prompt += `You are executing a task dispatched from Claude.ai via CV-Hub.\n\n`;
  prompt += `## Task: ${task.title}\n`;
  prompt += `Task ID: ${task.id}\n`;
  prompt += `Priority: ${task.priority}\n`;

  if (task.branch) prompt += `Branch: ${task.branch}\n`;
  if (task.file_paths?.length) prompt += `Focus files: ${task.file_paths.join(', ')}\n`;

  prompt += `\n`;

  // Main instructions
  if (task.description) {
    prompt += task.description;
  } else if (task.input?.description) {
    prompt += task.input.description;
  }

  if (task.input?.context) {
    prompt += `\n\n## Context\n${task.input.context}`;
  }

  if (task.input?.instructions?.length) {
    prompt += `\n\n## Instructions\n`;
    task.input.instructions.forEach((i, idx) => {
      prompt += `${idx + 1}. ${i}\n`;
    });
  }

  if (task.input?.constraints?.length) {
    prompt += `\n\n## Constraints\n`;
    task.input.constraints.forEach(c => {
      prompt += `- ${c}\n`;
    });
  }

  prompt += `\n\n---\n`;
  prompt += `When complete, provide a brief summary of what you accomplished.\n`;

  return prompt;
}

/** Shared reference to current child process so signal handlers can kill it */
let _activeChild: ChildProcess | null = null;

/** Signal handling state */
let _sigintCount = 0;
let _sigintTimer: ReturnType<typeof setTimeout> | null = null;
let _signalHandlerInstalled = false;

function installSignalHandlers(
  getState: () => AgentState,
  cleanup: () => Promise<void>,
): void {
  if (_signalHandlerInstalled) return;
  _signalHandlerInstalled = true;

  process.on('SIGINT', async () => {
    // No task running — exit agent immediately
    if (!_activeChild) {
      console.log('\n' + chalk.gray('👋 Agent stopped.'));
      await cleanup();
      process.exit(0);
    }

    _sigintCount++;

    if (_sigintCount === 1) {
      console.log(`\n${chalk.yellow('⚠')} Press Ctrl+C again within 3s to abort task.`);
      _sigintTimer = setTimeout(() => { _sigintCount = 0; }, 3000);
      return;
    }

    // Second Ctrl+C within window — kill child, stay running
    if (_sigintTimer) clearTimeout(_sigintTimer);
    console.log(`\n${chalk.red('🛑')} Aborting task...`);
    try { _activeChild.kill('SIGKILL'); } catch {}
    _activeChild = null;
    _sigintCount = 0;
    // The child's 'close' event will fire with signal='SIGKILL',
    // resolving the promise and returning to the listen loop.
  });

  process.on('SIGTERM', async () => {
    console.log(`\n${chalk.gray('⏹')} Received SIGTERM, shutting down...`);
    if (_activeChild) {
      try { _activeChild.kill('SIGKILL'); } catch {}
      _activeChild = null;
    }
    await cleanup();
    process.exit(0);
  });
}

// ============================================================================
// Permission prompt relay
// ============================================================================

/**
 * Patterns that indicate Claude Code is waiting for permission approval.
 * These are matched against stripped (ANSI-free) stdout lines.
 */
const PERMISSION_PATTERNS = [
  // "Allow <tool>? (Y/n)" style
  /Allow .+\?\s*\(Y\/n\)/i,
  // "Do you want to" style
  /Do you want to .+\?\s*\(Y\/n\)/i,
  // Generic tool approval
  /\(Y\/n\)\s*$/,
  // "Allow once" / "Allow always" style menus
  /Allow\s+\w+.*\?\s*$/i,
];

/** Strip ANSI escape codes from a string */
function stripAnsi(str: string): string {
  return str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '').replace(/\x1B\].*?\x07/g, '');
}

/** Check if a line looks like a permission prompt */
function isPermissionPrompt(line: string): boolean {
  const clean = stripAnsi(line).trim();
  return PERMISSION_PATTERNS.some(p => p.test(clean));
}

/** Extract the prompt text from a buffer of recent output */
function extractPromptText(buffer: string): string {
  const lines = stripAnsi(buffer).split('\n').filter(l => l.trim());
  // Take the last few meaningful lines as context
  return lines.slice(-5).join('\n').trim();
}

interface PromptRelayContext {
  creds: CVHubCredentials;
  executorId: string;
  taskId: string;
}

async function createPromptAndWaitForResponse(
  ctx: PromptRelayContext,
  promptText: string,
): Promise<string> {
  // Create the prompt via API
  const createRes = await apiCall(ctx.creds, 'POST', `/api/v1/tasks/${ctx.taskId}/prompts`, {
    prompt_type: 'approval',
    prompt_text: promptText,
    options: ['Yes', 'No'],
    context: { source: 'claude_code_permission' },
    expires_in_minutes: 30,
  });

  if (!createRes.ok) {
    console.log(chalk.yellow('  ⚠ Failed to relay prompt to CV-Hub, auto-approving'));
    return 'y';
  }

  const promptData = await createRes.json() as any;
  const promptId = promptData.id;

  console.log(chalk.cyan('  📡') + ' Permission prompt relayed to CV-Hub (waiting for response...)');

  // Poll for response
  const pollStart = Date.now();
  const timeout = 30 * 60 * 1000; // 30 minutes

  while (Date.now() - pollStart < timeout) {
    await new Promise(r => setTimeout(r, 3000));

    try {
      const res = await apiCall(ctx.creds, 'GET', `/api/v1/tasks/${ctx.taskId}/prompts`);
      if (!res.ok) continue;

      const data = await res.json() as any;
      const prompt = data.prompts?.find((p: any) => p.id === promptId);
      if (prompt?.response) {
        const answer = prompt.response.toLowerCase().trim();
        console.log(chalk.cyan('  📡') + ` Got response: ${prompt.response}`);
        // Map to y/n for Claude Code
        if (answer === 'yes' || answer === 'y' || answer === 'allow') {
          return 'y';
        }
        return 'n';
      }
    } catch {
      // Network error, keep polling
    }
  }

  console.log(chalk.yellow('  ⚠ Prompt timed out, defaulting to "no"'));
  return 'n';
}

async function launchClaudeCode(
  prompt: string,
  options: { cwd: string; autoApprove: boolean },
  relayCtx?: PromptRelayContext,
): Promise<{ exitCode: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const args: string[] = ['-p', prompt];

    let canSkipPermissions = false;
    if (options.autoApprove) {
      const isRoot = process.getuid?.() === 0;
      if (isRoot) {
        console.log(chalk.yellow('⚠') + ' Running as root — --dangerously-skip-permissions unavailable');
        if (relayCtx) {
          console.log(chalk.cyan('📡') + ' Permission prompts will be relayed through CV-Hub');
        }
      } else {
        args.push('--dangerously-skip-permissions');
        canSkipPermissions = true;
      }
    }

    // If we can skip permissions, inherit stdio for best UX.
    // Otherwise pipe stdout+stdin so we can intercept permission prompts.
    const needsRelay = !canSkipPermissions && !!relayCtx;
    const child = spawn('claude', args, {
      cwd: options.cwd,
      stdio: needsRelay
        ? ['pipe', 'pipe', 'pipe']
        : ['inherit', 'inherit', 'pipe'],
      env: { ...process.env },
    });

    _activeChild = child;
    let stderr = '';

    child.stderr?.on('data', (data: Buffer) => {
      const text = data.toString();
      stderr += text;
      process.stderr.write(data);
    });

    if (needsRelay && relayCtx) {
      // Tee stdout to terminal while scanning for permission prompts
      let recentOutput = '';

      child.stdout?.on('data', (data: Buffer) => {
        const text = data.toString();
        process.stdout.write(data); // tee to terminal

        recentOutput += text;
        // Keep a rolling window of recent output
        if (recentOutput.length > 4000) {
          recentOutput = recentOutput.slice(-2000);
        }

        // Check if the latest chunk contains a permission prompt
        if (isPermissionPrompt(text)) {
          const promptText = extractPromptText(recentOutput);

          // Async: relay and pipe response, don't block the stream
          createPromptAndWaitForResponse(relayCtx, promptText)
            .then((answer) => {
              try {
                child.stdin?.write(answer + '\n');
              } catch {
                // stdin may be closed
              }
            })
            .catch(() => {
              // Fallback: approve if relay fails
              try { child.stdin?.write('y\n'); } catch {}
            });
        }
      });

      // Forward process stdin to child stdin for manual intervention
      if (process.stdin.isTTY) {
        process.stdin.setRawMode?.(false);
        process.stdin.pipe(child.stdin!);
      }
    }

    child.on('close', (code, signal) => {
      _activeChild = null;
      if (needsRelay && process.stdin.isTTY) {
        process.stdin.unpipe();
      }
      if (signal === 'SIGKILL') {
        resolve({ exitCode: 137, stderr });
      } else {
        resolve({ exitCode: code ?? 1, stderr });
      }
    });

    child.on('error', (err) => {
      _activeChild = null;
      reject(err);
    });
  });
}

// ============================================================================
// Git helpers
// ============================================================================

function getChangedFiles(cwd: string): string[] {
  try {
    const stdout = execSync('git diff --name-only HEAD~1 2>/dev/null', {
      cwd,
      encoding: 'utf-8',
      timeout: 5000,
    });
    return stdout.trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

function getLatestCommit(cwd: string): string | null {
  try {
    return execSync('git rev-parse HEAD 2>/dev/null', {
      cwd,
      encoding: 'utf-8',
      timeout: 5000,
    }).trim();
  } catch {
    return null;
  }
}

// ============================================================================
// Display helpers
// ============================================================================

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return `${m}m ${rem}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function setTerminalTitle(title: string): void {
  if (process.stdout.isTTY) {
    process.stdout.write(`\x1b]0;${title}\x07`);
  }
}

function printBanner(
  status: 'COMPLETED' | 'FAILED' | 'ABORTED',
  elapsed: string,
  changedFiles: string[],
  commitSha: string | null,
): void {
  const color = status === 'COMPLETED' ? chalk.green : status === 'ABORTED' ? chalk.yellow : chalk.red;
  const icon = status === 'COMPLETED' ? '✅' : status === 'ABORTED' ? '⏹' : '❌';

  console.log(color('┌─────────────────────────────────────────────────────────────┐'));
  console.log(color(`│ ${icon} ${status.padEnd(57)}│`));
  console.log(color(`│ Duration: ${elapsed.padEnd(49)}│`));
  if (changedFiles.length > 0) {
    const shown = changedFiles.slice(0, 3);
    const fileStr = shown.join(', ') + (changedFiles.length > 3 ? ` and ${changedFiles.length - 3} more` : '');
    console.log(color(`│ Files: ${fileStr.substring(0, 51).padEnd(51)}│`));
  }
  if (commitSha) {
    console.log(color(`│ Commit: ${commitSha.substring(0, 8).padEnd(51)}│`));
  }
  console.log(color('└─────────────────────────────────────────────────────────────┘'));
}

function updateStatusLine(state: AgentState): void {
  const idle = formatDuration(Date.now() - state.lastTaskEnd);
  const poll = formatDuration(Date.now() - state.lastPoll);
  const line = `\r${chalk.cyan('🔄')} Listening... (${idle} idle) | Last poll: ${poll} ago | Completed: ${state.completedCount} | Failed: ${state.failedCount}`;
  process.stdout.write(`\r\x1b[K${line}`);
}

// ============================================================================
// Retry logic
// ============================================================================

async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  maxRetries = 3,
): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (err: any) {
      if (i === maxRetries - 1) throw err;
      const delay = (i + 1) * 5;
      console.log(`\n${chalk.yellow('⚠')} ${label} failed, retrying in ${delay}s... (${err.message})`);
      await new Promise(r => setTimeout(r, delay * 1000));
    }
  }
  throw new Error('unreachable');
}

// ============================================================================
// Main agent loop
// ============================================================================

async function runAgent(options: AgentOptions): Promise<void> {
  // ── Credential check ──────────────────────────────────────────────
  const creds = await readCredentials();

  // Default API URL if not set
  if (!creds.CV_HUB_API) {
    creds.CV_HUB_API = 'https://api.hub.controlvector.io';
  }

  if (!creds.CV_HUB_PAT) {
    console.log();
    console.log(chalk.red('⚠ Not authenticated.') + ' Run ' + chalk.cyan('cv auth login') + ' first.');
    console.log();
    console.log(chalk.bold('Quick setup:'));
    console.log(`  ${chalk.cyan('cv auth login')}                    # Authenticate`);
    console.log(`  ${chalk.cyan('cd ~/project/my-project')}          # Go to your project`);
    console.log(`  ${chalk.cyan('cv init -y')}                       # Install hooks`);
    console.log(`  ${chalk.cyan('cv agent')}                         # Start listening`);
    console.log();
    process.exit(1);
  }

  // ── Claude Code check ─────────────────────────────────────────────
  try {
    execSync('claude --version', { stdio: 'pipe', timeout: 5000 });
  } catch {
    console.log();
    console.log(chalk.red('❌ Claude Code CLI not found.') + ' Install it first:');
    console.log(`   ${chalk.cyan('npm install -g @anthropic-ai/claude-code')}`);
    console.log();
    process.exit(1);
  }

  // ── Configuration ─────────────────────────────────────────────────
  const machineName = options.machine || await getMachineName();
  const pollInterval = Math.max(3, parseInt(options.pollInterval, 10)) * 1000;
  const workingDir = options.workingDir;

  if (!options.machine && !creds.CV_HUB_MACHINE_NAME) {
    console.log();
    console.log(chalk.yellow('⚠') + ` No machine name set. Registering as "${chalk.bold(machineName)}".`);
    console.log(chalk.gray(`  Run 'cv init' to set a friendly name, or use --machine <name>.`));
    console.log();
  }

  // ── Register executor ─────────────────────────────────────────────
  const executor = await withRetry(
    () => registerExecutor(creds, machineName, workingDir),
    'Executor registration',
  );

  // ── Display banner ────────────────────────────────────────────────
  console.log();
  console.log(chalk.bold('🤖 CV-Hub Agent'));
  console.log(`   Machine:  ${chalk.cyan(machineName)}`);
  console.log(`   Executor: ${chalk.gray(executor.id)}`);
  console.log(`   API:      ${chalk.gray(creds.CV_HUB_API)}`);
  console.log(`   Dir:      ${chalk.gray(workingDir)}`);
  console.log(`   Polling:  every ${options.pollInterval}s`);
  console.log(`   Ctrl+C to stop`);
  console.log();
  console.log(chalk.cyan('🔄') + ' Listening for tasks...');
  console.log();

  // ── Agent state ───────────────────────────────────────────────────
  const state: AgentState = {
    executorId: executor.id,
    currentTaskId: null,
    completedCount: 0,
    failedCount: 0,
    lastPoll: Date.now(),
    lastTaskEnd: Date.now(),
    running: true,
  };

  // ── Signal handlers ─────────────────────────────────────────────
  installSignalHandlers(
    () => state,
    async () => {
      state.running = false;
      await markOffline(creds, state.executorId);
    },
  );

  // ── Main loop ─────────────────────────────────────────────────────
  while (state.running) {
    try {
      // Poll for task
      const task = await withRetry(
        () => pollForTask(creds, state.executorId),
        'Task poll',
      );
      state.lastPoll = Date.now();

      if (task) {
        await executeTask(task, state, creds, options);
      } else {
        // Update status line while idle
        updateStatusLine(state);
      }
    } catch (err: any) {
      console.log(`\n${chalk.red('⚠')} Error: ${err.message}`);
    }

    // Wait for next poll
    await new Promise(r => setTimeout(r, pollInterval));
  }
}

async function executeTask(
  task: Task,
  state: AgentState,
  creds: CVHubCredentials,
  options: AgentOptions,
): Promise<void> {
  const startTime = Date.now();
  state.currentTaskId = task.id;

  // Clear status line
  process.stdout.write('\r\x1b[K');

  // ── Task header ───────────────────────────────────────────────────
  console.log(chalk.bold('┌─────────────────────────────────────────────────────────────┐'));
  console.log(chalk.bold(`│ 📋 Task: ${(task.title || '').substring(0, 50).padEnd(50)}│`));
  console.log(chalk.bold(`│ ID: ${task.id.padEnd(55)}│`));
  console.log(chalk.bold(`│ Priority: ${task.priority.padEnd(49)}│`));
  console.log(chalk.bold('└─────────────────────────────────────────────────────────────┘'));
  console.log();

  // ── Mark task as running ──────────────────────────────────────────
  try {
    await startTask(creds, state.executorId, task.id);
    setTerminalTitle(`cv-agent: ${task.title} (starting...)`);
    sendTaskLog(creds, state.executorId, task.id, 'lifecycle', 'Task started, launching Claude Code');
  } catch (err: any) {
    console.log(chalk.red(`❌ Failed to start task: ${err.message}`));
    state.currentTaskId = null;
    return;
  }

  // ── Heartbeat timer ───────────────────────────────────────────────
  const heartbeatTimer = setInterval(async () => {
    try {
      const elapsed = formatDuration(Date.now() - startTime);
      setTerminalTitle(`cv-agent: ${task.title} (${elapsed})`);
      await sendHeartbeat(creds, state.executorId, task.id, `Claude Code running (${elapsed} elapsed)`);
    } catch {}
  }, 30_000);

  // ── Timeout timer ─────────────────────────────────────────────────
  let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
  if (task.timeout_at) {
    const timeoutMs = new Date(task.timeout_at).getTime() - Date.now();
    if (timeoutMs > 0) {
      timeoutTimer = setTimeout(() => {
        console.log(`\n${chalk.red('⏰')} Task timed out after ${formatDuration(timeoutMs)}`);
        // activeProcess is set during launchClaudeCode
        // The signal will cause the promise to resolve with non-zero exit
      }, timeoutMs);
    }
  }

  // ── Build prompt and launch ───────────────────────────────────────
  const prompt = buildClaudePrompt(task);

  try {
    console.log(chalk.cyan('🚀') + ' Launching Claude Code...');
    console.log(chalk.gray('─'.repeat(60)));

    const relayCtx: PromptRelayContext = {
      creds,
      executorId: state.executorId,
      taskId: task.id,
    };

    const result = await launchClaudeCode(prompt, {
      cwd: options.workingDir,
      autoApprove: options.autoApprove,
    }, relayCtx);

    console.log(chalk.gray('\n' + '─'.repeat(60)));

    const elapsed = formatDuration(Date.now() - startTime);
    const changedFiles = getChangedFiles(options.workingDir);
    const commitSha = getLatestCommit(options.workingDir);

    if (result.exitCode === 0) {
      if (changedFiles.length > 0) {
        sendTaskLog(creds, state.executorId, task.id, 'git',
          `${changedFiles.length} file(s) changed`,
          { files: changedFiles.slice(0, 20) });
      }

      sendTaskLog(creds, state.executorId, task.id, 'lifecycle',
        `Claude Code completed successfully (${elapsed})`, undefined, 100);

      console.log();
      printBanner('COMPLETED', elapsed, changedFiles, commitSha);

      const summary = changedFiles.length
        ? `Completed in ${elapsed}. Modified ${changedFiles.length} file(s): ${changedFiles.slice(0, 10).join(', ')}${changedFiles.length > 10 ? '...' : ''}`
        : `Completed in ${elapsed}. No files changed.`;

      await withRetry(
        () => completeTask(creds, state.executorId, task.id, {
          summary,
          files_modified: changedFiles,
          commit_sha: commitSha,
        }),
        'Report completion',
      );
      state.completedCount++;

      console.log(chalk.gray('   Reported to CV-Hub.'));
    } else if (result.exitCode === 137) {
      sendTaskLog(creds, state.executorId, task.id, 'lifecycle',
        'Task aborted by user (Ctrl+C)');

      console.log();
      printBanner('ABORTED', elapsed, [], null);

      try {
        await failTask(creds, state.executorId, task.id, 'Aborted by user (Ctrl+C)');
      } catch {}
      state.failedCount++;
    } else {
      const stderrTail = result.stderr.trim().slice(-500);
      sendTaskLog(creds, state.executorId, task.id, 'lifecycle',
        `Claude Code exited with code ${result.exitCode} (${elapsed})`,
        stderrTail ? { stderr_tail: stderrTail } : undefined);

      console.log();
      printBanner('FAILED', elapsed, changedFiles, commitSha);

      const errorDetail = result.stderr.trim()
        ? `${result.stderr.trim().slice(-1500)}\n\nExit code ${result.exitCode} after ${elapsed}.`
        : `Claude Code exited with code ${result.exitCode} after ${elapsed}.`;

      await withRetry(
        () => failTask(creds, state.executorId, task.id, errorDetail),
        'Report failure',
      );
      state.failedCount++;
    }
  } catch (err: any) {
    console.log(`\n${chalk.red('❌')} Task error: ${err.message}`);

    sendTaskLog(creds, state.executorId, task.id, 'error',
      `Agent error: ${err.message}`);

    try {
      await failTask(creds, state.executorId, task.id, err.message);
    } catch {}
    state.failedCount++;
  } finally {
    clearInterval(heartbeatTimer);
    if (timeoutTimer) clearTimeout(timeoutTimer);
    state.currentTaskId = null;
    state.lastTaskEnd = Date.now();
  }

  setTerminalTitle('cv-agent: listening...');
  console.log();
  console.log(chalk.cyan('🔄') + ' Listening for tasks...');
  console.log();
}

// ============================================================================
// Command definition
// ============================================================================

export function agentCommand(): Command {
  const cmd = new Command('agent');
  cmd.description('Listen for tasks dispatched from Claude.ai and execute them with Claude Code');

  cmd.option('--machine <name>', 'Machine name override');
  cmd.option('--poll-interval <seconds>', 'How often to check for tasks', '5');
  cmd.option('--working-dir <path>', 'Working directory for Claude Code', process.cwd());
  cmd.option('--auto-approve', 'Skip file change confirmations (uses --dangerously-skip-permissions)', false);

  addGlobalOptions(cmd);

  cmd.action(async (options: AgentOptions) => {
    await runAgent(options);
  });

  return cmd;
}
