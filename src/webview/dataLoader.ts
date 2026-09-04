import { state } from './state';
import { elements } from './dom';
import { getFilters } from './filters';
import { RightPaneState } from './types';
import { setRightPane } from './rightPane';

let loadingTimer: any = null;

export function showLoading() {
  loadingTimer = setTimeout(() => {
    elements.loadingOverlay.classList.remove('hidden');
  }, 150);
}

export function hideLoading() {
  if (loadingTimer) { clearTimeout(loadingTimer); loadingTimer = null; }
  elements.loadingOverlay.classList.add('hidden');
}

export function reloadData(options: { forceExpandOverview?: boolean; silent?: boolean } | boolean = false) {
  const forceExpandOverview = typeof options === 'boolean' ? options : !!options.forceExpandOverview;
  const silent = typeof options === 'boolean' ? false : !!options.silent;

  state.currentPage = 0;
  state.hasMoreCommits = true;
  if (!silent) {
    state.commits = [];
    state.selectedCommitHash = null;
    state.currentFocusedAuthor = null;
    window._pendingForceExpand = forceExpandOverview;
    if (forceExpandOverview || state.rightPaneState === RightPaneState.LOADING) {
      setRightPane(RightPaneState.LOADING);
    }
    showLoading();
  }
  state.isFetching = true;
  elements.errorBanner.classList.add('hidden');

  const filters = getFilters();

  window.vscode.postMessage({ command: 'loadData', filters, page: 0 });
  requestStats(filters);
}

export function loadNextPage() {
  if (state.isFetching || !state.hasMoreCommits) return;
  state.isFetching = true;
  showLoading();

  const filters = getFilters();

  window.vscode.postMessage({ command: 'loadData', filters, page: state.currentPage + 1 });
}

export function requestStats(filters: any) {
  const statsFilters = {
    branch: filters.branch,
    author: filters.author,
    since: filters.since,
    until: filters.until
  };
  window.vscode.postMessage({ command: 'getStats', filters: statsFilters });
}

export function showError(msg: string) {
  elements.errorBanner.textContent = msg;
  elements.errorBanner.classList.remove('hidden');
}

export function saveCurrentState() {
  const filters = {
    branch: elements.branchSelect.value || undefined,
    author: elements.authorSelect.value || undefined,
    datePreset: elements.datePresetSelect.value || undefined,
    since: elements.sinceDate.value || undefined,
    until: elements.untilDate.value || undefined,
    query: elements.searchInput.value.trim() || undefined
  };
  state.saveCurrentState(filters, elements.detailsPane.style.width);
}
