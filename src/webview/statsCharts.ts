import { state } from './state';
import { elements } from './dom';
import { colors, getRelativeTime, formatDate, escapeHtml, hexToRgba, getAvatarColor, getInitials, fmtNum } from './utils/format';
import { RightPaneState } from './types';
import { getFileIconInfo } from './utils/fileIcons';
import { constants } from './constants';
import { setRightPane, setRightPaneVisible, ensureDetailsExpanded } from './rightPane';
import { requestStats, hideLoading, showLoading } from './dataLoader';

import { showAuthorDetail } from './authorDetail';
import { reloadData } from './dataLoader';
import { adjustSelectWidth } from './filters';

export function renderStatsStrip(stats) {
  if (!elements.statsStrip) return;
  elements.statsStrip.classList.remove('hidden');
  if (elements.stripCommitsVal) elements.stripCommitsVal.textContent = fmtNum(stats.totalCommits);
  if (elements.stripAdd) elements.stripAdd.textContent = '+' + fmtNum(stats.totalAdditions);
  if (elements.stripDel) elements.stripDel.textContent = '-' + fmtNum(stats.totalDeletions);
  if (elements.stripContributorsVal) elements.stripContributorsVal.textContent = stats.contributors.length;
  const range = `${stats.sinceDate} ~ ${stats.untilDate}`;
  if (elements.stripRange) elements.stripRange.textContent = range;
}

export function renderOverviewStats(stats) {
  // Range label
  const rangeLabel = `${stats.sinceDate} → ${stats.untilDate}`;
  elements.overviewRange.textContent = rangeLabel;

  // Summary cards
  elements.ovCommits.textContent = fmtNum(stats.totalCommits);
  elements.ovAdd.textContent = '+' + fmtNum(stats.totalAdditions);
  elements.ovDel.textContent = '-' + fmtNum(stats.totalDeletions);

  // Activity SVG chart
  renderActivityChart(stats.dailyActivity);

  // Contributors leaderboard
  elements.contributorsList.innerHTML = '';
  const maxChanged = stats.contributors[0] ? stats.contributors[0].totalChanged : 1;
  stats.contributors.forEach((c, i) => {
    const pct = maxChanged > 0 ? Math.round((c.totalChanged / maxChanged) * 100) : 0;
    const color = getAvatarColor(c.author);
    const initials = getInitials(c.author);
    const row = document.createElement('div');
    row.className = 'contributor-row';
    row.innerHTML = `
        <div class="contributor-row-top">
          <span class="contributor-rank">${i + 1}</span>
          <span class="avatar-circle" style="background-color:${color};width:18px;height:18px;font-size:8px;margin-right:0;flex-shrink:0;border:none;box-shadow:none;">${escapeHtml(initials)}</span>
          <span class="contributor-name">${escapeHtml(c.author)}</span>
          <span class="contributor-state.commits">${c.commits} state.commits</span>
        </div>
        <div class="contributor-bar-row">
          <div class="contributor-bar-track">
            <div class="contributor-bar-fill" style="width:${pct}%;background-color:${color};"></div>
          </div>
          <span class="contributor-line-stats">
            <span class="contributor-line-add">+${fmtNum(c.additions)}</span>
            &nbsp;
            <span class="contributor-line-del">-${fmtNum(c.deletions)}</span>
          </span>
        </div>
      `;
    row.addEventListener('click', () => showAuthorDetail(c));
    elements.contributorsList.appendChild(row);
  });

  // Top files
  renderTopFiles(elements.topFilesList, stats.topFiles);
}

