import { state } from './state';
import { elements } from './dom';
import { colors, getRelativeTime, formatDate, escapeHtml, hexToRgba, getAvatarColor, getInitials, fmtNum } from './utils/format';
import { RightPaneState } from './types';
import { getFileIconInfo } from './utils/fileIcons';
import { constants } from './constants';
import { setRightPane, setRightPaneVisible, ensureDetailsExpanded } from './rightPane';
import { requestStats, hideLoading, showLoading } from './dataLoader';

import { updateVirtualList } from './virtualList';
import { selectCircleInGraph } from './svgRenderer';
import { collapseDetail } from './commitDetail';

const rowHeight = constants.rowHeight;
const laneWidth = constants.laneWidth;
const paddingLeft = constants.paddingLeft;

export function renderTableAndGraph() {
  const oldSelectedHash = state.selectedCommitHash;

  if (state.commits.length === 0) {
    elements.commitsTbody.innerHTML = '';
    const tr = document.createElement('tr');
    tr.innerHTML = `<td colspan="5">
        <div class="empty-state">
          <i class="codicon codicon-git-commit"></i>
          <span>没有找到匹配的提交记录</span>
        </div>
      </td>`;
    elements.commitsTbody.appendChild(tr);
    elements.graphSvg.style.height = '0px';
    elements.graphSvg.innerHTML = '';
    return;
  }

  // ─── 1. 图表 Lane 分配算法（防重叠新版）─────────

  const isFiltered = !!(
    (elements.authorSelect && elements.authorSelect.value) ||
    (elements.sinceDate && elements.sinceDate.value) ||
    (elements.untilDate && elements.untilDate.value) ||
    (elements.datePresetSelect && elements.datePresetSelect.value && elements.datePresetSelect.value !== 'custom') ||
    (elements.searchInput && elements.searchInput.value.trim())
  );
  const shouldDrawToBottom = state.hasMoreCommits && !isFiltered;

  const commitHashes = new Set(state.commits.map(c => c.hash));
  const hashToCommitMap = new Map();
  const hashToCommitRowMap = new Map();
  state.commits.forEach((c, index) => {
    hashToCommitMap.set(c.hash, c);
    hashToCommitRowMap.set(c.hash, index);
  });

  const lanes = [];             // lanes[i] = hash or null (activeLanes)
  const commitNodes = {};       // hash → { row, lane, isMerge }
  const lines = [];             // 连线数据
  let maxLanes = 0;

  // Helper to find first null slot or push a new one
  function getEmptyLaneIndex(preferZero = false) {
    if (preferZero && lanes[0] === null) {
      return 0;
    }
    const start = preferZero ? 0 : 1;
    for (let i = start; i < lanes.length; i++) {
      if (lanes[i] === null) {
        return i;
      }
    }
    if (preferZero && lanes.length === 0) {
      lanes.push(null); // lane 0
      return 0;
    }
    if (lanes.length === 0) {
      lanes.push(null); // lane 0
    }
    const idx = lanes.length;
    lanes.push(null);
    return idx;
  }

  // Determine if a commit is main trunk
  const mainTrunk = new Set();
  const headCommit = state.commits.find(c => c.decorations && c.decorations.includes('HEAD'));
  let curr = headCommit ? headCommit.hash : (state.commits[0] ? state.commits[0].hash : null);
  while (curr) {
    mainTrunk.add(curr);
    const c = hashToCommitMap.get(curr);
    curr = (c && c.parents && c.parents.length > 0) ? c.parents[0] : null;
  }

  // Branch colors decoration mapping
  state.branchColorMap.clear();

  let nextColorIdx = 1;
  const laneColorIndices = [0]; // lane 0 is mainTrunk, initialized to color index 0

  for (let r = 0; r < state.commits.length; r++) {
    const c = state.commits[r];
    const hash = c.hash;
    const parents = c.parents || [];
    const isMerge = parents.length >= 2;

    // 1. Find or assign lane for the current commit
    let laneIdx = lanes.indexOf(hash);
    if (laneIdx === -1) {
      // Not in activeLanes. This is a branch tip or HEAD.
      if (mainTrunk.has(hash)) {
        laneIdx = 0;
        if (lanes.length === 0) {
          lanes.push(hash);
        } else {
          lanes[0] = hash;
        }
        laneColorIndices[0] = 0;
      } else {
        laneIdx = getEmptyLaneIndex(false);
        lanes[laneIdx] = hash;
        laneColorIndices[laneIdx] = nextColorIdx++;
      }
    }

    // Update all lines pointing to this commit to use its final lane
    lines.forEach(line => {
      if (line.toHash === hash) {
        line.toLane = laneIdx;
        if (line.isMergeLine) {
          line.runningLane = laneIdx;
        }
      }
    });

    // Record commit node position with its unique color index
    const nodeColorIdx = laneColorIndices[laneIdx] !== undefined ? laneColorIndices[laneIdx] : 0;
    commitNodes[hash] = { row: r, lane: laneIdx, isMerge, colorIdx: nodeColorIdx };
    maxLanes = Math.max(maxLanes, lanes.length);

    // Branch color mapping
    if (c.decorations && c.decorations.length > 0) {
      c.decorations.forEach(dec => {
        state.branchColorMap.set(dec, colors[nodeColorIdx % colors.length]);
      });
    }

    // 2. Free up all slots containing the current commit in activeLanes
    for (let i = 0; i < lanes.length; i++) {
      if (lanes[i] === hash) {
        lanes[i] = null;
      }
    }

    // 3. Process parents to reserve lanes and generate lines
    if (parents.length > 0) {
      // A. Primary parent (first parent)
      const p0 = parents[0];
      if (commitHashes.has(p0)) {
        const p0Row = hashToCommitRowMap.get(p0);
        let targetLaneIdx = lanes.indexOf(p0);

        if (targetLaneIdx !== -1) {
          if (laneIdx < targetLaneIdx) {
            lanes[laneIdx] = p0;
            targetLaneIdx = laneIdx;
          }
        } else {
          targetLaneIdx = laneIdx;
          lanes[laneIdx] = p0;
        }

        lines.push({
          fromRow: r,
          fromLane: laneIdx,
          toRow: p0Row,
          toLane: targetLaneIdx,
          runningLane: laneIdx,
          toHash: p0,
          colorIdx: nodeColorIdx
        });
      } else {
        // Parent not loaded
        if (shouldDrawToBottom) {
          lanes[laneIdx] = p0;
          lines.push({
            fromRow: r,
            fromLane: laneIdx,
            toRow: state.commits.length - 0.5,
            toLane: laneIdx,
            runningLane: laneIdx,
            toHash: p0,
            colorIdx: nodeColorIdx
          });
        }
      }

      // B. Secondary parents (merge sources)
      for (let p = 1; p < parents.length; p++) {
        const pk = parents[p];
        if (commitHashes.has(pk)) {
          const pkRow = hashToCommitRowMap.get(pk);
          let targetLaneIdx = lanes.indexOf(pk);

          if (targetLaneIdx === -1) {
            let otherBranchChildLaneIdx = -1;
            for (let i = 0; i < lanes.length; i++) {
              const activeHash = lanes[i];
              if (activeHash) {
                const activeCommit = hashToCommitMap.get(activeHash);
                if (activeCommit && activeCommit.parents && activeCommit.parents[0] === pk) {
                  otherBranchChildLaneIdx = i;
                  break;
                }
              }
            }

            if (otherBranchChildLaneIdx !== -1) {
              targetLaneIdx = otherBranchChildLaneIdx;
            } else {
              targetLaneIdx = getEmptyLaneIndex(false);
              lanes[targetLaneIdx] = pk;
              laneColorIndices[targetLaneIdx] = nextColorIdx++;
            }
          }

          const targetColorIdx = laneColorIndices[targetLaneIdx] !== undefined ? laneColorIndices[targetLaneIdx] : 0;
          lines.push({
            fromRow: r,
            fromLane: laneIdx,
            toRow: pkRow,
            toLane: targetLaneIdx,
            runningLane: targetLaneIdx,
            toHash: pk,
            colorIdx: targetColorIdx,
            isMergeLine: true
          });
        } else {
          // Secondary parent not loaded
          if (shouldDrawToBottom) {
            let targetLaneIdx = lanes.indexOf(pk);
            if (targetLaneIdx === -1) {
              targetLaneIdx = getEmptyLaneIndex(false);
              lanes[targetLaneIdx] = pk;
              laneColorIndices[targetLaneIdx] = nextColorIdx++;
            }
            const targetColorIdx = laneColorIndices[targetLaneIdx] !== undefined ? laneColorIndices[targetLaneIdx] : 0;
            lines.push({
              fromRow: r,
              fromLane: laneIdx,
              toRow: state.commits.length - 0.5,
              toLane: targetLaneIdx,
              runningLane: targetLaneIdx,
              toHash: pk,
              colorIdx: targetColorIdx,
              isMergeLine: true
            });
          }
        }
      }
    }

    // Trim trailing nulls
    while (lanes.length > 0 && lanes[lanes.length - 1] === null) {
      lanes.pop();
    }
    maxLanes = Math.max(maxLanes, lanes.length);
  }

  state.cachedLines = lines;
  state.cachedCommitNodes = commitNodes;

  // Build commit → branch name mapping
  const laneCurrentBranch = {};
  state.commitBranchLabel = {};
  state.commits.forEach(c => {
    const node = commitNodes[c.hash];
    if (!node) return;
    const lane = node.lane;
    const laneColor = colors[node.colorIdx % colors.length];

    let resolvedBranch = null;
    if (c.decorations && c.decorations.length > 0) {
      resolvedBranch = c.decorations.find(d =>
        d !== 'HEAD' &&
        !d.startsWith('origin/') &&
        !d.startsWith('tag: ') &&
        !state.remoteBranches.includes(d)
      );

      if (!resolvedBranch && c.decorations[0] === 'HEAD') {
        resolvedBranch = c.decorations.find(d =>
          d !== 'HEAD' &&
          !d.startsWith('origin/') &&
          !d.startsWith('tag: ')
        );
      }

      if (!resolvedBranch) {
        const remoteDec = c.decorations.find(d =>
          d.startsWith('origin/') || state.remoteBranches.includes(d)
        );
        if (remoteDec) {
          resolvedBranch = remoteDec.replace(/^origin\//, '');
        }
      }
    }

    if (resolvedBranch) {
      laneCurrentBranch[lane] = { name: resolvedBranch, color: laneColor };
    }

    const branchLabel = laneCurrentBranch[lane] || null;
    state.commitBranchLabel[c.hash] = branchLabel
      ? { name: branchLabel.name, color: laneColor }
      : { name: null, color: laneColor };
  });

  // Calculate max lane for each row
  const rowMaxLanes = new Array(state.commits.length).fill(0);
  for (const hash in commitNodes) {
    const node = commitNodes[hash];
    if (node.row < state.commits.length) {
      rowMaxLanes[node.row] = Math.max(rowMaxLanes[node.row], node.lane);
    }
  }
  for (const line of lines) {
    const startRow = Math.max(0, Math.min(Math.floor(line.fromRow), Math.floor(line.toRow)));
    const endRow = Math.min(state.commits.length - 1, Math.max(Math.ceil(line.fromRow), Math.ceil(line.toRow)));
    for (let r = startRow; r <= endRow; r++) {
      rowMaxLanes[r] = Math.max(rowMaxLanes[r], line.fromLane, line.toLane, line.runningLane || 0);
    }
  }

  // Save row max lanes to window object
  window.rowMaxLanes = rowMaxLanes;

  // Dynamic graph width
  const computedGraphWidth = paddingLeft + (maxLanes + 1) * laneWidth;
  state.currentGraphWidth = computedGraphWidth;

  const graphHeader = document.querySelector('th.graph-col');
  if (graphHeader) {
    (graphHeader as HTMLElement).style.width = computedGraphWidth + 'px';
    (graphHeader as HTMLElement).style.minWidth = computedGraphWidth + 'px';
  }

  // Reset virtual indices to force a redraw
  state.lastStartIndex = -1;
  state.lastEndIndex = -1;

  // SVG sizes
  const totalHeight = state.commits.length * rowHeight;
  elements.graphSvg.style.width = computedGraphWidth + 'px';
  elements.graphSvg.style.height = totalHeight + 'px';

  // Trigger initial virtual list rendering
  updateVirtualList();

  // Restore selected status highlight in SVG graph
  if (oldSelectedHash) {
    selectCircleInGraph(oldSelectedHash);
  } else {
    collapseDetail();
  }
}

