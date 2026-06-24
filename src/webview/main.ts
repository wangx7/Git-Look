import { state } from './state';
import { elements } from './dom';

window.vscode = acquireVsCodeApi();
const vscode = window.vscode;

  // Elements removed

  // Helper to map UI state to the state number (0-4)
  function getRightPaneStateNumber() {
    if (state.rightPaneVisible === 0) {
      return 0; // 0: 隐藏
    }
    switch (state.rightPaneState) {
      case 'overview':
        return 1; // 1: 展示统计
      case 'commit':
      case 'author':
        return 2; // 2: 展示详情
      case 'history':
        return 3; // 3: 展示选区历史
      case 'file_blame_stats':
        return 4; // 4: 展示行作者玫瑰图
      case 'loading':
      default:
        return 1;
    }
  }

  // RightPaneState is imported from types

  function checkBlameState() {
    const stateNum = getRightPaneStateNumber();
    vscode.postMessage({ command: 'blameVisibilityChanged', state: stateNum });
  }

  function setRightPane(paneState: any) {
    state.rightPaneState = paneState;
    elements.overviewStats.classList.add('hidden');
    elements.detailsContent.classList.add('hidden');
    elements.authorStatsPane.classList.add('hidden');
    elements.detailsPlaceholder.classList.add('hidden');
    if (elements.selectionHistoryEl) {
      elements.selectionHistoryEl.classList.add('hidden');
    }
    const fileBlameStatsEl = document.getElementById('file-blame-stats');
    if (fileBlameStatsEl) {
      fileBlameStatsEl.classList.add('hidden');
    }

    if (paneState === RightPaneState.LOADING) {
      elements.detailsPlaceholder.classList.remove('hidden');
    } else if (paneState === RightPaneState.OVERVIEW) {
      elements.overviewStats.classList.remove('hidden');
    } else if (paneState === RightPaneState.COMMIT) {
      elements.detailsContent.classList.remove('hidden');
    } else if (paneState === RightPaneState.AUTHOR) {
      elements.authorStatsPane.classList.remove('hidden');
    } else if (paneState === RightPaneState.HISTORY) {
      if (elements.selectionHistoryEl) {
        elements.selectionHistoryEl.classList.remove('hidden');
      }
    } else if (paneState === RightPaneState.FILE_BLAME_STATS) {
      if (fileBlameStatsEl) {
        fileBlameStatsEl.classList.remove('hidden');
      }
    }
    
    // Auto-expand when a view is activated (except for loading)
    if (paneState !== RightPaneState.LOADING) {
      setRightPaneVisible(1);
    } else {
      checkBlameState();
    }
  }

  function updateDetailsCollapseUI() {
    if (elements.mainLayoutEl) {
      elements.mainLayoutEl.classList.toggle('details-collapsed', state.rightPaneVisible === 0);
      if (state.rightPaneVisible !== 0) {
        drawSvg(state.lastStartIndex || 0, state.lastEndIndex || state.commits.length - 1);
        if (state.currentStatsData && state.currentStatsData.dailyActivity && typeof renderActivityChart === 'function') {
          renderActivityChart(state.currentStatsData.dailyActivity);
        }
      }
    }
    checkBlameState();
  }

  function setRightPaneVisible(visible) {
    state.rightPaneVisible = visible;
    updateDetailsCollapseUI();
  }

  function setRightPaneStateByNumber(num) {
    if (num === 0) {
      setRightPaneVisible(0);
    } else {
      setRightPaneVisible(1);
      if (num === 1) {
        setRightPane(RightPaneState.OVERVIEW);
      } else if (num === 2) {
        if (state.selectedCommitHash) {
          setRightPane(RightPaneState.COMMIT);
        } else if (state.currentFocusedAuthor) {
          setRightPane(RightPaneState.AUTHOR);
        } else {
          setRightPane(RightPaneState.OVERVIEW);
        }
      } else if (num === 3) {
        setRightPane(RightPaneState.HISTORY);
      } else if (num === 4) {
        setRightPane(RightPaneState.FILE_BLAME_STATS);
      }
    }
    saveCurrentState();
  }

  function ensureDetailsExpanded() {
    setRightPaneVisible(1);
    saveCurrentState();
  }

  // Pagination State

  function saveCurrentState() {
    const filters = {
      branch: elements.branchSelect.value || undefined,
      author: elements.authorSelect.value || undefined,
      datePreset: elements.datePresetSelect.value || undefined,
      since: elements.sinceDate.value || undefined,
      until: elements.untilDate.value || undefined,
      query: elements.searchInput.value.trim() || undefined
    };
    vscode.setState({
      commits: state.commits,
      branches: state.branches,
      remoteBranches: state.remoteBranches,
      authors: state.authors,
      selectedCommitHash: state.selectedCommitHash,
      currentPage: state.currentPage,
      hasMoreCommits: state.hasMoreCommits,
      filters,
      detailsWidth: elements.detailsPane.style.width,
      rightPaneState: state.rightPaneState,
      rightPaneVisible: state.rightPaneVisible,
      detailsCollapsed: state.rightPaneVisible === 0
    });
  }

  // Loading 防闪烁
  let loadingTimer = null;
  function showLoading() {
    loadingTimer = setTimeout(() => {
      elements.loadingOverlay.classList.remove('hidden');
    }, 150);
  }
  function hideLoading() {
    if (loadingTimer) { clearTimeout(loadingTimer); loadingTimer = null; }
    elements.loadingOverlay.classList.add('hidden');
  }

  // Settings
  const rowHeight = 22;
  const laneWidth = 14;
  const paddingLeft = 12;
