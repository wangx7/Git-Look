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
  const detailsPane = document.querySelector('.details-pane');
  const resizerBar = document.getElementById('resizer-bar');
  const detailsPlaceholder = document.querySelector('.details-placeholder');
  const detailsContent = document.querySelector('.details-content');
  const detailHashBadge = document.getElementById('detail-hash-badge');
  const detailMergeBadge = document.getElementById('detail-merge-badge');
  const detailAuthorAvatar = document.getElementById('detail-author-avatar');
  const detailAuthorName = document.getElementById('detail-author-name');
  const detailAuthorDate = document.getElementById('detail-author-date');
  const detailMsgSubject = document.getElementById('detail-msg-subject');
  const detailMsgBody = document.getElementById('detail-msg-body');
  const detailStatsRow = document.getElementById('detail-stats-row');
  const detailFilesTree = document.getElementById('detail-files-tree');

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
      detailsWidth: detailsPane.style.width
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
  const rowHeight = 28;
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
    isFetching = true;
    showLoading();
    errorBanner.classList.add('hidden');
    
    const filters = getFilters();

    vscode.postMessage({ command: 'loadData', filters, page: 0 });
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
      vscode.postMessage({ command: 'getCommitDetail', hash: selectedCommitHash });
    }
    vscode.postMessage({ command: 'initWatcher' });
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
    searchTimeout = setTimeout(reloadData, 350);
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
          let row = commitsTbody.querySelector(`tr.commit-row[data-hash^="${message.hash.substring(0, 7)}"]`);
          if (row) {
            row.scrollIntoView({ behavior: 'smooth', block: 'center' });
            if (selectedCommitHash !== row.dataset.hash) {
              row.click();
            }
          }
        }, 100);
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

    // ─── 1. 图表 Lane 分配算法（防重叠） ─────────

    const commitHashes = new Set(commits.map(c => c.hash));
    const lanes = [];         // lanes[i] = hash 占用该 lane 的 commit
    const commitNodes = {};   // hash -> { row, lane }
    const lines = [];         // 连线数据
    let maxLanes = 0;

    // 找出主干提交，强行绑定在 Lane 0 (主轴)
    const mainTrunk = new Set();
    const headCommit = commits.find(c => c.decorations && c.decorations.includes('HEAD'));
    let curr = headCommit ? headCommit.hash : (commits[0] ? commits[0].hash : null);
    while (curr) {
      mainTrunk.add(curr);
      const c = commits.find(x => x.hash === curr);
      curr = (c && c.parents && c.parents.length > 0) ? c.parents[0] : null;
    }

    // 分支名 -> 颜色映射（用于 badge 上色）
    branchColorMap.clear();

    for (let r = 0; r < commits.length; r++) {
      const c = commits[r];
      const hash = c.hash;
      const parents = c.parents;
      const isMerge = parents.length >= 2;

      // 找到或分配 lane
      let laneIdx = lanes.indexOf(hash);
      if (laneIdx === -1) {
        if (mainTrunk.has(hash)) {
          laneIdx = 0;
          if (lanes.length === 0) {
            lanes.push(hash);
          } else {
            lanes[0] = hash;
          }
        } else {
          // Search empty slot starting from lane 1 (reserve lane 0 for main trunk)
          let emptySlot = -1;
          for (let s = 1; s < lanes.length; s++) {
            if (lanes[s] === null) {
              emptySlot = s;
              break;
            }
          }
          if (emptySlot !== -1) {
            laneIdx = emptySlot;
            lanes[laneIdx] = hash;
          } else {
            // Allocate new lane
            if (lanes.length === 0) {
              lanes.push(null); // Lane 0 reserved
              lanes.push(hash); // Lane 1
              laneIdx = 1;
            } else {
              laneIdx = lanes.length;
              lanes.push(hash);
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
      lanes[laneIdx] = null;

      // 处理父节点
      if (parents.length > 0) {
        // 主父节点
        const p0 = parents[0];
        if (commitHashes.has(p0)) {
          const p0LaneIdx = lanes.indexOf(p0);
          let targetLaneIdx = laneIdx;
          
          if (p0LaneIdx !== -1) {
            targetLaneIdx = p0LaneIdx;
          } else {
            if (mainTrunk.has(p0)) {
              if (lanes[0] === null) {
                lanes[0] = p0;
              }
              targetLaneIdx = 0;
            } else {
              lanes[laneIdx] = p0;
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
            const pkLaneIdx = lanes.indexOf(pk);
            let pkTargetLaneIdx = pkLaneIdx;

            if (pkLaneIdx === -1) {
              if (mainTrunk.has(pk)) {
                pkTargetLaneIdx = 0;
                if (lanes[0] === null) {
                  lanes[0] = pk;
                }
              } else {
                // 不复用已占用的 slot，防重叠 (从 lane 1 开始找)
                let emptySlot = -1;
                for (let s = 1; s < lanes.length; s++) {
                  if (lanes[s] === null && s !== laneIdx) {
                    emptySlot = s;
                    break;
                  }
                }
                if (emptySlot === -1) {
                  pkTargetLaneIdx = lanes.length === 0 ? 1 : lanes.length;
                  while (lanes.length < pkTargetLaneIdx) lanes.push(null);
                  lanes.push(pk);
                } else {
                  pkTargetLaneIdx = emptySlot;
                  lanes[emptySlot] = pk;
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
          const nextLaneIdx = lanes.indexOf(h);
          if (nextLaneIdx !== -1) {
            lines.push({
              fromRow: r, fromLane: j,
              toRow: r + 1, toLane: nextLaneIdx,
              colorIdx: j
            });
          }
        }
      }

      // 清理尾部空 lanes
      while (lanes.length > 0 && lanes[lanes.length - 1] === null) {
        lanes.pop();
      }
      maxLanes = Math.max(maxLanes, lanes.length);
    }

    cachedLines = lines;
    cachedCommitNodes = commitNodes;

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
          const firstDec = c.decorations[0];
          
          const makeBadge = (dec) => {
            let badgeClass = 'badge-branch';
            let iconHtml = '<i class="codicon codicon-git-branch"></i>';
            let badgeColor = branchColorMap.get(dec) || colors[0];
            let isHead = false;
            const isRemote = remoteBranches.includes(dec) || dec.startsWith('origin/');

            if (dec.startsWith('tag: ')) {
              badgeClass = 'badge-tag';
              iconHtml = '<i class="codicon codicon-tag"></i>';
              dec = dec.substring(5);
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

            return `<span class="ref-badge ${badgeClass}" style="${style}">${iconHtml}${escapeHtml(dec)}</span>`;
          };

          decsHtml += makeBadge(firstDec);

          if (c.decorations.length > 1) {
            decsHtml += `<span class="ref-badge" style="background-color: rgba(255,255,255,0.06); color: var(--desc-fg); border: 1px solid var(--border-color); cursor: default;" title="还有 ${c.decorations.length - 1} 个分支在详情中展示">+${c.decorations.length - 1}</span>`;
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
                <span class="commit-author" title="${escapeHtml(c.author)}">
                  ${authorAvatarHtml}
                  <span style="vertical-align: middle;">${escapeHtml(c.author)}</span>
                </span>
                <span class="commit-date" title="${relTime}">${absTime}</span>
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
    if (detailsContent.classList.contains('hidden')) {
      detailsPane.classList.remove('empty');
      detailsPlaceholder.classList.add('hidden');
      detailsContent.classList.remove('hidden');
    }

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
      if (commit.decorations && commit.decorations.length > 0) {
        branchesContainer.classList.remove('hidden');
        commit.decorations.forEach(dec => {
          let badgeClass = 'badge-branch';
          let iconHtml = '<i class="codicon codicon-git-branch"></i>';
          let badgeColor = branchColorMap.get(dec) || colors[0];
          let isHead = false;
          const isRemote = remoteBranches.includes(dec) || dec.startsWith('origin/');

          if (dec.startsWith('tag: ')) {
            badgeClass = 'badge-tag';
            iconHtml = '<i class="codicon codicon-tag"></i>';
            dec = dec.substring(5);
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
          span.innerHTML = `${iconHtml}${escapeHtml(dec)}`;
          branchesContainer.appendChild(span);
        });
      } else {
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

    detailsPane.classList.add('empty');
    detailsPlaceholder.classList.remove('hidden');
    detailsContent.classList.add('hidden');
    detailMergeBadge.classList.add('hidden');
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
    let row = commitsTbody.querySelector(`tr.commit-row[data-hash^="${hash.substring(0, 7)}"]`);
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
})();
