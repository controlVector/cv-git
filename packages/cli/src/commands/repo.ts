/**
 * cv repo — CV-Hub repository management
 *
 * Commands:
 *   cv repo list                          List your repos on CV-Hub
 *   cv repo create <name>                 Create a new repo on CV-Hub
 *   cv repo members [owner/repo]          List collaborators
 *   cv repo add-member <user> [owner/repo]  Add a collaborator
 *   cv repo remove-member <user> [owner/repo]  Remove a collaborator
 *   cv repo set-role <user> <role> [owner/repo]  Change a collaborator's role
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { execSync } from 'node:child_process';
import { readSharedCredentials } from '../utils/shared-credentials.js';
import { readCredentials } from '../utils/cv-hub-credentials.js';

const HUB_URL = 'https://api.hub.controlvector.io';

interface HubAuth {
  url: string;
  token: string;
  username: string;
}

async function getAuth(): Promise<HubAuth> {
  // Try shared credentials first
  const shared = await readSharedCredentials();
  if (shared?.token) {
    return { url: shared.hub_url || HUB_URL, token: shared.token, username: shared.username || 'user' };
  }

  // Fall back to cv-hub credentials
  const creds = await readCredentials();
  if (creds.CV_HUB_PAT) {
    return { url: creds.CV_HUB_API || HUB_URL, token: creds.CV_HUB_PAT, username: 'user' };
  }

  console.log(chalk.red('Not authenticated.'));
  console.log(`Run ${chalk.cyan('cv auth setup cv-hub')} or ${chalk.cyan('cva setup')} first.`);
  process.exit(1);
}

async function hubFetch(auth: HubAuth, path: string, options?: RequestInit): Promise<Response> {
  return fetch(`${auth.url}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${auth.token}`,
      'Content-Type': 'application/json',
      ...(options?.headers || {}),
    },
  });
}

/**
 * Detect owner/repo from current git remote, or use provided argument.
 */
function resolveRepo(repoArg?: string): { owner: string; repo: string } | null {
  if (repoArg && repoArg.includes('/')) {
    const [owner, repo] = repoArg.split('/');
    return { owner, repo };
  }

  // Auto-detect from git remote
  try {
    const remotes = ['cv-hub', 'origin'];
    for (const remote of remotes) {
      try {
        const url = execSync(`git remote get-url ${remote} 2>/dev/null`, { encoding: 'utf8' }).trim();
        const match = url.match(/controlvector\.io[:/]([^/]+)\/([^/.]+)/);
        if (match) return { owner: match[1], repo: match[2] };
      } catch { /* try next */ }
    }
  } catch { /* not in a git repo */ }

  return null;
}

// ============================================================================
// Subcommands
// ============================================================================

async function listRepos(): Promise<void> {
  const auth = await getAuth();
  const res = await hubFetch(auth, '/api/v1/repos?limit=50');

  if (!res.ok) {
    console.log(chalk.red(`Error: ${res.status}`));
    return;
  }

  const data = await res.json() as { repositories?: Array<{ name: string; slug: string; visibility: string; description?: string }> };
  const repos = data.repositories || [];

  if (repos.length === 0) {
    console.log(chalk.gray('No repositories found.'));
    console.log(`Create one with: ${chalk.cyan('cv repo create <name>')}`);
    return;
  }

  console.log(chalk.bold(`\n  Your CV-Hub Repositories (${repos.length})\n`));
  for (const r of repos) {
    const vis = r.visibility === 'public' ? chalk.green('public') : chalk.gray('private');
    const desc = r.description ? chalk.gray(` — ${r.description.substring(0, 50)}`) : '';
    console.log(`  ${chalk.cyan(r.slug || r.name)}  ${vis}${desc}`);
  }
  console.log();
}

