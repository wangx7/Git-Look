import { Commit, CodeStats, WebviewState, RightPaneState, RightPaneStateType, Filters, RepoInfo } from './types';

export class StateManager {
  commits: Commit[] = [];
  branches: string[] = [];
  remoteBranches: string[] = [];
  authors: string[] = [];
  selectedCommitHash: string | null = null;
  expandedRow: string | null = null;
  currentGraphWidth: number = 120;
  cachedLines: any[] = [];
  cachedCommitNodes: Record<string, any> = {};
  branchColorMap: Map<string, string> = new Map();
  currentStatsData: CodeStats | null = null;
  currentFocusedAuthor: string | null = null;
  commitBranchLabel: Record<string, { name: string | null; color: string }> = {};
  isOverlayMode: boolean = false;
  rightPaneVisible: number = 1;
  lastStartIndex: number = -1;
  lastEndIndex: number = -1;
  rightPaneState: RightPaneStateType = RightPaneState.LOADING;
  isFetching: boolean = false;
  hasMoreCommits: boolean = true;
  currentPage: number = 0;
  readonly pageSize: number = 150;
  repos: RepoInfo[] = [];
  selectedRepoIndex: number = 0;

  getRightPaneStateNumber(): number {
    if (this.rightPaneVisible === 0) {
      return 0; // 0: hidden
    }
    switch (this.rightPaneState) {
      case RightPaneState.OVERVIEW: return 1;
      case RightPaneState.COMMIT:
      case RightPaneState.AUTHOR: return 2;
      case RightPaneState.HISTORY: return 3;
      case RightPaneState.FILE_BLAME_STATS: return 4;
      case RightPaneState.FILE_HISTORY: return 5;
      case RightPaneState.LOADING:
      default: return 1;
    }
  }

  saveCurrentState(filters: Filters, detailsWidth: string): void {
    const state: WebviewState = {
      commits: this.commits,
      branches: this.branches,
      remoteBranches: this.remoteBranches,
      authors: this.authors,
      selectedCommitHash: this.selectedCommitHash,
      currentPage: this.currentPage,
      hasMoreCommits: this.hasMoreCommits,
      filters,
      detailsWidth,
      rightPaneState: this.rightPaneState,
      rightPaneVisible: this.rightPaneVisible,
      detailsCollapsed: this.rightPaneVisible === 0,
      repos: this.repos,
      selectedRepoIndex: this.selectedRepoIndex
    };
    window.vscode.setState(state);
  }
}

export const state = new StateManager();
