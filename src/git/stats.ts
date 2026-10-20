import { execGit, execGitStream } from './exec';
import { CodeStats, GitFilters, ContributorStat, DailyActivity, HourlyActivity, FileStat } from './types';

/**
 * Format Date to YYYY-MM-DD in LOCAL timezone (matches Git's date interpretation)
 * Avoids off-by-one day errors from toISOString() which uses UTC
 */
export function toLocalDateString(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

interface CommitNumstat {
  additions: number;
  deletions: number;
  files: string[];
}

/** Upper bound on cached commits per repo, to keep memory bounded on huge repositories. */
const MAX_CACHED_COMMITS = 100000;

/**
 * Per-repo cache of commit hash → numstat. A commit's diff never changes,
 * so entries stay valid across refreshes and are never invalidated by ref updates.
 */
const numstatCache = new Map<string, Map<string, CommitNumstat>>();

export function clearStatsCache() {
  numstatCache.clear();
}

async function fillNumstatCache(cwd: string, hashes: string[], signal?: AbortSignal): Promise<void> {
  let repoCache = numstatCache.get(cwd);
  if (!repoCache) {
    repoCache = new Map();
    numstatCache.set(cwd, repoCache);
  }
  let missing = hashes.filter(h => !repoCache!.has(h));
  if (missing.length === 0) {
    return;
  }
  if (repoCache.size + missing.length > MAX_CACHED_COMMITS) {
    repoCache.clear();
    missing = hashes;
  }

  const cache = repoCache;
  let currentHash: string | null = null;
  let current: CommitNumstat = { additions: 0, deletions: 0, files: [] };
  const flush = () => {
    if (currentHash) {
      cache.set(currentHash, current);
    }
  };

  // Hashes go through stdin: thousands of them would overflow the command line on Windows.
  // Each commit is committed to the cache once complete, so an aborted run still saves its progress.
  await execGitStream(
    ['log', '--no-walk=unsorted', '--numstat', '--no-renames', '--pretty=format:COMMIT_STAT|%H', '--stdin'],
    cwd,
    line => {
      if (line.startsWith('COMMIT_STAT|')) {
        flush();
        currentHash = line.substring(12);
        current = { additions: 0, deletions: 0, files: [] };
        return;
      }
      const tabParts = line.split('\t');
      if (currentHash && tabParts.length >= 3) {
        current.additions += tabParts[0] === '-' ? 0 : (parseInt(tabParts[0], 10) || 0);
        current.deletions += tabParts[1] === '-' ? 0 : (parseInt(tabParts[1], 10) || 0);
        if (tabParts[2]) {
          current.files.push(tabParts[2]);
        }
      }
    },
    signal,
    missing.join('\n') + '\n'
  );
  flush();
}

export async function getCodeStats(
  cwd: string,
  filters: GitFilters,
  signal?: AbortSignal
): Promise<CodeStats> {
  // Default time window: last 100 days if no date range specified
  const effectiveSince = filters.since || (() => {
    const d = new Date();
    d.setDate(d.getDate() - 100);
    return toLocalDateString(d);
  })();
  const effectiveUntil = filters.until || toLocalDateString(new Date());

  // Always explicitly append times for correct date range inclusion
  let effectiveSinceVal = effectiveSince;
  if (/^\d{4}-\d{2}-\d{2}$/.test(effectiveSinceVal)) {
    effectiveSinceVal += ' 00:00:00';
  }
  let effectiveUntilVal = effectiveUntil;
  if (/^\d{4}-\d{2}-\d{2}$/.test(effectiveUntilVal)) {
    effectiveUntilVal += ' 23:59:59';
  }

  const args = ['log', '--no-merges', '--pretty=format:%H%x1f%an%x1f%ae%x1f%at'];

  if (filters.branch) {
    args.push(filters.branch);
  } else {
    args.push('--branches', '--tags', '--remotes', 'HEAD');
  }
  if (filters.author) {
    args.push(`--author=${filters.author}`);
  }
  args.push(`--since=${effectiveSinceVal}`, `--until=${effectiveUntilVal}`);

  // Listing commits is cheap; the per-commit diffs (--numstat) are what make this command slow
  // on large repos, so they are fetched only for commits not already in the cache.
  let commits: { hash: string; author: string; email: string; timestamp: number }[];
  try {
    const output = await execGit(args, cwd, signal);
    commits = output.split('\n').filter(Boolean).map(line => {
      const [hash, author, email, ts] = line.split('\x1f');
      return { hash, author, email, timestamp: parseInt(ts, 10) };
    });
    await fillNumstatCache(cwd, commits.map(c => c.hash), signal);
  } catch (e: any) {
    if (e.message === 'ABORTED') { throw e; }
    console.error('Error running git log for getCodeStats:', e);
    throw e;
  }

  try {
    const repoCache = numstatCache.get(cwd);

    const authorMap = new Map<string, {
      email: string;
      commits: number;
      additions: number;
      deletions: number;
      weekdays: number[];
      fileMap: Map<string, number>;
    }>();
    const dailyMap = new Map<string, number>();
    const hourMap = new Map<number, number>(); // hour 0-23
    const fileMap = new Map<string, number>();

    for (const commit of commits) {
      if (!authorMap.has(commit.author)) {
        authorMap.set(commit.author, {
          email: commit.email,
          commits: 0,
          additions: 0,
          deletions: 0,
          weekdays: [0, 0, 0, 0, 0, 0, 0],
          fileMap: new Map()
        });
      }
      const entry = authorMap.get(commit.author)!;
      entry.commits++;

      const d = new Date(commit.timestamp * 1000);
      entry.weekdays[d.getDay()]++;
      const dateStr = toLocalDateString(d);
      dailyMap.set(dateStr, (dailyMap.get(dateStr) || 0) + 1);
      const h = d.getHours();
      hourMap.set(h, (hourMap.get(h) || 0) + 1);

      const numstat = repoCache?.get(commit.hash);
      if (numstat) {
        entry.additions += numstat.additions;
        entry.deletions += numstat.deletions;
        for (const filePath of numstat.files) {
          fileMap.set(filePath, (fileMap.get(filePath) || 0) + 1);
          entry.fileMap.set(filePath, (entry.fileMap.get(filePath) || 0) + 1);
        }
      }
    }

    const contributors: ContributorStat[] = Array.from(authorMap.entries())
      .map(([author, s]) => ({
        author,
        email: s.email,
        commits: s.commits,
        additions: s.additions,
        deletions: s.deletions,
        totalChanged: s.additions + s.deletions,
        weekdayDistribution: s.weekdays,
        topFiles: Array.from(s.fileMap.entries())
          .map(([p, changes]) => ({ path: p, changes }))
          .sort((a, b) => b.changes - a.changes)
          .slice(0, 8)
      }))
      .sort((a, b) => b.totalChanged - a.totalChanged);

    const totalCommits = contributors.reduce((s, c) => s + c.commits, 0);
    const totalAdditions = contributors.reduce((s, c) => s + c.additions, 0);
    const totalDeletions = contributors.reduce((s, c) => s + c.deletions, 0);

    const dailyActivity: DailyActivity[] = [];
    // Parse dates as LOCAL timezone (YYYY-MM-DD without Z suffix uses local time)
    const startD = new Date(effectiveSince + 'T00:00:00');
    const endD = new Date(effectiveUntil + 'T00:00:00');
    for (let d = new Date(startD); d <= endD; d.setDate(d.getDate() + 1)) {
      const dateStr = toLocalDateString(d);
      dailyActivity.push({ date: dateStr, count: dailyMap.get(dateStr) || 0 });
    }

    // Build hourly activity if range is within 1 day
    const isSingleDayRange = effectiveSince === effectiveUntil;
    const hourlyActivity: HourlyActivity[] | null = isSingleDayRange
      ? Array.from({ length: 24 }, (_, h) => ({
          hour: h,
          label: String(h).padStart(2, '0') + ':00',
          count: hourMap.get(h) || 0
        }))
      : null;

    const topFiles: FileStat[] = Array.from(fileMap.entries())
      .map(([p, changes]) => ({ path: p, changes }))
      .sort((a, b) => b.changes - a.changes)
      .slice(0, 10);

    return {
      totalCommits,
      totalAdditions,
      totalDeletions,
      totalChanged: totalAdditions + totalDeletions,
      contributors,
      dailyActivity,
      hourlyActivity,
      topFiles,
      sinceDate: effectiveSince,
      untilDate: effectiveUntil
    };
  } catch (e: any) {
    console.error('Error parsing getCodeStats output:', e);
    throw e;
  }
}
