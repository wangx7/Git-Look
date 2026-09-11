import { state } from './state';
import { escapeHtml, formatDate, getRelativeTime, getAvatarGradient, getInitials } from './utils/format';
import { makeBadgeHtml } from './badgeRenderer';

let popoverEl: HTMLElement | null = null;
let hoverTimer: any = null;
let popoverHideTimer: any = null;
let currentHoverHash: string | null = null;
let popoverPointerInside = false;
let currentAnchorX = 0;
let currentAnchorY = 0;
let currentTooltipFiles: any[] | null = null;
const HOVER_DELAY_MS = 320;
const POPOVER_HIDE_DELAY_MS = 380;

function getOrCreatePopover(): HTMLElement {
  if (!popoverEl) {
    popoverEl = document.createElement('div');
    popoverEl.id = 'commit-hover-popover';
    popoverEl.className = 'commit-hover-popover';
    if (popoverEl.addEventListener) {
      popoverEl.addEventListener('mouseenter', () => {
        popoverPointerInside = true;
        if (popoverHideTimer) {
          clearTimeout(popoverHideTimer);
          popoverHideTimer = null;
        }
      });
      popoverEl.addEventListener('mouseleave', () => {
        popoverPointerInside = false;
        schedulePopoverHide();
      });
    }
    document.body.appendChild(popoverEl);
  }
  return popoverEl;
}

export function _resetPopoverForTest(): void {
  popoverEl = null;
  hoverTimer = null;
  popoverHideTimer = null;
  currentHoverHash = null;
  popoverPointerInside = false;
  currentAnchorX = 0;
  currentAnchorY = 0;
  currentTooltipFiles = null;
}

function schedulePopoverHide(): void {
  if (popoverHideTimer) clearTimeout(popoverHideTimer);
  popoverHideTimer = setTimeout(() => {
    popoverHideTimer = null;
    if (!popoverPointerInside) hideCommitTooltip();
  }, POPOVER_HIDE_DELAY_MS);
}

export function hideCommitTooltip(): void {
  if (hoverTimer) {
    clearTimeout(hoverTimer);
    hoverTimer = null;
  }
  if (popoverHideTimer) {
    clearTimeout(popoverHideTimer);
    popoverHideTimer = null;
  }
  currentHoverHash = null;
  if (popoverEl) {
    popoverEl.classList.remove('visible');
  }
}

function positionPopover(anchorX: number, anchorY: number): void {
  if (!popoverEl) return;
  const rect = popoverEl.getBoundingClientRect();
  const winWidth = window.innerWidth;
  const winHeight = window.innerHeight;

  let left = anchorX + 4;
  let top = anchorY + 4;
  if (left + rect.width > winWidth - 8) left = winWidth - rect.width - 8;
  if (left < 8) left = 8;
  if (top + rect.height > winHeight - 8) top = Math.max(8, anchorY - rect.height - 4);

  popoverEl.style.left = `${left}px`;
  popoverEl.style.top = `${top}px`;
}

function renderTooltipStats(files: any[] | null): void {
  if (!popoverEl) return;
  const toolbar = popoverEl.querySelector('.commit-hover-stats') as HTMLElement | null;
  if (!toolbar) return;
  if (!files) {
    toolbar.innerHTML = '<span class="commit-hover-stats-loading">加载变更统计...</span>';
    return;
  }
  currentTooltipFiles = files;

  let additions = 0;
  let deletions = 0;
  files.forEach(file => {
    additions += Number(file.additions) || 0;
    deletions += Number(file.deletions) || 0;
  });
  const hash = currentHoverHash;
  const commit = state.commits.find(c => c.hash === hash);
  const parentHash = commit?.parents?.[0] || '';
  const viewMode = state.commitDetailViewMode || 'tree';
  toolbar.innerHTML = `
    <div class="details-stats-toolbar">
      <div class="stats-left">
        <span class="stat-pill stat-pill-files" title="已更改 ${files.length} 个文件"><i class="codicon codicon-files"></i><span class="stats-count-badge">${files.length}</span></span>
        ${additions > 0 ? `<span class="stat-pill stat-pill-add">+${additions.toLocaleString()}</span>` : ''}
        ${deletions > 0 ? `<span class="stat-pill stat-pill-del">-${deletions.toLocaleString()}</span>` : ''}
      </div>
      <div class="stats-right-actions">
        <button class="toggle-view-mode-btn compact-btn" title="${viewMode === 'tree' ? '切换为列表视图' : '切换为树状视图'}"><i class="codicon ${viewMode === 'tree' ? 'codicon-list-flat' : 'codicon-list-tree'}"></i></button>
        <button class="open-all-changes-btn compact-btn" title="打开当前提交的所有文件更改对比"><i class="codicon codicon-diff"></i></button>
      </div>
    </div>
  `;

  toolbar.querySelector('.open-all-changes-btn')?.addEventListener('click', (event) => {
    event.stopPropagation();
    window.vscode?.postMessage({ command: 'openAllDiffs', hash, files, parentHash, message: commit?.message || '' });
  });
  toolbar.querySelector('.toggle-view-mode-btn')?.addEventListener('click', (event) => {
    event.stopPropagation();
    state.commitDetailViewMode = state.commitDetailViewMode === 'tree' ? 'list' : 'tree';
    // Update the popover immediately; the right pane can sync asynchronously.
    renderTooltipStats(currentTooltipFiles);
    window.dispatchEvent?.(new CustomEvent('commitTooltipViewToggle', { detail: { hash } }));
    window.vscode?.postMessage({ command: 'focusCommit', hash });
  });
  positionPopover(currentAnchorX, currentAnchorY);
}

