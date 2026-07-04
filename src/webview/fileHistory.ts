import { escapeHtml } from './utils/format';
import { RightPaneState } from './types';
import { setRightPane, ensureDetailsExpanded } from './rightPane';
import { createHistoryCard } from './historyCard';

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
      const card = createHistoryCard(c);

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