import { getFileIconInfo } from './utils/fileIcons';
import { colors, getRelativeTime, formatDate, formatDateShort, escapeHtml, hexToRgba, getAvatarColor, getInitials, fmtNum } from './utils/format';
import { RightPaneState } from './types';

  // ── 请求/加载逻辑 ────────────────────────

  function getFilters() {
    let sinceVal = undefined;
    let untilVal = undefined;

    const preset = elements.datePresetSelect.value;
    if (preset === '24h') {
      const d = new Date();
      d.setDate(d.getDate() - 1);
      sinceVal = d.toISOString().split('T')[0];
    } else if (preset === '7d') {
      const d = new Date();
      d.setDate(d.getDate() - 7);
      sinceVal = d.toISOString().split('T')[0];
    } else if (preset === '30d') {
      const d = new Date();
      d.setDate(d.getDate() - 30);
      sinceVal = d.toISOString().split('T')[0];
    } else if (preset === 'custom') {
      sinceVal = elements.sinceDate.value || undefined;
      untilVal = elements.untilDate.value || undefined;
    }

    return {
      branch: elements.branchSelect.value || undefined,
      author: elements.authorSelect.value || undefined,
      since: sinceVal,
      until: untilVal,
      query: elements.searchInput.value.trim() || undefined
    };
  }

  function reloadData(forceExpandOverview = false) {
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

    vscode.postMessage({ command: 'loadData', filters, page: 0 });
    requestStats(filters);
  }

  function loadNextPage() {
    if (state.isFetching || !state.hasMoreCommits) return;
    state.isFetching = true;
    showLoading();

    const filters = getFilters();

    vscode.postMessage({ command: 'loadData', filters, page: state.currentPage + 1 });
  }

  // 滚动分页与虚拟列表更新
  elements.tableContainer.addEventListener('scroll', () => {
    updateVirtualList();
    if (state.isFetching || !state.hasMoreCommits) return;
    const { scrollHeight, scrollTop, clientHeight } = elements.tableContainer;
    if (scrollHeight - scrollTop - clientHeight < 120) {
      loadNextPage();
    }
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
      // 缓存恢复：自动定位至对应行并模拟点击
      const restoredIndex = state.commits.findIndex(c => c.hash === state.selectedCommitHash);
      if (restoredIndex !== -1) {
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
    // 初始加载
    reloadData(true);
  }

  // 过滤器监听
  elements.branchSelect.addEventListener('change', () => {
    adjustSelectWidth(elements.branchSelect);
    reloadData(true);
  });
  elements.authorSelect.addEventListener('change', () => {
    adjustSelectWidth(elements.authorSelect);
    reloadData(true);
  });
  elements.datePresetSelect.addEventListener('change', () => {
    adjustSelectWidth(elements.datePresetSelect);
    if (elements.datePresetSelect.value === 'custom') {
      elements.dateRangeGroup.classList.remove('hidden');
    } else {
      elements.dateRangeGroup.classList.add('hidden');
      elements.sinceDate.value = '';
      elements.untilDate.value = '';
    }
    reloadData(true);
  });
  elements.sinceDate.addEventListener('change', () => reloadData(true));
  elements.untilDate.addEventListener('change', () => reloadData(true));

  let searchTimeout;
  elements.searchInput.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    elements.searchInput.style.opacity = '0.55'; // 防抖等待期间给出视觉反馈
    searchTimeout = setTimeout(() => {
      elements.searchInput.style.opacity = '';
      reloadData(true);
    }, 350);
  });

  elements.resetBtn.addEventListener('click', () => {
    elements.branchSelect.value = '';
    elements.authorSelect.value = '';
    elements.datePresetSelect.value = '';
    elements.sinceDate.value = '';
    elements.untilDate.value = '';
    elements.dateRangeGroup.classList.add('hidden');
    elements.searchInput.value = '';
    updateSelectWidths();
    reloadData(true);
  });

  // ── 消息处理 ────────────────────────

  window.addEventListener('message', event => {
    const message = event.data;

    switch (message.type) {
      case 'refresh':
        reloadData();
        break;
      case 'error':
        hideLoading();
        state.isFetching = false;
        showError(message.error);
        break;
      case 'dataLoaded':
        hideLoading();
        state.isFetching = false;

        const newCommits = message.commits;
        const page = message.page;
        state.currentPage = page;

        if (page === 0) {
          state.commits = newCommits;
          state.hasMoreCommits = newCommits.length === state.pageSize;
        } else {
          state.commits = state.commits.concat(newCommits);
          state.hasMoreCommits = newCommits.length === state.pageSize;
        }

        state.branches = message.branches;
        state.remoteBranches = message.remoteBranches || [];
        state.authors = message.authors;
        
        updateFilterControls();
        renderTableAndGraph();
        saveCurrentState();
        break;
      case 'commitDetail':
        renderCommitDetail(message.hash, message.files);
        break;
      case 'showHistory':
        hideLoading();
        state.isFetching = false;
        renderSelectionHistory(message.filePath, message.startLine, message.endLine, message.commits);
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
      case 'commitLocated':
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

        updateFilterControls();
        renderTableAndGraph();
        saveCurrentState();

        setTimeout(() => {
          const index = state.commits.findIndex(c => c.hash === message.hash);
          if (index !== -1) {
            elements.tableContainer.scrollTop = Math.max(0, index * rowHeight - elements.tableContainer.clientHeight / 2 + rowHeight / 2);
            updateVirtualList();
            let row = elements.commitsTbody.querySelector(`tr.commit-row[data-hash="${message.hash}"]`);
            if (row) {
              if (state.selectedCommitHash !== (row as HTMLElement).dataset.hash) {
                (row as HTMLElement).click();
              }
            }
          }
        }, 100);
        break;
      case 'statsLoaded':
        state.currentStatsData = message.stats;
        renderStatsStrip(message.stats);
        if (state.rightPaneState === RightPaneState.OVERVIEW || state.rightPaneState === RightPaneState.LOADING) {
          if (window._pendingForceExpand || state.rightPaneVisible === 1) {
            setRightPane(RightPaneState.OVERVIEW);
          } else {
            setRightPane(RightPaneState.OVERVIEW);
            setRightPaneVisible(0);
          }
          renderOverviewStats(message.stats);
          window._pendingForceExpand = false;
        } else if (state.rightPaneState === RightPaneState.AUTHOR && state.currentFocusedAuthor) {
          // Refresh author detail with new data
          const contrib = message.stats.contributors.find(c => c.author === state.currentFocusedAuthor);
          if (contrib) { showAuthorDetail(contrib); }
        }
        break;
      case 'statsError':
        // Stats failed silently — just hide the strip loading state
        break;
    }
  });

  function showError(msg) {
    elements.errorBanner.textContent = msg;
    elements.errorBanner.classList.remove('hidden');
  }

  // ── 过滤控件填充 ────────────────────────

  function adjustSelectWidth(select) {
    // 动态添加占位符置灰样式
    if (select.value === "") {
      select.classList.add('placeholder-selected');
    } else {
      select.classList.remove('placeholder-selected');
    }

    let measurer = document.getElementById('select-width-measurer');
    if (!measurer) {
      measurer = document.createElement('span');
      measurer.id = 'select-width-measurer';
      measurer.style.position = 'absolute';
      measurer.style.visibility = 'hidden';
      measurer.style.whiteSpace = 'pre';
      measurer.style.fontFamily = select.style.fontFamily || 'var(--font-family)';
      measurer.style.fontSize = '11px';
      measurer.style.fontWeight = 'normal';
      document.body.appendChild(measurer);
    }
    const selectedOption = select.options ? select.options[select.selectedIndex] : undefined;
    measurer.textContent = selectedOption ? selectedOption.text : '';
    const width = measurer.offsetWidth + 28;
    select.style.width = `${width}px`;
  }

  function updateSelectWidths() {
    adjustSelectWidth(elements.branchSelect);
    adjustSelectWidth(elements.authorSelect);
    adjustSelectWidth(elements.datePresetSelect);
  }

  function updateFilterControls() {
    let currentBranchValue = elements.branchSelect.value;
    if (elements.branchSelect.dataset.restoredValue !== undefined) {
      currentBranchValue = elements.branchSelect.dataset.restoredValue;
      delete elements.branchSelect.dataset.restoredValue;
    }
    elements.branchSelect.innerHTML = '<option value="">分支</option>';
    state.branches.forEach(b => {
      const option = document.createElement('option');
      option.value = b;
      option.textContent = b;
      if (b === currentBranchValue) option.selected = true;
      elements.branchSelect.appendChild(option);
    });

    let currentAuthorValue = elements.authorSelect.value;
    if (elements.authorSelect.dataset.restoredValue !== undefined) {
      currentAuthorValue = elements.authorSelect.dataset.restoredValue;
      delete elements.authorSelect.dataset.restoredValue;
    }
    elements.authorSelect.innerHTML = '<option value="">作者</option>';
    state.authors.forEach(a => {
      const option = document.createElement('option');
      option.value = a;
      option.textContent = a;
      if (a === currentAuthorValue) option.selected = true;
      elements.authorSelect.appendChild(option);
    });

    updateSelectWidths();
  }

  // ── 图表布局 & 渲染核心 ────────────────────────

  // ── 图表布局 & 核心虚拟列表化 ────────────────────────

  function renderTableAndGraph() {
    const oldSelectedHash = state.selectedCommitHash;

    if (state.commits.length === 0) {
      elements.commitsTbody.innerHTML = '';
      const tr = document.createElement('tr');
      tr.innerHTML = `<td colspan="5">
        <div class="empty-state">
          <i class="codicon codicon-git-commit"></i>
          <span>没有找到匹配的提交记录</span>
        </div>
      </td>`;
      elements.commitsTbody.appendChild(tr);
      elements.graphSvg.style.height = '0px';
      elements.graphSvg.innerHTML = '';
      return;
    }

    // ─── 1. 图表 Lane 分配算法（防重叠新版）─────────

    const isFiltered = !!(
      (elements.authorSelect && elements.authorSelect.value) ||
      (elements.sinceDate && elements.sinceDate.value) ||
      (elements.untilDate && elements.untilDate.value) ||
      (elements.datePresetSelect && elements.datePresetSelect.value && elements.datePresetSelect.value !== 'custom') ||
      (elements.searchInput && elements.searchInput.value.trim())
    );
    const shouldDrawToBottom = state.hasMoreCommits && !isFiltered;

    const commitHashes = new Set(state.commits.map(c => c.hash));
    const hashToCommitMap = new Map();
    const hashToCommitRowMap = new Map();
    state.commits.forEach((c, index) => {
      hashToCommitMap.set(c.hash, c);
      hashToCommitRowMap.set(c.hash, index);
    });

    const lanes = [];             // lanes[i] = hash or null (activeLanes)
    const commitNodes = {};       // hash → { row, lane, isMerge }
    const lines = [];             // 连线数据
    let maxLanes = 0;

    // Helper to find first null slot or push a new one
    function getEmptyLaneIndex(preferZero = false) {
      if (preferZero && lanes[0] === null) {
        return 0;
      }
      const start = preferZero ? 0 : 1;
      for (let i = start; i < lanes.length; i++) {
        if (lanes[i] === null) {
          return i;
        }
      }
      if (preferZero && lanes.length === 0) {
        lanes.push(null); // lane 0
        return 0;
      }
      if (lanes.length === 0) {
        lanes.push(null); // lane 0
      }
      const idx = lanes.length;
      lanes.push(null);
      return idx;
    }

    // Determine if a commit is main trunk
    const mainTrunk = new Set();
    const headCommit = state.commits.find(c => c.decorations && c.decorations.includes('HEAD'));
    let curr = headCommit ? headCommit.hash : (state.commits[0] ? state.commits[0].hash : null);
    while (curr) {
      mainTrunk.add(curr);
      const c = hashToCommitMap.get(curr);
      curr = (c && c.parents && c.parents.length > 0) ? c.parents[0] : null;
    }

    // Branch colors decoration mapping
    state.branchColorMap.clear();

    let nextColorIdx = 1;
    const laneColorIndices = [0]; // lane 0 is mainTrunk, initialized to color index 0

    for (let r = 0; r < state.commits.length; r++) {
      const c = state.commits[r];
      const hash = c.hash;
      const parents = c.parents || [];
      const isMerge = parents.length >= 2;

      // 1. Find or assign lane for the current commit
      let laneIdx = lanes.indexOf(hash);
      if (laneIdx === -1) {
        // Not in activeLanes. This is a branch tip or HEAD.
        if (mainTrunk.has(hash)) {
          laneIdx = 0;
          if (lanes.length === 0) {
            lanes.push(hash);
          } else {
            lanes[0] = hash;
          }
          laneColorIndices[0] = 0;
        } else {
          laneIdx = getEmptyLaneIndex(false);
          lanes[laneIdx] = hash;
          laneColorIndices[laneIdx] = nextColorIdx++;
        }
      }

      // Update all lines pointing to this commit to use its final lane
      lines.forEach(line => {
        if (line.toHash === hash) {
          line.toLane = laneIdx;
          if (line.isMergeLine) {
            line.runningLane = laneIdx;
          }
        }
      });

      // Record commit node position with its unique color index
      const nodeColorIdx = laneColorIndices[laneIdx] !== undefined ? laneColorIndices[laneIdx] : 0;
      commitNodes[hash] = { row: r, lane: laneIdx, isMerge, colorIdx: nodeColorIdx };
      maxLanes = Math.max(maxLanes, lanes.length);

      // Branch color mapping
      if (c.decorations && c.decorations.length > 0) {
        c.decorations.forEach(dec => {
          state.branchColorMap.set(dec, colors[nodeColorIdx % colors.length]);
        });
      }

      // 2. Free up all slots containing the current commit in activeLanes
      for (let i = 0; i < lanes.length; i++) {
        if (lanes[i] === hash) {
          lanes[i] = null;
        }
      }

      // 3. Process parents to reserve lanes and generate lines
      if (parents.length > 0) {
        // A. Primary parent (first parent)
        const p0 = parents[0];
        if (commitHashes.has(p0)) {
          const p0Row = hashToCommitRowMap.get(p0);
          let targetLaneIdx = lanes.indexOf(p0);

          if (targetLaneIdx !== -1) {
            if (laneIdx < targetLaneIdx) {
              lanes[laneIdx] = p0;
              targetLaneIdx = laneIdx;
            }
          } else {
            targetLaneIdx = laneIdx;
            lanes[laneIdx] = p0;
          }

          lines.push({
            fromRow: r,
            fromLane: laneIdx,
            toRow: p0Row,
            toLane: targetLaneIdx,
            runningLane: laneIdx,
            toHash: p0,
            colorIdx: nodeColorIdx
          });
        } else {
          // Parent not loaded
          if (shouldDrawToBottom) {
            lanes[laneIdx] = p0;
            lines.push({
              fromRow: r,
              fromLane: laneIdx,
              toRow: state.commits.length - 0.5,
              toLane: laneIdx,
              runningLane: laneIdx,
              toHash: p0,
              colorIdx: nodeColorIdx
            });
          }
        }

        // B. Secondary parents (merge sources)
        for (let p = 1; p < parents.length; p++) {
          const pk = parents[p];
          if (commitHashes.has(pk)) {
            const pkRow = hashToCommitRowMap.get(pk);
            let targetLaneIdx = lanes.indexOf(pk);

            if (targetLaneIdx === -1) {
              let otherBranchChildLaneIdx = -1;
              for (let i = 0; i < lanes.length; i++) {
                const activeHash = lanes[i];
                if (activeHash) {
                  const activeCommit = hashToCommitMap.get(activeHash);
                  if (activeCommit && activeCommit.parents && activeCommit.parents[0] === pk) {
                    otherBranchChildLaneIdx = i;
                    break;
                  }
                }
              }

              if (otherBranchChildLaneIdx !== -1) {
                targetLaneIdx = otherBranchChildLaneIdx;
              } else {
                targetLaneIdx = getEmptyLaneIndex(false);
                lanes[targetLaneIdx] = pk;
                laneColorIndices[targetLaneIdx] = nextColorIdx++;
              }
            }

            const targetColorIdx = laneColorIndices[targetLaneIdx] !== undefined ? laneColorIndices[targetLaneIdx] : 0;
            lines.push({
              fromRow: r,
              fromLane: laneIdx,
              toRow: pkRow,
              toLane: targetLaneIdx,
              runningLane: targetLaneIdx,
              toHash: pk,
              colorIdx: targetColorIdx,
              isMergeLine: true
            });
          } else {
            // Secondary parent not loaded
            if (shouldDrawToBottom) {
              let targetLaneIdx = lanes.indexOf(pk);
              if (targetLaneIdx === -1) {
                targetLaneIdx = getEmptyLaneIndex(false);
                lanes[targetLaneIdx] = pk;
                laneColorIndices[targetLaneIdx] = nextColorIdx++;
              }
              const targetColorIdx = laneColorIndices[targetLaneIdx] !== undefined ? laneColorIndices[targetLaneIdx] : 0;
              lines.push({
                fromRow: r,
                fromLane: laneIdx,
                toRow: state.commits.length - 0.5,
                toLane: targetLaneIdx,
                runningLane: targetLaneIdx,
                toHash: pk,
                colorIdx: targetColorIdx,
                isMergeLine: true
              });
            }
          }
        }
      }

      // Trim trailing nulls
      while (lanes.length > 0 && lanes[lanes.length - 1] === null) {
        lanes.pop();
      }
      maxLanes = Math.max(maxLanes, lanes.length);
    }

    state.cachedLines = lines;
    state.cachedCommitNodes = commitNodes;

    // Build commit → branch name mapping
    const laneCurrentBranch = {};
    state.commitBranchLabel = {};
    state.commits.forEach(c => {
      const node = commitNodes[c.hash];
      if (!node) return;
      const lane = node.lane;
      const laneColor = colors[node.colorIdx % colors.length];

      let resolvedBranch = null;
      if (c.decorations && c.decorations.length > 0) {
        resolvedBranch = c.decorations.find(d =>
          d !== 'HEAD' &&
          !d.startsWith('origin/') &&
          !d.startsWith('tag: ') &&
          !state.remoteBranches.includes(d)
        );

        if (!resolvedBranch && c.decorations[0] === 'HEAD') {
          resolvedBranch = c.decorations.find(d =>
            d !== 'HEAD' &&
            !d.startsWith('origin/') &&
            !d.startsWith('tag: ')
          );
        }

        if (!resolvedBranch) {
          const remoteDec = c.decorations.find(d =>
            d.startsWith('origin/') || state.remoteBranches.includes(d)
          );
          if (remoteDec) {
            resolvedBranch = remoteDec.replace(/^origin\//, '');
          }
        }
      }

      if (resolvedBranch) {
        laneCurrentBranch[lane] = { name: resolvedBranch, color: laneColor };
      }

      const branchLabel = laneCurrentBranch[lane] || null;
      state.commitBranchLabel[c.hash] = branchLabel
        ? { name: branchLabel.name, color: laneColor }
        : { name: null, color: laneColor };
    });

    // Calculate max lane for each row
    const rowMaxLanes = new Array(state.commits.length).fill(0);
    for (const hash in commitNodes) {
      const node = commitNodes[hash];
      if (node.row < state.commits.length) {
        rowMaxLanes[node.row] = Math.max(rowMaxLanes[node.row], node.lane);
      }
    }
    for (const line of lines) {
      const startRow = Math.max(0, Math.min(Math.floor(line.fromRow), Math.floor(line.toRow)));
      const endRow = Math.min(state.commits.length - 1, Math.max(Math.ceil(line.fromRow), Math.ceil(line.toRow)));
      for (let r = startRow; r <= endRow; r++) {
        rowMaxLanes[r] = Math.max(rowMaxLanes[r], line.fromLane, line.toLane, line.runningLane || 0);
      }
    }

    // Save row max lanes to window object
    window.rowMaxLanes = rowMaxLanes;

    // Dynamic graph width
    const computedGraphWidth = paddingLeft + (maxLanes + 1) * laneWidth;
    state.currentGraphWidth = computedGraphWidth;
    
    const graphHeader = document.querySelector('th.graph-col');
    if (graphHeader) {
      (graphHeader as HTMLElement).style.width = computedGraphWidth + 'px';
      (graphHeader as HTMLElement).style.minWidth = computedGraphWidth + 'px';
    }

    // Reset virtual indices to force a redraw
    state.lastStartIndex = -1;
    state.lastEndIndex = -1;

    // SVG sizes
    const totalHeight = state.commits.length * rowHeight;
    elements.graphSvg.style.width = computedGraphWidth + 'px';
    elements.graphSvg.style.height = totalHeight + 'px';

    // Trigger initial virtual list rendering
    updateVirtualList();

    // Restore selected status highlight in SVG graph
    if (oldSelectedHash) {
      selectCircleInGraph(oldSelectedHash);
    } else {
      collapseDetail();
    }
  }

  function updateVirtualList() {
    if (state.commits.length === 0) return;
    const scrollTop = elements.tableContainer.scrollTop;
    const clientHeight = elements.tableContainer.clientHeight;
    
    const buffer = 15;
    const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - buffer);
    const endIndex = Math.min(state.commits.length - 1, Math.ceil((scrollTop + clientHeight) / rowHeight) + buffer);

    if (startIndex === state.lastStartIndex && endIndex === state.lastEndIndex) {
      return;
    }

    state.lastStartIndex = startIndex;
    state.lastEndIndex = endIndex;

    renderVisibleRows(startIndex, endIndex);
    drawSvg(startIndex, endIndex);

    // Make sure the selected node stays highlighted after a virtual draw
    if (state.selectedCommitHash) {
      selectCircleInGraph(state.selectedCommitHash);
    }
  }

  function renderVisibleRows(startIndex, endIndex) {
    const fragment = document.createDocumentFragment();

    // Top Spacer
    if (startIndex > 0) {
      const topSpacer = document.createElement('tr');
      topSpacer.className = 'virtual-spacer-top';
      const spacerHeight = startIndex * rowHeight;
      topSpacer.style.height = `${spacerHeight}px`;
      const td1 = document.createElement('td');
      td1.className = 'graph-col';
      td1.style.width = `${state.currentGraphWidth}px`;
      td1.style.minWidth = `${state.currentGraphWidth}px`;
      td1.style.height = `${spacerHeight}px`;
      td1.style.padding = '0';
      td1.style.border = 'none';
      const td2 = document.createElement('td');
      td2.className = 'content-col';
      td2.style.height = `${spacerHeight}px`;
      td2.style.padding = '0';
      td2.style.border = 'none';
      topSpacer.appendChild(td1);
      topSpacer.appendChild(td2);
      fragment.appendChild(topSpacer);
    }

    const rowMaxLanes = window.rowMaxLanes || [];

    // Render Rows in viewport
    for (let r = startIndex; r <= endIndex; r++) {
      const c = state.commits[r];
      if (!c) continue;
      const tr = document.createElement('tr');
      tr.className = 'commit-row';
      if (c.hash === state.selectedCommitHash) {
        tr.className += ' selected';
      }
      tr.dataset.hash = c.hash;
      tr.dataset.parents = JSON.stringify(c.parents);

      const node = state.cachedCommitNodes[c.hash];
      if (node) {
        const color = colors[node.colorIdx % colors.length];
        tr.style.setProperty('--selection-glow-color', color);
        tr.style.setProperty('--row-selected-glow-bg', hexToRgba(color, 0.08));
      }

      const relTime = getRelativeTime(c.timestamp);
      const absTime = formatDate(c.timestamp);

      // Branch decorations HTML
      let decsHtml = '';
      if (c.decorations && c.decorations.length > 0) {
        const makeBadge = (dec, overrideLabel) => {
          let badgeClass = 'badge-branch';
          let iconHtml = '<i class="codicon codicon-git-branch"></i>';
          let badgeColor = state.branchColorMap.get(dec) || colors[0];
          let isHead = false;
          const isRemote = state.remoteBranches.includes(dec) || dec.startsWith('origin/');
          let displayDec = overrideLabel || dec;

          if (dec.startsWith('tag: ')) {
            badgeClass = 'badge-tag';
            iconHtml = '<i class="codicon codicon-tag"></i>';
            displayDec = overrideLabel || dec.substring(5);
            badgeColor = '#f59e0b';
          } else if (isRemote) {
            badgeClass = 'badge-remote-branch';
            iconHtml = '<i class="codicon codicon-cloud"></i>';
          } else if (dec === 'HEAD') {
            badgeClass = 'badge-head';
            iconHtml = '<i class="codicon codicon-circle-filled"></i>';
            isHead = true;
          }

          const style = isHead
            ? `background-color: rgba(255,255,255,0.08); color: #fff; border-color: rgba(255,255,255,0.22);`
            : `background-color: ${hexToRgba(badgeColor, 0.15)}; color: ${badgeColor}; border-color: ${hexToRgba(badgeColor, 0.35)};`;

          return `<span class="ref-badge ${badgeClass}" style="${style}">${iconHtml}${escapeHtml(displayDec)}</span>`;
        };

        if (c.decorations[0] === 'HEAD') {
          const nextLocal = c.decorations.slice(1).find(d =>
            !d.startsWith('origin/') && !d.startsWith('tag: ') && !state.remoteBranches.includes(d)
          );
          const headLabel = nextLocal ? `HEAD → ${nextLocal}` : 'HEAD';
          decsHtml += makeBadge('HEAD', headLabel);

          const remaining = c.decorations.slice(1).filter(d => d !== nextLocal);
          if (remaining.length === 1) {
            decsHtml += makeBadge(remaining[0], '');
          } else if (remaining.length > 1) {
            const remainingNames = remaining.join(', ');
            decsHtml += `<span class="ref-badge" style="background-color: rgba(255,255,255,0.06); color: var(--desc-fg); border: 1px solid var(--border-color); cursor: default;" title="${escapeHtml(remainingNames)}">+${remaining.length}</span>`;
          }
        } else {
          decsHtml += makeBadge(c.decorations[0], '');
          if (c.decorations.length > 1) {
            const remainingNames = c.decorations.slice(1).join(', ');
            decsHtml += `<span class="ref-badge" style="background-color: rgba(255,255,255,0.06); color: var(--desc-fg); border: 1px solid var(--border-color); cursor: default;" title="${escapeHtml(remainingNames)}">+${c.decorations.length - 1}</span>`;
          }
        }
      }

      const inlineAuthorHtml = `<span class="commit-author-inline" title="${escapeHtml(c.author)}">${escapeHtml(c.author)}</span>`;
      const currentMaxLanes = rowMaxLanes[r] !== undefined ? rowMaxLanes[r] : 0;

      tr.innerHTML = `
        <td class="graph-col" style="width: ${state.currentGraphWidth}px; min-width: ${state.currentGraphWidth}px;"></td>
        <td class="content-col">
          <div class="row-content">
            <div class="commit-main">
              <span class="commit-message" title="${escapeHtml(c.message)}">${escapeHtml(c.message)}</span>
              ${inlineAuthorHtml}
              ${decsHtml}
            </div>
          </div>
        </td>
      `;

      tr.addEventListener('click', () => handleRowClick(tr, c.hash, c.parents));
      
      tr.addEventListener('mouseenter', () => {
        const node = state.cachedCommitNodes[c.hash];
        if (node) {
          const branchId = node.colorIdx;
          elements.graphSvg.classList.add('hover-active');
          elements.graphSvg.querySelectorAll(`.lane-path-${branchId}`).forEach(p => p.classList.add('hovered-lane-path'));
          elements.graphSvg.querySelectorAll(`.lane-node-${branchId}`).forEach(n => n.classList.add('hovered-lane-node'));
        }
        const el = elements.graphSvg.querySelector(`.node-${c.hash}`);
        if (el) {
          el.classList.add('hovered');
          if (el.parentNode && el.parentNode.tagName === 'g') {
            el.parentNode.querySelectorAll('circle').forEach(cc => cc.classList.add('hovered'));
          }
        }
      });

      tr.addEventListener('mouseleave', () => {
        elements.graphSvg.classList.remove('hover-active');
        elements.graphSvg.querySelectorAll('.hovered-lane-path').forEach(p => p.classList.remove('hovered-lane-path'));
        elements.graphSvg.querySelectorAll('.hovered-lane-node').forEach(n => n.classList.remove('hovered-lane-node'));
        
        const el = elements.graphSvg.querySelector(`.node-${c.hash}`);
        if (el) {
          el.classList.remove('hovered');
          if (el.parentNode && el.parentNode.tagName === 'g') {
            el.parentNode.querySelectorAll('circle').forEach(cc => cc.classList.remove('hovered'));
          }
        }
      });

      fragment.appendChild(tr);
    }

    // Bottom Spacer
    if (endIndex < state.commits.length - 1) {
      const bottomSpacer = document.createElement('tr');
      bottomSpacer.className = 'virtual-spacer-bottom';
      const spacerHeight = (state.commits.length - 1 - endIndex) * rowHeight;
      bottomSpacer.style.height = `${spacerHeight}px`;
      const td1 = document.createElement('td');
      td1.className = 'graph-col';
      td1.style.width = `${state.currentGraphWidth}px`;
      td1.style.minWidth = `${state.currentGraphWidth}px`;
      td1.style.height = `${spacerHeight}px`;
      td1.style.padding = '0';
      td1.style.border = 'none';
      const td2 = document.createElement('td');
      td2.className = 'content-col';
      td2.style.height = `${spacerHeight}px`;
      td2.style.padding = '0';
      td2.style.border = 'none';
      bottomSpacer.appendChild(td1);
      bottomSpacer.appendChild(td2);
      fragment.appendChild(bottomSpacer);
    }

    // Bottom "loaded all" footer
    if (!state.hasMoreCommits && state.commits.length > 0) {
      const footerTr = document.createElement('tr');
      footerTr.className = 'commits-end-footer';
      footerTr.innerHTML = `<td class="graph-col" style="width: ${state.currentGraphWidth}px; min-width: ${state.currentGraphWidth}px;"></td><td class="content-col" style="text-align:center;padding:10px 0 12px;opacity:0.35;font-size:11px;user-select:none;pointer-events:none;">· 已加载全部 ${state.commits.length} 条提交记录 ·</td>`;
      fragment.appendChild(footerTr);
    }

    elements.commitsTbody.innerHTML = '';
    elements.commitsTbody.appendChild(fragment);
  }

  function drawSvg(startIndex: number, endIndex: number) {
    elements.graphSvg.innerHTML = '';
    
    // Clear hover state to prevent stuck dimming when SVG re-renders (e.g. on click)
    elements.graphSvg.classList.remove('hover-active');

    function getBranchColor(branchId) {
      if (branchId < colors.length) {
        return colors[branchId];
      }
      const hue = (branchId * 137.508) % 360;
      return `hsl(${hue}, 75%, 60%)`;
    }

    if (state.commits.length === 0) {
      elements.graphSvg.style.height = '0px';
      return;
    }

    function getYCoordinate(rowIndex) {
      return rowIndex * rowHeight + rowHeight / 2;
    }

    // ── Path rendering (elegant "guqin string" style: smooth gentle S-curves) ──
    state.cachedLines.forEach(line => {
      // SVG path virtualization check: only draw paths that intersect the visible indices
      const minRow = Math.min(line.fromRow, line.toRow);
      const maxRow = Math.max(line.fromRow, line.toRow);
      if (maxRow < startIndex || minRow > endIndex) {
        return;
      }

      const x_from = paddingLeft + line.fromLane * laneWidth;
      const x_run = paddingLeft + (line.runningLane !== undefined ? line.runningLane : line.fromLane) * laneWidth;
      const x_to = paddingLeft + line.toLane * laneWidth;

      const y1 = getYCoordinate(line.fromRow);
      const y2 = getYCoordinate(line.toRow);
      
      const branchId = line.colorIdx;
      const color = getBranchColor(branchId);

      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('class', `lane-path-${branchId}`);

      const isMergeLine = line.isMergeLine;
      const isMainTrunk = (line.colorIdx === 0 && !isMergeLine);
      const strokeWidth = isMainTrunk ? 2 : (isMergeLine ? 1.5 : 1.5);

      const segH = y2 - y1;
      const topCurve = (x_from !== x_run);
      const botCurve = (x_run !== x_to);

      let d = `M ${x_from} ${y1}`;

      if (!topCurve && !botCurve) {
        d += ` L ${x_to} ${y2}`;
      } else if (topCurve && !botCurve) {
        const curveH = Math.min(rowHeight, segH);
        const y_mid = y1 + curveH / 2;
        d += ` C ${x_from} ${y_mid}, ${x_run} ${y_mid}, ${x_run} ${y1 + curveH}`;
        if (y1 + curveH < y2) {
          d += ` L ${x_run} ${y2}`;
        }
      } else if (!topCurve && botCurve) {
        const curveH = Math.min(rowHeight, segH);
        const curveStartY = y2 - curveH;
        if (y1 < curveStartY) {
          d += ` L ${x_run} ${curveStartY}`;
        }
        const y_mid = curveStartY + curveH / 2;
        d += ` C ${x_run} ${y_mid}, ${x_to} ${y_mid}, ${x_to} ${y2}`;
      } else {
        const curveH = Math.min(rowHeight, segH / 2);
        const topEnd = y1 + curveH;
        const botStart = y2 - curveH;

        d += ` C ${x_from} ${y1 + curveH/2}, ${x_run} ${y1 + curveH/2}, ${x_run} ${topEnd}`;
        if (botStart > topEnd) {
          d += ` L ${x_run} ${botStart}`;
        }
        d += ` C ${x_run} ${botStart + curveH/2}, ${x_to} ${botStart + curveH/2}, ${x_to} ${y2}`;
      }

      path.setAttribute('d', d);
      path.setAttribute('stroke', color);
      path.setAttribute('stroke-width', strokeWidth.toString());
      path.setAttribute('fill', 'none');

      path.addEventListener('mouseover', () => {
        const branchId = line.colorIdx;
        elements.graphSvg.classList.add('hover-active');
        elements.graphSvg.querySelectorAll(`.lane-path-${branchId}`).forEach(p => p.classList.add('hovered-lane-path'));
        elements.graphSvg.querySelectorAll(`.lane-node-${branchId}`).forEach(n => n.classList.add('hovered-lane-node'));
      });
      path.addEventListener('mouseout', () => {
        elements.graphSvg.classList.remove('hover-active');
        elements.graphSvg.querySelectorAll('.hovered-lane-path').forEach(p => p.classList.remove('hovered-lane-path'));
        elements.graphSvg.querySelectorAll('.hovered-lane-node').forEach(n => n.classList.remove('hovered-lane-node'));
      });

      elements.graphSvg.appendChild(path);
    });

    // ── Node rendering (clean, no glow, no ring) ──
    for (let r = startIndex; r <= endIndex; r++) {
      const c = state.commits[r];
      if (!c) continue;
      const node = state.cachedCommitNodes[c.hash];
      if (!node) continue;
      const x = paddingLeft + node.lane * laneWidth;
      const y = getYCoordinate(r);
      const branchId = node.colorIdx;
      const color = getBranchColor(branchId);
      const isSelected = (c.hash === state.selectedCommitHash);

      if (node.isMerge) {
        const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        group.setAttribute('class', `node-group-${c.hash}`);

        const outer = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        outer.setAttribute('class', `node-${c.hash} lane-node-${branchId} merge-outer${isSelected ? ' selected' : ''}`);
        outer.setAttribute('cx', String(x));
        outer.setAttribute('cy', String(y));
        outer.setAttribute('r', isSelected ? '6' : '5.5');
        outer.setAttribute('fill', 'var(--bg-color)');
        outer.setAttribute('stroke', color);
        outer.setAttribute('stroke-width', '1.5');

        const inner = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        inner.setAttribute('class', `node-${c.hash} lane-node-${branchId} merge-inner${isSelected ? ' selected' : ''}`);
        inner.setAttribute('cx', String(x));
        inner.setAttribute('cy', String(y));
        inner.setAttribute('r', '2.5');
        inner.setAttribute('fill', color);

        group.appendChild(outer);
        group.appendChild(inner);

        group.addEventListener('mouseover', () => {
          elements.graphSvg.classList.add('hover-active');
          elements.graphSvg.querySelectorAll(`.lane-path-${branchId}`).forEach(p => p.classList.add('hovered-lane-path'));
          elements.graphSvg.querySelectorAll(`.lane-node-${branchId}`).forEach(n => n.classList.add('hovered-lane-node'));
        });
        group.addEventListener('mouseout', () => {
          elements.graphSvg.classList.remove('hover-active');
          elements.graphSvg.querySelectorAll('.hovered-lane-path').forEach(p => p.classList.remove('hovered-lane-path'));
          elements.graphSvg.querySelectorAll('.hovered-lane-node').forEach(n => n.classList.remove('hovered-lane-node'));
        });

        elements.graphSvg.appendChild(group);
      } else {
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('class', `node-${c.hash} lane-node-${branchId}${isSelected ? ' selected' : ''}`);
        circle.setAttribute('cx', String(x));
        circle.setAttribute('cy', String(y));
        circle.setAttribute('r', isSelected ? '5' : '4.5');
        circle.setAttribute('fill', color);
        circle.setAttribute('stroke', 'var(--bg-color)');
        circle.setAttribute('stroke-width', '1.5');

        circle.addEventListener('mouseover', () => {
          elements.graphSvg.classList.add('hover-active');
          elements.graphSvg.querySelectorAll(`.lane-path-${branchId}`).forEach(p => p.classList.add('hovered-lane-path'));
          elements.graphSvg.querySelectorAll(`.lane-node-${branchId}`).forEach(n => n.classList.add('hovered-lane-node'));
        });
        circle.addEventListener('mouseout', () => {
          elements.graphSvg.classList.remove('hover-active');
          elements.graphSvg.querySelectorAll('.hovered-lane-path').forEach(p => p.classList.remove('hovered-lane-path'));
          elements.graphSvg.querySelectorAll('.hovered-lane-node').forEach(n => n.classList.remove('hovered-lane-node'));
        });

        elements.graphSvg.appendChild(circle);
      }
    }
  }

  // ── 行展开 & 详情 ────────────────────────

  function handleRowClick(row, hash, parents) {
    if (state.selectedCommitHash === hash) {
      collapseDetail();
      return;
    }

    // 取消之前选中行的样式，不触发全面面板折叠
    const previouslySelected = elements.commitsTbody.querySelector('tr.commit-row.selected');
    if (previouslySelected) {
      previouslySelected.classList.remove('selected');
    }

    state.selectedCommitHash = hash;
    saveCurrentState();
    row.classList.add('selected');
    selectCircleInGraph(hash);

    const commit = state.commits.find(c => c.hash === hash);
    if (!commit) return;

    // 仅在原先处于空状态时，才显示详情框并触发 slideDown 动画
    ensureDetailsExpanded();
    setRightPane(RightPaneState.COMMIT);

    elements.detailHashBadge.textContent = hash.substring(0, 7);
    elements.detailHashBadge.dataset.fullHash = hash;

    // 动态渲染详情面板的作者信息及头像
    if (elements.detailAuthorName && elements.detailAuthorDate && elements.detailAuthorAvatar) {
      elements.detailAuthorName.textContent = commit.author;
      elements.detailAuthorName.title = commit.email || '';
      elements.detailAuthorDate.textContent = formatDate(commit.timestamp);
      elements.detailAuthorDate.title = getRelativeTime(commit.timestamp);
      
      const initials = getInitials(commit.author);
      elements.detailAuthorAvatar.textContent = initials;
      elements.detailAuthorAvatar.style.backgroundColor = getAvatarColor(commit.author);
    }

    // Render all branch badges in detail panel
    const branchesContainer = document.getElementById('detail-branches-container');
    if (branchesContainer) {
      branchesContainer.innerHTML = '';

      // 先展示显式 decorations（HEAD、分支名、tag 等）
      let hasBadges = false;
      if (commit.decorations && commit.decorations.length > 0) {
        hasBadges = true;
        branchesContainer.classList.remove('hidden');
        commit.decorations.forEach(dec => {
          let badgeClass = 'badge-branch';
          let iconHtml = '<i class="codicon codicon-git-branch"></i>';
          let badgeColor = state.branchColorMap.get(dec) || colors[0];
          let isHead = false;
          const isRemote = state.remoteBranches.includes(dec) || dec.startsWith('origin/');
          let displayDec = dec;

          if (dec.startsWith('tag: ')) {
            badgeClass = 'badge-tag';
            iconHtml = '<i class="codicon codicon-tag"></i>';
            displayDec = dec.substring(5);
            badgeColor = '#f59e0b';
          } else if (isRemote) {
            badgeClass = 'badge-remote-branch';
            iconHtml = '<i class="codicon codicon-cloud"></i>';
          } else if (dec === 'HEAD') {
            badgeClass = 'badge-head';
            iconHtml = '<i class="codicon codicon-circle-filled"></i>';
            isHead = true;
          }

          const style = isHead
            ? `background-color: rgba(255,255,255,0.08); color: #fff; border-color: rgba(255,255,255,0.22);`
            : `background-color: ${hexToRgba(badgeColor, 0.15)}; color: ${badgeColor}; border-color: ${hexToRgba(badgeColor, 0.35)};`;

          const span = document.createElement('span');
          span.className = `ref-badge ${badgeClass}`;
          span.style.cssText = style;
          span.innerHTML = `${iconHtml}${escapeHtml(displayDec)}`;
          branchesContainer.appendChild(span);
        });
      }

      // 补充 lane 推断的分支名（仅当该分支名尚未在 decorations 中出现时）
      const laneBranch = state.commitBranchLabel[hash];
      if (laneBranch && laneBranch.name) {
        const alreadyShown = commit.decorations && commit.decorations.includes(laneBranch.name);
        if (!alreadyShown) {
          hasBadges = true;
          branchesContainer.classList.remove('hidden');
          const span = document.createElement('span');
          span.className = 'ref-badge badge-branch';
          span.style.cssText = `background-color: ${hexToRgba(laneBranch.color, 0.15)}; color: ${laneBranch.color}; border-color: ${hexToRgba(laneBranch.color, 0.35)};`;
          span.innerHTML = `<i class="codicon codicon-git-branch"></i>${escapeHtml(laneBranch.name)}`;
          branchesContainer.appendChild(span);
        }
      }

      if (!hasBadges) {
        branchesContainer.classList.add('hidden');
      }
    }

    if (commit.parents && commit.parents.length >= 2) {
      elements.detailMergeBadge.classList.remove('hidden');
    } else {
      elements.detailMergeBadge.classList.add('hidden');
    }
    
    // 复制哈希点击事件
    elements.detailHashBadge.onclick = (e) => {
      e.stopPropagation();
      navigator.clipboard.writeText(hash).then(() => {
        elements.detailHashBadge.textContent = '已复制!';
        setTimeout(() => {
          elements.detailHashBadge.textContent = hash.substring(0, 7);
        }, 1200);
      });
    };

    const msg = commit.message || '';
    const firstLineEnd = msg.indexOf('\n');
    let subject = msg;
    let body = '';
    if (firstLineEnd !== -1) {
      subject = msg.substring(0, firstLineEnd);
      body = msg.substring(firstLineEnd + 1).trim();
    }

    if (elements.detailMsgSubject) {
      elements.detailMsgSubject.textContent = subject;
    }
    if (elements.detailMsgBody) {
      if (body) {
        elements.detailMsgBody.textContent = body;
        elements.detailMsgBody.classList.remove('hidden');
      } else {
        elements.detailMsgBody.classList.add('hidden');
      }
    }

    elements.detailStatsRow.innerHTML = '';
    
    // 立即清空旧文件树，并重置透明度
    elements.detailFilesTree.innerHTML = '';
    elements.detailFilesTree.style.opacity = '1';

    // 设置延迟加载提示定时器，如果 150ms 内获取到结果则不显示 "获取文件列表..."，避免闪烁
    if (window.pendingFileLoadTimeout) {
      clearTimeout(window.pendingFileLoadTimeout);
    }
    window.pendingFileLoadTimeout = setTimeout(() => {
      elements.detailFilesTree.innerHTML = `
        <div style="display: flex; align-items: center; gap: 8px; padding: 10px;">
          <div class="spinner" style="width:14px; height:14px; border-width: 2px;"></div>
          <span style="opacity: 0.5; font-size: 11px;">获取文件列表...</span>
        </div>
      `;
    }, 150);

    vscode.postMessage({ command: 'getCommitDetail', hash });
  }

  function collapseDetail() {
    if (window.pendingFileLoadTimeout) {
      clearTimeout(window.pendingFileLoadTimeout);
      window.pendingFileLoadTimeout = null;
    }

    const previouslySelected = elements.commitsTbody.querySelector('tr.commit-row.selected');
    if (previouslySelected) {
      previouslySelected.classList.remove('selected');
    }
    state.selectedCommitHash = null;
    
    setRightPaneVisible(0);
    
    saveCurrentState();
    selectCircleInGraph(null);
  }

  function selectCircleInGraph(hash) {
    // Redraw SVG to properly render selection ring and glow effects
    drawSvg(state.lastStartIndex || 0, state.lastEndIndex || state.commits.length - 1);
  }

  // ── 文件树构建 + 路径压缩 ────────────────────────

  function buildFileTree(files) {
    const root = { _name: 'root', _children: {} };
    
    files.forEach(f => {
      const parts = f.path.split('/');
      let current = root;
      
      parts.forEach((part, idx) => {
        const isFile = idx === parts.length - 1;
        if (!current._children[part]) {
          current._children[part] = isFile 
            ? { _name: part, _isFile: true, status: f.status, path: f.path }
            : { _name: part, _isFile: false, _children: {} };
        }
        current = current._children[part];
      });
    });
    
    // 路径压缩：合并单子目录节点
    compressTree(root);
    return root;
  }

  function compressTree(node) {
    if (!node._children) return;

    // 先递归压缩所有子节点
    Object.keys(node._children).forEach(key => compressTree(node._children[key]));

    // 尝试合并单子目录
    const keys = Object.keys(node._children);
    const newChildren = {};

    keys.forEach(key => {
      const child = node._children[key];
      if (!child._isFile && child._children) {
        // 尝试向下合并路径
        let mergedKey = key;
        let current = child;
        while (true) {
          const grandKeys = Object.keys(current._children || {});
          if (grandKeys.length === 1 && !current._children[grandKeys[0]]._isFile) {
            mergedKey += '/' + grandKeys[0];
            current = current._children[grandKeys[0]];
          } else {
            break;
          }
        }
        const mergedNode = { _name: mergedKey, _isFile: false, _children: current._children };
        newChildren[mergedKey] = mergedNode;
      } else {
        newChildren[key] = child;
      }
    });

    node._children = newChildren;
  }

  function renderFileTreeHTML(node, depth, hash, parentHash) {
    let html = '';
    
    const keys = Object.keys(node._children || {}).sort((a, b) => {
      const nodeA = node._children[a];
      const nodeB = node._children[b];
      if (nodeA._isFile !== nodeB._isFile) return nodeA._isFile ? 1 : -1;
      return a.localeCompare(b);
    });

    keys.forEach(key => {
      const child = node._children[key];
      const indent = depth * 14;
      
      if (child._isFile) {
        const iconInfo = getFileIconInfo(child._name);
        const statusLabel = child.status;
        const statusClass = `status-${child.status}`;

        html += `
          <div class="tree-node file-node" style="padding-left: ${indent}px;" data-path="${escapeHtml(child.path)}" data-hash="${hash}" data-parent-hash="${parentHash}">
            <i class="codicon ${iconInfo.icon} file-icon ${iconInfo.color}"></i>
            <span class="file-name">${escapeHtml(child._name)}</span>
            <span class="file-actions">
              <i class="codicon codicon-go-to-file action-btn" title="转到当前文件 (Go to Current File)"></i>
            </span>
            <span class="file-status-badge ${statusClass}">${statusLabel}</span>
          </div>
        `;
      } else {
        // 构建压缩路径显示：用 / 分隔每段，斜杠用特殊样式
        const pathParts = key.split('/');
        const displayName = pathParts.map((p, i) => 
          i < pathParts.length - 1 
            ? `${escapeHtml(p)}<span class="compressed-path-sep">/</span>` 
            : escapeHtml(p)
        ).join('');

        html += `
          <div class="tree-node folder-node" style="padding-left: ${indent}px;">
            <i class="codicon codicon-chevron-down tree-chevron"></i>
            <i class="codicon codicon-folder-opened folder-icon folder-state-icon"></i>
            <span class="folder-name">${displayName}</span>
          </div>
          <div class="folder-children">
            ${renderFileTreeHTML(child, depth + 1, hash, parentHash)}
          </div>
        `;
      }
    });
    
    return html;
  }

  function renderCommitDetail(hash, files) {
    if (state.selectedCommitHash !== hash) return;

    if (window.pendingFileLoadTimeout) {
      clearTimeout(window.pendingFileLoadTimeout);
      window.pendingFileLoadTimeout = null;
    }
    elements.detailFilesTree.style.opacity = '1';

    const commit = state.commits.find(c => c.hash === hash);
    if (!commit) return;
    const parents = commit.parents || [];
    const parentHash = parents[0] || '';

    if (files.length === 0) {
      elements.detailStatsRow.innerHTML = '';
      elements.detailFilesTree.innerHTML = '<div style="opacity: 0.5; text-align: center; padding: 8px;">无文件变动</div>';
      return;
    }

    // 文件变动统计
    let addedLines = 0;
    let deletedLines = 0;
    let filesChanged = files.length;
    
    files.forEach(f => { 
      if (f.additions) addedLines += parseInt(f.additions, 10) || 0;
      if (f.deletions) deletedLines += parseInt(f.deletions, 10) || 0;
    });

    let statsHtml = '<div class="details-stats-toolbar">';
    statsHtml += '<div class="stats-left">';
    statsHtml += `<i class="codicon codicon-files" title="文件更改数"></i>`;
    statsHtml += `<span class="stats-count-badge" title="已更改文件数">${filesChanged}</span>`;
    if (addedLines > 0 || deletedLines > 0) {
      statsHtml += `<span class="stats-divider">|</span>`;
      if (addedLines > 0) statsHtml += `<span class="stats-diff-badge add" title="插入行数">+${addedLines}</span>`;
      if (deletedLines > 0) statsHtml += `<span class="stats-diff-badge delete" title="删除行数">-${deletedLines}</span>`;
    }
    statsHtml += '</div>';
    statsHtml += `
      <button class="open-all-changes-btn compact-btn" title="打开当前提交的所有文件更改对比 (Multi Diff)">
        <i class="codicon codicon-diff"></i>
        <span>对比全部</span>
      </button>
    `;
    statsHtml += '</div>';

    elements.detailStatsRow.innerHTML = statsHtml;

    const commitMessage = commit ? commit.message : '';
    const openAllBtn = elements.detailStatsRow.querySelector('.open-all-changes-btn');
    if (openAllBtn) {
      openAllBtn.addEventListener('click', () => {
        vscode.postMessage({
          command: 'openAllDiffs',
          hash: hash,
          files: files,
          parentHash: parentHash,
          message: commitMessage
        });
      });
    }

    const fileTree = buildFileTree(files);
    const treeHTML = renderFileTreeHTML(fileTree, 0, hash, parentHash);

    elements.detailFilesTree.innerHTML = treeHTML;

    // 点击文件打开 diff
    elements.detailFilesTree.querySelectorAll('.file-node').forEach(el => {
      el.addEventListener('click', () => {
        vscode.postMessage({
          command: 'openDiff',
          file: (el as HTMLElement).dataset.path,
          hash: (el as HTMLElement).dataset.hash,
          parentHash: (el as HTMLElement).dataset.parentHash
        });
      });

      // 转到当前文件 (openWorkspaceFile)
      const actionBtn = el.querySelector('.action-btn');
      if (actionBtn) {
        actionBtn.addEventListener('click', (e) => {
          e.stopPropagation(); // 阻止触发 openDiff
          vscode.postMessage({
            command: 'openWorkspaceFile',
            file: (el as HTMLElement).dataset.path,
            hash: (el as HTMLElement).dataset.hash
          });
        });
      }
    });

    // 文件夹折叠/展开
    elements.detailFilesTree.querySelectorAll('.folder-node').forEach(el => {
      el.addEventListener('click', () => {
        const children = el.nextElementSibling;
        if (!children || !children.classList.contains('folder-children')) return;
        const chevron = el.querySelector('.tree-chevron');
        const folderIcon = el.querySelector('.folder-state-icon');
        if (!chevron || !folderIcon) return;
        
        if (children.classList.contains('hidden')) {
          children.classList.remove('hidden');
          chevron.classList.remove('collapsed');
          folderIcon.classList.remove('codicon-folder');
          folderIcon.classList.add('codicon-folder-opened');
        } else {
          children.classList.add('hidden');
          chevron.classList.add('collapsed');
          folderIcon.classList.remove('codicon-folder-opened');
          folderIcon.classList.add('codicon-folder');
        }
      });
    });
  }

  function focusAndHighlightCommit(hash) {
    const index = state.commits.findIndex(c => c.hash === hash);
    if (index !== -1) {
      const targetScrollTop = index * rowHeight - elements.tableContainer.clientHeight / 2 + rowHeight / 2;
      elements.tableContainer.scrollTop = Math.max(0, targetScrollTop);
      updateVirtualList();
      let row = elements.commitsTbody.querySelector(`tr.commit-row[data-hash="${hash}"]`);
      if (row) {
        if (state.selectedCommitHash !== (row as HTMLElement).dataset.hash) {
          (row as HTMLElement).click();
        }
      }
    } else {
      showLoading();
      // Use getFilters() so date presets (24h, 7d) are converted to real dates
      vscode.postMessage({ command: 'locateCommit', hash, filters: getFilters() });
    }
  }



  // ── 左右分栏拖拽事件 ────────────────────────
  let isDragging = false;

  elements.resizerBar.addEventListener('mousedown', (e) => {
    isDragging = true;
    elements.resizerBar.classList.add('dragging');
    document.body.style.cursor = state.isOverlayMode ? 'row-resize' : 'col-resize';
    document.body.style.userSelect = 'none';
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;

    const layoutEl = document.querySelector('.main-layout');
    if (state.isOverlayMode) {
      // Stacking mode (vertical resizing)
      const containerHeight = layoutEl.clientHeight;
      const detailsHeight = containerHeight - e.clientY;
      const minHeight = 80;
      const maxHeight = containerHeight * 0.8;
      let finalHeight = Math.max(minHeight, Math.min(maxHeight, detailsHeight));
      
      elements.detailsPane.style.height = finalHeight + 'px';
      elements.detailsPane.style.width = '100%';
      
      const leftPaneHeight = containerHeight - finalHeight - 4;
      elements.leftPaneEl.style.height = leftPaneHeight + 'px';
      elements.leftPaneEl.style.flex = 'none';
    } else {
      // Horizontal mode
      const containerWidth = layoutEl.clientWidth;
      const detailsWidth = containerWidth - e.clientX;
      const minWidth = 280;
      const maxWidth = containerWidth * 0.6;
      let finalWidth = Math.max(minWidth, Math.min(maxWidth, detailsWidth));
      
      elements.detailsPane.style.width = finalWidth + 'px';
      elements.detailsPane.style.height = '100%';
      elements.leftPaneEl.style.height = '100%';
      elements.leftPaneEl.style.flex = '1';
    }
  });

  document.addEventListener('mouseup', () => {
    if (isDragging) {
      isDragging = false;
      elements.resizerBar.classList.remove('dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      saveCurrentState();
    }
  });

  window.addEventListener('resize', () => {
    state.lastStartIndex = -1;
    state.lastEndIndex = -1;
    updateVirtualList();
  });

  // ── Stats Functions ──────────────────────────

  function requestStats(filters) {
    const statsFilters = {
      branch: filters.branch,
      author: filters.author,
      since: filters.since,
      until: filters.until
    };
    vscode.postMessage({ command: 'getStats', filters: statsFilters });
  }



  function renderStatsStrip(stats) {
    if (!elements.statsStrip) return;
    elements.statsStrip.classList.remove('hidden');
    if (elements.stripCommitsVal) elements.stripCommitsVal.textContent = fmtNum(stats.totalCommits);
    if (elements.stripAdd) elements.stripAdd.textContent = '+' + fmtNum(stats.totalAdditions);
    if (elements.stripDel) elements.stripDel.textContent = '-' + fmtNum(stats.totalDeletions);
    if (elements.stripContributorsVal) elements.stripContributorsVal.textContent = stats.contributors.length;
    const range = `${stats.sinceDate} ~ ${stats.untilDate}`;
    if (elements.stripRange) elements.stripRange.textContent = range;
  }

  function renderOverviewStats(stats) {
    // Range label
    const rangeLabel = `${stats.sinceDate} → ${stats.untilDate}`;
    elements.overviewRange.textContent = rangeLabel;

    // Summary cards
    elements.ovCommits.textContent = fmtNum(stats.totalCommits);
    elements.ovAdd.textContent = '+' + fmtNum(stats.totalAdditions);
    elements.ovDel.textContent = '-' + fmtNum(stats.totalDeletions);

    // Activity SVG chart
    renderActivityChart(stats.dailyActivity);

    // Contributors leaderboard
    elements.contributorsList.innerHTML = '';
    const maxChanged = stats.contributors[0] ? stats.contributors[0].totalChanged : 1;
    stats.contributors.forEach((c, i) => {
      const pct = maxChanged > 0 ? Math.round((c.totalChanged / maxChanged) * 100) : 0;
      const color = getAvatarColor(c.author);
      const initials = getInitials(c.author);
      const row = document.createElement('div');
      row.className = 'contributor-row';
      row.innerHTML = `
        <div class="contributor-row-top">
          <span class="contributor-rank">${i + 1}</span>
          <span class="avatar-circle" style="background-color:${color};width:18px;height:18px;font-size:8px;margin-right:0;flex-shrink:0;border:none;box-shadow:none;">${escapeHtml(initials)}</span>
          <span class="contributor-name">${escapeHtml(c.author)}</span>
          <span class="contributor-state.commits">${c.commits} state.commits</span>
        </div>
        <div class="contributor-bar-row">
          <div class="contributor-bar-track">
            <div class="contributor-bar-fill" style="width:${pct}%;background-color:${color};"></div>
          </div>
          <span class="contributor-line-stats">
            <span class="contributor-line-add">+${fmtNum(c.additions)}</span>
            &nbsp;
            <span class="contributor-line-del">-${fmtNum(c.deletions)}</span>
          </span>
        </div>
      `;
      row.addEventListener('click', () => showAuthorDetail(c));
      elements.contributorsList.appendChild(row);
    });

    // Top files
    renderTopFiles(elements.topFilesList, stats.topFiles);
  }

  function renderActivityChart(dailyActivity) {
    elements.activitySvg.innerHTML = '';
    if (!dailyActivity || dailyActivity.length === 0) return;

    const svgW = elements.activitySvg.clientWidth || 300;
    const svgH = 80;
    elements.activitySvg.setAttribute('height', svgH);
    elements.activitySvg.style.height = svgH + 'px';

    const padTop = 8;
    const padBot = 20;  // room for month labels
    const padLeft = 2;
    const padRight = 2;
    const chartW = svgW - padLeft - padRight;
    const chartH = svgH - padTop - padBot;

    const maxCount = Math.max(...dailyActivity.map(d => d.count), 1);
    const n = dailyActivity.length;

    // Compute point coordinates
    const pts = dailyActivity.map((d, i) => ({
      x: padLeft + (i / Math.max(n - 1, 1)) * chartW,
      y: padTop + chartH - (d.count / maxCount) * chartH,
      date: d.date,
      count: d.count
    }));

    // Build smooth bezier path
    function bezierPath(points) {
      if (points.length === 0) return '';
      if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
      let d = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
      for (let i = 0; i < points.length - 1; i++) {
        const cp1x = (points[i].x + points[i + 1].x) / 2;
        const cp1y = points[i].y;
        const cp2x = (points[i].x + points[i + 1].x) / 2;
        const cp2y = points[i + 1].y;
        d += ` C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(2)}, ${points[i + 1].x.toFixed(2)} ${points[i + 1].y.toFixed(2)}`;
      }
      return d;
    }

    const linePath = bezierPath(pts);
    const baseY = padTop + chartH;
    const areaPath = linePath + ` L ${pts[pts.length - 1].x.toFixed(2)} ${baseY} L ${pts[0].x.toFixed(2)} ${baseY} Z`;

    const ns = 'http://www.w3.org/2000/svg';
    const gradId = 'activity-chart-gradient';

    // Gradient def
    const defs = document.createElementNS(ns, 'defs');
    const grad = document.createElementNS(ns, 'linearGradient');
    grad.setAttribute('id', gradId);
    grad.setAttribute('x1', '0'); grad.setAttribute('y1', '0');
    grad.setAttribute('x2', '0'); grad.setAttribute('y2', '1');
    const stop1 = document.createElementNS(ns, 'stop');
    stop1.setAttribute('offset', '0%');
    stop1.setAttribute('stop-color', 'var(--accent)');
    stop1.setAttribute('stop-opacity', '0.35');
    const stop2 = document.createElementNS(ns, 'stop');
    stop2.setAttribute('offset', '100%');
    stop2.setAttribute('stop-color', 'var(--accent)');
    stop2.setAttribute('stop-opacity', '0.02');
    grad.appendChild(stop1); grad.appendChild(stop2);
    defs.appendChild(grad);
    elements.activitySvg.appendChild(defs);

    // Area fill
    const area = document.createElementNS(ns, 'path');
    area.setAttribute('d', areaPath);
    area.setAttribute('fill', `url(#${gradId})`);
    area.setAttribute('stroke', 'none');
    elements.activitySvg.appendChild(area);

    // Line
    const line = document.createElementNS(ns, 'path');
    line.setAttribute('d', linePath);
    line.setAttribute('fill', 'none');
    line.setAttribute('stroke', 'var(--accent)');
    line.setAttribute('stroke-width', '1.8');
    line.setAttribute('stroke-linecap', 'round');
    line.setAttribute('stroke-linejoin', 'round');
    elements.activitySvg.appendChild(line);

    // Month tick labels
    let lastMonth = '';
    pts.forEach((p, i) => {
      const month = dailyActivity[i].date.substring(0, 7); // YYYY-MM
      if (month !== lastMonth) {
        lastMonth = month;
        const label = document.createElementNS(ns, 'text');
        label.setAttribute('x', p.x.toFixed(1));
        label.setAttribute('y', (svgH - 4).toFixed(1));
        label.setAttribute('font-size', '8');
        label.setAttribute('fill', 'var(--fg-faint, rgba(128,128,128,0.5))');
        label.setAttribute('text-anchor', 'middle');
        label.setAttribute('font-family', 'var(--font-family, sans-serif)');
        label.textContent = month.substring(5); // MM only
        elements.activitySvg.appendChild(label);
      }
    });

    // Interactive hover overlay
    const hoverGroup = document.createElementNS(ns, 'g');
    hoverGroup.setAttribute('style', 'pointer-events: none; opacity: 0;');
    hoverGroup.setAttribute('class', 'activity-hover-group');

    // Vertical crosshair
    const vLine = document.createElementNS(ns, 'line');
    vLine.setAttribute('class', 'activity-crosshair');
    vLine.setAttribute('y1', padTop.toString());
    vLine.setAttribute('y2', (padTop + chartH).toString());
    vLine.setAttribute('stroke', 'var(--accent)');
    vLine.setAttribute('stroke-width', '1');
    vLine.setAttribute('stroke-dasharray', '3,3');
    vLine.setAttribute('opacity', '0.5');
    hoverGroup.appendChild(vLine);

    // Hover dot
    const dot = document.createElementNS(ns, 'circle');
    dot.setAttribute('r', '4');
    dot.setAttribute('fill', 'var(--accent)');
    dot.setAttribute('stroke', 'var(--bg-color, #1e1e1e)');
    dot.setAttribute('stroke-width', '2');
    hoverGroup.appendChild(dot);
    elements.activitySvg.appendChild(hoverGroup);

    // Tooltip element (HTML div, positioned absolutely)
    let tooltip = document.getElementById('activity-tooltip');
    if (!tooltip) {
      tooltip = document.createElement('div');
      tooltip.id = 'activity-tooltip';
      tooltip.style.cssText = `
        position: fixed; pointer-events: none; z-index: 9999;
        background: var(--surface-2, #252526);
        border: 1px solid var(--border-color, rgba(128,128,128,0.25));
        border-radius: 6px;
        padding: 5px 9px;
        font-size: 11px;
        font-family: var(--font-family, sans-serif);
        color: var(--fg-color, #ccc);
        box-shadow: 0 4px 16px rgba(0,0,0,0.35);
        white-space: nowrap;
        display: none;
        line-height: 1.5;
      `;
      document.body.appendChild(tooltip);
    }

    // Invisible wide overlay rect for mouse tracking
    const overlay = document.createElementNS(ns, 'rect');
    overlay.setAttribute('x', padLeft.toString());
    overlay.setAttribute('y', padTop.toString());
    overlay.setAttribute('width', chartW.toString());
    overlay.setAttribute('height', chartH.toString());
    overlay.setAttribute('fill', 'transparent');
    overlay.setAttribute('style', 'cursor: pointer;');
    elements.activitySvg.appendChild(overlay);

    overlay.addEventListener('mousemove', (e) => {
      const rect = elements.activitySvg.getBoundingClientRect();
      const mouseX = e.clientX - rect.left - padLeft;
      const idx = Math.max(0, Math.min(n - 1, Math.round((mouseX / chartW) * (n - 1))));
      const p = pts[idx];
      const d = dailyActivity[idx];

      hoverGroup.style.opacity = '1';
      vLine.setAttribute('x1', p.x.toFixed(1));
      vLine.setAttribute('x2', p.x.toFixed(1));
      dot.setAttribute('cx', p.x.toFixed(1));
      dot.setAttribute('cy', p.y.toFixed(1));

      tooltip.style.display = 'block';
      tooltip.innerHTML = `<span style="opacity:0.7;font-size:12px;">${d.date}</span><br><strong style="color:var(--accent);font-size:13px;">${d.count}</strong> <span style="font-size:12px">次提交</span><br><span style="opacity:0.6;font-size:11px;">点击筛选此日</span>`;
      // Position tooltip with boundary checks
      const tw = tooltip.offsetWidth;
      const th = tooltip.offsetHeight;
      const margin = 12;
      
      let tx = e.clientX + margin;
      let ty = e.clientY - th - 8; // 8px above cursor

      if (tx + tw > window.innerWidth) {
        tx = e.clientX - tw - margin;
      }
      if (ty < 0) {
        ty = e.clientY + margin;
      }

      tooltip.style.left = tx + 'px';
      tooltip.style.top = ty + 'px';
    });

    overlay.addEventListener('mouseleave', () => {
      hoverGroup.style.opacity = '0';
      tooltip.style.display = 'none';
    });

    // Click a day → set date filter to that single day
    overlay.addEventListener('click', (e) => {
      const rect = elements.activitySvg.getBoundingClientRect();
      const mouseX = e.clientX - rect.left - padLeft;
      const idx = Math.max(0, Math.min(n - 1, Math.round((mouseX / chartW) * (n - 1))));
      const d = dailyActivity[idx];
      if (!d || !d.date) return;

      // Set date preset to custom and fill since/until with the clicked day
      elements.datePresetSelect.value = 'custom';
      elements.dateRangeGroup.classList.remove('hidden');
      elements.sinceDate.value = d.date;
      elements.untilDate.value = d.date;
      adjustSelectWidth(elements.datePresetSelect);

      // Brief flash on the overlay to confirm click
      overlay.style.opacity = '0.15';
      overlay.style.fill = 'var(--accent)';
      setTimeout(() => {
        overlay.style.opacity = '';
        overlay.style.fill = 'transparent';
      }, 180);

      tooltip.style.display = 'none';
      reloadData();
    });
  }

  function renderTopFiles(container, files) {
    container.innerHTML = '';
    if (!files || files.length === 0) {
      container.innerHTML = '<div style="opacity:0.4;font-size:11px;padding:4px 8px;">暂无数据</div>';
      return;
    }
    const maxChanges = files[0].changes;
    files.forEach(f => {
      const pct = maxChanges > 0 ? Math.round((f.changes / maxChanges) * 100) : 0;
      const row = document.createElement('div');
      row.className = 'top-file-row top-file-row-clickable';
      row.title = `${f.path}\n点击打开文件`;
      row.innerHTML = `
        <span class="top-file-name">${escapeHtml(f.path)}</span>
        <div class="top-file-bar-track"><div class="top-file-bar-fill" style="width:${pct}%;"></div></div>
        <span class="top-file-count">${f.changes}次</span>
        <i class="codicon codicon-go-to-file top-file-open-icon" title="打开文件"></i>
      `;
      row.addEventListener('click', () => {
        vscode.postMessage({
          command: 'openWorkspaceFile',
          file: f.path
        });
      });
      container.appendChild(row);
    });
  }

  function showAuthorDetail(contributor) {
    state.currentFocusedAuthor = contributor.author;
    ensureDetailsExpanded();
    setRightPane(RightPaneState.AUTHOR);

    const color = getAvatarColor(contributor.author);
    const initials = getInitials(contributor.author);
    elements.authorStatsAvatar.textContent = initials;
    elements.authorStatsAvatar.style.backgroundColor = color;
    elements.authorStatsName.textContent = contributor.author;
    elements.authorStatsEmail.textContent = contributor.email || '';

    elements.auCommits.textContent = fmtNum(contributor.commits);
    elements.auAdd.textContent = '+' + fmtNum(contributor.additions);
    elements.auDel.textContent = '-' + fmtNum(contributor.deletions);

    // Weekday bar chart
    elements.weekdayChart.innerHTML = '';
    const dayLabels = ['日', '一', '二', '三', '四', '五', '六'];
    const wd = contributor.weekdayDistribution || [0,0,0,0,0,0,0];
    const maxWd = Math.max(...wd, 1);
    // Reorder: Mon-Sun (index 1..6, 0)
    const order = [1,2,3,4,5,6,0];
    const orderLabels = ['一','二','三','四','五','六','日'];
    order.forEach((dayIdx, i) => {
      const count = wd[dayIdx] || 0;
      const heightPct = Math.max(4, Math.round((count / maxWd) * 100));
      const col = document.createElement('div');
      col.className = 'weekday-col custom-tooltip-container';
      col.innerHTML = `
        <div class="weekday-bar" style="height:${heightPct}%;background-color:${color};opacity:0.65;"></div>
        <span class="weekday-label">${orderLabels[i]}</span>
        <div class="custom-tooltip">${orderLabels[i]}: ${count}次</div>
      `;
      elements.weekdayChart.appendChild(col);
    });

    // Author top files: use per-author topFiles from contributor data
    elements.authorTopFiles.innerHTML = '';
    if (contributor.topFiles && contributor.topFiles.length > 0) {
      renderTopFiles(elements.authorTopFiles, contributor.topFiles);
    } else if (state.currentStatsData && state.currentStatsData.topFiles) {
      // fallback to global if per-author data unavailable
      renderTopFiles(elements.authorTopFiles, state.currentStatsData.topFiles.slice(0, 5));
    } else {
      elements.authorTopFiles.innerHTML = '<div style="opacity:0.4;font-size:11px;padding:4px 8px;">暂无数据</div>';
    }
  }

  // Stats toggle button — force show overview
  if (elements.statsToggleBtn) {
    elements.statsToggleBtn.addEventListener('click', () => {
      if (state.currentStatsData) {
        // Deselect any commit
        const sel = elements.commitsTbody.querySelector('tr.commit-row.selected');
        if (sel) sel.classList.remove('selected');
        state.selectedCommitHash = null;
        renderOverviewStats(state.currentStatsData);
        setRightPane(RightPaneState.OVERVIEW);
      }
    });
  }

  // Author highlight button — set author filter in graph
  elements.authorHighlightBtn.addEventListener('click', () => {
    if (!state.currentFocusedAuthor) return;
    // Check if author is already an option; if not, add it dynamically
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

  // 作者区域点击：不再拦截跳转作者统计，让事件冒泡到行点击处理器，展示提交详情
  // （作者统计仍可通过右侧 Overview 面板中的贡献者列表访问）

  // ── 响应式断点：监听左侧面板宽度，动态切换 pane-compact / pane-narrow ──
  if (elements.leftPaneEl && window.ResizeObserver) {
    const paneObserver = new ResizeObserver(entries => {
      if (!entries || entries.length === 0) return;
      const w = entries[0].contentRect.width;
      elements.leftPaneEl.classList.toggle('pane-medium',  w < 480);
      elements.leftPaneEl.classList.toggle('pane-compact', w < 320);
      elements.leftPaneEl.classList.toggle('pane-narrow',  w < 220);

      // 动态更新搜索框 placeholder 文字
      if (elements.searchInput) {
        if (w < 320) {
          elements.searchInput.placeholder = '搜索…';
        } else if (w < 480) {
          elements.searchInput.placeholder = '搜索';
        } else {
          elements.searchInput.placeholder = '搜索消息或哈希';
        }
      }
    });
    paneObserver.observe(elements.leftPaneEl);
  }

  // ── 窄屏 Layout 模式：监听整体 main-layout 宽度 ──
  const overlayBackdrop = document.getElementById('overlay-backdrop');
  const OVERLAY_BREAKPOINT = 550;

  function openOverlay() {
    elements.detailsPane.classList.add('overlay-open');
    overlayBackdrop.classList.add('visible');
  }

  function closeOverlay() {
    elements.detailsPane.classList.remove('overlay-open');
    overlayBackdrop.classList.remove('visible');
  }

  if (overlayBackdrop) {
    overlayBackdrop.addEventListener('click', closeOverlay);
  }
  if (elements.detailsCloseBtn) {
    elements.detailsCloseBtn.addEventListener('click', () => {
      setRightPaneVisible(0);
      saveCurrentState();
    });
  }

  // setRightPane already handles overlay via state.isOverlayMode (see top of file)
  if (elements.mainLayoutEl && window.ResizeObserver) {
    const layoutObserver = new ResizeObserver(entries => {
      if (!entries || entries.length === 0) return;
      const w = entries[0].contentRect.width;
      const shouldBeNarrow = w < OVERLAY_BREAKPOINT;

      if (shouldBeNarrow === state.isOverlayMode) return;
      state.isOverlayMode = shouldBeNarrow;
      elements.mainLayoutEl.classList.toggle('layout-narrow', state.isOverlayMode);
      // Reset inline styles to let CSS media queries take over correctly
      elements.detailsPane.style.width = '';
      elements.detailsPane.style.height = '';
      elements.leftPaneEl.style.height = '';
      elements.leftPaneEl.style.flex = '';
    });
    layoutObserver.observe(elements.mainLayoutEl);
  }

  // Observe elements.tableContainer size changes (e.g. sidebar collapse, bottom panel resize) to refresh virtual rows
  if (elements.tableContainer && window.ResizeObserver) {
    const tableResizeObserver = new ResizeObserver(() => {
      state.lastStartIndex = -1;
      state.lastEndIndex = -1;
      updateVirtualList();
    });
    tableResizeObserver.observe(elements.tableContainer);
  }

  if (elements.activitySvg && elements.activitySvg.parentElement && window.ResizeObserver) {
    let resizeTimer = null;
    const chartObserver = new ResizeObserver(() => {
      if (resizeTimer) cancelAnimationFrame(resizeTimer);
      resizeTimer = requestAnimationFrame(() => {
        if (state.currentStatsData && state.currentStatsData.dailyActivity) {
          renderActivityChart(state.currentStatsData.dailyActivity);
        }
      });
    });
    chartObserver.observe(elements.activitySvg.parentElement);
  }

  // ── Selection History Rendering ────────────────
  const historyFileInfoEl = document.getElementById('history-file-info');
  const historyListEl = document.getElementById('history-list');

  let activeHistoryHash = null;

  function renderSelectionHistory(filePath, startLine, endLine, historyCommits) {
    activeHistoryHash = null;
    ensureDetailsExpanded();
    setRightPane(RightPaneState.HISTORY);
    
    if (historyFileInfoEl) {
      historyFileInfoEl.innerHTML = `<div><i class="codicon codicon-file"></i> ${escapeHtml(filePath)}</div><div style="margin-top: 3px; font-weight: 500;"><i class="codicon codicon-list-flat"></i> 行 ${startLine} - ${endLine}</div>`;
    }

    if (historyListEl) {
      historyListEl.innerHTML = '';
      if (!historyCommits || historyCommits.length === 0) {
        historyListEl.innerHTML = '<div class="empty-state">没有历史记录</div>';
        return;
      }

      historyCommits.forEach(c => {
        const card = document.createElement('div');
        card.className = 'history-card';
        card.dataset.hash = c.hash;
        
        const shortHash = c.hash.substring(0, 7);
        const relTime = getRelativeTime(c.timestamp);
        
        card.innerHTML = `
          <div class="history-card-header">
            <span class="history-card-author"><i class="codicon codicon-person"></i> ${escapeHtml(c.author)}</span>
            <span class="history-card-date">${relTime}</span>
          </div>
          <div class="history-card-msg">${escapeHtml(c.message)}</div>
          <div class="history-card-footer">
            <span class="history-card-hash"><i class="codicon codicon-git-commit"></i> ${shortHash}</span>
          </div>
        `;
        
        card.addEventListener('click', () => {
          // Highlight active card
          historyListEl.querySelectorAll('.history-card').forEach(el => el.classList.remove('active'));
          card.classList.add('active');
          activeHistoryHash = c.hash;

          // postMessage to open diff
          vscode.postMessage({
            command: 'openSingleDiff',
            file: filePath,
            hash: c.hash,
            parentHash: c.parentHash,
            lineRange: c.lineRange,
            oldFilePath: c.oldFilePath,
            newFilePath: c.newFilePath
          });
        });

        historyListEl.appendChild(card);
      });
    }
  }

  // ── File Blame Stats Rendering ─────────────────
  let lockedSliceHash = null;
  let lockedSliceColor = null;

  function renderFileBlameStats(fileName, stats) {
    state.rightPaneState = RightPaneState.FILE_BLAME_STATS;
    ensureDetailsExpanded();
    setRightPane(RightPaneState.FILE_BLAME_STATS);
    
    lockedSliceHash = null;
    lockedSliceColor = null;

    const infoEl = document.getElementById('file-blame-info');
    if (infoEl) {
      infoEl.innerHTML = `<i class="codicon codicon-file"></i> ${escapeHtml(fileName)}`;
    }

    if (!stats || stats.length === 0) {
      renderRoseChart([], 0);
      return;
    }

    const totalLines = stats.reduce((sum, s) => sum + s.lines, 0);
    renderRoseChart(stats, totalLines);
  }

  function renderRoseChart(stats, totalLines) {
    const svg = document.getElementById('rose-chart-svg');
    const tooltip = document.getElementById('rose-chart-tooltip');
    if (!svg) return;

    svg.innerHTML = '';

    if (!stats || stats.length === 0 || totalLines === 0) return;

    const centerX = 0;
    const centerY = 0;
    // Increase viewBox and maxRadius to fit labels
    svg.setAttribute('viewBox', '-130 -130 260 260');
    const maxRadius = 100;
    const minRadius = 0; // True Nightingale chart starts from center
    
    // Sort by lines descending to give a classic rose chart look
    const sortedStats = [...stats].sort((a, b) => b.lines - a.lines);
    const maxLines = sortedStats[0].lines;

    // Angle per item is equal
    const angleStep = (Math.PI * 2) / sortedStats.length;
    let currentAngle = -Math.PI / 2; // Start at top

    // --- Draw concentric grid lines (Polar Grid) ---
    const gridGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    gridGroup.setAttribute('class', 'rose-grid');
    [0.25, 0.5, 0.75, 1.0].forEach(ratio => {
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', String(centerX));
      circle.setAttribute('cy', String(centerY));
      circle.setAttribute('r', String(maxRadius * ratio));
      circle.setAttribute('fill', 'none');
      circle.setAttribute('stroke', 'var(--vscode-editorGhostText-foreground)');
      circle.setAttribute('stroke-width', '0.5');
      circle.setAttribute('stroke-dasharray', '2,2');
      circle.setAttribute('opacity', '0.3');
      gridGroup.appendChild(circle);
    });
    
    // --- Draw radial grid lines ---
    for (let i = 0; i < sortedStats.length; i++) {
      const angle = currentAngle + i * angleStep;
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', String(centerX));
      line.setAttribute('y1', String(centerY));
      line.setAttribute('x2', String(centerX + maxRadius * Math.cos(angle)));
      line.setAttribute('y2', String(centerY + maxRadius * Math.sin(angle)));
      line.setAttribute('stroke', 'var(--vscode-editorGhostText-foreground)');
      line.setAttribute('stroke-width', '0.5');
      line.setAttribute('opacity', '0.2');
      gridGroup.appendChild(line);
    }
    svg.appendChild(gridGroup);

    // Keep track of slice paths
    const paths = [];

    // State helper to get synced color
    function getCommitColor(hash) {
      const node = state.cachedCommitNodes[hash];
      if (node) {
        return colors[node.colorIdx % colors.length];
      }
      return getAvatarColor(hash);
    }

    let hoveredSliceHash = null;

    // Helper to update styling of all wedges
    function updateSliceStyles() {
      paths.forEach(item => {
        const { pathEl, hash, baseColor } = item;
        
        if (lockedSliceHash) {
          if (hash === lockedSliceHash) {
            pathEl.setAttribute('fill', baseColor);
            pathEl.setAttribute('opacity', '1.0');
            pathEl.setAttribute('stroke', 'var(--vscode-focusBorder, #007fd4)');
            pathEl.setAttribute('stroke-width', '2.0');
            pathEl.setAttribute('transform', 'scale(1.08)');
          } else if (hoveredSliceHash && hash === hoveredSliceHash) {
            pathEl.setAttribute('fill', baseColor);
            pathEl.setAttribute('opacity', '1.0');
            pathEl.setAttribute('stroke', 'var(--surface-1)');
            pathEl.setAttribute('stroke-width', '1.5');
            pathEl.setAttribute('transform', 'scale(1.04)');
          } else {
            pathEl.setAttribute('fill', hexToRgba(baseColor, 0.3));
            pathEl.setAttribute('opacity', '0.2');
            pathEl.setAttribute('stroke', 'var(--surface-1)');
            pathEl.setAttribute('stroke-width', '1.5');
            pathEl.setAttribute('transform', 'scale(1)');
          }
        } else if (hoveredSliceHash) {
          if (hash === hoveredSliceHash) {
            pathEl.setAttribute('fill', baseColor);
            pathEl.setAttribute('opacity', '1.0');
            pathEl.setAttribute('stroke', 'var(--surface-1)');
            pathEl.setAttribute('stroke-width', '1.5');
            pathEl.setAttribute('transform', 'scale(1.08)');
          } else {
            pathEl.setAttribute('fill', hexToRgba(baseColor, 0.3));
            pathEl.setAttribute('opacity', '0.2');
            pathEl.setAttribute('stroke', 'var(--surface-1)');
            pathEl.setAttribute('stroke-width', '1.5');
            pathEl.setAttribute('transform', 'scale(1)');
          }
        } else {
          pathEl.setAttribute('fill', hexToRgba(baseColor, 0.8));
          pathEl.setAttribute('opacity', '1.0');
          pathEl.setAttribute('stroke', 'var(--surface-1)');
          pathEl.setAttribute('stroke-width', '1.5');
          pathEl.setAttribute('transform', 'scale(1)');
        }
      });
    }

    // --- Draw wedges (Coxcomb Slices) ---
    sortedStats.forEach((s, i) => {
      const normalizedRatio = Math.sqrt(s.lines / maxLines);
      const radius = minRadius + (maxRadius - minRadius) * normalizedRatio;
      
      const startAngle = currentAngle;
      const endAngle = currentAngle + angleStep;
      const midAngle = startAngle + angleStep / 2;
      
      const x1 = centerX + radius * Math.cos(startAngle);
      const y1 = centerY + radius * Math.sin(startAngle);
      const x2 = centerX + radius * Math.cos(endAngle);
      const y2 = centerY + radius * Math.sin(endAngle);
      
      const minX1 = centerX + minRadius * Math.cos(startAngle);
      const minY1 = centerY + minRadius * Math.sin(startAngle);
      const minX2 = centerX + minRadius * Math.cos(endAngle);
      const minY2 = centerY + minRadius * Math.sin(endAngle);
      
      const largeArcFlag = angleStep > Math.PI ? 1 : 0;
      
      let pathData;
      if (sortedStats.length === 1) {
        pathData = `M 0 ${-radius} A ${radius} ${radius} 0 1 1 0 ${radius} A ${radius} ${radius} 0 1 1 0 ${-radius} Z`;
      } else {
        pathData = [
          `M ${minX1} ${minY1}`,
          `L ${x1} ${y1}`,
          `A ${radius} ${radius} 0 ${largeArcFlag} 1 ${x2} ${y2}`,
          `L ${minX2} ${minY2}`,
          `A ${minRadius} ${minRadius} 0 ${largeArcFlag} 0 ${minX1} ${minY1}`,
          `Z`
        ].join(' ');
      }

      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', pathData);
      path.style.cursor = 'pointer';
      
      const color = getCommitColor(s.hash);
      const pct = ((s.lines / totalLines) * 100).toFixed(1);

      paths.push({
        pathEl: path,
        hash: s.hash,
        baseColor: color
      });

      // Mouse enter
      path.addEventListener('mouseenter', (e) => {
        hoveredSliceHash = s.hash;
        updateSliceStyles();
        
        if (tooltip) {
          const shortHash = s.hash.substring(0, 7);
          const maxMsgLen = 45;
          const msg = s.summary.length > maxMsgLen ? s.summary.substring(0, maxMsgLen) + '...' : s.summary;
          tooltip.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
              <div style="display: flex; align-items: center; background: rgba(128, 128, 128, 0.15); border: 1px solid rgba(128, 128, 128, 0.2); border-radius: 4px; padding: 2px 6px; font-size: 11px; font-family: var(--vscode-editor-font-family, monospace);">
                <i class="codicon codicon-git-commit" style="font-size: 12px; margin-right: 4px; opacity: 0.8;"></i>
                <span style="font-weight: 600; opacity: 0.9;">${shortHash}</span>
              </div>
              <div style="font-weight: 600; font-size: 12px; color: var(--accent); display: flex; align-items: center;">
                ${s.lines} 行 (${pct}%)
              </div>
            </div>
            <div style="font-size: 13px; line-height: 1.5; font-weight: 400; opacity: 0.95; margin-bottom: 10px; max-width: 260px; word-wrap: break-word;">
              ${escapeHtml(msg || '')}
            </div>
            <div style="display: flex; align-items: center; font-size: 12px; opacity: 0.8; border-top: 1px solid rgba(128, 128, 128, 0.15); padding-top: 8px;">
              <i class="codicon codicon-account" style="font-size: 13px; margin-right: 6px;"></i>
              <span>${escapeHtml(s.author)}</span>
            </div>
          `;
          tooltip.classList.remove('hidden');
        }

        // Notify editor to highlight
        vscode.postMessage({
          command: 'hoverBlameCommit',
          hash: s.hash,
          color: hexToRgba(color, 0.25)
        });
      });
      
      // Mouse move
      path.addEventListener('mousemove', (e) => {
        if (tooltip) {
          const containerRect = svg.parentElement.getBoundingClientRect();
          const x = e.clientX - containerRect.left;
          const y = e.clientY - containerRect.top;
          tooltip.style.left = (x + 10) + 'px';
          tooltip.style.top = (y + 10) + 'px';
        }
      });
      
      // Mouse leave
      path.addEventListener('mouseleave', () => {
        hoveredSliceHash = null;
        updateSliceStyles();
        
        if (tooltip) {
          tooltip.classList.add('hidden');
        }

        // Clear editor highlight unless there is a locked slice
        if (lockedSliceHash) {
          vscode.postMessage({
            command: 'hoverBlameCommit',
            hash: lockedSliceHash,
            color: hexToRgba(lockedSliceColor, 0.25)
          });
        } else {
          vscode.postMessage({ command: 'clearHoverBlameCommit' });
        }
      });

      // Click: Lock / Unlock slice
      path.addEventListener('click', (e) => {
        e.stopPropagation(); // prevent bubbling to svg background click
        if (lockedSliceHash === s.hash) {
          // Unlock
          lockedSliceHash = null;
          lockedSliceColor = null;
        } else {
          // Lock
          lockedSliceHash = s.hash;
          lockedSliceColor = color;
        }
        updateSliceStyles();
        
        // Ensure Editor is highlighted with current lock or hover
        if (lockedSliceHash) {
          vscode.postMessage({
            command: 'hoverBlameCommit',
            hash: lockedSliceHash,
            color: hexToRgba(lockedSliceColor, 0.25)
          });
        } else {
          // If unlocked, highlight the hovered one
          vscode.postMessage({
            command: 'hoverBlameCommit',
            hash: s.hash,
            color: hexToRgba(color, 0.25)
          });
        }
      });

      svg.appendChild(path);
      
      currentAngle = endAngle;
    });

    // Handle initial styles (e.g. if lockedSliceHash is already set)
    updateSliceStyles();

    // Click SVG empty space to unlock
    svg.addEventListener('click', (e: any) => {
      if (!e.target || !e.target.tagName) return;
      if (e.target.tagName !== 'path') {
        lockedSliceHash = null;
        lockedSliceColor = null;
        updateSliceStyles();
        vscode.postMessage({ command: 'clearHoverBlameCommit' });
      }
    });
  }

  // ── 点击图谱或列表空白处收起面板 ────────────────
  const containerContainer = document.querySelector('.container');
  if (containerContainer) {
    containerContainer.addEventListener('click', (e: any) => {
      // 检查点击目标是否在 svg 或 list-pane 内，但不是具体的行或节点
      if (state.rightPaneState === RightPaneState.HISTORY || state.rightPaneState === RightPaneState.FILE_BLAME_STATS) {
        return; // 在追溯模式下不轻易收起
      }
      if (!e.target || !e.target.closest) return;
      
      const inSvg = e.target.closest('#graph-svg');
      const inList = e.target.closest('.list-pane');
      const isRow = e.target.closest('.commit-row');
      const isNode = e.target.closest('.commit-node');
      
      if ((inSvg || inList) && !isRow && !isNode) {
        if (state.rightPaneVisible === 1) {
          setRightPaneVisible(0);
          saveCurrentState();
        }
        if (state.selectedCommitHash) {
          collapseDetail();
        }
      }
    });
  }