export function renderCommitTooltipFiles(hash: string, files: any[]): void {
  if (currentHoverHash !== hash) return;
  renderTooltipStats(files);
}

export function showCommitTooltip(commit: any, anchorX: number, anchorY: number): void {
  const popover = getOrCreatePopover();
  currentAnchorX = anchorX;
  currentAnchorY = anchorY;
  const avatarGradient = getAvatarGradient(commit.author);
  const isWorkingTree = commit.hash === '*working-tree*';
  const initials = isWorkingTree ? 'WIP' : getInitials(commit.author);
  const shortHash = isWorkingTree ? '工作区' : (commit.hash ? commit.hash.substring(0, 7) : '');
  const dateStr = formatDate(commit.timestamp);
  const relTime = getRelativeTime(commit.timestamp);
  const badgesHtml = (commit.decorations || []).map((d: string) => makeBadgeHtml(d)).join('');
  const message = commit.message || '';
  const firstLineEnd = message.indexOf('\n');
  const subject = firstLineEnd === -1 ? message : message.substring(0, firstLineEnd);
  const body = firstLineEnd === -1 ? '' : message.substring(firstLineEnd + 1).trim();

  popover.innerHTML = `
    <div class="commit-info-card">
      <div class="commit-info-author-row">
        <span class="detail-author-info-compact">
          <span class="avatar-circle detail-author-avatar" style="background: ${isWorkingTree ? 'var(--vscode-charts-yellow, #eab308)' : avatarGradient};">${escapeHtml(initials)}</span>
          <span class="detail-author-text">
            <span class="detail-author-name" title="${escapeHtml(isWorkingTree ? '尚未提交的内容' : (commit.email || ''))}">${escapeHtml(isWorkingTree ? '本地工作区' : commit.author)}</span>
            <span class="detail-author-date" title="${isWorkingTree ? '当前最新' : relTime}">${dateStr}</span>
          </span>
        </span>
        <div class="commit-info-badges">
          ${commit.parents && commit.parents.length >= 2 ? '<span class="ref-badge badge-merge">合并</span>' : ''}
          <span class="detail-hash-copyable">${escapeHtml(shortHash)}</span>
        </div>
      </div>
      ${badgesHtml ? `<div class="detail-branches-container">${badgesHtml}</div>` : ''}
      <div class="commit-info-message">
        <div class="detail-msg-subject">${escapeHtml(subject)}</div>
        ${body ? `<div class="detail-msg-body">${escapeHtml(body)}</div>` : ''}
      </div>
    </div>
    <div class="commit-hover-stats">加载变更统计...</div>
  `;

  popover.classList.add('visible');
  positionPopover(anchorX, anchorY);
  window.vscode?.postMessage({ command: 'getCommitDetail', hash: commit.hash });
}

export function initCommitTooltip(tbody: HTMLElement, container: HTMLElement): void {
  tbody.addEventListener('mousemove', (e: MouseEvent) => {
    const row = (e.target as HTMLElement).closest('.commit-row') as HTMLElement;
    if (!row) {
      hideCommitTooltip();
      return;
    }

    const hash = row.dataset.hash;
    if (!hash) {
      hideCommitTooltip();
      return;
    }

    if (currentHoverHash === hash) {
      return;
    }

    // New row hovered: start timer
    hideCommitTooltip();
    currentHoverHash = hash;
    const clientX = e.clientX;
    const clientY = e.clientY;

    hoverTimer = setTimeout(() => {
      const commit = state.commits.find(c => c.hash === hash);
      if (commit && currentHoverHash === hash) {
        showCommitTooltip(commit, clientX, clientY);
      }
    }, HOVER_DELAY_MS);
  });

  tbody.addEventListener('mouseleave', () => {
    schedulePopoverHide();
  });

  // Hide when scrolling or clicking
  container.addEventListener('scroll', () => {
    hideCommitTooltip();
  }, { passive: true });

  document.addEventListener('click', () => {
    hideCommitTooltip();
  });
}
