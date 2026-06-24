import { state } from './state';
import { elements } from './dom';
import { colors, getRelativeTime, formatDate, escapeHtml, hexToRgba, getAvatarColor, getInitials, fmtNum } from './utils/format';
import { RightPaneState } from './types';
import { getFileIconInfo } from './utils/fileIcons';
import { constants } from './constants';
import { setRightPane, setRightPaneVisible, ensureDetailsExpanded } from './rightPane';
import { requestStats, hideLoading, showLoading } from './dataLoader';

import { selectCircleInGraph, drawSvg } from './svgRenderer';
import { saveCurrentState } from './dataLoader';
import { getFilters } from './filters';

let requestVirtualListUpdate: (() => void) | null = null;

export function onRequestVirtualListUpdate(callback: () => void) {
  requestVirtualListUpdate = callback;
}

const rowHeight = constants.rowHeight;

export function handleRowClick(row, hash, parents) {
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

  window.vscode.postMessage({ command: 'getCommitDetail', hash });
}

export function collapseDetail() {
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

export function renderCommitDetail(hash, files) {
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
      window.vscode.postMessage({
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
      window.vscode.postMessage({
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
        window.vscode.postMessage({
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

export function buildFileTree(files) {
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

export function compressTree(node) {
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

export function renderFileTreeHTML(node, depth, hash, parentHash) {
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

export function focusAndHighlightCommit(hash) {
  const index = state.commits.findIndex(c => c.hash === hash);
  if (index !== -1) {
    const targetScrollTop = index * rowHeight - elements.tableContainer.clientHeight / 2 + rowHeight / 2;
    elements.tableContainer.scrollTop = Math.max(0, targetScrollTop);
    if (requestVirtualListUpdate) {
      requestVirtualListUpdate();
    }
    let row = elements.commitsTbody.querySelector(`tr.commit-row[data-hash="${hash}"]`);
    if (row) {
      if (state.selectedCommitHash !== (row as HTMLElement).dataset.hash) {
        (row as HTMLElement).click();
      }
    }
  } else {
    showLoading();
    // Use getFilters() so date presets (24h, 7d) are converted to real dates
    window.vscode.postMessage({ command: 'locateCommit', hash, filters: getFilters() });
  }
}

