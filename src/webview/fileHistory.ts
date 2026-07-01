import { state } from './state';
import { elements } from './dom';
import { getRelativeTime, escapeHtml } from './utils/format';
import { RightPaneState } from './types';
import { setRightPane, ensureDetailsExpanded } from './rightPane';

let activeHistoryHash: any = null;

export function renderFileHistory(filePath: string, historyCommits: any[]) {
  activeHistoryHash = null;
  ensureDetailsExpanded();
  setRightPane(RightPaneState.FILE_HISTORY);

  const fileHistoryInfoEl = document.getElementById('file-history-info');
  const fileHistoryListEl = document.getElementById('file-history-list');

  if (fileHistoryInfoEl) {
    fileHistoryInfoEl.innerHTML = `<div><i class="codicon codicon-file"></i> ${escapeHtml(filePath)}</div>`;
  }

  if (fileHistoryListEl) {
    fileHistoryListEl.innerHTML = '';
    if (!historyCommits || historyCommits.length === 0) {
      fileHistoryListEl.innerHTML = '<div class="empty-state">没有历史记录</div>';
      return;
    }

    historyCommits.forEach(c => {
      const card = document.createElement('div');
      card.className = 'history-card';
      card.dataset.hash = c.hash;

      const shortHash = c.hash.substring(0, 7);
      const relTime = getRelativeTime(c.timestamp);

      card.innerHTML = `
          <div class="history-card-header">
            <span class="history-card-author"><i class="codicon codicon-person"></i> ${escapeHtml(c.author)}</span>
            <span class="history-card-date">${relTime}</span>
          </div>
          <div class="history-card-msg">${escapeHtml(c.message)}</div>
          <div class="history-card-footer">
            <span class="history-card-hash"><i class="codicon codicon-git-commit"></i> ${shortHash}</span>
          </div>
        `;

      card.addEventListener('click', () => {
        fileHistoryListEl.querySelectorAll('.history-card').forEach(el => el.classList.remove('active'));
        card.classList.add('active');
        activeHistoryHash = c.hash;

        // postMessage to open diff with parent of target history version vs local workspace file!
        window.vscode.postMessage({
          command: 'openFileHistoryDiff',
          file: filePath,
          hash: c.hash,
          parentHash: c.parentHash,
          oldFilePath: c.oldFilePath,
          newFilePath: c.newFilePath
        });
      });

      fileHistoryListEl.appendChild(card);
    });
  }
}
