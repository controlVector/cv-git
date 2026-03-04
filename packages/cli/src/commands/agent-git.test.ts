/**
 * Tests for agent-git.ts — git state tracking for cv-git agent
 *
 * Covers: capturePreTaskState, capturePostTaskState,
 * buildCompletionPayload, verifyGitRemote
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  gitExec,
  capturePreTaskState,
  capturePostTaskState,
  buildCompletionPayload,
  verifyGitRemote,
  type PreTaskState,
  type PostTaskState,
} from './agent-git';

// Mock child_process.execSync
vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

import { execSync } from 'node:child_process';
const mockExecSync = vi.mocked(execSync);

beforeEach(() => {
  vi.clearAllMocks();
});

// ============================================================================
// gitExec
// ============================================================================

describe('gitExec', () => {
  it('returns trimmed stdout on success', () => {
    mockExecSync.mockReturnValue('  abc123  \n');
    expect(gitExec('git rev-parse HEAD', '/tmp')).toBe('abc123');
  });

  it('returns null on failure', () => {
    mockExecSync.mockImplementation(() => { throw new Error('not a git repo'); });
    expect(gitExec('git status', '/tmp')).toBeNull();
  });
});

// ============================================================================
// capturePreTaskState
// ============================================================================

describe('capturePreTaskState', () => {
  it('returns SHA, branch, remote in a git repo', () => {
    mockExecSync.mockImplementation((cmd: unknown) => {
      const s = String(cmd);
      if (s.includes('rev-parse HEAD')) return 'abc123def456\n';
      if (s.includes('--abbrev-ref HEAD')) return 'main\n';
      if (s.includes('remote get-url origin')) return 'https://hub.controlvector.io/user/repo.git\n';
      return '';
    });

    const state = capturePreTaskState('/project');
    expect(state).toEqual({
      headSha: 'abc123def456',
      branch: 'main',
      remote: 'https://hub.controlvector.io/user/repo.git',
      workingDir: '/project',
    });
  });

  it('returns nulls in a non-git directory', () => {
    mockExecSync.mockImplementation(() => { throw new Error('fatal'); });

    const state = capturePreTaskState('/not-a-repo');
    expect(state.headSha).toBeNull();
    expect(state.branch).toBeNull();
    expect(state.remote).toBeNull();
    expect(state.workingDir).toBe('/not-a-repo');
  });

  it('returns headSha null for empty repo (no commits)', () => {
    mockExecSync.mockImplementation((cmd: unknown) => {
      const s = String(cmd);
      if (s.includes('rev-parse HEAD')) throw new Error('HEAD does not exist');
      if (s.includes('--abbrev-ref HEAD')) return 'main\n';
      if (s.includes('remote get-url origin')) return 'https://example.com/repo.git\n';
      return '';
    });

    const state = capturePreTaskState('/empty-repo');
    expect(state.headSha).toBeNull();
    expect(state.branch).toBe('main');
    expect(state.remote).toBe('https://example.com/repo.git');
  });
});

// ============================================================================
// capturePostTaskState
// ============================================================================

describe('capturePostTaskState', () => {
  const basePreState: PreTaskState = {
    headSha: 'aaa111',
    branch: 'main',
    remote: 'https://example.com/repo.git',
    workingDir: '/project',
  };

  it('detects added, modified, and deleted files when HEAD changes', () => {
    mockExecSync.mockImplementation((cmd: unknown) => {
      const s = String(cmd);
      if (s.includes('rev-parse HEAD')) return 'bbb222\n';
      if (s.includes('--abbrev-ref HEAD')) return 'main\n';
      if (s.includes('diff --name-status')) return 'A\tnew-file.ts\nM\texisting.ts\nD\told.ts\n';
      if (s.includes('diff --shortstat')) return ' 3 files changed, 42 insertions(+), 10 deletions(-)\n';
      if (s.includes('git log --oneline')) return 'bbb222 feat: add stuff\nccc333 fix: things\n';
      if (s.includes('remote get-url origin')) return 'https://example.com/repo.git\n';
      if (s.includes('ls-remote')) return 'bbb222\trefs/heads/main\n';
      return '';
    });

    const post = capturePostTaskState('/project', basePreState);
    expect(post.filesAdded).toEqual(['new-file.ts']);
    expect(post.filesModified).toEqual(['existing.ts']);
    expect(post.filesDeleted).toEqual(['old.ts']);
    expect(post.linesAdded).toBe(42);
    expect(post.linesDeleted).toBe(10);
    expect(post.commitMessages).toHaveLength(2);
    expect(post.headSha).toBe('bbb222');
  });

  it('handles renamed files (R status)', () => {
    mockExecSync.mockImplementation((cmd: unknown) => {
      const s = String(cmd);
      if (s.includes('rev-parse HEAD')) return 'bbb222\n';
      if (s.includes('--abbrev-ref HEAD')) return 'main\n';
      if (s.includes('diff --name-status')) return 'R100\told-name.ts\tnew-name.ts\n';
      if (s.includes('diff --shortstat')) return '';
      if (s.includes('git log --oneline')) return '';
      if (s.includes('remote get-url origin')) return 'https://example.com/repo.git\n';
      if (s.includes('ls-remote')) return '';
      return '';
    });

    const post = capturePostTaskState('/project', basePreState);
    expect(post.filesDeleted).toContain('old-name.ts');
    expect(post.filesAdded).toContain('new-name.ts');
  });

  it('detects all files as added when repo was empty (no pre-state SHA)', () => {
    const emptyPreState: PreTaskState = {
      headSha: null, branch: 'main', remote: null, workingDir: '/project',
    };

    mockExecSync.mockImplementation((cmd: unknown) => {
      const s = String(cmd);
      if (s.includes('rev-parse HEAD')) return 'aaa111\n';
      if (s.includes('--abbrev-ref HEAD')) return 'main\n';
      if (s.includes('ls-files')) return 'file1.ts\nfile2.ts\nREADME.md\n';
      if (s.includes('remote get-url origin')) throw new Error('no remote');
      return '';
    });

    const post = capturePostTaskState('/project', emptyPreState);
    expect(post.filesAdded).toEqual(['file1.ts', 'file2.ts', 'README.md']);
    expect(post.pushStatus).toBe('no_remote');
  });

  it('falls back to git status when HEAD unchanged', () => {
    mockExecSync.mockImplementation((cmd: unknown) => {
      const s = String(cmd);
      if (s.includes('rev-parse HEAD')) return 'aaa111\n';
      if (s.includes('--abbrev-ref HEAD')) return 'main\n';
      if (s.includes('status --porcelain')) return '?? untracked.ts\nM  modified.ts\nD  deleted.ts\n';
      if (s.includes('remote get-url origin')) return 'https://example.com/repo.git\n';
      if (s.includes('ls-remote')) return '';
      return '';
    });

    const post = capturePostTaskState('/project', basePreState);
    expect(post.filesAdded).toContain('untracked.ts');
    expect(post.filesModified).toContain('modified.ts');
    expect(post.filesDeleted).toContain('deleted.ts');
    expect(post.pushStatus).toBe('not_pushed');
  });

  it('reports push status success when remote SHA matches HEAD', () => {
    mockExecSync.mockImplementation((cmd: unknown) => {
      const s = String(cmd);
      if (s.includes('rev-parse HEAD')) return 'bbb222\n';
      if (s.includes('--abbrev-ref HEAD')) return 'main\n';
      if (s.includes('diff --name-status')) return '';
      if (s.includes('diff --shortstat')) return '';
      if (s.includes('git log --oneline')) return '';
      if (s.includes('remote get-url origin')) return 'https://example.com/repo.git\n';
      if (s.includes('ls-remote')) return 'bbb222\trefs/heads/main\n';
      return '';
    });

    const post = capturePostTaskState('/project', basePreState);
    expect(post.pushStatus).toBe('success');
    expect(post.pushRemote).toBe('https://example.com/repo.git');
  });

  it('reports no_remote when no remote configured', () => {
    mockExecSync.mockImplementation((cmd: unknown) => {
      const s = String(cmd);
      if (s.includes('rev-parse HEAD')) return 'bbb222\n';
      if (s.includes('--abbrev-ref HEAD')) return 'main\n';
      if (s.includes('diff --name-status')) return '';
      if (s.includes('diff --shortstat')) return '';
      if (s.includes('git log --oneline')) return '';
      if (s.includes('remote get-url')) throw new Error('no remote');
      return '';
    });

    const post = capturePostTaskState('/project', basePreState);
    expect(post.pushStatus).toBe('no_remote');
    expect(post.pushRemote).toBeNull();
  });

  it('reports not_pushed when remote exists but SHA not there', () => {
    mockExecSync.mockImplementation((cmd: unknown) => {
      const s = String(cmd);
      if (s.includes('rev-parse HEAD')) return 'bbb222\n';
      if (s.includes('--abbrev-ref HEAD')) return 'main\n';
      if (s.includes('diff --name-status')) return '';
      if (s.includes('diff --shortstat')) return '';
      if (s.includes('git log --oneline')) return '';
      if (s.includes('remote get-url origin')) return 'https://example.com/repo.git\n';
      if (s.includes('ls-remote')) return 'ccc333\trefs/heads/main\n';
      return '';
    });

    const post = capturePostTaskState('/project', basePreState);
    expect(post.pushStatus).toBe('not_pushed');
  });

  it('handles zero line stats gracefully', () => {
    mockExecSync.mockImplementation((cmd: unknown) => {
      const s = String(cmd);
      if (s.includes('rev-parse HEAD')) return 'bbb222\n';
      if (s.includes('--abbrev-ref HEAD')) return 'main\n';
      if (s.includes('diff --name-status')) return 'M\tfile.ts\n';
      if (s.includes('diff --shortstat')) return ' 1 file changed\n'; // no insertions/deletions
      if (s.includes('git log --oneline')) return 'bbb222 empty\n';
      if (s.includes('remote get-url')) throw new Error('no remote');
      return '';
    });

    const post = capturePostTaskState('/project', basePreState);
    expect(post.linesAdded).toBe(0);
    expect(post.linesDeleted).toBe(0);
  });
});

// ============================================================================
// buildCompletionPayload
// ============================================================================

describe('buildCompletionPayload', () => {
  const preState: PreTaskState = {
    headSha: 'aaa111', branch: 'main', remote: 'https://example.com/repo.git',
    workingDir: '/project',
  };

  const postState: PostTaskState = {
    headSha: 'bbb222', branch: 'main',
    filesAdded: ['new.ts'], filesModified: ['mod.ts'], filesDeleted: [],
    linesAdded: 50, linesDeleted: 10,
    commitMessages: ['bbb222 feat: add stuff'],
    pushStatus: 'success', pushRemote: 'https://example.com/repo.git',
  };

  it('produces structured payload with correct fields', () => {
    const startTime = Date.now() - 30000; // 30 seconds ago
    const payload = buildCompletionPayload(0, preState, postState, startTime);

    expect(payload.exit_code).toBe(0);
    expect(payload.commit.sha).toBe('bbb222');
    expect(payload.commit.branch).toBe('main');
    expect(payload.commit.push_status).toBe('success');
    expect(payload.commit.messages).toEqual(['bbb222 feat: add stuff']);
    expect(payload.files.added).toEqual(['new.ts']);
    expect(payload.files.modified).toEqual(['mod.ts']);
    expect(payload.files.deleted).toEqual([]);
    expect(payload.files.total_changed).toBe(2);
    expect(payload.stats.lines_added).toBe(50);
    expect(payload.stats.lines_deleted).toBe(10);
    expect(payload.stats.duration_seconds).toBeGreaterThanOrEqual(29);
    expect(payload.stats.duration_seconds).toBeLessThanOrEqual(31);
  });

  it('summary includes file count and commit SHA', () => {
    const payload = buildCompletionPayload(0, preState, postState, Date.now() - 5000);

    expect(payload.summary).toContain('2 file(s) changed');
    expect(payload.summary).toContain('+50/-10');
    expect(payload.summary).toContain('bbb222');
    expect(payload.summary).toContain('Pushed to remote');
  });

  it('summary says no file changes when none', () => {
    const emptyPost: PostTaskState = {
      ...postState,
      headSha: 'aaa111', // same as pre
      filesAdded: [], filesModified: [], filesDeleted: [],
      linesAdded: 0, linesDeleted: 0,
      commitMessages: [], pushStatus: 'not_pushed',
    };
    const payload = buildCompletionPayload(0, preState, emptyPost, Date.now());

    expect(payload.summary).toContain('No file changes');
    expect(payload.summary).toContain('Not pushed');
    expect(payload.files.total_changed).toBe(0);
  });

  it('formats duration with minutes for long tasks', () => {
    const startTime = Date.now() - 125000; // 2m 5s ago
    const payload = buildCompletionPayload(0, preState, postState, startTime);

    expect(payload.summary).toMatch(/2m \d+s/);
  });

  it('handles failure exit code', () => {
    const payload = buildCompletionPayload(1, preState, postState, Date.now());
    expect(payload.exit_code).toBe(1);
    // still includes file/commit info even on failure
    expect(payload.commit.sha).toBe('bbb222');
  });
});

// ============================================================================
// verifyGitRemote
// ============================================================================

describe('verifyGitRemote', () => {
  const gitHost = 'git.hub.controlvector.io';

  it('returns null when task has no owner/repo', () => {
    expect(verifyGitRemote('/project', {}, gitHost)).toBeNull();
    expect(verifyGitRemote('/project', { owner: 'user' }, gitHost)).toBeNull();
  });

  it('adds origin when no remote exists', () => {
    mockExecSync.mockImplementation((cmd: unknown) => {
      const s = String(cmd);
      if (s.includes('remote get-url origin')) throw new Error('no remote');
      if (s.includes('remote add origin')) return '';
      return '';
    });

    const result = verifyGitRemote('/project', { owner: 'alice', repo: 'myrepo' }, gitHost);
    expect(result).toEqual({
      remoteName: 'origin',
      remoteUrl: 'https://git.hub.controlvector.io/alice/myrepo.git',
    });
    expect(mockExecSync).toHaveBeenCalledWith(
      'git remote add origin https://git.hub.controlvector.io/alice/myrepo.git',
      expect.objectContaining({ cwd: '/project' }),
    );
  });

  it('returns existing origin when it already matches', () => {
    mockExecSync.mockReturnValue('https://git.hub.controlvector.io/alice/myrepo.git\n');

    const result = verifyGitRemote('/project', { owner: 'alice', repo: 'myrepo' }, gitHost);
    expect(result).toEqual({
      remoteName: 'origin',
      remoteUrl: 'https://git.hub.controlvector.io/alice/myrepo.git',
    });
  });

  it('fixes origin when pointing to wrong CV-Hub namespace', () => {
    let setUrlCalled = false;
    mockExecSync.mockImplementation((cmd: unknown) => {
      const s = String(cmd);
      if (s.includes('remote get-url origin')) return 'https://git.hub.controlvector.io/wrong/repo.git\n';
      if (s.includes('remote set-url origin')) { setUrlCalled = true; return ''; }
      return '';
    });

    const result = verifyGitRemote('/project', { owner: 'alice', repo: 'myrepo' }, gitHost);
    expect(result?.remoteName).toBe('origin');
    expect(result?.remoteUrl).toBe('https://git.hub.controlvector.io/alice/myrepo.git');
    expect(setUrlCalled).toBe(true);
  });

  it('adds cv-hub remote when origin is external (e.g. GitHub)', () => {
    mockExecSync.mockImplementation((cmd: unknown) => {
      const s = String(cmd);
      if (s.includes('remote get-url origin')) return 'https://github.com/alice/myrepo.git\n';
      if (s.includes('remote get-url cv-hub')) throw new Error('no such remote');
      if (s.includes('remote add cv-hub')) return '';
      return '';
    });

    const result = verifyGitRemote('/project', { owner: 'alice', repo: 'myrepo' }, gitHost);
    expect(result?.remoteName).toBe('cv-hub');
    expect(result?.remoteUrl).toBe('https://git.hub.controlvector.io/alice/myrepo.git');
  });

  it('updates cv-hub remote when it exists but points to wrong URL', () => {
    let setUrlCalled = false;
    mockExecSync.mockImplementation((cmd: unknown) => {
      const s = String(cmd);
      if (s.includes('remote get-url origin')) return 'https://github.com/alice/myrepo.git\n';
      if (s.includes('remote get-url cv-hub')) return 'https://git.hub.controlvector.io/old/wrong.git\n';
      if (s.includes('remote set-url cv-hub')) { setUrlCalled = true; return ''; }
      return '';
    });

    const result = verifyGitRemote('/project', { owner: 'alice', repo: 'myrepo' }, gitHost);
    expect(result?.remoteName).toBe('cv-hub');
    expect(setUrlCalled).toBe(true);
  });
});
