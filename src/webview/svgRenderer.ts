import { state } from './state';
import { elements } from './dom';
import { colors } from './utils/format';
import { constants } from './constants';

const rowHeight = constants.rowHeight;
const laneWidth = constants.laneWidth;
const paddingLeft = constants.paddingLeft;

let isGraphEventsInitialized = false;

export function initGraphEvents() {
  if (isGraphEventsInitialized || !elements.graphSvg || !elements.graphSvg.addEventListener) return;
  isGraphEventsInitialized = true;

  elements.graphSvg.addEventListener('mouseover', (e: Event) => {
    const target = (e.target as Element)?.closest?.('[data-branch-id]');
    if (target) {
      const branchId = parseInt(target.getAttribute('data-branch-id') || '', 10);
      if (!isNaN(branchId)) {
        highlightLane(branchId);
      }
    }
  });

  elements.graphSvg.addEventListener('mouseout', (e: Event) => {
    const target = (e.target as Element)?.closest?.('[data-branch-id]');
    if (target) {
      clearLaneHighlight();
    }
  });
}

export function highlightLane(branchId: number) {
  elements.graphSvg.classList.add('hover-active');
  elements.graphSvg.querySelectorAll(`.lane-path-${branchId}`).forEach(p => p.classList.add('hovered-lane-path'));
  elements.graphSvg.querySelectorAll(`.lane-node-${branchId}`).forEach(n => n.classList.add('hovered-lane-node'));
}

export function clearLaneHighlight() {
  elements.graphSvg.classList.remove('hover-active');
  elements.graphSvg.querySelectorAll('.hovered-lane-path').forEach(p => p.classList.remove('hovered-lane-path'));
  elements.graphSvg.querySelectorAll('.hovered-lane-node').forEach(n => n.classList.remove('hovered-lane-node'));
}

export function drawSvg(startIndex: number, endIndex: number) {
  initGraphEvents();
  elements.graphSvg.innerHTML = '';

  // Clear hover state to prevent stuck dimming when SVG re-renders (e.g. on click)
  elements.graphSvg.classList.remove('hover-active');

  function getBranchColor(branchId: number) {
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

  // ── Path rendering (Batched by branch/stroke to minimize DOM nodes) ──
  const pathGroups = new Map<string, { branchId: number; color: string; strokeWidth: number; d: string; isDotted?: boolean }>();

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

    const isMergeLine = line.isMergeLine;
    const isMainTrunk = (line.colorIdx === 0 && !isMergeLine);
    const strokeWidth = isMainTrunk ? 2 : 1.5;

    const segH = y2 - y1;
    const topCurve = (x_from !== x_run);
    const botCurve = (x_run !== x_to);

    let segD = `M ${x_from} ${y1}`;

    if (!topCurve && !botCurve) {
      segD += ` L ${x_to} ${y2}`;
    } else if (topCurve && !botCurve) {
      const curveH = Math.min(rowHeight, segH);
      const y_mid = y1 + curveH / 2;
      segD += ` C ${x_from} ${y_mid}, ${x_run} ${y_mid}, ${x_run} ${y1 + curveH}`;
      if (y1 + curveH < y2) {
        segD += ` L ${x_run} ${y2}`;
      }
    } else if (!topCurve && botCurve) {
      const curveH = Math.min(rowHeight, segH);
      const curveStartY = y2 - curveH;
      if (y1 < curveStartY) {
        segD += ` L ${x_run} ${curveStartY}`;
      }
      const y_mid = curveStartY + curveH / 2;
      segD += ` C ${x_run} ${y_mid}, ${x_to} ${y_mid}, ${x_to} ${y2}`;
    } else {
      const curveH = Math.min(rowHeight, segH / 2);
      const topEnd = y1 + curveH;
      const botStart = y2 - curveH;

      segD += ` C ${x_from} ${y1 + curveH / 2}, ${x_run} ${y1 + curveH / 2}, ${x_run} ${topEnd}`;
      if (botStart > topEnd) {
        segD += ` L ${x_run} ${botStart}`;
      }
      segD += ` C ${x_run} ${botStart + curveH / 2}, ${x_to} ${botStart + curveH / 2}, ${x_to} ${y2}`;
    }

    const isDotted = !!line.isWorkingTreeLine;
    const groupKey = `${branchId}_${strokeWidth}_${isDotted ? 'dashed' : 'solid'}`;
    const existing = pathGroups.get(groupKey);
    if (existing) {
      existing.d += ' ' + segD;
    } else {
      pathGroups.set(groupKey, { branchId, color, strokeWidth, d: segD, isDotted });
    }
  });

  pathGroups.forEach(group => {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('class', `lane-path-${group.branchId}`);
    path.setAttribute('data-branch-id', group.branchId.toString());
    path.setAttribute('d', group.d);
    path.setAttribute('stroke', group.color);
    path.setAttribute('stroke-width', group.strokeWidth.toString());
    path.setAttribute('fill', 'none');
    if (group.isDotted) {
      path.setAttribute('stroke-dasharray', '4,3');
    }

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

    if (c.hash === '*working-tree*') {
      const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      group.setAttribute('class', `node-group-${c.hash}`);
      group.setAttribute('data-branch-id', branchId.toString());

      const outer = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      outer.setAttribute('class', `node-${c.hash} lane-node-${branchId} working-tree-node${isSelected ? ' selected' : ''}`);
      outer.setAttribute('cx', String(x));
      outer.setAttribute('cy', String(y));
      outer.setAttribute('r', isSelected ? '6.5' : '5.5');
      outer.setAttribute('fill', 'var(--bg-color)');
      outer.setAttribute('stroke', color);
      outer.setAttribute('stroke-width', '1.8');
      outer.setAttribute('stroke-dasharray', '2.5,2');

      const inner = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      inner.setAttribute('class', `node-${c.hash} lane-node-${branchId} working-tree-inner${isSelected ? ' selected' : ''}`);
      inner.setAttribute('cx', String(x));
      inner.setAttribute('cy', String(y));
      inner.setAttribute('r', '2');
      inner.setAttribute('fill', color);

      group.appendChild(outer);
      group.appendChild(inner);

      elements.graphSvg.appendChild(group);
    } else if (node.isMerge) {
      const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      group.setAttribute('class', `node-group-${c.hash}`);
      group.setAttribute('data-branch-id', branchId.toString());

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

      elements.graphSvg.appendChild(group);
    } else {
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('class', `node-${c.hash} lane-node-${branchId}${isSelected ? ' selected' : ''}`);
      circle.setAttribute('data-branch-id', branchId.toString());
      circle.setAttribute('cx', String(x));
      circle.setAttribute('cy', String(y));
      circle.setAttribute('r', isSelected ? '5' : '4.5');
      circle.setAttribute('fill', color);
      circle.setAttribute('stroke', 'var(--bg-color)');
      circle.setAttribute('stroke-width', '1.5');

      elements.graphSvg.appendChild(circle);
    }
  }
}

export function selectCircleInGraph(hash) {
  // Redraw SVG to properly render selection ring and glow effects
  drawSvg(state.lastStartIndex || 0, state.lastEndIndex || state.commits.length - 1);
}