async function createRepo(name: string, options: { description?: string; private?: boolean }): Promise<void> {
  const auth = await getAuth();
  const res = await hubFetch(auth, '/api/v1/user/repos', {
    method: 'POST',
    body: JSON.stringify({
      name,
      description: options.description,
      visibility: options.private ? 'private' : 'public',
      auto_init: true,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: { message?: string } };
    console.log(chalk.red(`Failed to create repo: ${err.error?.message || res.status}`));
    return;
  }

  console.log(chalk.green(`✓ Created ${auth.username}/${name}`));
  console.log(chalk.gray(`  https://hub.controlvector.io/${auth.username}/${name}`));
  console.log();
  console.log(`  Clone: ${chalk.cyan(`git clone https://git.hub.controlvector.io/${auth.username}/${name}.git`)}`);
}

async function listMembers(repoArg?: string): Promise<void> {
  const auth = await getAuth();
  const resolved = resolveRepo(repoArg);

  if (!resolved) {
    console.log(chalk.red('Cannot determine repository.'));
    console.log(`Usage: ${chalk.cyan('cv repo members [owner/repo]')}`);
    console.log(chalk.gray('Or run from inside a repo with a CV-Hub remote.'));
    return;
  }

  const res = await hubFetch(auth, `/api/v1/repos/${resolved.owner}/${resolved.repo}/members`);

  if (!res.ok) {
    console.log(chalk.red(`Error: ${res.status} — repo not found or no access`));
    return;
  }

  const data = await res.json() as { members?: Array<{ id: string; role: string; user?: { username: string; email: string }; createdAt: string }> };
  const members = data.members || [];

  console.log(chalk.bold(`\n  Collaborators for ${resolved.owner}/${resolved.repo}\n`));

  if (members.length === 0) {
    console.log(chalk.gray('  No collaborators. Add one with:'));
    console.log(chalk.cyan(`  cv repo add-member <username>`));
  } else {
    const roleIcon = (r: string) => r === 'admin' ? '👑' : r === 'write' ? '✏️' : '👁️';
    for (const m of members) {
      const name = m.user?.username || '?';
      const email = m.user?.email ? chalk.gray(` (${m.user.email})`) : '';
      console.log(`  ${roleIcon(m.role)} ${chalk.cyan(name)}${email}  ${chalk.gray(m.role)}`);
    }
  }
  console.log();
}

async function addMember(username: string, repoArg: string | undefined, options: { role?: string }): Promise<void> {
  const auth = await getAuth();
  const resolved = resolveRepo(repoArg);

  if (!resolved) {
    console.log(chalk.red('Cannot determine repository.'));
    console.log(`Usage: ${chalk.cyan('cv repo add-member <username> [owner/repo]')}`);
    return;
  }

  const role = options.role || 'write';

  // Resolve username to user ID
  const searchRes = await hubFetch(auth, `/api/v1/users/search?q=${encodeURIComponent(username)}`);
  if (!searchRes.ok) {
    console.log(chalk.red('User search failed'));
    return;
  }

  const searchData = await searchRes.json() as { users?: Array<{ id: string; username: string; email: string }> };
  const user = searchData.users?.find(u => u.username === username || u.email === username);

  if (!user) {
    console.log(chalk.red(`User "${username}" not found on CV-Hub.`));
    return;
  }

  // Add member
  const res = await hubFetch(auth, `/api/v1/repos/${resolved.owner}/${resolved.repo}/members`, {
    method: 'POST',
    body: JSON.stringify({ userId: user.id, role }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: { message?: string } };
    console.log(chalk.red(`Failed: ${err.error?.message || res.status}`));
    return;
  }

  console.log(chalk.green(`✓ Added ${user.username} as ${role} to ${resolved.owner}/${resolved.repo}`));
}

async function removeMember(username: string, repoArg?: string): Promise<void> {
  const auth = await getAuth();
  const resolved = resolveRepo(repoArg);

  if (!resolved) {
    console.log(chalk.red('Cannot determine repository.'));
    return;
  }

  // Get current members to find the member ID
  const membersRes = await hubFetch(auth, `/api/v1/repos/${resolved.owner}/${resolved.repo}/members`);
  if (!membersRes.ok) {
    console.log(chalk.red('Failed to list members'));
    return;
  }

  const data = await membersRes.json() as { members?: Array<{ id: string; user?: { username: string } }> };
  const member = data.members?.find(m => m.user?.username === username);

  if (!member) {
    console.log(chalk.red(`${username} is not a collaborator on this repo.`));
    return;
  }

  const res = await hubFetch(auth, `/api/v1/repos/${resolved.owner}/${resolved.repo}/members/${member.id}`, {
    method: 'DELETE',
  });

  if (!res.ok) {
    console.log(chalk.red(`Failed to remove: ${res.status}`));
    return;
  }

  console.log(chalk.green(`✓ Removed ${username} from ${resolved.owner}/${resolved.repo}`));
}

async function setRole(username: string, role: string, repoArg?: string): Promise<void> {
  const auth = await getAuth();
  const resolved = resolveRepo(repoArg);

  if (!resolved) {
    console.log(chalk.red('Cannot determine repository.'));
    return;
  }

  if (!['read', 'write', 'admin'].includes(role)) {
    console.log(chalk.red(`Invalid role "${role}". Use: read, write, admin`));
    return;
  }

  // Get current members to find the member ID
  const membersRes = await hubFetch(auth, `/api/v1/repos/${resolved.owner}/${resolved.repo}/members`);
  if (!membersRes.ok) {
    console.log(chalk.red('Failed to list members'));
    return;
  }

  const data = await membersRes.json() as { members?: Array<{ id: string; user?: { username: string } }> };
  const member = data.members?.find(m => m.user?.username === username);

  if (!member) {
    console.log(chalk.red(`${username} is not a collaborator on this repo.`));
    return;
  }

  const res = await hubFetch(auth, `/api/v1/repos/${resolved.owner}/${resolved.repo}/members/${member.id}`, {
    method: 'PUT',
    body: JSON.stringify({ role }),
  });

  if (!res.ok) {
    console.log(chalk.red(`Failed to update role: ${res.status}`));
    return;
  }

  console.log(chalk.green(`✓ ${username} is now ${role} on ${resolved.owner}/${resolved.repo}`));
}

// ============================================================================
// Command Registration
// ============================================================================

export function repoCommand(): Command {
  const cmd = new Command('repo');
  cmd.description('Manage CV-Hub repositories and collaborators');

  cmd
    .command('list')
    .description('List your repositories on CV-Hub')
    .action(listRepos);

  cmd
    .command('create')
    .description('Create a new repository on CV-Hub')
    .argument('<name>', 'Repository name')
    .option('-d, --description <text>', 'Repository description')
    .option('-p, --private', 'Make repository private', true)
    .action(createRepo);

  cmd
    .command('members')
    .description('List collaborators on a repository')
    .argument('[owner/repo]', 'Repository (auto-detected from git remote if omitted)')
    .action(listMembers);

  cmd
    .command('add-member')
    .description('Add a collaborator to a repository')
    .argument('<username>', 'Username or email of the person to add')
    .argument('[owner/repo]', 'Repository (auto-detected from git remote if omitted)')
    .option('-r, --role <role>', 'Role: read, write, admin (default: write)', 'write')
    .action(addMember);

  cmd
    .command('remove-member')
    .description('Remove a collaborator from a repository')
    .argument('<username>', 'Username of the person to remove')
    .argument('[owner/repo]', 'Repository (auto-detected from git remote if omitted)')
    .action(removeMember);

  cmd
    .command('set-role')
    .description('Change a collaborator\'s role')
    .argument('<username>', 'Username of the collaborator')
    .argument('<role>', 'New role: read, write, admin')
    .argument('[owner/repo]', 'Repository (auto-detected from git remote if omitted)')
    .action(setRole);

  return cmd;
}
