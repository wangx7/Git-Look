import * as path from 'path';
import { execGit } from './exec';
import { WorkingTreeFile, WorkingTreeStatus } from './types';

export async function hasLocalModifications(
  cwd: string,
  filePath: string,
  startLine: number,
  endLine: number
): Promise<boolean> {
  try {
    let gitRoot = cwd;
    try {
      gitRoot = (await execGit(['rev-parse', '--show-toplevel'], cwd)).trim();
    } catch (e) {
      // Ignore
    }
    const repoFilePath = path.relative(gitRoot, filePath).replace(/\\/g, '/');
    const diffOutput = await execGit(['diff', '-U0', 'HEAD', '--', repoFilePath], gitRoot);
    if (!diffOutput.trim()) {
      return false;
    }

    const lines = diffOutput.split('\n');
    for (const line of lines) {
      const match = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
      if (match) {
        const newStart = parseInt(match[3], 10);
        const newLength = match[4] !== undefined ? parseInt(match[4], 10) : 1;

        let isOverlap = false;
        if (newLength > 0) {
          isOverlap = newStart <= endLine && (newStart + newLength - 1) >= startLine;
        } else {
          isOverlap = newStart >= startLine - 1 && newStart <= endLine;
        }

        if (isOverlap) {
          return true;
        }
      }
    }
    return false;
  } catch (e) {
    console.error('Error checking local modifications:', e);
    return false;
  }
}

export async function hasFileLocalModifications(
  cwd: string,
  filePath: string,
  signal?: AbortSignal
): Promise<boolean> {
  try {
    let gitRoot = cwd;
    try {
      gitRoot = (await execGit(['rev-parse', '--show-toplevel'], cwd, signal)).trim();
    } catch (e) {
      // Ignore
    }
    const repoFilePath = path.relative(gitRoot, filePath).replace(/\\/g, '/');
    const diffOutput = await execGit(['diff', '--name-only', 'HEAD', '--', repoFilePath], gitRoot, signal);
    return diffOutput.trim().length > 0;
  } catch (e: any) {
    // 用户快速切换编辑器触发的取消属于正常流程，不打印噪音日志
    if (e?.message !== 'ABORTED' && !signal?.aborted) {
      console.error('Error checking file local modifications:', e);
    }
    return false;
  }
}

export async function getWorkingTreeStatus(
  gitRoot: string,
  signal?: AbortSignal
): Promise<WorkingTreeStatus> {
  try {
    const [statusOutput, numstatOutput, mergeHeadOutput] = await Promise.all([
      execGit(['status', '--porcelain=v1', '-z', '-u'], gitRoot, signal).catch(() => ''),
      execGit(['diff', 'HEAD', '--numstat'], gitRoot, signal).catch(() => ''),
      execGit(['rev-parse', '-q', '--verify', 'MERGE_HEAD'], gitRoot, signal).catch(() => '')
    ]);

    const isMerging = mergeHeadOutput.trim().length > 0;
    const mergeHeads = isMerging ? mergeHeadOutput.trim().split(/\s+/).filter(Boolean) : [];

    const numstats = new Map<string, { additions: number; deletions: number }>();
    if (numstatOutput) {
      numstatOutput.split('\n').filter(Boolean).forEach(line => {
        const parts = line.split('\t');
        if (parts.length >= 3) {
          const add = parts[0] === '-' ? 0 : parseInt(parts[0], 10);
          const del = parts[1] === '-' ? 0 : parseInt(parts[1], 10);
          const filePath = parts[2];
          numstats.set(filePath, { additions: add, deletions: del });
        }
      });
    }

    const files: WorkingTreeFile[] = [];
    let stagedCount = 0;
    let unstagedCount = 0;
    let untrackedCount = 0;

    if (statusOutput) {
      const tokens = statusOutput.split('\0');
      let i = 0;
      while (i < tokens.length) {
        const token = tokens[i];
        if (!token) {
          i++;
          continue;
        }

        const indexStatus = token.charAt(0);
        const worktreeStatus = token.charAt(1);
        const filePath = token.substring(3);
        let oldPath: string | undefined;

        if (indexStatus === 'R' || indexStatus === 'C') {
          i++;
          if (i < tokens.length) {
            oldPath = tokens[i];
          }
        }

        const isUntracked = (indexStatus === '?' && worktreeStatus === '?');
        const isConflict = (indexStatus === 'U' || worktreeStatus === 'U' || (indexStatus === 'A' && worktreeStatus === 'A') || (indexStatus === 'D' && worktreeStatus === 'D'));

        const stat = numstats.get(filePath);

        if (isUntracked) {
          untrackedCount++;
          files.push({
            path: filePath,
            status: '?',
            staged: false,
            additions: stat?.additions,
            deletions: stat?.deletions
          });
        } else if (isConflict) {
          unstagedCount++;
          files.push({
            path: filePath,
            oldPath,
            status: 'U',
            staged: false,
            additions: stat?.additions,
            deletions: stat?.deletions
          });
        } else {
          // Has staged changes
          if (indexStatus !== ' ' && indexStatus !== '?') {
            stagedCount++;
            files.push({
              path: filePath,
              oldPath,
              status: indexStatus,
              staged: true,
              additions: stat?.additions,
              deletions: stat?.deletions
            });
          }
          // Has unstaged changes
          if (worktreeStatus !== ' ' && worktreeStatus !== '?') {
            unstagedCount++;
            files.push({
              path: filePath,
              oldPath,
              status: worktreeStatus,
              staged: false,
              additions: stat?.additions,
              deletions: stat?.deletions
            });
          }
        }

        i++;
      }
    }

    const hasChanges = files.length > 0 || isMerging;

    return {
      hasChanges,
      stagedCount,
      unstagedCount,
      untrackedCount,
      files,
      isMerging,
      mergeHeads
    };
  } catch (e: any) {
    if (e?.message !== 'ABORTED' && !signal?.aborted) {
      console.error('Error getting working tree status:', e);
    }
    return {
      hasChanges: false,
      stagedCount: 0,
      unstagedCount: 0,
      untrackedCount: 0,
      files: [],
      isMerging: false,
      mergeHeads: []
    };
  }
}
