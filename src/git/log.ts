import { execGit } from './exec';
import { CommitInfo, GitFilters } from './types';

export function buildLogArgs(filters: GitFilters): { args: string[]; searchHash: string | null } {
  const args = ['log', '--topo-order'];
  args.push('--pretty=format:%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%d%x1f%s');

  let searchHash: string | null = null;
  if (filters.query) {
    const trimmed = filters.query.trim();
    if (/^[0-9a-fA-F]{7,40}$/.test(trimmed)) {
      searchHash = trimmed;
    }
  }

  // First parent filter: show only first-parent commits (clean merge-only trunk history)
  if (filters.firstParent) {
    args.push('--first-parent');
  }

  // Branch filter
  if (filters.branch) {
    args.push(filters.branch);
  } else {
    args.push('--branches', '--tags', '--remotes', 'HEAD');
  }

  // Author filter
  if (filters.author) {
    args.push(`--author=${filters.author}`);
  }

  // Date filters
  // Important: Git parses bare YYYY-MM-DD dates incorrectly in some versions/timezones,
  // always explicitly append time (00:00:00 for since, 23:59:59 for until) to get the full day.
  if (filters.since) {
    let sinceVal = filters.since;
    if (/^\d{4}-\d{2}-\d{2}$/.test(sinceVal)) {
      sinceVal += ' 00:00:00';
    }
    args.push(`--since=${sinceVal}`);
  }
  if (filters.until) {
    let untilVal = filters.until;
    if (/^\d{4}-\d{2}-\d{2}$/.test(untilVal)) {
      untilVal += ' 23:59:59';
    }
    args.push(`--until=${untilVal}`);
  }

  // Text search filter: -F (--fixed-strings) ensures literal substring matching,
  // preventing Git from crashing with regex syntax errors on inputs like '[WIP]', '(fix)'
  if (filters.query && !searchHash) {
    args.push('-F', `--grep=${filters.query}`, '-i');
  }

  return { args, searchHash };
}

export async function getCommits(
  cwd: string,
  filters: GitFilters,
  skip: number = 0,
  limit: number = 150,
  signal?: AbortSignal
): Promise<CommitInfo[]> {
  const { args, searchHash } = buildLogArgs(filters);

  if (searchHash) {
    try {
      const output = await execGit(['show', '-s', '--pretty=format:%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%d%x1f%s', searchHash], cwd, signal);
      const parsed = parseCommitLine(output.trim());
      return parsed ? [parsed] : [];
    } catch {
      // Fall back
    }
  }

  // Skip and Limit for Pagination
  args.push('-n', String(limit));
  if (skip > 0) {
    args.push('--skip', String(skip));
  }

  try {
    const output = await execGit(args, cwd, signal);
    return output
      .split('\n')
      .map(line => parseCommitLine(line))
      .filter((c): c is CommitInfo => c !== null);
  } catch (e: any) {
    if (e.message === 'ABORTED') {
      throw e;
    }
    console.error('Error fetching commits:', e);
    return [];
  }
}

export async function getCommitsUntil(
  cwd: string,
  filters: GitFilters,
  targetHash: string,
  maxLimit: number = 3000,
  signal?: AbortSignal
): Promise<{ commits: CommitInfo[]; found: boolean }> {
  const { args, searchHash } = buildLogArgs(filters);
  args.push('-n', String(maxLimit));

  try {
    const output = await execGit(args, cwd, signal);
    const allCommits = output
      .split('\n')
      .map(line => parseCommitLine(line))
      .filter((c): c is CommitInfo => c !== null);

    const targetLower = targetHash.toLowerCase();
    const index = allCommits.findIndex(c => c.hash.toLowerCase().startsWith(targetLower));

    if (index !== -1) {
      // Return commits up to and including the target commit, plus 50 more to show history context below it
      const endSlice = Math.min(allCommits.length, index + 50);
      return {
        commits: allCommits.slice(0, endSlice),
        found: true
      };
    }

    return {
      commits: [],
      found: false
    };
  } catch (e: any) {
    if (e.message === 'ABORTED') {
      throw e;
    }
    console.error('Error in getCommitsUntil:', e);
    return { commits: [], found: false };
  }
}

export function parseCommitLine(line: string): CommitInfo | null {
  if (!line.trim()) {
    return null;
  }
  const parts = line.split('\x1f');
  if (parts.length < 7) {
    return null;
  }
  const hash = parts[0];
  const parents = parts[1] ? parts[1].split(' ') : [];
  const author = parts[2];
  const email = parts[3];
  const timestamp = parseInt(parts[4], 10);
  const decPart = parts[5].trim();
  const message = parts.slice(6).join('\x1f');

  // Parse decorations (e.g. "(HEAD -> master, origin/master, tag: v1.0.0)")
  const decorations: string[] = [];
  if (decPart && decPart.startsWith('(') && decPart.endsWith(')')) {
    const refs = decPart.substring(1, decPart.length - 1).split(', ');
    refs.forEach(ref => {
      if (ref.startsWith('HEAD -> ') || ref === 'HEAD') {
        decorations.push('HEAD');
      }
      const cleanRef = ref.replace('HEAD -> ', '').trim();
      if (cleanRef && cleanRef !== 'HEAD') {
        decorations.push(cleanRef);
      }
    });
  }

  return { hash, parents, author, email, timestamp, decorations, message };
}
