/**
 * Git state tracking for the cv-git agent.
 *
 * Captures pre-task and post-task git state so the agent can report
 * structured diffs, commit info, and file change details back to CV-Hub.
 */

import { execSync } from 'node:child_process';

// ============================================================================
// Types
// ============================================================================

export interface PreTaskState {
  headSha: string | null;
  branch: string | null;
  remote: string | null;
  workingDir: string;
}

export interface PostTaskState {
  headSha: string | null;
  branch: string | null;
  filesAdded: string[];
  filesModified: string[];
  filesDeleted: string[];
  linesAdded: number;
  linesDeleted: number;
  commitMessages: string[];
  pushStatus: 'success' | 'not_pushed' | 'failed' | 'no_remote';
  pushRemote: string | null;
}

export interface TaskCompletionPayload {
  summary: string;
  commit: {
    sha: string | null;
    branch: string | null;
    remote: string | null;
    push_status: string;
    messages: string[];
  };
  files: {
    added: string[];
    modified: string[];
    deleted: string[];
    total_changed: number;
  };
  stats: {
    lines_added: number;
    lines_deleted: number;
    duration_seconds: number;
  };
  exit_code: number;
}

// ============================================================================
// Helpers
// ============================================================================

/** Run a git command, return trimmed stdout or null on failure */
export function gitExec(cmd: string, cwd: string): string | null {
  try {
    return execSync(cmd, { cwd, encoding: 'utf-8', timeout: 10000 }).trim();
  } catch {
    return null;
  }
}

// ============================================================================
// Pre-task state
// ============================================================================

export function capturePreTaskState(cwd: string): PreTaskState {
  return {
    headSha: gitExec('git rev-parse HEAD', cwd),
    branch: gitExec('git rev-parse --abbrev-ref HEAD', cwd),
    remote: gitExec('git remote get-url origin', cwd),
    workingDir: cwd,
  };
}

// ============================================================================
// Post-task state
// ============================================================================

export function capturePostTaskState(cwd: string, preState: PreTaskState): PostTaskState {
  const headSha = gitExec('git rev-parse HEAD', cwd);
  const branch = gitExec('git rev-parse --abbrev-ref HEAD', cwd);

  let filesAdded: string[] = [];
  let filesModified: string[] = [];
  let filesDeleted: string[] = [];
  let linesAdded = 0;
  let linesDeleted = 0;
  let commitMessages: string[] = [];

  if (preState.headSha && headSha && preState.headSha !== headSha) {
    // HEAD changed — diff between pre and post
    const diffOutput = gitExec(
      `git diff --name-status ${preState.headSha}..${headSha}`,
      cwd,
    );

    if (diffOutput) {
      for (const line of diffOutput.split('\n')) {
        const [status, ...pathParts] = line.split('\t');
        const filepath = pathParts.join('\t');
        if (!filepath) continue;

        if (status === 'A') filesAdded.push(filepath);
        else if (status === 'M') filesModified.push(filepath);
        else if (status === 'D') filesDeleted.push(filepath);
        else if (status?.startsWith('R')) {
          filesDeleted.push(pathParts[0]);
          if (pathParts[1]) filesAdded.push(pathParts[1]);
        }
      }
    }

    // Line stats
    const statOutput = gitExec(
      `git diff --shortstat ${preState.headSha}..${headSha}`,
      cwd,
    );
    if (statOutput) {
      const addMatch = statOutput.match(/(\d+) insertion/);
      const delMatch = statOutput.match(/(\d+) deletion/);
      linesAdded = addMatch ? parseInt(addMatch[1], 10) : 0;
      linesDeleted = delMatch ? parseInt(delMatch[1], 10) : 0;
    }

    // Commit messages
    const logOutput = gitExec(
      `git log --oneline ${preState.headSha}..${headSha}`,
      cwd,
    );
    if (logOutput) {
      commitMessages = logOutput.split('\n').filter(Boolean);
    }
  } else if (!preState.headSha && headSha) {
    // Repo was empty, everything is new
    const allFiles = gitExec('git ls-files', cwd);
    if (allFiles) {
      filesAdded = allFiles.split('\n').filter(Boolean);
    }
  } else {
    // HEAD unchanged — check for uncommitted changes
    const statusOutput = gitExec('git status --porcelain', cwd);
    if (statusOutput) {
      for (const line of statusOutput.split('\n')) {
        const status = line.substring(0, 2).trim();
        const filepath = line.substring(3);
        if (!filepath) continue;

        if (status === '??' || status === 'A') filesAdded.push(filepath);
        else if (status === 'M') filesModified.push(filepath);
        else if (status === 'D') filesDeleted.push(filepath);
      }
    }
  }

  // Push status
  let pushStatus: PostTaskState['pushStatus'] = 'not_pushed';
  let pushRemote: string | null = null;

  const remote = gitExec('git remote get-url origin', cwd);
  if (!remote) {
    pushStatus = 'no_remote';
  } else {
    pushRemote = remote;
    if (headSha && branch) {
      const remoteRef = gitExec(`git ls-remote origin ${branch}`, cwd);
      if (remoteRef && remoteRef.includes(headSha)) {
        pushStatus = 'success';
      }
    }
  }

  return {
    headSha,
    branch,
    filesAdded,
    filesModified,
    filesDeleted,
    linesAdded,
    linesDeleted,
    commitMessages,
    pushStatus,
    pushRemote,
  };
}

