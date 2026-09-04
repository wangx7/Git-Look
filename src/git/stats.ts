import { execGit } from './exec';
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

  const args = ['log', '--no-merges', '--numstat', '--no-renames',
    '--pretty=format:COMMIT_STAT|%H|%an|%ae|%at'];

  if (filters.branch) {
    args.push(filters.branch);
  } else {
    args.push('--branches', '--tags', '--remotes', 'HEAD');
  }
  if (filters.author) {
    args.push(`--author=${filters.author}`);
  }
  args.push(`--since=${effectiveSinceVal}`, `--until=${effectiveUntilVal}`);

  let output: string;
  try {
    output = await execGit(args, cwd, signal);
  } catch (e: any) {
    if (e.message === 'ABORTED') { throw e; }
    console.error('Error running git log for getCodeStats:', e);
    throw e;
  }

  try {
    const lines = output.split('\n');

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

    let currentAuthor = '';
    let currentEmail = '';
    let currentTs = 0;

    for (const line of lines) {
      if (line.startsWith('COMMIT_STAT|')) {
        const parts = line.split('|');
        currentAuthor = parts[2];
        currentEmail = parts[3];
        currentTs = parseInt(parts[4], 10);

        if (!authorMap.has(currentAuthor)) {
          authorMap.set(currentAuthor, {
            email: currentEmail,
            commits: 0,
            additions: 0,
            deletions: 0,
            weekdays: [0, 0, 0, 0, 0, 0, 0],
            fileMap: new Map()
          });
        }
        const entry = authorMap.get(currentAuthor)!;
        entry.commits++;

        const d = new Date(currentTs * 1000);
        entry.weekdays[d.getDay()]++;
        const dateStr = toLocalDateString(d);
        dailyMap.set(dateStr, (dailyMap.get(dateStr) || 0) + 1);
        const h = d.getHours();
        hourMap.set(h, (hourMap.get(h) || 0) + 1);

      } else if (line.trim() && currentAuthor) {
        const tabParts = line.split('\t');
        if (tabParts.length >= 3) {
          const adds = tabParts[0] === '-' ? 0 : (parseInt(tabParts[0], 10) || 0);
          const dels = tabParts[1] === '-' ? 0 : (parseInt(tabParts[1], 10) || 0);
          const filePath = tabParts[2];

          const entry = authorMap.get(currentAuthor)!;
          entry.additions += adds;
          entry.deletions += dels;

          if (filePath) {
            fileMap.set(filePath, (fileMap.get(filePath) || 0) + 1);
            entry.fileMap.set(filePath, (entry.fileMap.get(filePath) || 0) + 1);
          }
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
