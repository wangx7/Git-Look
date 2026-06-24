import { state } from './state';
import { elements } from './dom';
import { colors, getRelativeTime, formatDate, escapeHtml, hexToRgba, getAvatarColor, getInitials, fmtNum } from './utils/format';
import { RightPaneState } from './types';
import { getFileIconInfo } from './utils/fileIcons';
import { constants } from './constants';
import { setRightPane, setRightPaneVisible, ensureDetailsExpanded } from './rightPane';
import { requestStats, hideLoading, showLoading } from './dataLoader';

let lockedSliceHash: any = null;
let lockedSliceColor: any = null;

export function renderFileBlameStats(fileName, stats) {
  state.rightPaneState = RightPaneState.FILE_BLAME_STATS;
  ensureDetailsExpanded();
  setRightPane(RightPaneState.FILE_BLAME_STATS);

  lockedSliceHash = null;
  lockedSliceColor = null;



  if (!stats || stats.length === 0) {
    renderRoseChart([], 0);
    return;
  }

  const totalLines = stats.reduce((sum, s) => sum + s.lines, 0);
  renderRoseChart(stats, totalLines);
}

export function renderRoseChart(stats, totalLines) {
  const svg = document.getElementById('rose-chart-svg');
  const tooltip = document.getElementById('rose-chart-tooltip');
  if (!svg) return;

  svg.innerHTML = '';

  if (!stats || stats.length === 0 || totalLines === 0) return;

  const centerX = 0;
  const centerY = 0;
  // Increase viewBox and maxRadius to fit labels
  svg.setAttribute('viewBox', '-130 -130 260 260');
  const maxRadius = 100;
  const minRadius = 0; // True Nightingale chart starts from center

  // Sort by lines descending to give a classic rose chart look
  const sortedStats = [...stats].sort((a, b) => b.lines - a.lines);
  const maxLines = sortedStats[0].lines;

  // Angle per item is equal
  const angleStep = (Math.PI * 2) / sortedStats.length;
  let currentAngle = -Math.PI / 2; // Start at top

  // --- Draw concentric grid lines (Polar Grid) ---
  const gridGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  gridGroup.setAttribute('class', 'rose-grid');
  [0.25, 0.5, 0.75, 1.0].forEach(ratio => {
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', String(centerX));
    circle.setAttribute('cy', String(centerY));
    circle.setAttribute('r', String(maxRadius * ratio));
    circle.setAttribute('fill', 'none');
    circle.setAttribute('stroke', 'var(--vscode-editorGhostText-foreground)');
    circle.setAttribute('stroke-width', '0.5');
    circle.setAttribute('stroke-dasharray', '2,2');
    circle.setAttribute('opacity', '0.3');
    gridGroup.appendChild(circle);
  });

  // --- Draw radial grid lines ---
  for (let i = 0; i < sortedStats.length; i++) {
    const angle = currentAngle + i * angleStep;
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', String(centerX));
    line.setAttribute('y1', String(centerY));
    line.setAttribute('x2', String(centerX + maxRadius * Math.cos(angle)));
    line.setAttribute('y2', String(centerY + maxRadius * Math.sin(angle)));
    line.setAttribute('stroke', 'var(--vscode-editorGhostText-foreground)');
    line.setAttribute('stroke-width', '0.5');
    line.setAttribute('opacity', '0.2');
    gridGroup.appendChild(line);
  }
  svg.appendChild(gridGroup);

  // Keep track of slice paths
  const paths = [];

  // State helper to get synced color
  function getCommitColor(hash) {
    const node = state.cachedCommitNodes[hash];
    if (node) {
      return colors[node.colorIdx % colors.length];
    }
    return getAvatarColor(hash);
  }

  let hoveredSliceHash = null;

  // Helper to update styling of all wedges
  function updateSliceStyles() {
    paths.forEach(item => {
      const { pathEl, hash, baseColor } = item;

      if (lockedSliceHash) {
        if (hash === lockedSliceHash) {
          pathEl.setAttribute('fill', baseColor);
          pathEl.setAttribute('opacity', '1.0');
          pathEl.setAttribute('stroke', 'var(--vscode-focusBorder, #007fd4)');
          pathEl.setAttribute('stroke-width', '2.0');
          pathEl.setAttribute('transform', 'scale(1.08)');
        } else if (hoveredSliceHash && hash === hoveredSliceHash) {
          pathEl.setAttribute('fill', baseColor);
          pathEl.setAttribute('opacity', '1.0');
          pathEl.setAttribute('stroke', 'var(--surface-1)');
          pathEl.setAttribute('stroke-width', '1.5');
          pathEl.setAttribute('transform', 'scale(1.04)');
        } else {
          pathEl.setAttribute('fill', hexToRgba(baseColor, 0.3));
          pathEl.setAttribute('opacity', '0.2');
          pathEl.setAttribute('stroke', 'var(--surface-1)');
          pathEl.setAttribute('stroke-width', '1.5');
          pathEl.setAttribute('transform', 'scale(1)');
        }
      } else if (hoveredSliceHash) {
        if (hash === hoveredSliceHash) {
          pathEl.setAttribute('fill', baseColor);
          pathEl.setAttribute('opacity', '1.0');
          pathEl.setAttribute('stroke', 'var(--surface-1)');
          pathEl.setAttribute('stroke-width', '1.5');
          pathEl.setAttribute('transform', 'scale(1.08)');
        } else {
          pathEl.setAttribute('fill', hexToRgba(baseColor, 0.3));
          pathEl.setAttribute('opacity', '0.2');
          pathEl.setAttribute('stroke', 'var(--surface-1)');
          pathEl.setAttribute('stroke-width', '1.5');
          pathEl.setAttribute('transform', 'scale(1)');
        }
      } else {
        pathEl.setAttribute('fill', hexToRgba(baseColor, 0.8));
        pathEl.setAttribute('opacity', '1.0');
        pathEl.setAttribute('stroke', 'var(--surface-1)');
        pathEl.setAttribute('stroke-width', '1.5');
        pathEl.setAttribute('transform', 'scale(1)');
      }
    });
  }

  // --- Draw wedges (Coxcomb Slices) ---
  sortedStats.forEach((s, i) => {
    const normalizedRatio = Math.sqrt(s.lines / maxLines);
    const radius = minRadius + (maxRadius - minRadius) * normalizedRatio;

    const startAngle = currentAngle;
    const endAngle = currentAngle + angleStep;
    const midAngle = startAngle + angleStep / 2;

    const x1 = centerX + radius * Math.cos(startAngle);
    const y1 = centerY + radius * Math.sin(startAngle);
    const x2 = centerX + radius * Math.cos(endAngle);
    const y2 = centerY + radius * Math.sin(endAngle);

    const minX1 = centerX + minRadius * Math.cos(startAngle);
    const minY1 = centerY + minRadius * Math.sin(startAngle);
    const minX2 = centerX + minRadius * Math.cos(endAngle);
    const minY2 = centerY + minRadius * Math.sin(endAngle);

    const largeArcFlag = angleStep > Math.PI ? 1 : 0;

    let pathData;
    if (sortedStats.length === 1) {
      pathData = `M 0 ${-radius} A ${radius} ${radius} 0 1 1 0 ${radius} A ${radius} ${radius} 0 1 1 0 ${-radius} Z`;
    } else {
      pathData = [
        `M ${minX1} ${minY1}`,
        `L ${x1} ${y1}`,
        `A ${radius} ${radius} 0 ${largeArcFlag} 1 ${x2} ${y2}`,
        `L ${minX2} ${minY2}`,
        `A ${minRadius} ${minRadius} 0 ${largeArcFlag} 0 ${minX1} ${minY1}`,
        `Z`
      ].join(' ');
    }

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', pathData);
    path.style.cursor = 'pointer';

    const color = getCommitColor(s.hash);
    const pct = ((s.lines / totalLines) * 100).toFixed(1);

    paths.push({
      pathEl: path,
      hash: s.hash,
      baseColor: color
    });

    // Mouse enter
    path.addEventListener('mouseenter', (e) => {
      hoveredSliceHash = s.hash;
      updateSliceStyles();

      if (tooltip) {
        const shortHash = s.hash.substring(0, 7);
        const maxMsgLen = 45;
        const msg = s.summary.length > maxMsgLen ? s.summary.substring(0, maxMsgLen) + '...' : s.summary;
        tooltip.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
              <div style="display: flex; align-items: center; background: rgba(128, 128, 128, 0.15); border: 1px solid rgba(128, 128, 128, 0.2); border-radius: 4px; padding: 2px 6px; font-size: 11px; font-family: var(--vscode-editor-font-family, monospace);">
                <i class="codicon codicon-git-commit" style="font-size: 12px; margin-right: 4px; opacity: 0.8;"></i>
                <span style="font-weight: 600; opacity: 0.9;">${shortHash}</span>
              </div>
              <div style="font-weight: 600; font-size: 12px; color: var(--accent); display: flex; align-items: center;">
                ${s.lines} 行 (${pct}%)
              </div>
            </div>
            <div style="font-size: 13px; line-height: 1.5; font-weight: 400; opacity: 0.95; margin-bottom: 10px; max-width: 260px; word-wrap: break-word;">
              ${escapeHtml(msg || '')}
            </div>
            <div style="display: flex; align-items: center; font-size: 12px; opacity: 0.8; border-top: 1px solid rgba(128, 128, 128, 0.15); padding-top: 8px;">
              <i class="codicon codicon-account" style="font-size: 13px; margin-right: 6px;"></i>
              <span>${escapeHtml(s.author)}</span>
            </div>
          `;
        tooltip.classList.remove('hidden');
      }

      // Notify editor to highlight
      window.vscode.postMessage({
        command: 'hoverBlameCommit',
        hash: s.hash,
        color: hexToRgba(color, 0.25)
      });
    });

    // Mouse move
    path.addEventListener('mousemove', (e) => {
      if (tooltip) {
        const containerRect = svg.parentElement.getBoundingClientRect();
        const x = e.clientX - containerRect.left;
        const y = e.clientY - containerRect.top;
        tooltip.style.left = (x + 10) + 'px';
        tooltip.style.top = (y + 10) + 'px';
      }
    });

    // Mouse leave
    path.addEventListener('mouseleave', () => {
      hoveredSliceHash = null;
      updateSliceStyles();

      if (tooltip) {
        tooltip.classList.add('hidden');
      }

      // Clear editor highlight unless there is a locked slice
      if (lockedSliceHash) {
        window.vscode.postMessage({
          command: 'hoverBlameCommit',
          hash: lockedSliceHash,
          color: hexToRgba(lockedSliceColor, 0.25)
        });
      } else {
        window.vscode.postMessage({ command: 'clearHoverBlameCommit' });
      }
    });

    // Click: Lock / Unlock slice
    path.addEventListener('click', (e) => {
      e.stopPropagation(); // prevent bubbling to svg background click
      if (lockedSliceHash === s.hash) {
        // Unlock
        lockedSliceHash = null;
        lockedSliceColor = null;
      } else {
        // Lock
        lockedSliceHash = s.hash;
        lockedSliceColor = color;
      }
      updateSliceStyles();

      // Ensure Editor is highlighted with current lock or hover
      if (lockedSliceHash) {
        window.vscode.postMessage({
          command: 'hoverBlameCommit',
          hash: lockedSliceHash,
          color: hexToRgba(lockedSliceColor, 0.25)
        });
      } else {
        // If unlocked, highlight the hovered one
        window.vscode.postMessage({
          command: 'hoverBlameCommit',
          hash: s.hash,
          color: hexToRgba(color, 0.25)
        });
      }
    });

    svg.appendChild(path);

    currentAngle = endAngle;
  });

  // Handle initial styles (e.g. if lockedSliceHash is already set)
  updateSliceStyles();

  // Click SVG empty space to unlock
  svg.addEventListener('click', (e: any) => {
    if (!e.target || !e.target.tagName) return;
    if (e.target.tagName !== 'path') {
      lockedSliceHash = null;
      lockedSliceColor = null;
      updateSliceStyles();
      window.vscode.postMessage({ command: 'clearHoverBlameCommit' });
    }
  });
}

