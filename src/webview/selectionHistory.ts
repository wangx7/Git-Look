import { escapeHtml } from './utils/format';
import { RightPaneState } from './types';
import { setRightPane, ensureDetailsExpanded } from './rightPane';
import { createHistoryCard } from './historyCard';

let activeHistoryHash: any = null;
const historyFileInfoEl = document.getElementById('history-file-info');
const historyListEl = document.getElementById('history-list');

export function renderSelectionHistory(filePath, startLine, endLine, historyCommits) {
  activeHistoryHash = null;
  ensureDetailsExpanded();
  setRightPane(RightPaneState.HISTORY);

  if (historyFileInfoEl) {
    historyFileInfoEl.innerHTML = `<div><i class="codicon codicon-file"></i> ${escapeHtml(filePath)}</div><div style="margin-top: 3px; font-weight: 500;"><i class="codicon codicon-list-flat"></i> 行 ${startLine} - ${endLine}</div>`;
  }

  if (historyListEl) {
    historyListEl.innerHTML = '';
    if (!historyCommits || historyCommits.length === 0) {
      historyListEl.innerHTML = '<div class="empty-state">没有历史记录</div>';
      return;
    }

    historyCommits.forEach(c => {
      const card = createHistoryCard(c);

      card.addEventListener('click', () => {
        // Highlight active card
        historyListEl.querySelectorAll('.history-card').forEach(el => el.classList.remove('active'));
        card.classList.add('active');
        activeHistoryHash = c.hash;

        // postMessage to open diff
        window.vscode.postMessage({
          command: 'openSingleDiff',
          file: filePath,
          hash: c.hash,
          parentHash: c.parentHash,
          lineRange: c.lineRange,
          oldFilePath: c.oldFilePath,
          newFilePath: c.newFilePath
        });
      });

      historyListEl.appendChild(card);
    });
  }
}

