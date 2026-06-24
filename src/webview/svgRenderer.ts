import { state } from './state';
import { elements } from './dom';
import { colors, getRelativeTime, formatDate, escapeHtml, hexToRgba, getAvatarColor, getInitials, fmtNum } from './utils/format';
import { RightPaneState } from './types';
import { getFileIconInfo } from './utils/fileIcons';
import { constants } from './constants';
import { setRightPane, setRightPaneVisible, ensureDetailsExpanded } from './rightPane';
import { requestStats, hideLoading, showLoading } from './dataLoader';

const rowHeight = constants.rowHeight;
const laneWidth = constants.laneWidth;
const paddingLeft = constants.paddingLeft;

export function drawSvg(startIndex: number, endIndex: number) {
  elements.graphSvg.innerHTML = '';

  // Clear hover state to prevent stuck dimming when SVG re-renders (e.g. on click)
  elements.graphSvg.classList.remove('hover-active');

  function getBranchColor(branchId) {
    if (branchId < colors.length) {
      return colors[branchId];
    }
    const hue = (branchId * 137.508) % 360;
    return `hsl(${hue}, 75%, 60%)`;
  }

  if (state.commits.length === 0) {
    elements.graphSvg.style.height = '0px';
    return;
  }

  function getYCoordinate(rowIndex) {
    return rowIndex * rowHeight + rowHeight / 2;
  }

  // ── Path rendering (elegant "guqin string" style: smooth gentle S-curves) ──
  state.cachedLines.forEach(line => {
    // SVG path virtualization check: only draw paths that intersect the visible indices
    const minRow = Math.min(line.fromRow, line.toRow);
    const maxRow = Math.max(line.fromRow, line.toRow);
    if (maxRow < startIndex || minRow > endIndex) {
      return;
    }

    const x_from = paddingLeft + line.fromLane * laneWidth;
    const x_run = paddingLeft + (line.runningLane !== undefined ? line.runningLane : line.fromLane) * laneWidth;
    const x_to = paddingLeft + line.toLane * laneWidth;

    const y1 = getYCoordinate(line.fromRow);
    const y2 = getYCoordinate(line.toRow);

    const branchId = line.colorIdx;
    const color = getBranchColor(branchId);

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('class', `lane-path-${branchId}`);

    const isMergeLine = line.isMergeLine;
    const isMainTrunk = (line.colorIdx === 0 && !isMergeLine);
    const strokeWidth = isMainTrunk ? 2 : (isMergeLine ? 1.5 : 1.5);

    const segH = y2 - y1;
    const topCurve = (x_from !== x_run);
    const botCurve = (x_run !== x_to);

    let d = `M ${x_from} ${y1}`;

    if (!topCurve && !botCurve) {
      d += ` L ${x_to} ${y2}`;
    } else if (topCurve && !botCurve) {
      const curveH = Math.min(rowHeight, segH);
      const y_mid = y1 + curveH / 2;
      d += ` C ${x_from} ${y_mid}, ${x_run} ${y_mid}, ${x_run} ${y1 + curveH}`;
      if (y1 + curveH < y2) {
        d += ` L ${x_run} ${y2}`;
      }
    } else if (!topCurve && botCurve) {
      const curveH = Math.min(rowHeight, segH);
      const curveStartY = y2 - curveH;
      if (y1 < curveStartY) {
        d += ` L ${x_run} ${curveStartY}`;
      }
      const y_mid = curveStartY + curveH / 2;
      d += ` C ${x_run} ${y_mid}, ${x_to} ${y_mid}, ${x_to} ${y2}`;
    } else {
      const curveH = Math.min(rowHeight, segH / 2);
      const topEnd = y1 + curveH;
      const botStart = y2 - curveH;

      d += ` C ${x_from} ${y1 + curveH / 2}, ${x_run} ${y1 + curveH / 2}, ${x_run} ${topEnd}`;
      if (botStart > topEnd) {
        d += ` L ${x_run} ${botStart}`;
      }
      d += ` C ${x_run} ${botStart + curveH / 2}, ${x_to} ${botStart + curveH / 2}, ${x_to} ${y2}`;
    }

    path.setAttribute('d', d);
    path.setAttribute('stroke', color);
    path.setAttribute('stroke-width', strokeWidth.toString());
    path.setAttribute('fill', 'none');

    path.addEventListener('mouseover', () => {
      const branchId = line.colorIdx;
      elements.graphSvg.classList.add('hover-active');
      elements.graphSvg.querySelectorAll(`.lane-path-${branchId}`).forEach(p => p.classList.add('hovered-lane-path'));
      elements.graphSvg.querySelectorAll(`.lane-node-${branchId}`).forEach(n => n.classList.add('hovered-lane-node'));
    });
    path.addEventListener('mouseout', () => {
      elements.graphSvg.classList.remove('hover-active');
      elements.graphSvg.querySelectorAll('.hovered-lane-path').forEach(p => p.classList.remove('hovered-lane-path'));
      elements.graphSvg.querySelectorAll('.hovered-lane-node').forEach(n => n.classList.remove('hovered-lane-node'));
    });

    elements.graphSvg.appendChild(path);
  });

  // ── Node rendering (clean, no glow, no ring) ──
  for (let r = startIndex; r <= endIndex; r++) {
    const c = state.commits[r];
    if (!c) continue;
    const node = state.cachedCommitNodes[c.hash];
    if (!node) continue;
    const x = paddingLeft + node.lane * laneWidth;
    const y = getYCoordinate(r);
    const branchId = node.colorIdx;
    const color = getBranchColor(branchId);
    const isSelected = (c.hash === state.selectedCommitHash);

    if (node.isMerge) {
      const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      group.setAttribute('class', `node-group-${c.hash}`);

      const outer = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      outer.setAttribute('class', `node-${c.hash} lane-node-${branchId} merge-outer${isSelected ? ' selected' : ''}`);
      outer.setAttribute('cx', String(x));
      outer.setAttribute('cy', String(y));
      outer.setAttribute('r', isSelected ? '6' : '5.5');
      outer.setAttribute('fill', 'var(--bg-color)');
      outer.setAttribute('stroke', color);
      outer.setAttribute('stroke-width', '1.5');

      const inner = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      inner.setAttribute('class', `node-${c.hash} lane-node-${branchId} merge-inner${isSelected ? ' selected' : ''}`);
      inner.setAttribute('cx', String(x));
      inner.setAttribute('cy', String(y));
      inner.setAttribute('r', '2.5');
      inner.setAttribute('fill', color);

      group.appendChild(outer);
      group.appendChild(inner);

      group.addEventListener('mouseover', () => {
        elements.graphSvg.classList.add('hover-active');
        elements.graphSvg.querySelectorAll(`.lane-path-${branchId}`).forEach(p => p.classList.add('hovered-lane-path'));
        elements.graphSvg.querySelectorAll(`.lane-node-${branchId}`).forEach(n => n.classList.add('hovered-lane-node'));
      });
      group.addEventListener('mouseout', () => {
        elements.graphSvg.classList.remove('hover-active');
        elements.graphSvg.querySelectorAll('.hovered-lane-path').forEach(p => p.classList.remove('hovered-lane-path'));
        elements.graphSvg.querySelectorAll('.hovered-lane-node').forEach(n => n.classList.remove('hovered-lane-node'));
      });

      elements.graphSvg.appendChild(group);
    } else {
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('class', `node-${c.hash} lane-node-${branchId}${isSelected ? ' selected' : ''}`);
      circle.setAttribute('cx', String(x));
      circle.setAttribute('cy', String(y));
      circle.setAttribute('r', isSelected ? '5' : '4.5');
      circle.setAttribute('fill', color);
      circle.setAttribute('stroke', 'var(--bg-color)');
      circle.setAttribute('stroke-width', '1.5');

      circle.addEventListener('mouseover', () => {
        elements.graphSvg.classList.add('hover-active');
        elements.graphSvg.querySelectorAll(`.lane-path-${branchId}`).forEach(p => p.classList.add('hovered-lane-path'));
        elements.graphSvg.querySelectorAll(`.lane-node-${branchId}`).forEach(n => n.classList.add('hovered-lane-node'));
      });
      circle.addEventListener('mouseout', () => {
        elements.graphSvg.classList.remove('hover-active');
        elements.graphSvg.querySelectorAll('.hovered-lane-path').forEach(p => p.classList.remove('hovered-lane-path'));
        elements.graphSvg.querySelectorAll('.hovered-lane-node').forEach(n => n.classList.remove('hovered-lane-node'));
      });

      elements.graphSvg.appendChild(circle);
    }
  }
}

export function selectCircleInGraph(hash) {
  // Redraw SVG to properly render selection ring and glow effects
  drawSvg(state.lastStartIndex || 0, state.lastEndIndex || state.commits.length - 1);
}

