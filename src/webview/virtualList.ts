import { state } from './state';
import { elements } from './dom';
import { colors, getRelativeTime, formatDate, escapeHtml, hexToRgba } from './utils/format';
import { constants } from './constants';
import { drawSvg, selectCircleInGraph } from './svgRenderer';

const rowHeight = constants.rowHeight;

export function updateVirtualList() {
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

export function renderVisibleRows(startIndex, endIndex) {
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