// ============================================================================
// Structured completion payload
// ============================================================================

export function buildCompletionPayload(
  exitCode: number,
  preState: PreTaskState,
  postState: PostTaskState,
  startTime: number,
): TaskCompletionPayload {
  const durationSec = Math.floor((Date.now() - startTime) / 1000);
  const durationStr = durationSec >= 60
    ? `${Math.floor(durationSec / 60)}m ${durationSec % 60}s`
    : `${durationSec}s`;

  const totalChanged =
    postState.filesAdded.length +
    postState.filesModified.length +
    postState.filesDeleted.length;

  const parts: string[] = [`Completed in ${durationStr}.`];

  if (totalChanged > 0) {
    parts.push(
      `${totalChanged} file(s) changed (+${postState.linesAdded}/-${postState.linesDeleted}).`,
    );
  } else {
    parts.push('No file changes detected.');
  }

  if (postState.headSha && postState.headSha !== preState.headSha) {
    parts.push(`Commit: ${postState.headSha.substring(0, 8)}`);
  }

  if (postState.pushStatus === 'success') {
    parts.push('Pushed to remote.');
  } else if (postState.pushStatus === 'not_pushed') {
    parts.push('Not pushed to remote.');
  }

  return {
    summary: parts.join(' '),
    commit: {
      sha: postState.headSha,
      branch: postState.branch,
      remote: postState.pushRemote,
      push_status: postState.pushStatus,
      messages: postState.commitMessages,
    },
    files: {
      added: postState.filesAdded,
      modified: postState.filesModified,
      deleted: postState.filesDeleted,
      total_changed: totalChanged,
    },
    stats: {
      lines_added: postState.linesAdded,
      lines_deleted: postState.linesDeleted,
      duration_seconds: durationSec,
    },
    exit_code: exitCode,
  };
}

// ============================================================================
// Git remote verification
// ============================================================================

export function verifyGitRemote(
  cwd: string,
  task: { owner?: string; repo?: string },
  gitHost: string,
): { remoteName: string; remoteUrl: string } | null {
  if (!task.owner || !task.repo) return null;

  const expectedRemote = `https://${gitHost}/${task.owner}/${task.repo}.git`;
  const currentRemote = gitExec('git remote get-url origin', cwd);

  if (!currentRemote) {
    // No remote — add origin
    try {
      execSync(`git remote add origin ${expectedRemote}`, { cwd, timeout: 5000 });
    } catch { /* remote may already exist without URL */ }
    return { remoteName: 'origin', remoteUrl: expectedRemote };
  }

  if (currentRemote === expectedRemote) {
    // Already correct
    return { remoteName: 'origin', remoteUrl: expectedRemote };
  }

  if (currentRemote.includes(gitHost)) {
    // Wrong CV-Hub namespace — fix origin
    try {
      execSync(`git remote set-url origin ${expectedRemote}`, { cwd, timeout: 5000 });
    } catch {}
    return { remoteName: 'origin', remoteUrl: expectedRemote };
  }

  // External remote (GitHub etc) — add cv-hub as secondary
  const cvRemote = gitExec('git remote get-url cv-hub', cwd);
  if (!cvRemote) {
    try {
      execSync(`git remote add cv-hub ${expectedRemote}`, { cwd, timeout: 5000 });
    } catch {}
  } else if (cvRemote !== expectedRemote) {
    try {
      execSync(`git remote set-url cv-hub ${expectedRemote}`, { cwd, timeout: 5000 });
    } catch {}
  }
  return { remoteName: 'cv-hub', remoteUrl: expectedRemote };
}
