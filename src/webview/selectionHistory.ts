import { state } from './state';
import { elements } from './dom';
import { colors, getRelativeTime, formatDate, escapeHtml, hexToRgba, getAvatarColor, getInitials, fmtNum } from './utils/format';
import { RightPaneState } from './types';
import { getFileIconInfo } from './utils/fileIcons';
import { constants } from './constants';
import { setRightPane, setRightPaneVisible, ensureDetailsExpanded } from './rightPane';
import { requestStats, hideLoading, showLoading } from './dataLoader';

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

