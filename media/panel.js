(function() {
  const vscode = acquireVsCodeApi();

  // Elements
  const branchSelect = document.getElementById('branch-select');
  const authorSelect = document.getElementById('author-select');
  const sinceDate = document.getElementById('since-date');
  const untilDate = document.getElementById('until-date');
  const searchInput = document.getElementById('search-input');
  const resetBtn = document.getElementById('reset-btn');
  const loadingOverlay = document.getElementById('loading');
  const errorBanner = document.getElementById('error-message');
  const commitsTbody = document.getElementById('commits-tbody');
  const graphSvg = document.getElementById('graph-svg');
  const tableContainer = document.querySelector('.table-container');

  // State
  let commits = [];
  let branches = [];
  let authors = [];
  let selectedCommitHash = null;
  let expandedRow = null;
  let currentGraphWidth = 120;

  // Pagination State
  let isFetching = false;
  let hasMoreCommits = true;
  let currentPage = 0;
  const pageSize = 150;

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
  const rowHeight = 24;
  const laneWidth = 12;
  const paddingLeft = 16;
  const colors = [
    '#10b981', // emerald
    '#6366f1', // indigo
    '#f59e0b', // amber
    '#3b82f6', // blue
    '#ec4899', // pink
    '#8b5cf6', // violet
    '#14b8a6', // teal
    '#ef4444', // red
    '#06b6d4', // cyan
    '#84cc16', // lime
    '#f97316', // orange
    '#a855f7'  // purple
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

  function reloadData() {
    currentPage = 0;
    hasMoreCommits = true;
    commits = [];
    isFetching = true;
    showLoading();
    errorBanner.classList.add('hidden');
    
    const filters = {
      branch: branchSelect.value || undefined,
      author: authorSelect.value || undefined,
      since: sinceDate.value || undefined,
      until: untilDate.value || undefined,
      query: searchInput.value.trim() || undefined
    };

    vscode.postMessage({ command: 'loadData', filters, page: 0 });
  }

  function loadNextPage() {
    if (isFetching || !hasMoreCommits) return;
    isFetching = true;
    
    const filters = {
      branch: branchSelect.value || undefined,
      author: authorSelect.value || undefined,
      since: sinceDate.value || undefined,
      until: untilDate.value || undefined,
      query: searchInput.value.trim() || undefined
    };

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

  // 初始加载
  reloadData();

  // 过滤器监听
  branchSelect.addEventListener('change', reloadData);
  authorSelect.addEventListener('change', reloadData);
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
    sinceDate.value = '';
    untilDate.value = '';
    searchInput.value = '';
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
        authors = message.authors;
        
        updateFilterControls();
        renderTableAndGraph();
        break;
      case 'commitDetail':
        renderCommitDetail(message.hash, message.files);
        break;
      case 'focusCommit':
        focusAndHighlightCommit(message.hash);
        break;
    }
  });

  function showError(msg) {
    errorBanner.textContent = msg;
    errorBanner.classList.remove('hidden');
  }

  // ── 过滤控件填充 ────────────────────────

  function updateFilterControls() {
    const currentBranchValue = branchSelect.value;
    branchSelect.innerHTML = '<option value="">所有分支</option>';
    branches.forEach(b => {
      const option = document.createElement('option');
      option.value = b;
      option.textContent = b;
      if (b === currentBranchValue) option.selected = true;
      branchSelect.appendChild(option);
    });

    const currentAuthorValue = authorSelect.value;
    authorSelect.innerHTML = '<option value="">所有作者</option>';
    authors.forEach(a => {
      const option = document.createElement('option');
      option.value = a;
      option.textContent = a;
      if (a === currentAuthorValue) option.selected = true;
      authorSelect.appendChild(option);
    });
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

    // 分支名 -> 颜色映射（用于 badge 上色）
    const branchColorMap = new Map();

    for (let r = 0; r < commits.length; r++) {
      const c = commits[r];
      const hash = c.hash;
      const parents = c.parents;
      const isMerge = parents.length >= 2;

      // 找到或分配 lane
      let laneIdx = lanes.indexOf(hash);
      if (laneIdx === -1) {
        laneIdx = lanes.indexOf(null);
        if (laneIdx === -1) {
          laneIdx = lanes.length;
          lanes.push(hash);
        } else {
          lanes[laneIdx] = hash;
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
            lanes[laneIdx] = p0;
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
              // 不复用已占用的 slot，防重叠
              let emptySlot = -1;
              for (let s = 0; s < lanes.length; s++) {
                if (lanes[s] === null && s !== laneIdx) {
                  emptySlot = s;
                  break;
                }
              }
              if (emptySlot === -1) {
                pkTargetLaneIdx = lanes.length;
                lanes.push(pk);
              } else {
                pkTargetLaneIdx = emptySlot;
                lanes[emptySlot] = pk;
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

        const relTime = getRelativeTime(c.timestamp);
        const absTime = formatDate(c.timestamp);

        // 分支 decorations HTML（颜色与 lane 同步）
        let decsHtml = '';
        if (c.decorations && c.decorations.length > 0) {
          c.decorations.forEach(dec => {
            let badgeClass = 'badge-branch';
            let iconHtml = '<i class="codicon codicon-git-branch"></i>';
            let badgeColor = branchColorMap.get(dec) || colors[0];
            let isHead = false;

            if (dec.startsWith('tag: ')) {
              badgeClass = 'badge-tag';
              iconHtml = '<i class="codicon codicon-tag"></i>';
              dec = dec.substring(5);
              badgeColor = '#f59e0b';
            } else if (dec.startsWith('origin/')) {
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

            decsHtml += `<span class="ref-badge ${badgeClass}" style="${style}">${iconHtml}${escapeHtml(dec)}</span>`;
          });
        }

        tr.innerHTML = `
          <td class="graph-col" style="width: ${computedGraphWidth}px; min-width: ${computedGraphWidth}px;"></td>
          <td class="message-col" title="${escapeHtml(c.message)}">
            ${decsHtml}
            <span>${escapeHtml(c.message)}</span>
          </td>
          <td class="author-col" title="${escapeHtml(c.author)}">${escapeHtml(c.author)}</td>
          <td class="date-col"><span class="relative-time" title="${absTime}">${relTime}</span></td>
          <td class="hash-col"><span class="hash-copyable" data-full-hash="${c.hash}">${c.hash.substring(0, 7)}</span></td>
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
      }
    }

    // SVG 尺寸
    graphSvg.style.width = computedGraphWidth + 'px';
    graphSvg.style.height = (commits.length * rowHeight) + 'px';

    // ─── 3. 渲染 SVG 连线 ─────────

    lines.forEach(line => {
      const x1 = paddingLeft + line.fromLane * laneWidth;
      const y1 = line.fromRow * rowHeight + rowHeight / 2;
      const x2 = paddingLeft + line.toLane * laneWidth;
      const y2 = line.toRow * rowHeight + rowHeight / 2;
      const color = colors[line.colorIdx % colors.length];

      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      
      if (line.fromLane === line.toLane) {
        if (line.fade) {
          path.setAttribute('d', `M ${x1} ${y1} L ${x1} ${y1 + rowHeight / 2}`);
          path.setAttribute('stroke-dasharray', '2,2');
          path.setAttribute('opacity', '0.4');
        } else {
          path.setAttribute('d', `M ${x1} ${y1} L ${x2} ${y2}`);
        }
      } else {
        if (line.fade) {
          const controlY = y1 + rowHeight / 4;
          const targetY = y1 + rowHeight / 2;
          path.setAttribute('d', `M ${x1} ${y1} C ${x1} ${controlY}, ${x2} ${controlY}, ${x2} ${targetY}`);
          path.setAttribute('stroke-dasharray', '2,2');
          path.setAttribute('opacity', '0.4');
        } else {
          const controlY = y1 + rowHeight / 2;
          path.setAttribute('d', `M ${x1} ${y1} C ${x1} ${controlY}, ${x2} ${(y2 - rowHeight / 2)}, ${x2} ${y2}`);
        }
      }
      
      path.setAttribute('stroke', color);
      path.setAttribute('stroke-width', '1.5');
      path.setAttribute('fill', 'none');
      graphSvg.appendChild(path);
    });

    // ─── 4. 渲染 SVG 节点 ─────────

    commits.forEach((c, r) => {
      const node = commitNodes[c.hash];
      if (!node) return;
      const x = paddingLeft + node.lane * laneWidth;
      const y = r * rowHeight + rowHeight / 2;
      const color = colors[node.lane % colors.length];

      if (node.isMerge) {
        // 合并节点：菱形标志
        const size = 4;
        const diamond = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        diamond.setAttribute('points',
          `${x},${y - size} ${x + size},${y} ${x},${y + size} ${x - size},${y}`
        );
        diamond.setAttribute('fill', color);
        diamond.setAttribute('stroke', 'var(--bg-color)');
        diamond.setAttribute('stroke-width', '1.5');
        graphSvg.appendChild(diamond);
      } else {
        // 普通节点：圆形
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', x);
        circle.setAttribute('cy', y);
        circle.setAttribute('r', '3');
        circle.setAttribute('fill', color);
        circle.setAttribute('stroke', 'var(--bg-color)');
        circle.setAttribute('stroke-width', '1.5');
        graphSvg.appendChild(circle);
      }
    });
  }

  // ── 行展开 & 详情 ────────────────────────

  function handleRowClick(row, hash, parents) {
    if (selectedCommitHash === hash) {
      collapseDetail();
      return;
    }

    collapseDetail();

    selectedCommitHash = hash;
    row.classList.add('selected');

    const detailTr = document.createElement('tr');
    detailTr.className = 'detail-row';
    
    const graphTd = document.createElement('td');
    graphTd.className = 'graph-col';
    graphTd.style.width = currentGraphWidth + 'px';
    graphTd.style.minWidth = currentGraphWidth + 'px';
    detailTr.appendChild(graphTd);

    const td = document.createElement('td');
    td.colSpan = 4;
    td.innerHTML = `
      <div class="detail-container">
        <div style="display: flex; align-items: center; gap: 8px; padding: 4px 0;">
          <div class="spinner" style="width:14px; height:14px; border-width: 2px;"></div>
          <span style="opacity: 0.5; font-size: 11px;">获取文件列表...</span>
        </div>
      </div>
    `;
    detailTr.appendChild(td);
    
    row.parentNode.insertBefore(detailTr, row.nextSibling);
    expandedRow = detailTr;

    vscode.postMessage({ command: 'getCommitDetail', hash });
  }

  function collapseDetail() {
    if (expandedRow) {
      expandedRow.parentNode.removeChild(expandedRow);
      expandedRow = null;
    }
    const previouslySelected = commitsTbody.querySelector('tr.commit-row.selected');
    if (previouslySelected) {
      previouslySelected.classList.remove('selected');
    }
    selectedCommitHash = null;
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
    if (selectedCommitHash !== hash || !expandedRow) return;

    const container = expandedRow.querySelector('.detail-container');
    
    if (files.length === 0) {
      container.innerHTML = '<div style="opacity: 0.5; text-align: center; padding: 8px;">无文件变动</div>';
      return;
    }

    const parents = JSON.parse(commitsTbody.querySelector(`tr.commit-row[data-hash="${hash}"]`).dataset.parents);
    const parentHash = parents[0] || '';

    // 文件变动统计
    const stats = { A: 0, M: 0, D: 0, R: 0 };
    files.forEach(f => { stats[f.status] = (stats[f.status] || 0) + 1; });

    let statsHtml = '<div class="detail-stats">';
    if (stats.A) statsHtml += `<span class="stat-add">+${stats.A} 新增</span>`;
    if (stats.M) statsHtml += `<span class="stat-modify">~${stats.M} 修改</span>`;
    if (stats.D) statsHtml += `<span class="stat-delete">-${stats.D} 删除</span>`;
    if (stats.R) statsHtml += `<span class="stat-rename">↻${stats.R} 重命名</span>`;
    statsHtml += '</div>';

    const fileTree = buildFileTree(files);
    const treeHTML = renderFileTreeHTML(fileTree, 0, hash, parentHash);

    container.innerHTML = `
      <div class="detail-header">
        <i class="codicon codicon-files"></i>
        <span>改动文件 (${files.length})</span>
        ${statsHtml}
      </div>
      <div class="file-list">
        ${treeHTML}
      </div>
    `;

    // 点击文件打开 diff
    container.querySelectorAll('.file-node').forEach(el => {
      el.addEventListener('click', () => {
        vscode.postMessage({
          command: 'openDiff',
          file: el.dataset.path,
          hash: el.dataset.hash,
          parentHash: el.dataset.parentHash
        });
      });
    });

    // 文件夹折叠/展开
    container.querySelectorAll('.folder-node').forEach(el => {
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
      showError(`在当前视图中未找到提交: ${hash.substring(0, 7)}`);
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
})();
