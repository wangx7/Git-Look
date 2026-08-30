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
 * Priority order helper for git ref decorations:
 * 1. HEAD / HEAD -> local_branch (highest)
 * 2. Local branch
 * 3. Tags
 * 4. Remote branches (e.g. origin/main)
 * 5. Special remote refs (e.g. origin/HEAD)
 */
function getRefPriority(ref: string): number {
  if (ref.startsWith('HEAD')) return 1;
  if (!ref.startsWith('tag: ') && !ref.startsWith('origin/') && !state.remoteBranches.includes(ref)) return 2;
  if (ref.startsWith('tag: ')) return 3;
  if (ref === 'origin/HEAD' || ref.endsWith('/HEAD')) return 5;
  return 4; // other remote branches
}

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
  } else if (dec === 'HEAD' || dec.startsWith('HEAD')) {
    badgeClass = 'badge-head';
    iconHtml = ICONS.head;
    isHead = true;
  }

  const style = isHead
    ? ``
    : `background-color: ${hexToRgba(badgeColor, 0.14)}; color: ${badgeColor}; border-color: ${hexToRgba(badgeColor, 0.35)};`;

  const styleAttr = style ? ` style="${style}"` : '';
  return `<span class="ref-badge ${badgeClass}"${styleAttr} title="${escapeHtml(displayDec)}">${iconHtml}<span class="badge-text">${escapeHtml(displayDec)}</span></span>`;
}

/**
 * Build inline badge HTML for a commit row in the virtual list.
 * Shows top priority badges (up to maxBadges) + "+N" overflow for remaining.
 */
export function renderInlineBadges(commit: any, maxBadges: number = 2): string {
  if (!commit.decorations || commit.decorations.length === 0) return '';

  const decs: string[] = [...commit.decorations];
  const renderedBadges: string[] = [];

  // 1. Check for HEAD and pair with local branch if available
  const hasHead = decs.includes('HEAD');
  if (hasHead) {
    const nextLocal = decs.find((d: string) =>
      d !== 'HEAD' && !d.startsWith('origin/') && !d.startsWith('tag: ') && !state.remoteBranches.includes(d)
    );
    if (nextLocal) {
      renderedBadges.push(makeBadgeHtml('HEAD', `HEAD → ${nextLocal}`));
      decs.splice(decs.indexOf('HEAD'), 1);
      decs.splice(decs.indexOf(nextLocal), 1);
    } else {
      renderedBadges.push(makeBadgeHtml('HEAD'));
      decs.splice(decs.indexOf('HEAD'), 1);
    }
  }

  // 2. Sort remaining decorations by priority (Local > Tag > Remote > Special)
  decs.sort((a, b) => getRefPriority(a) - getRefPriority(b));

  // 3. Render up to maxBadges
  while (decs.length > 0 && renderedBadges.length < maxBadges) {
    const item = decs.shift()!;
    renderedBadges.push(makeBadgeHtml(item));
  }

  // 4. Any remaining decorations become +N overflow badge
  if (decs.length > 0) {
    const remainingNames = decs.map(d => d.startsWith('tag: ') ? d.substring(5) : d).join(', ');
    renderedBadges.push(
      `<span class="ref-badge badge-overflow" title="${escapeHtml(remainingNames)}">+${decs.length}</span>`
    );
  }

  return renderedBadges.join('');
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
