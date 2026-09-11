import { state } from './state';
import { elements } from './dom';
import { reloadData, hideLoading, saveCurrentState, showError } from './dataLoader';
import { updateFilterControls, updateSelectWidths } from './filters';
import { renderTableAndGraph } from './graphLayout';
import { renderFileHistory } from './fileHistory';
import { constants } from './constants';
import { renderCommitDetail, focusAndHighlightCommit, collapseDetail } from './commitDetail';
import { renderSelectionHistory } from './selectionHistory';
import { renderFileBlameStats } from './roseChart';
import { setRightPaneVisible, setRightPaneStateByNumber, setRightPane } from './rightPane';
import { renderStatsStrip, renderOverviewStats } from './statsCharts';
import { RightPaneState } from './types';
import { showAuthorDetail } from './authorDetail';
import { updateVirtualList } from './virtualList';
import { updateRepoSelector, showEmptyState, hideEmptyState, updateRepoSelectorVisibility } from './repoSelector';
import { renderCommitTooltipFiles } from './commitTooltip';

export function initMessageHandler() {
  window.addEventListener('message', event => {
    const message = event.data;
  
    switch (message.type) {
      case 'refresh':
        reloadData({ silent: !!message.silent });
        break;
      case 'hideLoading':
        hideLoading();
        state.isFetching = false;
        break;
      case 'reposLoaded': {
        hideLoading();
        state.isFetching = false;
        state.repos = message.repos || [];
        state.selectedRepoIndex = message.selectedIndex ?? 0;

        updateRepoSelector();
        updateRepoSelectorVisibility();

        if (state.repos.length === 0) {
          showEmptyState();
        } else {
          hideEmptyState();
          // Reload data when the selected repo changed (switched by user or list changed)
          if (message.needsReload) {
            reloadData();
          }
        }
        break;
      }
      case 'error':
        hideLoading();
        state.isFetching = false;
        // fetch 失败也要解除按钮的旋转态
        if (elements.fetchBtn) elements.fetchBtn.classList.remove('fetching');
        showError(message.error);
        break;
      case 'fetchRemoteDone': {
        // host 端完成 git fetch 后回送，解除按钮旋转态；
        // message.refresh=true 时表示远端确实有变化，host 已通过 watcher 触发刷新
        if (elements.fetchBtn) elements.fetchBtn.classList.remove('fetching');
        if (message.error) {
          showError(message.error);
        } else if (message.refresh === false) {
          // 没触发 watcher（无新对象），主动触发一次刷新
          (window as any).vscode.postMessage({ command: 'loadData', page: 0 });
        }
        break;
      }
      case 'dataLoaded': {
        hideLoading();
        state.isFetching = false;
  
        const newCommits = message.commits;
        const page = message.page;
        state.currentPage = page;
  
        if (page === 0) {
          state.commits = newCommits;
          const realCount = newCommits.filter((c: any) => c.hash !== '*working-tree*').length;
          state.hasMoreCommits = realCount >= state.pageSize;

          if (state.selectedCommitHash && !newCommits.some((c: any) => c.hash === state.selectedCommitHash)) {
            state.selectedCommitHash = null;
            if (state.rightPaneState === RightPaneState.COMMIT) {
              collapseDetail();
            }
          }
        } else {
          state.commits = state.commits.concat(newCommits);
          state.hasMoreCommits = newCommits.length === state.pageSize;
        }
  
        state.branches = message.branches;
        state.remoteBranches = message.remoteBranches || [];
        state.authors = message.authors;
        state.worktrees = message.worktrees || [];
  
        updateFilterControls();
        renderTableAndGraph();
        saveCurrentState();
        break;
      }
      case 'commitDetail':
        renderCommitTooltipFiles(message.hash, message.files);
        renderCommitDetail(message.hash, message.files);
        break;
      case 'showHistory':
        hideLoading();
        state.isFetching = false;
        renderSelectionHistory(message.filePath, message.startLine, message.endLine, message.commits);
        break;
      case 'showFileHistory':
        hideLoading();
        state.isFetching = false;
        renderFileHistory(message.filePath, message.commits);
        break;
      case 'showFileBlameStats':
        renderFileBlameStats(message.fileName, message.stats);
        break;
      case 'clearFileBlameStats':
        if (state.rightPaneState === RightPaneState.FILE_BLAME_STATS) {
          setRightPaneVisible(0);
          saveCurrentState();
        }
        break;
      case 'setRightPaneState':
        setRightPaneStateByNumber(message.state);
        break;
      case 'focusCommit':
        focusAndHighlightCommit(message.hash);
        break;
      case 'commitLocated': {
        hideLoading();
        state.isFetching = false;
  
        if (message.resetFilters) {
          elements.branchSelect.value = '';
          elements.authorSelect.value = '';
          elements.datePresetSelect.value = '';
          elements.sinceDate.value = '';
          elements.untilDate.value = '';
          elements.dateRangeGroup.classList.add('hidden');
          elements.searchInput.value = '';
          updateSelectWidths();
        }
  
        state.commits = message.commits;
        state.currentPage = Math.max(0, Math.ceil(state.commits.length / state.pageSize) - 1);
        state.hasMoreCommits = message.commits.length >= state.pageSize;
  
        state.branches = message.branches;
        state.remoteBranches = message.remoteBranches || [];
        state.authors = message.authors;
        state.worktrees = message.worktrees || [];
  
        updateFilterControls();
        renderTableAndGraph();
        saveCurrentState();

        // 双 rAF 等待 layout 完成后再计算 scrollTop 并触发点击；
        // 比 setTimeout(100) 更稳定（不依赖固定延迟，慢机器也准确），快机器上无谓延迟更短
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            const index = state.commits.findIndex(c => c.hash === message.hash);
            if (index === -1) return;
            const rowHeight = constants.rowHeight;
            elements.tableContainer.scrollTop = Math.max(0, index * rowHeight - elements.tableContainer.clientHeight / 2 + rowHeight / 2);
            updateVirtualList();
            let row = elements.commitsTbody.querySelector(`tr.commit-row[data-hash="${message.hash}"]`);
            if (row) {
              if (state.selectedCommitHash !== (row as HTMLElement).dataset.hash) {
                (row as HTMLElement).click();
              }
            }
          });
        });
        break;
      }
      case 'statsLoaded':
        state.currentStatsData = message.stats;
        renderStatsStrip(message.stats);
        if (window._pendingForceExpand) {
          // 筛选/重新加载触发：无论当前右侧显示什么，统一切换到统计概览
          setRightPane(RightPaneState.OVERVIEW);
          renderOverviewStats(message.stats);
          window._pendingForceExpand = false;
        } else if (state.rightPaneState === RightPaneState.OVERVIEW || state.rightPaneState === RightPaneState.LOADING) {
          // 非筛选触发的统计刷新（如后台刷新）：只在右侧可见时更新内容
          if (state.rightPaneVisible === 1) {
            setRightPane(RightPaneState.OVERVIEW);
          } else {
            state.rightPaneState = RightPaneState.OVERVIEW;
          }
          renderOverviewStats(message.stats);
        } else if (state.rightPaneState === RightPaneState.AUTHOR && state.currentFocusedAuthor) {
          // 作者详情页：用新数据刷新
          const contrib = message.stats.contributors.find((c: any) => c.author === state.currentFocusedAuthor);
          if (contrib) { showAuthorDetail(contrib); }
        }
        break;
      case 'statsError':
        // Stats failed silently — just hide the strip loading state
        break;
    }
  });
}
