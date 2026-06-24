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

export function reloadData(forceExpandOverview = false) {
  state.currentPage = 0;
  state.hasMoreCommits = true;
  state.commits = [];
  state.selectedCommitHash = null;
  state.currentFocusedAuthor = null;
  window._pendingForceExpand = forceExpandOverview;
  setRightPane(RightPaneState.LOADING);
  state.isFetching = true;
  showLoading();
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
