import { state } from './state';
import { elements } from './dom';
import { colors, formatDate, formatCommitDate, escapeHtml, hexToRgba } from './utils/format';
import { constants } from './constants';
import { drawSvg, selectCircleInGraph, highlightLane, clearLaneHighlight } from './svgRenderer';
import { renderInlineBadges } from './badgeRenderer';

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
}

export function renderVisibleRows(startIndex, endIndex) {
  const fragment = document.createDocumentFragment();

  function createSpacer(className: string, height: number): HTMLTableRowElement {
    const spacer = document.createElement('tr');
    spacer.className = className;
    spacer.style.height = `${height}px`;
    const td1 = document.createElement('td');
    td1.className = 'graph-col';
    td1.style.cssText = `width:${state.currentGraphWidth}px;min-width:${state.currentGraphWidth}px;height:${height}px;padding:0;border:none;`;
    const td2 = document.createElement('td');
    td2.className = 'content-col';
    td2.style.cssText = `height:${height}px;padding:0;border:none;`;
    spacer.appendChild(td1);
    spacer.appendChild(td2);
    return spacer;
  }

  // Top Spacer
  if (startIndex > 0) {
    fragment.appendChild(createSpacer('virtual-spacer-top', startIndex * rowHeight));
  }

  const rowMaxLanes = window.rowMaxLanes || [];

  // Render Rows in viewport
  for (let r = startIndex; r <= endIndex; r++) {
    const c = state.commits[r];
    if (!c) continue;
    const tr = document.createElement('tr');
    tr.className = 'commit-row';
    if (c.hash === '*working-tree*') {
      tr.className += ' working-tree-row';
    }
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

    const absTime = formatDate(c.timestamp);
    const commitDate = formatCommitDate(c.timestamp);
    const decsHtml = renderInlineBadges(c);

    tr.innerHTML = `
        <td class="graph-col" style="width: ${state.currentGraphWidth}px; min-width: ${state.currentGraphWidth}px;"></td>
        <td class="content-col">
          <div class="row-content">
            <span class="commit-message" title="${escapeHtml(c.message)}">${escapeHtml(c.message)}</span>
            ${decsHtml ? `<span class="commit-badges">${decsHtml}</span>` : ''}
            <span class="commit-author-inline" title="${escapeHtml(c.author)}">${escapeHtml(c.author)}</span>
            <span class="commit-date-inline" title="${absTime}">${commitDate}</span>
          </div>
        </td>
      `;

    tr.addEventListener('mouseenter', () => {
      const node = state.cachedCommitNodes[c.hash];
      if (node) {
        highlightLane(node.colorIdx);
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
      clearLaneHighlight();
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
    fragment.appendChild(createSpacer('virtual-spacer-bottom', (state.commits.length - 1 - endIndex) * rowHeight));
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

