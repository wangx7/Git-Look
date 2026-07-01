export interface Commit {
  hash: string;
  parents: string[];
  author: string;
  email: string;
  timestamp: number;
  message: string;
  decorations?: string[];
}

export interface FileChange {
  status: string;
  path: string;
  additions: number;
  deletions: number;
}

export interface ContributorStats {
  author: string;
  email?: string;
  commits: number;
  additions: number;
  deletions: number;
  topFiles?: any[];
}

export interface CodeStats {
  totalCommits: number;
  totalAdditions: number;
  totalDeletions: number;
  contributors: ContributorStats[];
  dailyActivity: Record<string, number>;
  topFiles: { path: string; count: number }[];
}

export interface RepoInfo {
  root: string;
  name: string;
}

export interface Filters {
  branch?: string;
  author?: string;
  datePreset?: string;
  since?: string;
  until?: string;
  query?: string;
}

export interface WebviewState {
  commits: Commit[];
  branches: string[];
  remoteBranches: string[];
  authors: string[];
  selectedCommitHash: string | null;
  currentPage: number;
  hasMoreCommits: boolean;
  filters: Filters;
  detailsWidth?: string;
  rightPaneState?: string;
  rightPaneVisible?: number;
  detailsCollapsed?: boolean;
  repos?: RepoInfo[];
  selectedRepoIndex?: number;
}

export const RightPaneState = { 
  OVERVIEW: 'overview', 
  COMMIT: 'commit', 
  AUTHOR: 'author', 
  HISTORY: 'history', 
  FILE_HISTORY: 'file_history',
  FILE_BLAME_STATS: 'file_blame_stats', 
  LOADING: 'loading' 
} as const;

export type RightPaneStateType = typeof RightPaneState[keyof typeof RightPaneState];

declare global {
  function acquireVsCodeApi(): {
    postMessage(message: any): void;
    getState(): any;
    setState(state: any): void;
  };

  interface Window {
    _pendingForceExpand?: boolean;
    rowMaxLanes?: number[];
    pendingFileLoadTimeout?: any;
    vscode: ReturnType<typeof acquireVsCodeApi>;
  }
}
