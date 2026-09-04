import * as path from 'path';
import { execGit } from './exec';
import { WorktreeInfo } from './types';

export async function isGitRepository(cwd: string): Promise<boolean> {
  try {
    await execGit(['rev-parse', '--is-inside-work-tree'], cwd);
    return true;
  } catch {
    return false;
  }
}

export async function getGitRoot(cwd: string): Promise<string | null> {
  try {
    const root = (await execGit(['rev-parse', '--show-toplevel'], cwd)).trim();
    return root;
  } catch {
    return null;
  }
}

export async function getBranches(cwd: string): Promise<string[]> {
  try {
    const output = await execGit(['branch', '-a', '--format=%(refname:short)'], cwd);
    return output
      .split('\n')
      .map(b => b.trim())
      .filter(b => b.length > 0 && !b.startsWith('origin/HEAD'));
  } catch (e) {
    console.error('Error fetching branches:', e);
    return [];
  }
}

export async function getAuthors(cwd: string, signal?: AbortSignal): Promise<string[]> {
  try {
    // Use git shortlog -s -n: aggregated and deduplicated in Git C-core,
    // sorted by commit count descending. Dramatically faster and avoids OOM in large repos.
    const output = await execGit(['shortlog', '-s', '-n', '--branches', '--tags', '--remotes', 'HEAD'], cwd, signal);
    const authorsSet = new Set<string>();
    output.split('\n').forEach(line => {
      const trimmed = line.trim();
      if (!trimmed) return;
      const tabIdx = trimmed.indexOf('\t');
      const author = (tabIdx !== -1 ? trimmed.substring(tabIdx + 1) : trimmed.replace(/^\d+\s+/, '')).trim();
      if (author) {
        authorsSet.add(author);
      }
    });
    return Array.from(authorsSet);
  } catch (e) {
    console.error('Error fetching authors:', e);
    return [];
  }
}

export async function getWorktrees(
  gitRoot: string,
  signal?: AbortSignal
): Promise<WorktreeInfo[]> {
  try {
    const output = await execGit(['worktree', 'list', '--porcelain'], gitRoot, signal);
    const lines = output.split('\n');
    const worktrees: WorktreeInfo[] = [];
    let currentWt: Partial<WorktreeInfo> | null = null;

    const normalizedGitRoot = path.resolve(gitRoot);

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        if (currentWt && currentWt.path && currentWt.headHash) {
          worktrees.push({
            path: currentWt.path,
            headHash: currentWt.headHash,
            branch: currentWt.branch,
            isBare: !!currentWt.isBare,
            isLocked: !!currentWt.isLocked,
            lockReason: currentWt.lockReason,
            isCurrent: path.resolve(currentWt.path) === normalizedGitRoot
          });
          currentWt = null;
        }
        continue;
      }

      if (trimmed.startsWith('worktree ')) {
        if (currentWt && currentWt.path && currentWt.headHash) {
          worktrees.push({
            path: currentWt.path,
            headHash: currentWt.headHash,
            branch: currentWt.branch,
            isBare: !!currentWt.isBare,
            isLocked: !!currentWt.isLocked,
            lockReason: currentWt.lockReason,
            isCurrent: path.resolve(currentWt.path) === normalizedGitRoot
          });
        }
        currentWt = { path: trimmed.substring(9).trim() };
      } else if (currentWt) {
        if (trimmed.startsWith('HEAD ')) {
          currentWt.headHash = trimmed.substring(5).trim();
        } else if (trimmed.startsWith('branch ')) {
          const rawBranch = trimmed.substring(7).trim();
          currentWt.branch = rawBranch.replace(/^refs\/heads\//, '');
        } else if (trimmed === 'bare') {
          currentWt.isBare = true;
        } else if (trimmed.startsWith('locked')) {
          currentWt.isLocked = true;
          const reason = trimmed.substring(6).trim();
          if (reason) {
            currentWt.lockReason = reason;
          }
        }
      }
    }

    if (currentWt && currentWt.path && currentWt.headHash) {
      worktrees.push({
        path: currentWt.path,
        headHash: currentWt.headHash,
        branch: currentWt.branch,
        isBare: !!currentWt.isBare,
        isLocked: !!currentWt.isLocked,
        lockReason: currentWt.lockReason,
        isCurrent: path.resolve(currentWt.path) === normalizedGitRoot
      });
    }

    return worktrees;
  } catch (e: any) {
    if (e?.message !== 'ABORTED' && !signal?.aborted) {
      console.error('Error listing worktrees:', e);
    }
    return [];
  }
}
