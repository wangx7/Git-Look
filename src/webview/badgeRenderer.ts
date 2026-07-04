import { state } from './state';
import { colors, escapeHtml, hexToRgba } from './utils/format';

export interface BadgeOptions {
  dec: string;
  overrideLabel?: string;
}

const ICONS = {
  branch: '<i class="codicon codicon-git-branch"></i>',
  tag: '<i class="codicon codicon-tag"></i>',
  cloud: '<i class="codicon codicon-cloud"></i>',
  head: '<i class="codicon codicon-circle-filled"></i>'
};

/**
 * Generate HTML for a single ref badge (branch/tag/HEAD/remote).
 */
export function makeBadgeHtml(dec: string, overrideLabel?: string): string {
  let badgeClass = 'badge-branch';
  let iconHtml = ICONS.branch;
  let badgeColor = state.branchColorMap.get(dec) || colors[0];
  let isHead = false;
  const isRemote = state.remoteBranches.includes(dec) || dec.startsWith('origin/');
  let displayDec = overrideLabel || dec;

  if (dec.startsWith('tag: ')) {
    badgeClass = 'badge-tag';
    iconHtml = ICONS.tag;
    displayDec = overrideLabel || dec.substring(5);
    badgeColor = '#f59e0b';
  } else if (isRemote) {
    badgeClass = 'badge-remote-branch';
    iconHtml = ICONS.cloud;
  } else if (dec === 'HEAD') {
    badgeClass = 'badge-head';
    iconHtml = ICONS.head;
    isHead = true;
  }

  const style = isHead
    ? ``
    : `background-color: ${hexToRgba(badgeColor, 0.15)}; color: ${badgeColor}; border-color: ${hexToRgba(badgeColor, 0.35)};`;

  const styleAttr = style ? ` style="${style}"` : '';
  return `<span class="ref-badge ${badgeClass}"${styleAttr}>${iconHtml}${escapeHtml(displayDec)}</span>`;
}

/**
 * Build inline badge HTML for a commit row in the virtual list.
 * Shows first badge + "+N" overflow for remaining.
 */
export function renderInlineBadges(commit: any): string {
  if (!commit.decorations || commit.decorations.length === 0) return '';

  let html = '';

  if (commit.decorations[0] === 'HEAD') {
    const nextLocal = commit.decorations.slice(1).find((d: string) =>
      !d.startsWith('origin/') && !d.startsWith('tag: ') && !state.remoteBranches.includes(d)
    );
    const headLabel = nextLocal ? `HEAD → ${nextLocal}` : 'HEAD';
    html += makeBadgeHtml('HEAD', headLabel);

    const remaining = commit.decorations.slice(1).filter((d: string) => d !== nextLocal);
    if (remaining.length === 1) {
      html += makeBadgeHtml(remaining[0]);
    } else if (remaining.length > 1) {
      const remainingNames = remaining.join(', ');
      html += `<span class="ref-badge" style="background-color: rgba(255,255,255,0.06); color: var(--desc-fg); border: 1px solid var(--border-color); cursor: default;" title="${escapeHtml(remainingNames)}">+${remaining.length}</span>`;
    }
  } else {
    html += makeBadgeHtml(commit.decorations[0]);
    if (commit.decorations.length > 1) {
      const remainingNames = commit.decorations.slice(1).join(', ');
      html += `<span class="ref-badge" style="background-color: rgba(255,255,255,0.06); color: var(--desc-fg); border: 1px solid var(--border-color); cursor: default;" title="${escapeHtml(remainingNames)}">+${commit.decorations.length - 1}</span>`;
    }
  }

  return html;
}

/**
 * Render branch/tag/remote badges into the detail panel's container element.
 * Also shows inferred lane branch if not already in decorations.
 */
export function renderDetailBadges(commit: any, hash: string, container: HTMLElement): void {
  container.innerHTML = '';
  let hasBadges = false;

  if (commit.decorations && commit.decorations.length > 0) {
    hasBadges = true;
    container.classList.remove('hidden');
    commit.decorations.forEach((dec: string) => {
      const span = document.createElement('span');
      // Re-use makeBadgeHtml but parse it into DOM
      const temp = document.createElement('div');
      temp.innerHTML = makeBadgeHtml(dec);
      const badge = temp.firstElementChild as HTMLElement;
      if (badge) container.appendChild(badge);
    });
  }

  // Append inferred lane branch if not already in decorations
  const laneBranch = state.commitBranchLabel[hash];
  if (laneBranch && laneBranch.name) {
    const alreadyShown = commit.decorations && commit.decorations.includes(laneBranch.name);
    if (!alreadyShown) {
      hasBadges = true;
      container.classList.remove('hidden');
      const span = document.createElement('span');
      span.className = 'ref-badge badge-branch';
      span.style.cssText = `background-color: ${hexToRgba(laneBranch.color, 0.15)}; color: ${laneBranch.color}; border-color: ${hexToRgba(laneBranch.color, 0.35)}; border-radius: 10px;`;
      span.innerHTML = `${ICONS.branch}${escapeHtml(laneBranch.name)}`;
      container.appendChild(span);
    }
  }

  if (!hasBadges) {
    container.classList.add('hidden');
  }
}
