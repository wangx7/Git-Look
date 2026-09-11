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
  if (ref === 'Working Tree') return 0;
  if (ref.startsWith('HEAD')) return 1;
  if (!ref.startsWith('tag: ') && !ref.startsWith('origin/') && !state.remoteBranches.includes(ref)) return 2;
  if (ref.startsWith('tag: ')) return 3;
  if (ref === 'origin/HEAD' || ref.endsWith('/HEAD')) return 5;
  return 4; // other remote branches
}

/**
 * Generate HTML for a single ref badge (branch/tag/HEAD/remote/worktree).
 */
export function makeBadgeHtml(dec: string, overrideLabel?: string, overrideColor?: string): string {
  if (dec === 'Working Tree') {
    const badgeColor = '#06b6d4';
    const style = `background-color: ${hexToRgba(badgeColor, 0.16)}; color: ${badgeColor}; border-color: ${hexToRgba(badgeColor, 0.45)}; font-weight: 500;`;
    return `<span class="ref-badge badge-working-tree" style="${style}" title="工作区未提交的修改"><i class="codicon codicon-edit"></i><span class="badge-text">工作区</span></span>`;
  }

  let badgeClass = 'badge-branch';
  let iconHtml = ICONS.branch;
  const cleanDec = dec.replace(/^origin\//, '').replace(/^refs\/remotes\/[^/]+\//, '');
  let badgeColor = overrideColor || state.branchColorMap.get(dec) || state.branchColorMap.get(cleanDec) || colors[0];
  let isHead = false;
  const isRemote = state.remoteBranches.includes(dec) || dec.startsWith('origin/') || dec.startsWith('refs/remotes/');
  let displayDec = overrideLabel || dec;

  // Worktree awareness: if branch is checked out by another worktree, show indicator
  if (state.worktrees && state.worktrees.length > 0 && !overrideLabel) {
    const otherWt = state.worktrees.find(wt => !wt.isCurrent && wt.branch === cleanDec);
    if (otherWt) {
      const wtName = otherWt.path.split(/[/\\]/).filter(Boolean).pop() || 'worktree';
      displayDec = `${displayDec} ⎇ ${wtName}`;
    }
  }

  if (dec.startsWith('tag: ')) {
    badgeClass = 'badge-tag';
    iconHtml = ICONS.tag;
    displayDec = overrideLabel || dec.substring(5);
    badgeColor = overrideColor || '#f59e0b';
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
 * Render only authoritative Git decorations into the detail panel.
 */
export function renderDetailBadges(commit: any, hash: string, container: HTMLElement): void {
  const renderedBadges: string[] = [];

  if (commit && commit.decorations && commit.decorations.length > 0) {
    commit.decorations.forEach((dec: string) => {
      renderedBadges.push(makeBadgeHtml(dec));
    });
  }


  if (renderedBadges.length > 0) {
    container.innerHTML = renderedBadges.join('');
    container.classList.remove('hidden');
  } else {
    container.innerHTML = '';
    container.classList.add('hidden');
  }
}
