import { getRelativeTime, escapeHtml, getAvatarGradient, getInitials } from './utils/format';

/**
 * Create a history card DOM element for a commit.
 * Shared between selectionHistory.ts and fileHistory.ts.
 */
export function createHistoryCard(commit: any): HTMLDivElement {
  const card = document.createElement('div');
  card.className = 'history-card';
  card.dataset.hash = commit.hash;

  const shortHash = commit.hash.substring(0, 7);
  const relTime = getRelativeTime(commit.timestamp);
  const initials = getInitials(commit.author);
  const avatarGradient = getAvatarGradient(commit.author);

  card.innerHTML = `
    <div class="history-card-layout">
      <div class="history-card-avatar-col">
        <span class="avatar-circle history-card-avatar" style="background:${avatarGradient};width:22px;height:22px;font-size:10px;">${escapeHtml(initials)}</span>
      </div>
      <div class="history-card-content">
        <div class="history-card-header">
          <span class="history-card-author">${escapeHtml(commit.author)}</span>
          <span class="history-card-hash-badge">${shortHash}</span>
          <span class="history-card-date">${relTime}</span>
        </div>
        <div class="history-card-msg">${escapeHtml(commit.message)}</div>
        ${commit.body ? `<div class="history-card-body">${escapeHtml(commit.body)}</div>` : ''}
      </div>
    </div>
  `;

  // Long bodies are clamped; clicking a clamped body toggles it instead of opening the diff.
  const bodyEl = card.querySelector('.history-card-body') as HTMLElement | null;
  bodyEl?.addEventListener('click', (e) => {
    const expanded = bodyEl.classList.contains('expanded');
    if (!expanded && bodyEl.scrollHeight <= bodyEl.clientHeight) return;
    e.stopPropagation();
    bodyEl.classList.toggle('expanded');
  });

  return card;
}
