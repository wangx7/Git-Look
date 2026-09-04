import { state } from './state';
import { escapeHtml, formatDate, getRelativeTime, getAvatarGradient, getInitials } from './utils/format';
import { makeBadgeHtml } from './badgeRenderer';

let popoverEl: HTMLElement | null = null;
let hoverTimer: any = null;
let currentHoverHash: string | null = null;
const HOVER_DELAY_MS = 320;

function getOrCreatePopover(): HTMLElement {
  if (!popoverEl) {
    popoverEl = document.createElement('div');
    popoverEl.id = 'commit-hover-popover';
    popoverEl.className = 'commit-hover-popover';
    document.body.appendChild(popoverEl);
  }
  return popoverEl;
}

export function _resetPopoverForTest(): void {
  popoverEl = null;
  hoverTimer = null;
  currentHoverHash = null;
}

export function hideCommitTooltip(): void {
  if (hoverTimer) {
    clearTimeout(hoverTimer);
    hoverTimer = null;
  }
  currentHoverHash = null;
  if (popoverEl) {
    popoverEl.classList.remove('visible');
  }
}

export function showCommitTooltip(commit: any, anchorX: number, anchorY: number): void {
  const popover = getOrCreatePopover();
  const avatarGradient = getAvatarGradient(commit.author);
  const initials = getInitials(commit.author);
  const shortHash = commit.hash ? commit.hash.substring(0, 7) : '';
  const dateStr = formatDate(commit.timestamp);
  const relTime = getRelativeTime(commit.timestamp);

  // Render all decoration badges, and append inferred lane branch if not already shown
  const renderedBadges: string[] = [];
  if (commit.decorations && commit.decorations.length > 0) {
    commit.decorations.forEach((d: string) => {
      renderedBadges.push(makeBadgeHtml(d));
    });
  }

  if (commit.hash) {
    const laneBranch = state.commitBranchLabel[commit.hash];
    if (laneBranch && laneBranch.name) {
      const isAlreadyShown = commit.decorations && commit.decorations.some((d: string) => {
        if (d === laneBranch.name) return true;
        if (d.replace(/^origin\//, '') === laneBranch.name) return true;
        if (d.replace(/^refs\/remotes\/[^/]+\//, '') === laneBranch.name) return true;
        return false;
      });

      if (!isAlreadyShown) {
        renderedBadges.push(makeBadgeHtml(laneBranch.name, undefined, laneBranch.color));
      }
    }
  }

  const badgesHtml = renderedBadges.join('');

  popover.innerHTML = `
    <div class="popover-header">
      <div class="popover-hash">
        <i class="codicon codicon-git-commit"></i>
        <span>${shortHash}</span>
      </div>
      ${badgesHtml ? `<div class="popover-badges">${badgesHtml}</div>` : ''}
    </div>
    <div class="popover-msg">${escapeHtml(commit.message || '')}</div>
    <div class="popover-meta">
      <span class="avatar-circle popover-avatar" style="background: ${avatarGradient};">${escapeHtml(initials)}</span>
      <span class="popover-author" title="${escapeHtml(commit.email || '')}">${escapeHtml(commit.author)}</span>
      <span class="popover-date">${dateStr} · ${relTime}</span>
    </div>
  `;

  // Position popover safely inside viewport
  popover.classList.add('visible');
  const rect = popover.getBoundingClientRect();
  const winWidth = window.innerWidth;
  const winHeight = window.innerHeight;

  let left = anchorX + 12;
  let top = anchorY + 16;

  // Clamp horizontal
  if (left + rect.width > winWidth - 12) {
    left = winWidth - rect.width - 12;
  }
  if (left < 12) {
    left = 12;
  }

  // Clamp vertical (flip above if overflowing bottom)
  if (top + rect.height > winHeight - 12) {
    top = Math.max(12, anchorY - rect.height - 10);
  }

  popover.style.left = `${left}px`;
  popover.style.top = `${top}px`;
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

    // If mouse moves within same row and popover is already visible, keep it
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
    hideCommitTooltip();
  });

  // Hide when scrolling or clicking
  container.addEventListener('scroll', () => {
    hideCommitTooltip();
  }, { passive: true });

  document.addEventListener('click', () => {
    hideCommitTooltip();
  });
}
