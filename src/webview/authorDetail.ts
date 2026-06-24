import { state } from './state';
import { elements } from './dom';
import { colors, getRelativeTime, formatDate, escapeHtml, hexToRgba, getAvatarColor, getInitials, fmtNum } from './utils/format';
import { RightPaneState } from './types';
import { getFileIconInfo } from './utils/fileIcons';
import { constants } from './constants';
import { setRightPane, setRightPaneVisible, ensureDetailsExpanded } from './rightPane';
import { requestStats, hideLoading, showLoading } from './dataLoader';

import { renderTopFiles } from './statsCharts';

export function showAuthorDetail(contributor) {
  state.currentFocusedAuthor = contributor.author;
  ensureDetailsExpanded();
  setRightPane(RightPaneState.AUTHOR);

  const color = getAvatarColor(contributor.author);
  const initials = getInitials(contributor.author);
  elements.authorStatsAvatar.textContent = initials;
  elements.authorStatsAvatar.style.backgroundColor = color;
  elements.authorStatsName.textContent = contributor.author;
  elements.authorStatsEmail.textContent = contributor.email || '';

  elements.auCommits.textContent = fmtNum(contributor.commits);
  elements.auAdd.textContent = '+' + fmtNum(contributor.additions);
  elements.auDel.textContent = '-' + fmtNum(contributor.deletions);

  // Weekday bar chart
  elements.weekdayChart.innerHTML = '';
  const dayLabels = ['日', '一', '二', '三', '四', '五', '六'];
  const wd = contributor.weekdayDistribution || [0, 0, 0, 0, 0, 0, 0];
  const maxWd = Math.max(...wd, 1);
  // Reorder: Mon-Sun (index 1..6, 0)
  const order = [1, 2, 3, 4, 5, 6, 0];
  const orderLabels = ['一', '二', '三', '四', '五', '六', '日'];
  order.forEach((dayIdx, i) => {
    const count = wd[dayIdx] || 0;
    const heightPct = Math.max(4, Math.round((count / maxWd) * 100));
    const col = document.createElement('div');
    col.className = 'weekday-col custom-tooltip-container';
    col.innerHTML = `
        <div class="weekday-bar" style="height:${heightPct}%;background-color:${color};opacity:0.65;"></div>
        <span class="weekday-label">${orderLabels[i]}</span>
        <div class="custom-tooltip">${orderLabels[i]}: ${count}次</div>
      `;
    elements.weekdayChart.appendChild(col);
  });

  // Author top files: use per-author topFiles from contributor data
  elements.authorTopFiles.innerHTML = '';
  if (contributor.topFiles && contributor.topFiles.length > 0) {
    renderTopFiles(elements.authorTopFiles, contributor.topFiles);
  } else if (state.currentStatsData && state.currentStatsData.topFiles) {
    // fallback to global if per-author data unavailable
    renderTopFiles(elements.authorTopFiles, state.currentStatsData.topFiles.slice(0, 5));
  } else {
    elements.authorTopFiles.innerHTML = '<div style="opacity:0.4;font-size:11px;padding:4px 8px;">暂无数据</div>';
  }
}

