import { CommitInfo, GitRef, GraphLayoutOptions } from './types';

/**
 * Determine the root commit hash to start the first-parent backbone from.
 * Strategy:
 * 1. If options.rootHash is explicitly provided, use it.
 * 2. If options.selectedBranch is provided, find the ref corresponding to it.
 * 3. Otherwise, look for the commit marked with 'HEAD' ref/decoration.
 * 4. Fall back to the first commit in the topological list (or '*working-tree*').
 */
export function getGraphRoot(
  commits: CommitInfo[],
  refs: GitRef[] = [],
  options?: GraphLayoutOptions
): string | undefined {
  if (options?.rootHash) {
    return options.rootHash;
  }

  if (commits.length === 0) {
    return undefined;
  }

  // 1. If selectedBranch is provided, find commit hash from refs
  if (options?.selectedBranch) {
    const branchRef = refs.find(
      r => r.name === options.selectedBranch || r.name === `origin/${options.selectedBranch}`
    );
    if (branchRef && commits.some(c => c.hash === branchRef.targetHash)) {
      return branchRef.targetHash;
    }
  }

  // 2. Working tree commit at the top
  if (commits[0]?.hash === '*working-tree*') {
    return commits[0].hash;
  }

  // 3. Find commit pointed to by HEAD
  const headRef = refs.find(r => r.type === 'head');
  if (headRef && commits.some(c => c.hash === headRef.targetHash)) {
    return headRef.targetHash;
  }

  // Also check commit decorations for 'HEAD' or 'HEAD -> ...'
  const headCommit = commits.find(c =>
    c.decorations && c.decorations.some(d => d === 'HEAD' || d.startsWith('HEAD ->'))
  );
  if (headCommit) {
    return headCommit.hash;
  }

  // 4. Default to the topmost commit
  return commits[0]?.hash;
}

/**
 * Traverse the first-parent chain (parents[0]) downward from startHash.
 * In Git DAG, parents[0] represents the continuation of the history in which
 * the merge or commit was executed (e.g. current branch).
 */
export function getFirstParentBackbone(
  commits: CommitInfo[],
  startHash?: string
): Set<string> {
  const result = new Set<string>();
  if (!startHash || commits.length === 0) {
    return result;
  }

  const commitMap = new Map<string, CommitInfo>();
  for (const c of commits) {
    commitMap.set(c.hash, c);
  }

  let curr: string | undefined = startHash;
  while (curr) {
    if (result.has(curr)) {
      break; // Prevent cycles if any corrupted graph exists
    }
    result.add(curr);
    const commit = commitMap.get(curr);
    curr = commit && commit.parents && commit.parents.length > 0 ? commit.parents[0] : undefined;
  }

  return result;
}
