export interface CommitInfo {
  hash: string;
  parents: string[];
  author: string;
  email: string;
  timestamp: number; // Unix timestamp
  decorations: string[];
  message: string;
}

export interface DiffLine {
  type: 'added' | 'deleted' | 'context';
  text: string;
}

export interface CommitDiff {
  hash: string;
  parentHash: string;
  parents?: string[];
  author: string;
  email: string;
  timestamp: number;
  message: string;
  diffLines: DiffLine[];
  lineRange?: {
    oldStart: number;
    oldLength: number;
    newStart: number;
    newLength: number;
  };
  oldFilePath?: string;
  newFilePath?: string;
}

export interface GitFilters {
  branch?: string;
  author?: string;
  since?: string;
  until?: string;
  query?: string;
  firstParent?: boolean;
}

export interface ContributorStat {
  author: string;
  email: string;
  commits: number;
  additions: number;
  deletions: number;
  totalChanged: number; // additions + deletions
  weekdayDistribution: number[]; // [Mon(1)..Sun(0)], index 0=Sun,1=Mon,...,6=Sat
  topFiles: FileStat[]; // per-author most-modified files
}

export interface DailyActivity {
  date: string; // YYYY-MM-DD
  count: number;
}

export interface HourlyActivity {
  hour: number; // 0-23
  label: string; // e.g. "00:00", "06:00"
  count: number;
}

export interface FileStat {
  path: string;
  changes: number; // number of commits touching this file
}

export interface CodeStats {
  totalCommits: number;
  totalAdditions: number;
  totalDeletions: number;
  totalChanged: number;
  contributors: ContributorStat[];
  dailyActivity: DailyActivity[];
  hourlyActivity: HourlyActivity[] | null; // non-null only when range ≤1 day
  topFiles: FileStat[];
  sinceDate: string;
  untilDate: string;
}

export interface WorkingTreeFile {
  path: string;
  oldPath?: string;
  status: string;
  staged: boolean;
  additions?: number;
  deletions?: number;
}

export interface WorkingTreeStatus {
  hasChanges: boolean;
  stagedCount: number;
  unstagedCount: number;
  untrackedCount: number;
  files: WorkingTreeFile[];
  isMerging: boolean;
  mergeHeads: string[];
}

export interface WorktreeInfo {
  path: string;
  headHash: string;
  branch?: string;
  isBare: boolean;
  isLocked: boolean;
  lockReason?: string;
  isCurrent: boolean;
}

export interface GitUser {
  name?: string;
  email?: string;
}

export interface FileLastCommit {
  hash: string;
  author: string;
  email: string;
  timestamp: number;
  message: string;
}

export interface FileAuthor {
  name: string;
  email: string;
}