export function renderActivityChart(dailyActivity) {
  elements.activitySvg.innerHTML = '';
  if (!dailyActivity || dailyActivity.length === 0) return;

  const svgW = elements.activitySvg.clientWidth || 300;
  const svgH = 80;
  elements.activitySvg.setAttribute('height', svgH);
  elements.activitySvg.style.height = svgH + 'px';

  const padTop = 8;
  const padBot = 20;  // room for month labels
  const padLeft = 2;
  const padRight = 2;
  const chartW = svgW - padLeft - padRight;
  const chartH = svgH - padTop - padBot;

  const maxCount = Math.max(...dailyActivity.map(d => d.count), 1);
  const n = dailyActivity.length;

  // Compute point coordinates
  const pts = dailyActivity.map((d, i) => ({
    x: padLeft + (i / Math.max(n - 1, 1)) * chartW,
    y: padTop + chartH - (d.count / maxCount) * chartH,
    date: d.date,
    count: d.count
  }));

  // Build smooth bezier path
  function bezierPath(points) {
    if (points.length === 0) return '';
    if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
    let d = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
    for (let i = 0; i < points.length - 1; i++) {
      const cp1x = (points[i].x + points[i + 1].x) / 2;
      const cp1y = points[i].y;
      const cp2x = (points[i].x + points[i + 1].x) / 2;
      const cp2y = points[i + 1].y;
      d += ` C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(2)}, ${points[i + 1].x.toFixed(2)} ${points[i + 1].y.toFixed(2)}`;
    }
    return d;
  }

  const linePath = bezierPath(pts);
  const baseY = padTop + chartH;
  const areaPath = linePath + ` L ${pts[pts.length - 1].x.toFixed(2)} ${baseY} L ${pts[0].x.toFixed(2)} ${baseY} Z`;

  const ns = 'http://www.w3.org/2000/svg';
  const gradId = 'activity-chart-gradient';

  // Gradient def
  const defs = document.createElementNS(ns, 'defs');
  const grad = document.createElementNS(ns, 'linearGradient');
  grad.setAttribute('id', gradId);
  grad.setAttribute('x1', '0'); grad.setAttribute('y1', '0');
  grad.setAttribute('x2', '0'); grad.setAttribute('y2', '1');
  const stop1 = document.createElementNS(ns, 'stop');
  stop1.setAttribute('offset', '0%');
  stop1.setAttribute('stop-color', 'var(--accent)');
  stop1.setAttribute('stop-opacity', '0.35');
  const stop2 = document.createElementNS(ns, 'stop');
  stop2.setAttribute('offset', '100%');
  stop2.setAttribute('stop-color', 'var(--accent)');
  stop2.setAttribute('stop-opacity', '0.02');
  grad.appendChild(stop1); grad.appendChild(stop2);
  defs.appendChild(grad);
  elements.activitySvg.appendChild(defs);

  // Area fill
  const area = document.createElementNS(ns, 'path');
  area.setAttribute('d', areaPath);
  area.setAttribute('fill', `url(#${gradId})`);
  area.setAttribute('stroke', 'none');
  elements.activitySvg.appendChild(area);

  // Line
  const line = document.createElementNS(ns, 'path');
  line.setAttribute('d', linePath);
  line.setAttribute('fill', 'none');
  line.setAttribute('stroke', 'var(--accent)');
  line.setAttribute('stroke-width', '1.8');
  line.setAttribute('stroke-linecap', 'round');
  line.setAttribute('stroke-linejoin', 'round');
  elements.activitySvg.appendChild(line);

  // Month tick labels
  let lastMonth = '';
  pts.forEach((p, i) => {
    const month = dailyActivity[i].date.substring(0, 7); // YYYY-MM
    if (month !== lastMonth) {
      lastMonth = month;
      const label = document.createElementNS(ns, 'text');
      label.setAttribute('x', p.x.toFixed(1));
      label.setAttribute('y', (svgH - 4).toFixed(1));
      label.setAttribute('font-size', '8');
      label.setAttribute('fill', 'var(--fg-faint, rgba(128,128,128,0.5))');
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('font-family', 'var(--font-family, sans-serif)');
      label.textContent = month.substring(5); // MM only
      elements.activitySvg.appendChild(label);
    }
  });

  // Interactive hover overlay
  const hoverGroup = document.createElementNS(ns, 'g');
  hoverGroup.setAttribute('style', 'pointer-events: none; opacity: 0;');
  hoverGroup.setAttribute('class', 'activity-hover-group');

  // Vertical crosshair
  const vLine = document.createElementNS(ns, 'line');
  vLine.setAttribute('class', 'activity-crosshair');
  vLine.setAttribute('y1', padTop.toString());
  vLine.setAttribute('y2', (padTop + chartH).toString());
  vLine.setAttribute('stroke', 'var(--accent)');
  vLine.setAttribute('stroke-width', '1');
  vLine.setAttribute('stroke-dasharray', '3,3');
  vLine.setAttribute('opacity', '0.5');
  hoverGroup.appendChild(vLine);

  // Hover dot
  const dot = document.createElementNS(ns, 'circle');
  dot.setAttribute('r', '4');
  dot.setAttribute('fill', 'var(--accent)');
  dot.setAttribute('stroke', 'var(--bg-color, #1e1e1e)');
  dot.setAttribute('stroke-width', '2');
  hoverGroup.appendChild(dot);
  elements.activitySvg.appendChild(hoverGroup);

  // Tooltip element (HTML div, positioned absolutely)
  let tooltip = document.getElementById('activity-tooltip');
  if (!tooltip) {
    tooltip = document.createElement('div');
    tooltip.id = 'activity-tooltip';
    tooltip.style.cssText = `
        position: fixed; pointer-events: none; z-index: 9999;
        background: var(--surface-2, #252526);
        border: 1px solid var(--border-color, rgba(128,128,128,0.25));
        border-radius: 6px;
        padding: 5px 9px;
        font-size: 11px;
        font-family: var(--font-family, sans-serif);
        color: var(--fg-color, #ccc);
        box-shadow: 0 4px 16px rgba(0,0,0,0.35);
        white-space: nowrap;
        display: none;
        line-height: 1.5;
      `;
    document.body.appendChild(tooltip);
  }

  // Invisible wide overlay rect for mouse tracking
  const overlay = document.createElementNS(ns, 'rect');
  overlay.setAttribute('x', padLeft.toString());
  overlay.setAttribute('y', padTop.toString());
  overlay.setAttribute('width', chartW.toString());
  overlay.setAttribute('height', chartH.toString());
  overlay.setAttribute('fill', 'transparent');
  overlay.setAttribute('style', 'cursor: pointer;');
  elements.activitySvg.appendChild(overlay);

  overlay.addEventListener('mousemove', (e) => {
    const rect = elements.activitySvg.getBoundingClientRect();
    const mouseX = e.clientX - rect.left - padLeft;
    const idx = Math.max(0, Math.min(n - 1, Math.round((mouseX / chartW) * (n - 1))));
    const p = pts[idx];
    const d = dailyActivity[idx];

    hoverGroup.style.opacity = '1';
    vLine.setAttribute('x1', p.x.toFixed(1));
    vLine.setAttribute('x2', p.x.toFixed(1));
    dot.setAttribute('cx', p.x.toFixed(1));
    dot.setAttribute('cy', p.y.toFixed(1));

    tooltip.style.display = 'block';
    tooltip.innerHTML = `<span style="opacity:0.7;font-size:12px;">${d.date}</span><br><strong style="color:var(--accent);font-size:13px;">${d.count}</strong> <span style="font-size:12px">次提交</span><br><span style="opacity:0.6;font-size:11px;">点击筛选此日</span>`;
    // Position tooltip with boundary checks
    const tw = tooltip.offsetWidth;
    const th = tooltip.offsetHeight;
    const margin = 12;

    let tx = e.clientX + margin;
    let ty = e.clientY - th - 8; // 8px above cursor

    if (tx + tw > window.innerWidth) {
      tx = e.clientX - tw - margin;
    }
    if (ty < 0) {
      ty = e.clientY + margin;
    }

    tooltip.style.left = tx + 'px';
    tooltip.style.top = ty + 'px';
  });

  overlay.addEventListener('mouseleave', () => {
    hoverGroup.style.opacity = '0';
    tooltip.style.display = 'none';
  });

  // Click a day → set date filter to that single day
  overlay.addEventListener('click', (e) => {
    const rect = elements.activitySvg.getBoundingClientRect();
    const mouseX = e.clientX - rect.left - padLeft;
    const idx = Math.max(0, Math.min(n - 1, Math.round((mouseX / chartW) * (n - 1))));
    const d = dailyActivity[idx];
    if (!d || !d.date) return;

    // Set date preset to custom and fill since/until with the clicked day
    elements.datePresetSelect.value = 'custom';
    elements.dateRangeGroup.classList.remove('hidden');
    elements.sinceDate.value = d.date;
    elements.untilDate.value = d.date;
    adjustSelectWidth(elements.datePresetSelect);

    // Brief flash on the overlay to confirm click
    overlay.style.opacity = '0.15';
    overlay.style.fill = 'var(--accent)';
    setTimeout(() => {
      overlay.style.opacity = '';
      overlay.style.fill = 'transparent';
    }, 180);

    tooltip.style.display = 'none';
    reloadData();
  });
}

export function renderTopFiles(container, files) {
  container.innerHTML = '';
  if (!files || files.length === 0) {
    container.innerHTML = '<div style="opacity:0.4;font-size:11px;padding:4px 8px;">暂无数据</div>';
    return;
  }
  const maxChanges = files[0].changes;
  files.forEach(f => {
    const pct = maxChanges > 0 ? Math.round((f.changes / maxChanges) * 100) : 0;
    const row = document.createElement('div');
    row.className = 'top-file-row top-file-row-clickable';
    row.title = `${f.path}\n点击打开文件`;
    row.innerHTML = `
        <span class="top-file-name">${escapeHtml(f.path)}</span>
        <div class="top-file-bar-track"><div class="top-file-bar-fill" style="width:${pct}%;"></div></div>
        <span class="top-file-count">${f.changes}次</span>
        <i class="codicon codicon-go-to-file top-file-open-icon" title="打开文件"></i>
      `;
    row.addEventListener('click', () => {
      window.vscode.postMessage({
        command: 'openWorkspaceFile',
        file: f.path
      });
    });
    container.appendChild(row);
  });
}

