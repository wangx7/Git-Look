import { state } from './state';
import { elements } from './dom';
import { RightPaneState } from './types';
import { setRightPaneVisible, setRightPane, updateDetailsCollapseUI, onRightPaneStateChange } from './rightPane';
import { initFilters, updateFilterControls, getFilters, adjustSelectWidth } from './filters';
import { reloadData, requestStats, saveCurrentState, loadNextPage } from './dataLoader';
import { renderTableAndGraph } from './graphLayout';
import { updateVirtualList } from './virtualList';
import { handleRowClick, onRequestVirtualListUpdate } from './commitDetail';
import { initLayout } from './layout';
import { initMessageHandler } from './messageHandler';
import { constants } from './constants';

window.vscode = acquireVsCodeApi();
const vscode = window.vscode;

function init() {
  // Init layout and event listeners
  initLayout();
  initFilters(() => reloadData(true));
  initMessageHandler();
  onRightPaneStateChange(saveCurrentState);
  onRequestVirtualListUpdate(updateVirtualList);

  elements.commitsTbody.addEventListener('click', (e) => {
    const row = (e.target as HTMLElement).closest('.commit-row');
    if (row) {
      const hash = (row as HTMLElement).dataset.hash;
      const parents = JSON.parse((row as HTMLElement).dataset.parents || '[]');
      handleRowClick(row, hash, parents);
    }
  });

  window.addEventListener('detailsExpanded', () => {
    import('./svgRenderer').then(({ drawSvg }) => drawSvg(state.lastStartIndex || 0, state.lastEndIndex || state.commits.length - 1));
    if (state.currentStatsData && state.currentStatsData.dailyActivity) {
      import('./statsCharts').then(({ renderActivityChart }) => renderActivityChart(state.currentStatsData.dailyActivity));
    }
  });

  elements.tableContainer.addEventListener('scroll', () => {
    updateVirtualList();
    if (state.isFetching || !state.hasMoreCommits) return;
    const { scrollHeight, scrollTop, clientHeight } = elements.tableContainer;
    if (scrollHeight - scrollTop - clientHeight < 120) {
      loadNextPage();
    }
  });

  if (elements.statsToggleBtn) {
    elements.statsToggleBtn.addEventListener('click', () => {
      if (state.currentStatsData) {
        const sel = elements.commitsTbody.querySelector('tr.commit-row.selected');
        if (sel) sel.classList.remove('selected');
        state.selectedCommitHash = null;
        import('./statsCharts').then(({ renderOverviewStats }) => {
            renderOverviewStats(state.currentStatsData);
            setRightPane(RightPaneState.OVERVIEW);
        });
      }
    });
  }

  elements.authorHighlightBtn.addEventListener('click', () => {
    if (!state.currentFocusedAuthor) return;
    const existingOption = Array.from(elements.authorSelect.options).find(o => o.value === state.currentFocusedAuthor);
    if (!existingOption) {
      const opt = document.createElement('option');
      opt.value = state.currentFocusedAuthor;
      opt.textContent = state.currentFocusedAuthor;
      elements.authorSelect.appendChild(opt);
    }
    elements.authorSelect.value = state.currentFocusedAuthor;
    adjustSelectWidth(elements.authorSelect);
    reloadData();
  });

  // Restore state if available
  const previousState = vscode.getState();
  if (previousState) {
    state.commits = previousState.commits || [];
    state.branches = previousState.branches || [];
    state.remoteBranches = previousState.remoteBranches || [];
    state.authors = previousState.authors || [];
    state.selectedCommitHash = previousState.selectedCommitHash || null;
    state.currentPage = previousState.currentPage || 0;
    state.hasMoreCommits = previousState.hasMoreCommits !== undefined ? previousState.hasMoreCommits : true;

    if (previousState.rightPaneVisible !== undefined) {
      state.rightPaneVisible = previousState.rightPaneVisible;
    } else if (previousState.detailsCollapsed !== undefined) {
      state.rightPaneVisible = previousState.detailsCollapsed ? 0 : 1;
    } else {
      state.rightPaneVisible = 1;
    }
    updateDetailsCollapseUI();

    if (previousState.detailsWidth) {
      elements.detailsPane.style.width = previousState.detailsWidth;
    }

    if (previousState.filters) {
      elements.branchSelect.value = previousState.filters.branch || '';
      elements.branchSelect.dataset.restoredValue = previousState.filters.branch || '';
      elements.authorSelect.value = previousState.filters.author || '';
      elements.authorSelect.dataset.restoredValue = previousState.filters.author || '';
      elements.datePresetSelect.value = previousState.filters.datePreset || '';
      elements.sinceDate.value = previousState.filters.since || '';
      elements.untilDate.value = previousState.filters.until || '';
      if (elements.datePresetSelect.value === 'custom') {
        elements.dateRangeGroup.classList.remove('hidden');
      } else {
        elements.dateRangeGroup.classList.add('hidden');
      }
      elements.searchInput.value = previousState.filters.query || '';
    }

    updateFilterControls();
    renderTableAndGraph();

    if (state.selectedCommitHash) {
      const restoredIndex = state.commits.findIndex(c => c.hash === state.selectedCommitHash);
      if (restoredIndex !== -1) {
        const rowHeight = constants.rowHeight;
        elements.tableContainer.scrollTop = Math.max(0, restoredIndex * rowHeight - elements.tableContainer.clientHeight / 2 + rowHeight / 2);
        updateVirtualList();
        const restoredRow = elements.commitsTbody.querySelector(`tr.commit-row[data-hash="${state.selectedCommitHash}"]`);
        if (restoredRow) {
          const restoredParents = JSON.parse((restoredRow as HTMLElement).dataset.parents || '[]');
          handleRowClick(restoredRow, state.selectedCommitHash, restoredParents);
        }
      } else {
        vscode.postMessage({ command: 'getCommitDetail', hash: state.selectedCommitHash });
        setRightPane(RightPaneState.COMMIT);
      }
    } else {
      state.rightPaneVisible = 1;
      updateDetailsCollapseUI();
      setRightPane(RightPaneState.LOADING);
      window._pendingForceExpand = true;
    }
    vscode.postMessage({ command: 'initWatcher' });
    requestStats(getFilters());
  } else {
    // Initial load
    reloadData(true);
  }
}

init();
