(function() {
  const vscode = acquireVsCodeApi();

  // Elements
  const branchSelect = document.getElementById('branch-select');
  const authorSelect = document.getElementById('author-select');
  const datePresetSelect = document.getElementById('date-preset-select');
  const dateRangeGroup = document.querySelector('.date-range-group');
  const sinceDate = document.getElementById('since-date');
  const untilDate = document.getElementById('until-date');
  const searchInput = document.getElementById('search-input');
  const resetBtn = document.getElementById('reset-btn');
  const loadingOverlay = document.getElementById('loading');
  const errorBanner = document.getElementById('error-message');
  const commitsTbody = document.getElementById('commits-tbody');
  const graphSvg = document.getElementById('graph-svg');
  const tableContainer = document.querySelector('.list-pane');

  // Details Pane Elements
  const detailsPane = document.getElementById('details-pane');
  const resizerBar = document.getElementById('resizer-bar');
  const detailsPlaceholder = document.getElementById('details-placeholder');
  const detailsContent = document.getElementById('details-content');
  const detailHashBadge = document.getElementById('detail-hash-badge');
  const detailMergeBadge = document.getElementById('detail-merge-badge');
  const detailAuthorAvatar = document.getElementById('detail-author-avatar');
  const detailAuthorName = document.getElementById('detail-author-name');
  const detailAuthorDate = document.getElementById('detail-author-date');
  const detailMsgSubject = document.getElementById('detail-msg-subject');
  const detailMsgBody = document.getElementById('detail-msg-body');
  const detailStatsRow = document.getElementById('detail-stats-row');
  const detailFilesTree = document.getElementById('detail-files-tree');

  // Stats Elements
  const statsStrip = document.getElementById('stats-strip');
  const stripCommitsVal = document.getElementById('strip-commits-val');
  const stripAdd = document.getElementById('strip-add');
  const stripDel = document.getElementById('strip-del');
  const stripContributorsVal = document.getElementById('strip-contributors-val');
  const stripRange = document.getElementById('strip-range');
  const statsToggleBtn = document.getElementById('stats-toggle-btn');
  const overviewStats = document.getElementById('overview-stats');
  const overviewRange = document.getElementById('overview-range');
  const ovCommits = document.getElementById('ov-commits');
  const ovAdd = document.getElementById('ov-add');
  const ovDel = document.getElementById('ov-del');
  const activitySvg = document.getElementById('activity-svg');
  const contributorsList = document.getElementById('contributors-list');
  const topFilesList = document.getElementById('top-files-list');
  const authorStatsPane = document.getElementById('author-stats');
  const authorBackBtn = document.getElementById('author-back-btn');
  const authorStatsAvatar = document.getElementById('author-stats-avatar');
  const authorStatsName = document.getElementById('author-stats-name');
  const authorStatsEmail = document.getElementById('author-stats-email');
  const auCommits = document.getElementById('au-commits');
  const auAdd = document.getElementById('au-add');
  const auDel = document.getElementById('au-del');
  const weekdayChart = document.getElementById('weekday-chart');
  const authorTopFiles = document.getElementById('author-top-files');
  const authorHighlightBtn = document.getElementById('author-highlight-btn');

  // State
  let commits = [];
  let branches = [];
  let remoteBranches = [];
  let authors = [];
  let selectedCommitHash = null;
  let expandedRow = null;
  let currentGraphWidth = 120;
  let cachedLines = [];
  let cachedCommitNodes = {};
  const branchColorMap = new Map();
  let currentStatsData = null;  // latest CodeStats from backend
  let currentFocusedAuthor = null; // author name for author-detail state

  // Right pane state machine
  const RightPaneState = { OVERVIEW: 'overview', COMMIT: 'commit', AUTHOR: 'author', LOADING: 'loading' };
  let rightPaneState = RightPaneState.LOADING;

  function setRightPane(state) {
    rightPaneState = state;
    overviewStats.classList.add('hidden');
    detailsContent.classList.add('hidden');
    authorStatsPane.classList.add('hidden');
    detailsPlaceholder.classList.add('hidden');

    if (state === RightPaneState.LOADING) {
      detailsPlaceholder.classList.remove('hidden');
    } else if (state === RightPaneState.OVERVIEW) {
      overviewStats.classList.remove('hidden');
    } else if (state === RightPaneState.COMMIT) {
      detailsContent.classList.remove('hidden');
    } else if (state === RightPaneState.AUTHOR) {
      authorStatsPane.classList.remove('hidden');
    }
  }

  // Pagination State
  let isFetching = false;
  let hasMoreCommits = true;
  let currentPage = 0;
  const pageSize = 150;

  function saveCurrentState() {
    const filters = {
      branch: branchSelect.value || undefined,
      author: authorSelect.value || undefined,
      datePreset: datePresetSelect.value || undefined,
      since: sinceDate.value || undefined,
      until: untilDate.value || undefined,
      query: searchInput.value.trim() || undefined
    };
    vscode.setState({
      commits,
      branches,
      remoteBranches,
      authors,
      selectedCommitHash,
      currentPage,
      hasMoreCommits,
      filters,
      detailsWidth: detailsPane.style.width,
      rightPaneState
    });
  }

  // Loading 防闪烁
  let loadingTimer = null;
  function showLoading() {
    loadingTimer = setTimeout(() => {
      loadingOverlay.classList.remove('hidden');
    }, 150);
  }
  function hideLoading() {
    if (loadingTimer) { clearTimeout(loadingTimer); loadingTimer = null; }
    loadingOverlay.classList.add('hidden');
  }

  // Settings
  const rowHeight = 32;
  const laneWidth = 12;
  const paddingLeft = 16;
  const colors = [
    '#3b82f6', // modern blue
    '#10b981', // emerald green
    '#f59e0b', // amber yellow
    '#8b5cf6', // violet purple
    '#ec4899', // pink
    '#06b6d4', // cyan
    '#f97316', // orange
    '#14b8a6', // teal
    '#a855f7', // purple
    '#84cc16', // lime
    '#6366f1', // indigo
    '#ef4444'  // red
  ];

  // 文件扩展名 → codicon class + 颜色 class 映射
  const fileIconMap = {
    '.ts': { icon: 'codicon-symbol-class', color: 'file-icon-ts' },
    '.tsx': { icon: 'codicon-symbol-class', color: 'file-icon-ts' },
    '.js': { icon: 'codicon-symbol-event', color: 'file-icon-js' },
    '.mjs': { icon: 'codicon-symbol-event', color: 'file-icon-js' },
    '.cjs': { icon: 'codicon-symbol-event', color: 'file-icon-js' },
    '.jsx': { icon: 'codicon-symbol-event', color: 'file-icon-js' },
    '.vue': { icon: 'codicon-file-code', color: 'file-icon-vue' },
    '.css': { icon: 'codicon-symbol-color', color: 'file-icon-css' },
    '.scss': { icon: 'codicon-symbol-color', color: 'file-icon-css' },
    '.less': { icon: 'codicon-symbol-color', color: 'file-icon-css' },
    '.html': { icon: 'codicon-file-code', color: 'file-icon-html' },
    '.htm': { icon: 'codicon-file-code', color: 'file-icon-html' },
    '.json': { icon: 'codicon-json', color: 'file-icon-json' },
    '.md': { icon: 'codicon-markdown', color: 'file-icon-md' },
    '.py': { icon: 'codicon-symbol-method', color: 'file-icon-py' },
    '.java': { icon: 'codicon-symbol-class', color: 'file-icon-java' },
    '.go': { icon: 'codicon-symbol-method', color: 'file-icon-go' },
    '.rs': { icon: 'codicon-symbol-struct', color: 'file-icon-rs' },
    '.sh': { icon: 'codicon-terminal', color: 'file-icon-sh' },
    '.bash': { icon: 'codicon-terminal', color: 'file-icon-sh' },
    '.zsh': { icon: 'codicon-terminal', color: 'file-icon-sh' },
    '.yaml': { icon: 'codicon-symbol-namespace', color: 'file-icon-yaml' },
    '.yml': { icon: 'codicon-symbol-namespace', color: 'file-icon-yaml' },
    '.xml': { icon: 'codicon-file-code', color: 'file-icon-xml' },
    '.sql': { icon: 'codicon-database', color: 'file-icon-sql' },
    '.swift': { icon: 'codicon-symbol-method', color: 'file-icon-swift' },
    '.kt': { icon: 'codicon-symbol-class', color: 'file-icon-kt' },
    '.kts': { icon: 'codicon-symbol-class', color: 'file-icon-kt' },
    '.rb': { icon: 'codicon-symbol-method', color: 'file-icon-rb' },
    '.php': { icon: 'codicon-file-code', color: 'file-icon-php' },
    '.c': { icon: 'codicon-symbol-method', color: 'file-icon-c' },
    '.h': { icon: 'codicon-symbol-interface', color: 'file-icon-c' },
    '.cpp': { icon: 'codicon-symbol-method', color: 'file-icon-cpp' },
    '.hpp': { icon: 'codicon-symbol-interface', color: 'file-icon-cpp' },
    '.cs': { icon: 'codicon-symbol-class', color: 'file-icon-cs' },
    '.svg': { icon: 'codicon-file-media', color: '' },
    '.png': { icon: 'codicon-file-media', color: '' },
    '.jpg': { icon: 'codicon-file-media', color: '' },
    '.gif': { icon: 'codicon-file-media', color: '' },
    '.ico': { icon: 'codicon-file-media', color: '' },
    '.woff': { icon: 'codicon-file-binary', color: '' },
    '.woff2': { icon: 'codicon-file-binary', color: '' },
    '.ttf': { icon: 'codicon-file-binary', color: '' },
    '.zip': { icon: 'codicon-file-zip', color: '' },
    '.tar': { icon: 'codicon-file-zip', color: '' },
    '.gz': { icon: 'codicon-file-zip', color: '' },
    '.lock': { icon: 'codicon-lock', color: '' },
  };

  function getFileIconInfo(fileName) {
    const lowerName = fileName.toLowerCase();
    // 特殊文件名
    if (lowerName === 'dockerfile') return { icon: 'codicon-symbol-namespace', color: 'file-icon-go' };
    if (lowerName === 'makefile') return { icon: 'codicon-terminal', color: 'file-icon-sh' };
    if (lowerName === '.gitignore') return { icon: 'codicon-git-commit', color: '' };
    if (lowerName === '.env') return { icon: 'codicon-key', color: '' };

    const lastDot = fileName.lastIndexOf('.');
    if (lastDot === -1) return { icon: 'codicon-file', color: '' };
    const ext = fileName.substring(lastDot).toLowerCase();
    return fileIconMap[ext] || { icon: 'codicon-file', color: '' };
  }

  // ── 请求/加载逻辑 ────────────────────────

  function getFilters() {
    let sinceVal = undefined;
    let untilVal = undefined;

    const preset = datePresetSelect.value;
    if (preset === '24h') {
      const d = new Date();
      d.setDate(d.getDate() - 1);
      sinceVal = d.toISOString().split('T')[0];
    } else if (preset === '7d') {
      const d = new Date();
      d.setDate(d.getDate() - 7);
      sinceVal = d.toISOString().split('T')[0];
    } else if (preset === 'custom') {
      sinceVal = sinceDate.value || undefined;
      untilVal = untilDate.value || undefined;
    }

    return {
      branch: branchSelect.value || undefined,
      author: authorSelect.value || undefined,
      since: sinceVal,
      until: untilVal,
      query: searchInput.value.trim() || undefined
    };
  }

  function reloadData() {
    currentPage = 0;
    hasMoreCommits = true;
    commits = [];
    selectedCommitHash = null;
    currentFocusedAuthor = null;
    setRightPane(RightPaneState.LOADING);
    isFetching = true;
    showLoading();
    errorBanner.classList.add('hidden');
    
    const filters = getFilters();

    vscode.postMessage({ command: 'loadData', filters, page: 0 });
    requestStats(filters);
  }

  function loadNextPage() {
    if (isFetching || !hasMoreCommits) return;
    isFetching = true;
    
    const filters = getFilters();

    vscode.postMessage({ command: 'loadData', filters, page: currentPage + 1 });
  }

  // 滚动分页
  tableContainer.addEventListener('scroll', () => {
    if (isFetching || !hasMoreCommits) return;
    const { scrollHeight, scrollTop, clientHeight } = tableContainer;
    if (scrollHeight - scrollTop - clientHeight < 120) {
      loadNextPage();
    }
  });

  // Restore state if available
  const previousState = vscode.getState();
  if (previousState) {
    commits = previousState.commits || [];
    branches = previousState.branches || [];
    remoteBranches = previousState.remoteBranches || [];
    authors = previousState.authors || [];
    selectedCommitHash = previousState.selectedCommitHash || null;
    currentPage = previousState.currentPage || 0;
    hasMoreCommits = previousState.hasMoreCommits !== undefined ? previousState.hasMoreCommits : true;
    
    if (previousState.detailsWidth) {
      detailsPane.style.width = previousState.detailsWidth;
    }

    if (previousState.filters) {
      branchSelect.value = previousState.filters.branch || '';
      branchSelect.dataset.restoredValue = previousState.filters.branch || '';
      authorSelect.value = previousState.filters.author || '';
      authorSelect.dataset.restoredValue = previousState.filters.author || '';
      datePresetSelect.value = previousState.filters.datePreset || '';
      sinceDate.value = previousState.filters.since || '';
      untilDate.value = previousState.filters.until || '';
      if (datePresetSelect.value === 'custom') {
        dateRangeGroup.classList.remove('hidden');
      } else {
        dateRangeGroup.classList.add('hidden');
      }
      searchInput.value = previousState.filters.query || '';
    }

    updateFilterControls();
    renderTableAndGraph();
    
    if (selectedCommitHash) {
      // 缓存恢复：通过模拟行点击来完整初始化右侧详情面板（含分支名填充）
      const restoredRow = commitsTbody.querySelector(`tr.commit-row[data-hash="${selectedCommitHash}"]`);
      if (restoredRow) {
        const restoredParents = JSON.parse(restoredRow.dataset.parents || '[]');
        handleRowClick(restoredRow, selectedCommitHash, restoredParents);
      } else {
        vscode.postMessage({ command: 'getCommitDetail', hash: selectedCommitHash });
        setRightPane(RightPaneState.COMMIT);
      }
    } else {
      setRightPane(RightPaneState.LOADING);
    }
    vscode.postMessage({ command: 'initWatcher' });
    requestStats(getFilters());
  } else {
    // 初始加载
    reloadData();
  }

  // 过滤器监听
  branchSelect.addEventListener('change', () => {
    adjustSelectWidth(branchSelect);
    reloadData();
  });
  authorSelect.addEventListener('change', () => {
    adjustSelectWidth(authorSelect);
    reloadData();
  });
  datePresetSelect.addEventListener('change', () => {
    adjustSelectWidth(datePresetSelect);
    if (datePresetSelect.value === 'custom') {
      dateRangeGroup.classList.remove('hidden');
    } else {
      dateRangeGroup.classList.add('hidden');
      sinceDate.value = '';
      untilDate.value = '';
    }
    reloadData();
  });
  sinceDate.addEventListener('change', reloadData);
  untilDate.addEventListener('change', reloadData);

  let searchTimeout;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchInput.style.opacity = '0.55'; // 防抖等待期间给出视觉反馈
    searchTimeout = setTimeout(() => {
      searchInput.style.opacity = '';
      reloadData();
    }, 350);
  });

  resetBtn.addEventListener('click', () => {
    branchSelect.value = '';
    authorSelect.value = '';
    datePresetSelect.value = '';
    sinceDate.value = '';
    untilDate.value = '';
    dateRangeGroup.classList.add('hidden');
    searchInput.value = '';
    updateSelectWidths();
    reloadData();
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
        isFetching = false;
        showError(message.error);
        break;
      case 'dataLoaded':
        hideLoading();
        isFetching = false;

        const newCommits = message.commits;
        const page = message.page;
        currentPage = page;

        if (page === 0) {
          commits = newCommits;
          hasMoreCommits = newCommits.length === pageSize;
        } else {
          commits = commits.concat(newCommits);
          hasMoreCommits = newCommits.length === pageSize;
        }

        branches = message.branches;
        remoteBranches = message.remoteBranches || [];
        authors = message.authors;
        
        updateFilterControls();
        renderTableAndGraph();
        saveCurrentState();
        break;
      case 'commitDetail':
        renderCommitDetail(message.hash, message.files);
        break;
      case 'focusCommit':
        focusAndHighlightCommit(message.hash);
        break;
      case 'commitLocated':
        hideLoading();
        isFetching = false;

        if (message.resetFilters) {
          branchSelect.value = '';
          authorSelect.value = '';
          datePresetSelect.value = '';
          sinceDate.value = '';
          untilDate.value = '';
          dateRangeGroup.classList.add('hidden');
          searchInput.value = '';
          updateSelectWidths();
        }

        commits = message.commits;
        currentPage = Math.max(0, Math.ceil(commits.length / pageSize) - 1);
        hasMoreCommits = message.commits.length >= pageSize;

        branches = message.branches;
        remoteBranches = message.remoteBranches || [];
        authors = message.authors;

        updateFilterControls();
        renderTableAndGraph();
        saveCurrentState();

        setTimeout(() => {
          let row = commitsTbody.querySelector(`tr.commit-row[data-hash="${message.hash}"]`);
          if (row) {
            row.scrollIntoView({ behavior: 'smooth', block: 'center' });
            if (selectedCommitHash !== row.dataset.hash) {
              row.click();
            }
          }
        }, 100);
        break;
      case 'statsLoaded':
        currentStatsData = message.stats;
        renderStatsStrip(message.stats);
        if (rightPaneState === RightPaneState.OVERVIEW || rightPaneState === RightPaneState.LOADING) {
          renderOverviewStats(message.stats);
          setRightPane(RightPaneState.OVERVIEW);
        } else if (rightPaneState === RightPaneState.AUTHOR && currentFocusedAuthor) {
          // Refresh author detail with new data
          const contrib = message.stats.contributors.find(c => c.author === currentFocusedAuthor);
          if (contrib) { showAuthorDetail(contrib); }
        }
        break;
      case 'statsError':
        // Stats failed silently — just hide the strip loading state
        break;
    }
  });

  function showError(msg) {
    errorBanner.textContent = msg;
    errorBanner.classList.remove('hidden');
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
    const selectedOption = select.options[select.selectedIndex];
    measurer.textContent = selectedOption ? selectedOption.text : '';
    const width = measurer.offsetWidth + 28;
    select.style.width = `${width}px`;
  }

  function updateSelectWidths() {
    adjustSelectWidth(branchSelect);
    adjustSelectWidth(authorSelect);
    adjustSelectWidth(datePresetSelect);
  }

  function updateFilterControls() {
    let currentBranchValue = branchSelect.value;
    if (branchSelect.dataset.restoredValue !== undefined) {
      currentBranchValue = branchSelect.dataset.restoredValue;
      delete branchSelect.dataset.restoredValue;
    }
    branchSelect.innerHTML = '<option value="">分支</option>';
    branches.forEach(b => {
      const option = document.createElement('option');
      option.value = b;
      option.textContent = b;
      if (b === currentBranchValue) option.selected = true;
      branchSelect.appendChild(option);
    });

    let currentAuthorValue = authorSelect.value;
    if (authorSelect.dataset.restoredValue !== undefined) {
      currentAuthorValue = authorSelect.dataset.restoredValue;
      delete authorSelect.dataset.restoredValue;
    }
    authorSelect.innerHTML = '<option value="">作者</option>';
    authors.forEach(a => {
      const option = document.createElement('option');
      option.value = a;
      option.textContent = a;
      if (a === currentAuthorValue) option.selected = true;
      authorSelect.appendChild(option);
    });

    updateSelectWidths();
  }

  // ── 图表布局 & 渲染核心 ────────────────────────

  function renderTableAndGraph() {
    const oldSelectedHash = selectedCommitHash;

    if (currentPage === 0) {
      commitsTbody.innerHTML = '';
    }
    graphSvg.innerHTML = '';
    expandedRow = null;

    if (commits.length === 0) {
      commitsTbody.innerHTML = '';
      const tr = document.createElement('tr');
      tr.innerHTML = `<td colspan="5">
        <div class="empty-state">
          <i class="codicon codicon-git-commit"></i>
          <span>没有找到匹配的提交记录</span>
        </div>
      </td>`;
      commitsTbody.appendChild(tr);
      graphSvg.style.height = '0px';
      return;
    }

    // ─── 1. 图表 Lane 分配算法（防重叠 · Map O(1) 优化版）─────────

    const commitHashes = new Set(commits.map(c => c.hash));
    // 构建 hash→commit O(1) 查找表，避免在主干识别循环中反复线性 find
    const hashToCommitMap = new Map();
    commits.forEach(c => hashToCommitMap.set(c.hash, c));

    const lanes = [];             // lanes[i] = hash or null
    const hashToLane = new Map(); // 反向映射：hash → laneIdx（O(1) 查找替代 indexOf）
    const commitNodes = {};       // hash → { row, lane }
    const lines = [];             // 连线数据
    let maxLanes = 0;

    // lane 辅助函数（保持 lanes[] 与 hashToLane 严格同步）
    function laneSet(idx, hash) {
      const old = lanes[idx];
      if (old != null) { hashToLane.delete(old); }
      lanes[idx] = hash;
      if (hash != null) { hashToLane.set(hash, idx); }
    }
    function laneIndexOf(hash) {
      const idx = hashToLane.get(hash);
      return idx !== undefined ? idx : -1;
    }
    function lanePushNull() { lanes.push(null); }
    function lanePush(hash) {
      const idx = lanes.length;
      lanes.push(hash);
      if (hash != null) { hashToLane.set(hash, idx); }
      return idx;
    }

    // 找出主干提交，强行绑定在 Lane 0 (主轴)
    const mainTrunk = new Set();
    const headCommit = commits.find(c => c.decorations && c.decorations.includes('HEAD'));
    let curr = headCommit ? headCommit.hash : (commits[0] ? commits[0].hash : null);
    while (curr) {
      mainTrunk.add(curr);
      const c = hashToCommitMap.get(curr); // O(1)，原先为 O(n) find
      curr = (c && c.parents && c.parents.length > 0) ? c.parents[0] : null;
    }

    // 分支名 -> 颜色映射（用于 badge 上色）
    branchColorMap.clear();

    for (let r = 0; r < commits.length; r++) {
      const c = commits[r];
      const hash = c.hash;
      const parents = c.parents;
      const isMerge = parents.length >= 2;

      // 找到或分配 lane（O(1) Map 查找）
      let laneIdx = laneIndexOf(hash);
      if (laneIdx === -1) {
        if (mainTrunk.has(hash)) {
          laneIdx = 0;
          if (lanes.length === 0) {
            lanePush(hash);
          } else {
            laneSet(0, hash);
          }
        } else {
          // 从 lane 1 开始找空槽（保留 lane 0 给主轴）
          let emptySlot = -1;
          for (let s = 1; s < lanes.length; s++) {
            if (lanes[s] === null) { emptySlot = s; break; }
          }
          if (emptySlot !== -1) {
            laneIdx = emptySlot;
            laneSet(laneIdx, hash);
          } else {
            if (lanes.length === 0) {
              lanePushNull(); // Lane 0 保留给主轴
              laneIdx = lanePush(hash); // Lane 1
            } else {
              laneIdx = lanePush(hash);
            }
          }
        }
      }

      commitNodes[hash] = { row: r, lane: laneIdx, isMerge };
      maxLanes = Math.max(maxLanes, lanes.length);

      // 将 decoration 的分支名关联到 lane 颜色
      if (c.decorations && c.decorations.length > 0) {
        c.decorations.forEach(dec => {
          branchColorMap.set(dec, colors[laneIdx % colors.length]);
        });
      }

      const incomingLanes = [...lanes];

      // 释放当前 lane
      laneSet(laneIdx, null);

      // 处理父节点
      if (parents.length > 0) {
        // 主父节点
        const p0 = parents[0];
        if (commitHashes.has(p0)) {
          const p0LaneIdx = laneIndexOf(p0); // O(1)
          let targetLaneIdx = laneIdx;

          if (p0LaneIdx !== -1) {
            targetLaneIdx = p0LaneIdx;
          } else {
            if (mainTrunk.has(p0)) {
              if (lanes[0] == null) {
                laneSet(0, p0);
              }
              targetLaneIdx = 0;
            } else {
              laneSet(laneIdx, p0);
              targetLaneIdx = laneIdx;
            }
          }

          lines.push({
            fromRow: r, fromLane: laneIdx,
            toRow: r + 1, toLane: targetLaneIdx,
            colorIdx: laneIdx
          });
        } else {
          lines.push({
            fromRow: r, fromLane: laneIdx,
            toRow: r + 0.5, toLane: laneIdx,
            colorIdx: laneIdx, fade: true
          });
        }

        // 其他父节点（合并分支）
        for (let p = 1; p < parents.length; p++) {
          const pk = parents[p];
          if (commitHashes.has(pk)) {
            const pkLaneIdx = laneIndexOf(pk); // O(1)
            let pkTargetLaneIdx = pkLaneIdx;

            if (pkLaneIdx === -1) {
              if (mainTrunk.has(pk)) {
                pkTargetLaneIdx = 0;
                if (lanes[0] == null) {
                  laneSet(0, pk);
                }
              } else {
                // 不复用已占用的 slot，防重叠（从 lane 1 开始找）
                let emptySlot = -1;
                for (let s = 1; s < lanes.length; s++) {
                  if (lanes[s] === null && s !== laneIdx) { emptySlot = s; break; }
                }
                if (emptySlot === -1) {
                  pkTargetLaneIdx = lanes.length === 0 ? 1 : lanes.length;
                  while (lanes.length < pkTargetLaneIdx) { lanePushNull(); }
                  lanePush(pk);
                } else {
                  pkTargetLaneIdx = emptySlot;
                  laneSet(emptySlot, pk);
                }
              }
            }

            lines.push({
              fromRow: r, fromLane: laneIdx,
              toRow: r + 1, toLane: pkTargetLaneIdx,
              colorIdx: pkTargetLaneIdx,
              isMergeLine: true
            });
          } else {
            const tempLane = laneIdx + 1;
            lines.push({
              fromRow: r, fromLane: laneIdx,
              toRow: r + 0.5, toLane: tempLane,
              colorIdx: laneIdx, fade: true
            });
          }
        }
      }

      // 穿过线（经过此行但未停留的分支线）
      for (let j = 0; j < incomingLanes.length; j++) {
        const h = incomingLanes[j];
        if (h && j !== laneIdx) {
          const nextLaneIdx = laneIndexOf(h); // O(1)
          if (nextLaneIdx !== -1) {
            lines.push({
              fromRow: r, fromLane: j,
              toRow: r + 1, toLane: nextLaneIdx,
              colorIdx: j
            });
          }
        }
      }

      // 清理尾部空 lanes（null 不在 Map 中，无需额外清理）
      while (lanes.length > 0 && lanes[lanes.length - 1] === null) {
        lanes.pop();
      }
      maxLanes = Math.max(maxLanes, lanes.length);
    }

    cachedLines = lines;
    cachedCommitNodes = commitNodes;

    // 构建「提交 → 分支名」映射：让每个提交都知道它属于哪个分支（含颜色）
    // 策略：从顶向下遍历，每个 lane 维护「当前分支名」，
    // 优先用本地分支名，没有则用 remote 分支名（去掉 origin/ 前缀），
    // 没有 decoration 的提交继承该 lane 上一个已知的分支名。
    const laneCurrentBranch = {}; // lane → {name, color}
    window._commitBranchLabel = {}; // hash → {name, color}
    commits.forEach(c => {
      const node = commitNodes[c.hash];
      if (!node) return;
      const lane = node.lane;
      const laneColor = colors[lane % colors.length];

      let resolvedBranch = null;
      if (c.decorations && c.decorations.length > 0) {
        // 优先：本地分支名（排除 HEAD、remote、tag）
        resolvedBranch = c.decorations.find(d =>
          d !== 'HEAD' &&
          !d.startsWith('origin/') &&
          !d.startsWith('tag: ') &&
          !remoteBranches.includes(d)
        );

        // 次选：HEAD 后面紧跟的本地分支
        if (!resolvedBranch && c.decorations[0] === 'HEAD') {
          resolvedBranch = c.decorations.find(d =>
            d !== 'HEAD' &&
            !d.startsWith('origin/') &&
            !d.startsWith('tag: ')
          );
        }

        // 兜底：remote 分支，去掉 origin/ 前缀显示
        if (!resolvedBranch) {
          const remoteDec = c.decorations.find(d =>
            d.startsWith('origin/') || remoteBranches.includes(d)
          );
          if (remoteDec) {
            resolvedBranch = remoteDec.replace(/^origin\//, '');
          }
        }
      }

      if (resolvedBranch) {
        laneCurrentBranch[lane] = { name: resolvedBranch, color: laneColor };
      }

      // 取该 lane 已知的分支名（可能是继承自上方的提交）
      const branchLabel = laneCurrentBranch[lane] || null;
      window._commitBranchLabel[c.hash] = branchLabel
        ? { name: branchLabel.name, color: laneColor }
        : { name: null, color: laneColor };
    });

    // 动态图表宽度
    const computedGraphWidth = paddingLeft + (maxLanes + 1) * laneWidth;
    currentGraphWidth = computedGraphWidth;
    
    const graphHeader = document.querySelector('th.graph-col');
    if (graphHeader) {
      graphHeader.style.width = computedGraphWidth + 'px';
      graphHeader.style.minWidth = computedGraphWidth + 'px';
    }

    // ─── 2. 渲染表格行 ─────────

    if (currentPage === 0) {
      commitsTbody.innerHTML = '';
    }

    commits.forEach((c, r) => {
      let tr = commitsTbody.querySelector(`tr.commit-row[data-hash="${c.hash}"]`);
      if (!tr) {
        tr = document.createElement('tr');
        tr.className = 'commit-row';
        tr.dataset.hash = c.hash;
        tr.dataset.parents = JSON.stringify(c.parents);

        const node = cachedCommitNodes[c.hash];
        if (node) {
          const color = colors[node.lane % colors.length];
          tr.style.setProperty('--selection-glow-color', color);
        }

        const relTime = getRelativeTime(c.timestamp);
        const absTime = formatDate(c.timestamp);
        // 分支 decorations HTML（颜色与 lane 同步）
        let decsHtml = '';
        if (c.decorations && c.decorations.length > 0) {
          const makeBadge = (dec, overrideLabel) => {
            let badgeClass = 'badge-branch';
            let iconHtml = '<i class="codicon codicon-git-branch"></i>';
            let badgeColor = branchColorMap.get(dec) || colors[0];
            let isHead = false;
            const isRemote = remoteBranches.includes(dec) || dec.startsWith('origin/');
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
              ? `background-color: rgba(255,255,255,0.08); color: #fff;`
              : `background-color: ${hexToRgba(badgeColor, 0.15)}; color: ${badgeColor};`;

            return `<span class="ref-badge ${badgeClass}" style="${style}">${iconHtml}${escapeHtml(displayDec)}</span>`;
          };

          // 如果第一个 decoration 是 HEAD，将其与紧跟的本地分支名合并显示
          if (c.decorations[0] === 'HEAD') {
            // 找紧跟 HEAD 之后的第一个本地分支（非 remote, 非 tag）
            const nextLocal = c.decorations.slice(1).find(d =>
              !d.startsWith('origin/') && !d.startsWith('tag: ') && !remoteBranches.includes(d)
            );
            const headLabel = nextLocal ? `HEAD → ${nextLocal}` : 'HEAD';
            decsHtml += makeBadge('HEAD', headLabel);

            // 剩余 decorations（去掉已合并进 HEAD badge 的分支）
            const remaining = c.decorations.slice(1).filter(d => d !== nextLocal);
            if (remaining.length === 1) {
              decsHtml += makeBadge(remaining[0]);
            } else if (remaining.length > 1) {
              const remainingNames = remaining.join(', ');
              decsHtml += `<span class="ref-badge" style="background-color: rgba(255,255,255,0.06); color: var(--desc-fg); border: 1px solid var(--border-color); cursor: default;" title="${escapeHtml(remainingNames)}">+${remaining.length}</span>`;
            }
          } else {
            decsHtml += makeBadge(c.decorations[0]);
            if (c.decorations.length > 1) {
              const remainingNames = c.decorations.slice(1).join(', ');
              decsHtml += `<span class="ref-badge" style="background-color: rgba(255,255,255,0.06); color: var(--desc-fg); border: 1px solid var(--border-color); cursor: default;" title="${escapeHtml(remainingNames)}">+${c.decorations.length - 1}</span>`;
            }
          }
        }

        // 列表页小头像计算
        const authorColor = getAvatarColor(c.author);
        const authorInitials = getInitials(c.author);
        const authorAvatarHtml = `<span class="avatar-circle" style="background-color: ${authorColor}; width: 14px; height: 14px; font-size: 8px; margin-right: 5px; display: inline-flex; vertical-align: middle; line-height: 14px; border: none; box-shadow: none;">${authorInitials}</span>`;

        tr.innerHTML = `
          <td class="graph-col" style="width: ${computedGraphWidth}px; min-width: ${computedGraphWidth}px;"></td>
          <td class="content-col" colspan="4">
            <div class="row-content">
              <div class="commit-main">
                <span class="commit-message" title="${escapeHtml(c.message)}">${escapeHtml(c.message)}</span>
                ${decsHtml}
              </div>
              <div class="commit-meta">
                <span class="commit-author" data-author="${escapeHtml(c.author)}" title="${escapeHtml(c.author)}">
                  ${authorAvatarHtml}
                  <span class="author-name-text" style="vertical-align: middle;">${escapeHtml(c.author)}</span>
                </span>
                <span class="commit-date" title="${relTime}"><span class="date-full">${absTime}</span><span class="date-short">${formatDateShort(c.timestamp)}</span></span>
                <span class="hash-copyable" data-full-hash="${c.hash}">${c.hash.substring(0, 7)}</span>
              </div>
            </div>
          </td>
        `;

        // 点击复制 hash
        const hashEl = tr.querySelector('.hash-copyable');
        hashEl.addEventListener('click', (e) => {
          e.stopPropagation();
          const fullHash = hashEl.dataset.fullHash;
          navigator.clipboard.writeText(fullHash).then(() => {
            hashEl.textContent = '已复制!';
            hashEl.classList.add('hash-copied');
            setTimeout(() => {
              hashEl.textContent = fullHash.substring(0, 7);
              hashEl.classList.remove('hash-copied');
            }, 1200);
          });
        });

        tr.addEventListener('click', () => handleRowClick(tr, c.hash, c.parents));
        
        // GitLens Row Hover Highlighting
        tr.addEventListener('mouseenter', () => {
          const node = cachedCommitNodes[c.hash];
          if (node) {
            const lane = node.lane % colors.length;
            graphSvg.setAttribute('class', `hover-active hover-lane-${lane}`);
          }
          const circle = graphSvg.querySelector(`.node-${c.hash}`);
          if (circle) {
            circle.classList.add('hovered');
          }
        });
        tr.addEventListener('mouseleave', () => {
          graphSvg.removeAttribute('class');
          const circle = graphSvg.querySelector(`.node-${c.hash}`);
          if (circle) {
            circle.classList.remove('hovered');
          }
        });

        commitsTbody.appendChild(tr);
      } else {
        const graphCol = tr.querySelector('.graph-col');
        if (graphCol) {
          graphCol.style.width = computedGraphWidth + 'px';
          graphCol.style.minWidth = computedGraphWidth + 'px';
        }
      }
    });

    // 恢复选中态
    if (oldSelectedHash) {
      const selectedRow = commitsTbody.querySelector(`tr.commit-row[data-hash="${oldSelectedHash}"]`);
      if (selectedRow) {
        selectedRow.classList.add('selected');
        selectedCommitHash = oldSelectedHash;
      } else {
        collapseDetail();
      }
    } else {
      collapseDetail();
    }

    // 底部「已加载全部」提示（当无更多提交时显示）
    const existingFooter = commitsTbody.querySelector('.commits-end-footer');
    if (existingFooter) { existingFooter.remove(); }
    if (!hasMoreCommits && commits.length > 0) {
      const footerTr = document.createElement('tr');
      footerTr.className = 'commits-end-footer';
      footerTr.innerHTML = `<td colspan="5" style="text-align:center;padding:10px 0 12px;opacity:0.35;font-size:11px;user-select:none;pointer-events:none;">· 已加载全部 ${commits.length} 条提交记录 ·</td>`;
      commitsTbody.appendChild(footerTr);
    }

    // SVG 尺寸
    graphSvg.style.width = computedGraphWidth + 'px';

    // 动态绘制 SVG 连线与节点
    drawSvg();
  }

  function drawSvg() {
    graphSvg.innerHTML = '';

    if (commits.length === 0) {
      graphSvg.style.height = '0px';
      return;
    }

    // Since the table is static now (no detail rows inline), height is always static
    const totalHeight = commits.length * rowHeight;
    graphSvg.style.height = totalHeight + 'px';

    // Helper to get Y coordinate for any row index (float or int)
    function getYCoordinate(rowIndex) {
      return rowIndex * rowHeight + rowHeight / 2;
    }

    // ─── 3. 渲染 SVG 连线 ─────────
    cachedLines.forEach(line => {
      const x1 = paddingLeft + line.fromLane * laneWidth;
      const y1 = getYCoordinate(line.fromRow);
      const x2 = paddingLeft + line.toLane * laneWidth;
      const y2 = getYCoordinate(line.toRow);
      const color = colors[line.colorIdx % colors.length];
      const laneClass = `lane-${line.colorIdx % colors.length}`;

      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('class', laneClass);
      
      if (line.fromLane === line.toLane) {
        if (line.fade) {
          const fadeLen = 12;
          path.setAttribute('d', `M ${x1} ${y1} L ${x1} ${y1 + fadeLen}`);
          path.setAttribute('stroke-dasharray', '2,2');
          path.setAttribute('opacity', '0.4');
        } else {
          path.setAttribute('d', `M ${x1} ${y1} L ${x2} ${y2}`);
        }
      } else {
        if (line.fade) {
          const fadeLen = 12;
          const controlY1 = y1 + 4;
          const controlY2 = y1 + fadeLen - 4;
          path.setAttribute('d', `M ${x1} ${y1} C ${x1} ${controlY1}, ${x2} ${controlY2}, ${x2} ${y1 + fadeLen}`);
          path.setAttribute('stroke-dasharray', '2,2');
          path.setAttribute('opacity', '0.4');
        } else {
          const cpOffset = 8; // Tighter, metro-style transit curves (aligned with GitLens)
          const controlY1 = y1 + cpOffset;
          const controlY2 = y2 - cpOffset;
          path.setAttribute('d', `M ${x1} ${y1} C ${x1} ${controlY1}, ${x2} ${controlY2}, ${x2} ${y2}`);
        }
      }
      
      path.setAttribute('stroke', color);
      path.setAttribute('stroke-width', '2.2');
      path.setAttribute('fill', 'none');

      // GitLens Hover events
      path.addEventListener('mouseover', () => {
        const lane = line.colorIdx % colors.length;
        graphSvg.setAttribute('class', `hover-active hover-lane-${lane}`);
      });
      path.addEventListener('mouseout', () => {
        graphSvg.removeAttribute('class');
      });

      graphSvg.appendChild(path);
    });

    // ─── 4. 渲染 SVG 节点 ─────────
    commits.forEach((c, r) => {
      const node = cachedCommitNodes[c.hash];
      if (!node) return;
      const x = paddingLeft + node.lane * laneWidth;
      const y = getYCoordinate(r);
      const color = colors[node.lane % colors.length];
      const laneClass = `lane-${node.lane % colors.length}`;

      // Render all nodes as circles (matching VS Code native Git Graph style)
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('class', `${laneClass} node-${c.hash}`);
      circle.setAttribute('cx', x);
      circle.setAttribute('cy', y);
      
      // Merge commits are rendered as hollow circles (ring nodes)
      if (node.isMerge) {
        circle.setAttribute('r', '5.5');
        circle.setAttribute('fill', 'var(--bg-color)');
        circle.setAttribute('stroke', color);
        circle.setAttribute('stroke-width', '2.5');
      } else {
        circle.setAttribute('r', '4.5');
        circle.setAttribute('fill', color);
        circle.setAttribute('stroke', 'var(--bg-color)');
        circle.setAttribute('stroke-width', '2.5');
      }

      // GitLens Hover events
      circle.addEventListener('mouseover', () => {
        const lane = node.lane % colors.length;
        graphSvg.setAttribute('class', `hover-active hover-lane-${lane}`);
      });
      circle.addEventListener('mouseout', () => {
        graphSvg.removeAttribute('class');
      });

      graphSvg.appendChild(circle);
    });
  }

  // ── 行展开 & 详情 ────────────────────────

  function handleRowClick(row, hash, parents) {
    if (selectedCommitHash === hash) {
      collapseDetail();
      return;
    }

    // 取消之前选中行的样式，不触发全面面板折叠
    const previouslySelected = commitsTbody.querySelector('tr.commit-row.selected');
    if (previouslySelected) {
      previouslySelected.classList.remove('selected');
    }

    selectedCommitHash = hash;
    saveCurrentState();
    row.classList.add('selected');

    const commit = commits.find(c => c.hash === hash);
    if (!commit) return;

    // 仅在原先处于空状态时，才显示详情框并触发 slideDown 动画
    setRightPane(RightPaneState.COMMIT);

    detailHashBadge.textContent = hash.substring(0, 7);
    detailHashBadge.dataset.fullHash = hash;

    // 动态渲染详情面板的作者信息及头像
    if (detailAuthorName && detailAuthorDate && detailAuthorAvatar) {
      detailAuthorName.textContent = commit.author;
      detailAuthorName.title = commit.email || '';
      detailAuthorDate.textContent = getRelativeTime(commit.timestamp);
      detailAuthorDate.title = formatDate(commit.timestamp);
      
      const initials = getInitials(commit.author);
      detailAuthorAvatar.textContent = initials;
      detailAuthorAvatar.style.backgroundColor = getAvatarColor(commit.author);
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
          let badgeColor = branchColorMap.get(dec) || colors[0];
          let isHead = false;
          const isRemote = remoteBranches.includes(dec) || dec.startsWith('origin/');
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
            ? `background-color: rgba(255,255,255,0.08); color: #fff;`
            : `background-color: ${hexToRgba(badgeColor, 0.15)}; color: ${badgeColor};`;

          const span = document.createElement('span');
          span.className = `ref-badge ${badgeClass}`;
          span.style.cssText = style;
          span.innerHTML = `${iconHtml}${escapeHtml(displayDec)}`;
          branchesContainer.appendChild(span);
        });
      }

      // 补充 lane 推断的分支名（仅当该分支名尚未在 decorations 中出现时）
      const laneBranch = window._commitBranchLabel && window._commitBranchLabel[hash];
      if (laneBranch && laneBranch.name) {
        const alreadyShown = commit.decorations && commit.decorations.includes(laneBranch.name);
        if (!alreadyShown) {
          hasBadges = true;
          branchesContainer.classList.remove('hidden');
          const span = document.createElement('span');
          span.className = 'ref-badge badge-branch';
          span.style.cssText = `background-color: ${hexToRgba(laneBranch.color, 0.15)}; color: ${laneBranch.color};`;
          span.innerHTML = `<i class="codicon codicon-git-branch"></i>${escapeHtml(laneBranch.name)}`;
          branchesContainer.appendChild(span);
        }
      }

      if (!hasBadges) {
        branchesContainer.classList.add('hidden');
      }
    }

    if (commit.parents && commit.parents.length >= 2) {
      detailMergeBadge.classList.remove('hidden');
    } else {
      detailMergeBadge.classList.add('hidden');
    }
    
    // 复制哈希点击事件
    detailHashBadge.onclick = (e) => {
      e.stopPropagation();
      navigator.clipboard.writeText(hash).then(() => {
        detailHashBadge.textContent = '已复制!';
        setTimeout(() => {
          detailHashBadge.textContent = hash.substring(0, 7);
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

    if (detailMsgSubject) {
      detailMsgSubject.textContent = subject;
    }
    if (detailMsgBody) {
      if (body) {
        detailMsgBody.textContent = body;
        detailMsgBody.classList.remove('hidden');
      } else {
        detailMsgBody.classList.add('hidden');
      }
    }

    detailStatsRow.innerHTML = '';
    
    // 立即清空旧文件树，并重置透明度
    detailFilesTree.innerHTML = '';
    detailFilesTree.style.opacity = '1';

    // 设置延迟加载提示定时器，如果 150ms 内获取到结果则不显示 "获取文件列表..."，避免闪烁
    if (window.pendingFileLoadTimeout) {
      clearTimeout(window.pendingFileLoadTimeout);
    }
    window.pendingFileLoadTimeout = setTimeout(() => {
      detailFilesTree.innerHTML = `
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

    const previouslySelected = commitsTbody.querySelector('tr.commit-row.selected');
    if (previouslySelected) {
      previouslySelected.classList.remove('selected');
    }
    selectedCommitHash = null;
    saveCurrentState();

    // Return to overview stats (or loading if no stats yet)
    if (currentStatsData) {
      setRightPane(RightPaneState.OVERVIEW);
    } else {
      setRightPane(RightPaneState.LOADING);
    }
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
          const grandKeys = Object.keys(current._children);
          if (grandKeys.length === 1 && !current._children[grandKeys[0]]._isFile && current._children[grandKeys[0]]._children) {
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
    if (selectedCommitHash !== hash) return;

    if (window.pendingFileLoadTimeout) {
      clearTimeout(window.pendingFileLoadTimeout);
      window.pendingFileLoadTimeout = null;
    }
    detailFilesTree.style.opacity = '1';

    const row = commitsTbody.querySelector(`tr.commit-row[data-hash="${hash}"]`);
    if (!row) return;
    const parents = JSON.parse(row.dataset.parents);
    const parentHash = parents[0] || '';

    if (files.length === 0) {
      detailStatsRow.innerHTML = '';
      detailFilesTree.innerHTML = '<div style="opacity: 0.5; text-align: center; padding: 8px;">无文件变动</div>';
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

    detailStatsRow.innerHTML = statsHtml;

    const commit = commits.find(c => c.hash === hash);
    const commitMessage = commit ? commit.message : '';
    const openAllBtn = detailStatsRow.querySelector('.open-all-changes-btn');
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

    detailFilesTree.innerHTML = treeHTML;

    // 点击文件打开 diff
    detailFilesTree.querySelectorAll('.file-node').forEach(el => {
      el.addEventListener('click', () => {
        vscode.postMessage({
          command: 'openDiff',
          file: el.dataset.path,
          hash: el.dataset.hash,
          parentHash: el.dataset.parentHash
        });
      });

      // 转到当前文件 (openWorkspaceFile)
      const actionBtn = el.querySelector('.action-btn');
      if (actionBtn) {
        actionBtn.addEventListener('click', (e) => {
          e.stopPropagation(); // 阻止触发 openDiff
          vscode.postMessage({
            command: 'openWorkspaceFile',
            file: el.dataset.path,
            hash: el.dataset.hash
          });
        });
      }
    });

    // 文件夹折叠/展开
    detailFilesTree.querySelectorAll('.folder-node').forEach(el => {
      el.addEventListener('click', () => {
        const children = el.nextElementSibling;
        const chevron = el.querySelector('.tree-chevron');
        const folderIcon = el.querySelector('.folder-state-icon');
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
    let row = commitsTbody.querySelector(`tr.commit-row[data-hash="${hash}"]`);
    if (row) {
      row.scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (selectedCommitHash !== row.dataset.hash) {
        row.click();
      }
    } else {
      showLoading();
      const filters = {
        branch: branchSelect.value || undefined,
        author: authorSelect.value || undefined,
        since: sinceDate.value || undefined,
        until: untilDate.value || undefined,
        query: searchInput.value.trim() || undefined
      };
      vscode.postMessage({ command: 'locateCommit', hash, filters });
    }
  }

  // ── 工具函数 ────────────────────────

  function getRelativeTime(timestamp) {
    const now = Math.floor(Date.now() / 1000);
    const diff = now - timestamp;
    if (diff < 60) return '刚刚';
    if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
    if (diff < 2592000) return `${Math.floor(diff / 86400)} 天前`;
    if (diff < 31536000) return `${Math.floor(diff / 2592000)} 个月前`;
    return `${Math.floor(diff / 31536000)} 年前`;
  }

  function formatDate(timestamp) {
    const d = new Date(timestamp * 1000);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}`;
  }

  // 紧凑模式：只显示 MM-DD
  function formatDateShort(timestamp) {
    const d = new Date(timestamp * 1000);
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${month}-${day}`;
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  function getAvatarColor(name) {
    if (!name) return colors[0];
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    const colorIndex = Math.abs(hash) % colors.length;
    return colors[colorIndex];
  }

  function getInitials(name) {
    if (!name) return '';
    name = name.trim();
    const isChinese = /[\u4e00-\u9fa5]/.test(name);
    if (isChinese) {
      return name.length > 2 ? name.substring(name.length - 2) : name;
    }
    const parts = name.split(/\s+/);
    if (parts.length > 1) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  }

  // ── 左右分栏拖拽事件 ────────────────────────
  let isDragging = false;

  resizerBar.addEventListener('mousedown', (e) => {
    isDragging = true;
    resizerBar.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;

    const containerWidth = document.querySelector('.main-layout').clientWidth;
    const detailsWidth = containerWidth - e.clientX;
    
    const minWidth = 280;
    const maxWidth = containerWidth * 0.6;
    
    let finalWidth = Math.max(minWidth, Math.min(maxWidth, detailsWidth));
    detailsPane.style.width = finalWidth + 'px';
  });

  document.addEventListener('mouseup', () => {
    if (isDragging) {
      isDragging = false;
      resizerBar.classList.remove('dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      saveCurrentState();
    }
  });

  window.addEventListener('resize', drawSvg);

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

  function fmtNum(n) {
    if (n === undefined || n === null) return '—';
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
    return String(n);
  }

  function renderStatsStrip(stats) {
    statsStrip.classList.remove('hidden');
    stripCommitsVal.textContent = fmtNum(stats.totalCommits);
    stripAdd.textContent = '+' + fmtNum(stats.totalAdditions);
    stripDel.textContent = '-' + fmtNum(stats.totalDeletions);
    stripContributorsVal.textContent = stats.contributors.length;
    const range = `${stats.sinceDate} ~ ${stats.untilDate}`;
    stripRange.textContent = range;
  }

  function renderOverviewStats(stats) {
    // Range label
    const rangeLabel = `${stats.sinceDate} → ${stats.untilDate}`;
    overviewRange.textContent = rangeLabel;

    // Summary cards
    ovCommits.textContent = fmtNum(stats.totalCommits);
    ovAdd.textContent = '+' + fmtNum(stats.totalAdditions);
    ovDel.textContent = '-' + fmtNum(stats.totalDeletions);

    // Activity SVG chart
    renderActivityChart(stats.dailyActivity);

    // Contributors leaderboard
    contributorsList.innerHTML = '';
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
          <span class="contributor-commits">${c.commits} commits</span>
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
      contributorsList.appendChild(row);
    });

    // Top files
    renderTopFiles(topFilesList, stats.topFiles);
  }

  function renderActivityChart(dailyActivity) {
    activitySvg.innerHTML = '';
    if (!dailyActivity || dailyActivity.length === 0) return;

    const svgW = activitySvg.clientWidth || 300;
    const svgH = 80;
    activitySvg.setAttribute('height', svgH);
    activitySvg.style.height = svgH + 'px';

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
    const gradId = 'activity-grad-' + Math.random().toString(36).slice(2);

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
    activitySvg.appendChild(defs);

    // Area fill
    const area = document.createElementNS(ns, 'path');
    area.setAttribute('d', areaPath);
    area.setAttribute('fill', `url(#${gradId})`);
    area.setAttribute('stroke', 'none');
    activitySvg.appendChild(area);

    // Line
    const line = document.createElementNS(ns, 'path');
    line.setAttribute('d', linePath);
    line.setAttribute('fill', 'none');
    line.setAttribute('stroke', 'var(--accent)');
    line.setAttribute('stroke-width', '1.8');
    line.setAttribute('stroke-linecap', 'round');
    line.setAttribute('stroke-linejoin', 'round');
    activitySvg.appendChild(line);

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
        activitySvg.appendChild(label);
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
    activitySvg.appendChild(hoverGroup);

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
    activitySvg.appendChild(overlay);

    overlay.addEventListener('mousemove', (e) => {
      const rect = activitySvg.getBoundingClientRect();
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
      tooltip.innerHTML = `<span style="opacity:0.6;font-size:10px;">${d.date}</span><br><strong style="color:var(--accent);">${d.count}</strong> 次提交<br><span style="opacity:0.55;font-size:9.5px;">点击筛选此日</span>`;
      // Position tooltip
      const tx = e.clientX + 12;
      const ty = e.clientY - 48;
      tooltip.style.left = tx + 'px';
      tooltip.style.top = ty + 'px';
    });

    overlay.addEventListener('mouseleave', () => {
      hoverGroup.style.opacity = '0';
      tooltip.style.display = 'none';
    });

    // Click a day → set date filter to that single day
    overlay.addEventListener('click', (e) => {
      const rect = activitySvg.getBoundingClientRect();
      const mouseX = e.clientX - rect.left - padLeft;
      const idx = Math.max(0, Math.min(n - 1, Math.round((mouseX / chartW) * (n - 1))));
      const d = dailyActivity[idx];
      if (!d || !d.date) return;

      // Set date preset to custom and fill since/until with the clicked day
      datePresetSelect.value = 'custom';
      dateRangeGroup.classList.remove('hidden');
      sinceDate.value = d.date;
      untilDate.value = d.date;
      adjustSelectWidth(datePresetSelect);

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
    currentFocusedAuthor = contributor.author;
    setRightPane(RightPaneState.AUTHOR);

    const color = getAvatarColor(contributor.author);
    const initials = getInitials(contributor.author);
    authorStatsAvatar.textContent = initials;
    authorStatsAvatar.style.backgroundColor = color;
    authorStatsName.textContent = contributor.author;
    authorStatsEmail.textContent = contributor.email || '';

    auCommits.textContent = fmtNum(contributor.commits);
    auAdd.textContent = '+' + fmtNum(contributor.additions);
    auDel.textContent = '-' + fmtNum(contributor.deletions);

    // Weekday bar chart
    weekdayChart.innerHTML = '';
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
      col.className = 'weekday-col';
      col.innerHTML = `
        <div class="weekday-bar" style="height:${heightPct}%;background-color:${color};opacity:0.65;" title="${orderLabels[i]}: ${count}次"></div>
        <span class="weekday-label">${orderLabels[i]}</span>
      `;
      weekdayChart.appendChild(col);
    });

    // Author top files: use per-author topFiles from contributor data
    authorTopFiles.innerHTML = '';
    if (contributor.topFiles && contributor.topFiles.length > 0) {
      renderTopFiles(authorTopFiles, contributor.topFiles);
    } else if (currentStatsData && currentStatsData.topFiles) {
      // fallback to global if per-author data unavailable
      renderTopFiles(authorTopFiles, currentStatsData.topFiles.slice(0, 5));
    } else {
      authorTopFiles.innerHTML = '<div style="opacity:0.4;font-size:11px;padding:4px 8px;">暂无数据</div>';
    }
  }

  // Back button
  authorBackBtn.addEventListener('click', () => {
    currentFocusedAuthor = null;
    if (currentStatsData) {
      renderOverviewStats(currentStatsData);
      setRightPane(RightPaneState.OVERVIEW);
    } else {
      setRightPane(RightPaneState.LOADING);
    }
  });

  // Stats toggle button — force show overview
  statsToggleBtn.addEventListener('click', () => {
    if (currentStatsData) {
      // Deselect any commit
      const sel = commitsTbody.querySelector('tr.commit-row.selected');
      if (sel) sel.classList.remove('selected');
      selectedCommitHash = null;
      renderOverviewStats(currentStatsData);
      setRightPane(RightPaneState.OVERVIEW);
    }
  });

  // Author highlight button — set author filter in graph
  authorHighlightBtn.addEventListener('click', () => {
    if (!currentFocusedAuthor) return;
    // Check if author is already an option; if not, add it dynamically
    const existingOption = Array.from(authorSelect.options).find(o => o.value === currentFocusedAuthor);
    if (!existingOption) {
      const opt = document.createElement('option');
      opt.value = currentFocusedAuthor;
      opt.textContent = currentFocusedAuthor;
      authorSelect.appendChild(opt);
    }
    authorSelect.value = currentFocusedAuthor;
    adjustSelectWidth(authorSelect);
    reloadData();
  });

  // 作者区域点击：不再拦截跳转作者统计，让事件冒泡到行点击处理器，展示提交详情
  // （作者统计仍可通过右侧 Overview 面板中的贡献者列表访问）

  // ── 响应式断点：监听左侧面板宽度，动态切换 pane-compact / pane-narrow ──
  const leftPaneEl = document.querySelector('.left-pane');
  if (leftPaneEl && window.ResizeObserver) {
    const paneObserver = new ResizeObserver(entries => {
      const w = entries[0].contentRect.width;
      leftPaneEl.classList.toggle('pane-medium',  w < 480);
      leftPaneEl.classList.toggle('pane-compact', w < 320);
      leftPaneEl.classList.toggle('pane-narrow',  w < 220);

      // 动态更新搜索框 placeholder 文字
      if (searchInput) {
        if (w < 320) {
          searchInput.placeholder = '搜索…';
        } else if (w < 480) {
          searchInput.placeholder = '搜索';
        } else {
          searchInput.placeholder = '搜索消息或哈希';
        }
      }
    });
    paneObserver.observe(leftPaneEl);
  }

  // ── 窄屏 Overlay 模式：监听整体 main-layout 宽度 ──
  const mainLayoutEl = document.querySelector('.main-layout');
  const overlayBackdrop = document.getElementById('overlay-backdrop');
  const overlayCloseBtn = document.getElementById('overlay-close-btn');
  const OVERLAY_BREAKPOINT = 550;
  let isOverlayMode = false;

  function openOverlay() {
    detailsPane.classList.add('overlay-open');
    overlayBackdrop.classList.add('visible');
  }

  function closeOverlay() {
    detailsPane.classList.remove('overlay-open');
    overlayBackdrop.classList.remove('visible');
  }

  if (overlayBackdrop) {
    overlayBackdrop.addEventListener('click', closeOverlay);
  }
  if (overlayCloseBtn) {
    overlayCloseBtn.addEventListener('click', closeOverlay);
  }

  // 原始的 setRightPane 逻辑：在 overlay 模式下，自动打开面板
  const _origSetRightPane = setRightPane;
  // 重新包装 setRightPane：在窄屏时选中提交或切换到 OVERVIEW/AUTHOR 时自动打开 overlay
  function setRightPaneWithOverlay(state) {
    _origSetRightPane(state);
    if (isOverlayMode && state !== RightPaneState.LOADING) {
      openOverlay();
    }
  }
  // 替换全局引用（仅对后续调用有效）
  // 由于 JS 闭包，这里改为直接在 ResizeObserver 回调中打 patch
  if (mainLayoutEl && window.ResizeObserver) {
    const layoutObserver = new ResizeObserver(entries => {
      const w = entries[0].contentRect.width;
      const shouldBeNarrow = w < OVERLAY_BREAKPOINT;
      if (shouldBeNarrow === isOverlayMode) return;
      isOverlayMode = shouldBeNarrow;
      mainLayoutEl.classList.toggle('layout-narrow', isOverlayMode);
      if (!isOverlayMode) {
        // 退出 overlay 模式时，确保面板可见（重置 transform）
        closeOverlay();
        detailsPane.style.width = '';
      } else {
        // 进入 overlay 模式时，如果当前有内容则保持打开
        closeOverlay();
      }
    });
    layoutObserver.observe(mainLayoutEl);
  }

  // 在 overlay 模式下，点击提交行 → 打开面板
  commitsTbody.addEventListener('click', () => {
    if (isOverlayMode) {
      // 延迟一帧等待右侧面板内容更新
      requestAnimationFrame(openOverlay);
    }
  });

  // stats toggle btn 在 overlay 模式下 → 打开 overlay
  const _origStatsToggleHandler = statsToggleBtn.onclick;
  statsToggleBtn.addEventListener('click', () => {
    if (isOverlayMode && currentStatsData) {
      requestAnimationFrame(openOverlay);
    }
  });
})();
