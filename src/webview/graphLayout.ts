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
import { MinHeap } from '../utils/minHeap';

const rowHeight = constants.rowHeight;
const laneWidth = constants.laneWidth;
const paddingLeft = constants.paddingLeft;

/**
 * FreeLanePool manages available lane slots using a binary MinHeap.
 * It implements greedy interval graph coloring on DAG, always recycling
 * the lowest available lane index in O(log K) time to keep graph width minimal.
 */
export class FreeLanePool {
  private minHeap: MinHeap<number>;
  private pooled: Set<number>;

  constructor() {
    this.minHeap = new MinHeap<number>((a, b) => a - b);
    this.pooled = new Set<number>();
  }

  public release(laneIdx: number): void {
    if (laneIdx > 0 && !this.pooled.has(laneIdx)) {
      this.pooled.add(laneIdx);
      this.minHeap.push(laneIdx);
    }
  }

  public acquire(lanes: (string | null)[], preferZero = false): number {
    if (preferZero && (lanes.length === 0 || lanes[0] === null)) {
      if (lanes.length === 0) lanes.push(null);
      return 0;
    }
    if (lanes.length === 0) {
      lanes.push(null); // lane 0 is reserved for main trunk
    }

    while (!this.minHeap.isEmpty) {
      const minLane = this.minHeap.pop()!;
      this.pooled.delete(minLane);
      if (minLane < lanes.length && lanes[minLane] === null) {
        return minLane;
      }
    }

    for (let i = 1; i < lanes.length; i++) {
      if (lanes[i] === null) {
        return i;
      }
    }

    const idx = lanes.length;
    lanes.push(null);
    return idx;
  }

  public clear(): void {
    this.minHeap.clear();
    this.pooled.clear();
  }
}

export interface MergeBranchInfo {
  sourceBranch?: string; // the branch that was merged in (parents[1])
  targetBranch?: string; // the branch that was merged into (parents[0])
}

/**
 * Extract source and target branch names from Git merge commit messages.
 * Handles GitHub/GitLab PRs, standard branch merges, and remote-tracking merges.
 */
export function parseMergeMessage(message: string): MergeBranchInfo | null {
  if (!message) return null;
  const firstLine = message.split('\n')[0].trim();

  // 1. "Merge pull request #3481 from deepseek-harness/fix/http-proxy-rc-version"
  const prMatch = firstLine.match(/Merge pull request #\d+ from ([^\s\n]+)(?:\s+into\s+([^\s\n]+))?/i);
  if (prMatch) {
    let src = prMatch[1].trim();
    // Clean fork repo prefix if present (e.g. "deepseek-harness/fix/xxx" -> "fix/xxx")
    const slashIdx = src.indexOf('/');
    if (slashIdx !== -1) {
      const remainder = src.substring(slashIdx + 1);
      if (remainder.includes('/') || remainder.startsWith('fix') || remainder.startsWith('feature') || remainder.startsWith('worktree') || remainder.startsWith('hotfix')) {
        src = remainder;
      }
    }
    return {
      sourceBranch: src,
      targetBranch: prMatch[2] ? prMatch[2].trim() : undefined
    };
  }

  // 2. "Merge remote-tracking branch 'origin/xxx' into yyy" or "Merge remote-tracking branch 'origin/xxx'"
  const remoteMatch = firstLine.match(/Merge remote-tracking branch ['"]?([^'"\s]+)['"]?(?:\s+into\s+['"]?([^'"\s]+)['"]?)?/i);
  if (remoteMatch) {
    const src = remoteMatch[1].replace(/^[^\/]+\//, '').trim();
    const tgt = remoteMatch[2] ? remoteMatch[2].replace(/^['"]/, '').replace(/['"]$/, '').trim() : undefined;
    return { sourceBranch: src, targetBranch: tgt };
  }

  // 3. "Merge branch 'xxx' into yyy" or "Merge branch 'xxx'"
  const branchMatch = firstLine.match(/Merge branch ['"]?([^'"\s]+)['"]?(?:\s+into\s+['"]?([^'"\s]+)['"]?)?/i);
  if (branchMatch) {
    const src = branchMatch[1].trim();
    const tgt = branchMatch[2] ? branchMatch[2].trim() : undefined;
    return { sourceBranch: src, targetBranch: tgt };
  }

  // 4. "Merge xxx into yyy"
  const intoMatch = firstLine.match(/Merge\s+['"]?([^'"\s]+)['"]?\s+into\s+['"]?([^'"\s]+)['"]?/i);
  if (intoMatch && intoMatch[1] !== 'pull' && intoMatch[1] !== 'remote-tracking' && intoMatch[1] !== 'branch') {
    return {
      sourceBranch: intoMatch[1].trim(),
      targetBranch: intoMatch[2].trim()
    };
  }

  return null;
}

/**
 * Extract clean branch name from decoration array.
 */
export function extractBranchFromDecorations(decorations: string[] | undefined, remoteBranches: string[] = []): string | null {
  if (!decorations || decorations.length === 0) return null;

  // 1. Filter out pseudo/non-branch decorations
  const validDecs = decorations.filter(d =>
    d !== 'Working Tree' &&
    d !== 'HEAD' &&
    !d.startsWith('tag: ')
  );
  if (validDecs.length === 0) return null;

  // 2. Local branch in HEAD pointer: "HEAD -> main"
  const headPtr = validDecs.find(d => d.startsWith('HEAD -> '));
  if (headPtr) {
    return headPtr.substring(8).replace(/^origin\//, '').replace(/^refs\/remotes\/[^\/]+\//, '').trim();
  }

  // 3. Local branch directly
  const localBranch = validDecs.find(d =>
    !d.startsWith('origin/') &&
    !d.startsWith('refs/remotes/') &&
    !remoteBranches.includes(d)
  );
  if (localBranch) {
    return localBranch;
  }

  // 4. Remote branch: "origin/feat-1" or in remoteBranches
  const remoteDec = validDecs.find(d =>
    d.startsWith('origin/') || d.startsWith('refs/remotes/') || remoteBranches.includes(d)
  );
  if (remoteDec) {
    return remoteDec.replace(/^origin\//, '').replace(/^refs\/remotes\/[^\/]+\//, '');
  }

  return null;
}

/**
 * Infer the branch name for every commit in the graph using:
 * 1. Explicit commit decorations (local & remote branch pointers)
 * 2. Merge commit message semantic parsing (PR # / merge into)
 * 3. Topological downward DAG propagation along parent lanes with active branch handoff
 * 4. Trunk anchoring with dynamic branch switching at fork points
 */
export function inferCommitBranches(
  commits: any[],
  commitNodes: Record<string, any>,
  lines: any[],
  hashToCommitMap: Map<string, any>,
  mainTrunk: Set<string>,
  remoteBranches: string[]
): Record<string, { name: string | null; color: string }> {
  const commitToBranch = new Map<string, string>();

  // 1. First pass: Seed known branches from direct decorations and explicit merge messages
  commits.forEach(c => {
    if (c.hash === '*working-tree*') {
      return;
    }

    const decBranch = extractBranchFromDecorations(c.decorations, remoteBranches);
    if (decBranch) {
      commitToBranch.set(c.hash, decBranch);
    }

    if (c.parents && c.parents.length >= 2) {
      const mergeInfo = parseMergeMessage(c.message);
      if (mergeInfo) {
        if (mergeInfo.targetBranch && !commitToBranch.has(c.hash)) {
          commitToBranch.set(c.hash, mergeInfo.targetBranch);
        }
        if (mergeInfo.sourceBranch && !commitToBranch.has(c.parents[1])) {
          commitToBranch.set(c.parents[1], mergeInfo.sourceBranch);
        }
        if (mergeInfo.targetBranch && !commitToBranch.has(c.parents[0])) {
          commitToBranch.set(c.parents[0], mergeInfo.targetBranch);
        }
      }
    }
  });

  // 2. Identify initial trunk branch name from the first decorated commit on trunk
  let currentTrunkBranch = 'main';
  for (const c of commits) {
    if (c.hash !== '*working-tree*' && mainTrunk.has(c.hash)) {
      const decBranch = extractBranchFromDecorations(c.decorations, remoteBranches);
      if (decBranch) {
        currentTrunkBranch = decBranch;
        break;
      }
    }
  }

  // Working tree node belongs to the active trunk branch
  if (mainTrunk.has('*working-tree*')) {
    commitToBranch.set('*working-tree*', currentTrunkBranch);
  }

  // 3. Second pass: Downward DAG propagation along parent edges with dynamic branch handoff
  const laneCurrentBranch = new Map<number, string>();

  for (let r = 0; r < commits.length; r++) {
    const c = commits[r];
    if (c.hash === '*working-tree*') {
      continue;
    }

    const hash = c.hash;
    const node = commitNodes[hash];
    const lane = node ? node.lane : undefined;
    const isTrunk = mainTrunk.has(hash);

    let branch = commitToBranch.get(hash);

    // Dynamic branch handoff: If this commit has an explicit branch decoration and is on the trunk,
    // update the active trunk branch (e.g. switching from feature branch to dev/main trunk)!
    if (branch && isTrunk) {
      currentTrunkBranch = branch;
    } else if (!branch && isTrunk) {
      branch = currentTrunkBranch;
      commitToBranch.set(hash, branch);
    }

    // If a side lane commit has no branch yet, check if its lane has a known branch
    if (!branch && lane !== undefined && laneCurrentBranch.has(lane)) {
      branch = laneCurrentBranch.get(lane);
      commitToBranch.set(hash, branch!);
    }

    // Track current active branch for this lane
    if (branch && lane !== undefined) {
      laneCurrentBranch.set(lane, branch);
    }

    const parents = c.parents || [];
    if (parents.length === 1) {
      const p0 = parents[0];
      if (!commitToBranch.has(p0)) {
        if (mainTrunk.has(p0)) {
          commitToBranch.set(p0, currentTrunkBranch);
        } else if (branch) {
          commitToBranch.set(p0, branch);
        }
      }
    } else if (parents.length >= 2) {
      const p0 = parents[0];
      const p1 = parents[1];

      if (!commitToBranch.has(p0)) {
        if (mainTrunk.has(p0)) {
          commitToBranch.set(p0, currentTrunkBranch);
        } else if (branch) {
          commitToBranch.set(p0, branch);
        }
      }

      const mergeInfo = parseMergeMessage(c.message);
      const secondaryBranch = mergeInfo?.sourceBranch || commitToBranch.get(p1);
      if (secondaryBranch) {
        if (!commitToBranch.has(p1)) {
          if (mainTrunk.has(p1)) {
            commitToBranch.set(p1, currentTrunkBranch);
          } else {
            commitToBranch.set(p1, secondaryBranch);
          }
        }
        const p1Node = commitNodes[p1];
        if (p1Node && p1Node.lane !== undefined) {
          laneCurrentBranch.set(p1Node.lane, secondaryBranch);
        }
      }
    }
  }

  // 4. Build final result mapping
  const result: Record<string, { name: string | null; color: string }> = {};
  commits.forEach(c => {
    const node = commitNodes[c.hash];
    const laneColor = node ? colors[node.colorIdx % colors.length] : colors[0];
    const branchName = commitToBranch.get(c.hash) || null;
    result[c.hash] = {
      name: branchName,
      color: laneColor
    };
  });

  return result;
}

/**
 * Consolidate consecutive vertical straight segments on the same track into single lines.
 * This dramatically reduces the number of SVG sub-commands and keeps path strings minimal.
 */
export function consolidateLines(rawLines: any[]): any[] {
  const straightMap = new Map<string, any>();
  const consolidated: any[] = [];

  for (const line of rawLines) {
    const isStraight = (line.fromLane === line.toLane && !line.isMergeLine);
    if (isStraight) {
      const key = `${line.fromLane}_${line.colorIdx}_${!!line.isWorkingTreeLine}`;
      const prev = straightMap.get(key);
      if (prev && prev.toRow === line.fromRow && prev.toLane === line.fromLane) {
        prev.toRow = line.toRow;
        continue;
      }
      const cloned = { ...line };
      straightMap.set(key, cloned);
      consolidated.push(cloned);
    } else {
      straightMap.delete(`${line.fromLane}_${line.colorIdx}_${!!line.isWorkingTreeLine}`);
      consolidated.push(line);
    }
  }
  return consolidated;
}

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

  interface ActiveTrack {
    targetHash: string;
    colorIdx: number;
    isWorkingTree?: boolean;
  }

  let activeTracks: ActiveTrack[] = [];
  const commitNodes: Record<string, any> = {};
  const rawLines: any[] = [];
  let maxLanes = 0;
  let nextColorIdx = 1;

  // Determine if a commit is main trunk
  const mainTrunk = new Set<string>();
  let curr: string | null = null;
  if (state.commits[0] && state.commits[0].hash === '*working-tree*') {
    curr = state.commits[0].hash;
  } else {
    const headCommit = state.commits.find(c => c.decorations && c.decorations.some(d => d === 'HEAD' || d.startsWith('HEAD ->')));
    curr = headCommit ? headCommit.hash : (state.commits[0] ? state.commits[0].hash : null);
  }
  while (curr) {
    mainTrunk.add(curr);
    const c = hashToCommitMap.get(curr);
    curr = (c && c.parents && c.parents.length > 0) ? c.parents[0] : null;
  }

  // Branch colors decoration mapping
  state.branchColorMap.clear();

  for (let r = 0; r < state.commits.length; r++) {
    const c = state.commits[r];
    const hash = c.hash;
    const parents = c.parents || [];
    const isMerge = parents.length >= 2;

    // 1. Find or assign lane for current commit
    const matchingIndices: number[] = [];
    for (let i = 0; i < activeTracks.length; i++) {
      if (activeTracks[i].targetHash === hash) {
        matchingIndices.push(i);
      }
    }

    let nodeLane: number;
    let nodeColorIdx: number;
    if (matchingIndices.length > 0) {
      nodeLane = matchingIndices[0];
      nodeColorIdx = activeTracks[nodeLane].colorIdx;
    } else {
      // Brand new branch tip (HEAD, main trunk root, or unmerged branch tip)
      if (mainTrunk.has(hash) && activeTracks.length === 0) {
        nodeLane = 0;
        nodeColorIdx = 0;
      } else {
        // Standard Git Graph convention: unmerged branches always allocate on the outermost track!
        nodeLane = activeTracks.length;
        nodeColorIdx = nextColorIdx++;
      }
      activeTracks.push({
        targetHash: hash,
        colorIdx: nodeColorIdx,
        isWorkingTree: (hash === '*working-tree*')
      });
    }

    commitNodes[hash] = { row: r, lane: nodeLane, isMerge, colorIdx: nodeColorIdx };
    maxLanes = Math.max(maxLanes, activeTracks.length, nodeLane + 1);

    // Branch color mapping
    if (c.decorations && c.decorations.length > 0) {
      c.decorations.forEach(dec => {
        state.branchColorMap.set(dec, colors[nodeColorIdx % colors.length]);
      });
    }

    // 2. Prepare next row tracks and connections
    const targetNextTracks: (ActiveTrack | null)[] = activeTracks.map(t => ({ ...t }));
    const mergingTracks: { fromLane: number; toTargetLane: number; colorIdx: number; toHash?: string }[] = [];
    const branchingLines: { fromLane: number; toTargetLane: number; colorIdx: number; toHash?: string }[] = [];

    // Other tracks matching this commit merge into nodeLane at row r
    for (let m = 1; m < matchingIndices.length; m++) {
      const idx = matchingIndices[m];
      targetNextTracks[idx] = null;
      mergingTracks.push({
        fromLane: idx,
        toTargetLane: nodeLane,
        colorIdx: activeTracks[idx].colorIdx,
        toHash: hash
      });
    }

    // Process primary parent (parents[0])
    if (parents.length === 0) {
      // Root commit reached: branch terminates
      targetNextTracks[nodeLane] = null;
    } else {
      const p0 = parents[0];
      if (commitHashes.has(p0)) {
        const existingIdx = targetNextTracks.findIndex((t, idx) => idx !== nodeLane && t !== null && t.targetHash === p0);
        if (existingIdx !== -1) {
          if (nodeLane < existingIdx) {
            // Lower lane continues, higher lane terminates and merges in
            const higherColor = targetNextTracks[existingIdx]!.colorIdx;
            targetNextTracks[existingIdx] = null;
            targetNextTracks[nodeLane]!.targetHash = p0;
            mergingTracks.push({ fromLane: existingIdx, toTargetLane: nodeLane, colorIdx: higherColor, toHash: p0 });
          } else {
            // Current lane is higher: terminates into existing lower lane
            targetNextTracks[nodeLane] = null;
            mergingTracks.push({ fromLane: nodeLane, toTargetLane: existingIdx, colorIdx: nodeColorIdx, toHash: p0 });
          }
        } else {
          targetNextTracks[nodeLane]!.targetHash = p0;
        }
      } else {
        // Parent not loaded
        if (shouldDrawToBottom) {
          targetNextTracks[nodeLane]!.targetHash = p0;
        } else {
          targetNextTracks[nodeLane] = null;
        }
      }
    }

    // Process secondary parents (parents[1..])
    for (let p = 1; p < parents.length; p++) {
      const pk = parents[p];
      const existingIdx = targetNextTracks.findIndex(t => t !== null && t.targetHash === pk);
      if (existingIdx !== -1) {
        branchingLines.push({
          fromLane: nodeLane,
          toTargetLane: existingIdx,
          colorIdx: targetNextTracks[existingIdx]!.colorIdx,
          toHash: pk
        });
      } else {
        if (commitHashes.has(pk) || shouldDrawToBottom) {
          const newLane = targetNextTracks.length;
          const newColor = nextColorIdx++;
          targetNextTracks.push({
            targetHash: pk,
            colorIdx: newColor,
            isWorkingTree: (hash === '*working-tree*')
          });
          branchingLines.push({
            fromLane: nodeLane,
            toTargetLane: newLane,
            colorIdx: newColor,
            toHash: pk
          });
        }
      }
    }

    // 3. Lane Compaction (Inward shift when lanes terminate)
    const nextTracks: ActiveTrack[] = [];
    const laneMap = new Map<number, number>();
    for (let i = 0; i < targetNextTracks.length; i++) {
      const tr = targetNextTracks[i];
      if (tr !== null && tr.targetHash !== '') {
        const newL = nextTracks.length;
        nextTracks.push(tr);
        laneMap.set(i, newL);
      }
    }

    // Generate transition lines between row r and row r + 1
    if (r < state.commits.length - 1) {
      // Surviving tracks
      for (let i = 0; i < activeTracks.length; i++) {
        if (laneMap.has(i)) {
          const toL = laneMap.get(i)!;
          rawLines.push({
            fromRow: r,
            fromLane: i,
            toRow: r + 1,
            toLane: toL,
            runningLane: toL,
            colorIdx: activeTracks[i].colorIdx,
            toHash: activeTracks[i].targetHash,
            isWorkingTreeLine: !!activeTracks[i].isWorkingTree
          });
        }
      }
      // Merging tracks (inward merge curves)
      for (const mt of mergingTracks) {
        const toL = laneMap.has(mt.toTargetLane) ? laneMap.get(mt.toTargetLane)! : mt.toTargetLane;
        rawLines.push({
          fromRow: r,
          fromLane: mt.fromLane,
          toRow: r + 1,
          toLane: toL,
          runningLane: toL,
          colorIdx: mt.colorIdx,
          toHash: mt.toHash,
          isMergeLine: true
        });
      }
      // Branching lines (outward fork curves)
      for (const bl of branchingLines) {
        const toL = laneMap.has(bl.toTargetLane) ? laneMap.get(bl.toTargetLane)! : bl.toTargetLane;
        rawLines.push({
          fromRow: r,
          fromLane: bl.fromLane,
          toRow: r + 1,
          toLane: toL,
          runningLane: toL,
          colorIdx: bl.colorIdx,
          toHash: bl.toHash,
          isMergeLine: true
        });
      }
    } else if (shouldDrawToBottom) {
      // Last row: draw tracks to bottom
      for (let i = 0; i < activeTracks.length; i++) {
        rawLines.push({
          fromRow: r,
          fromLane: i,
          toRow: state.commits.length - 0.5,
          toLane: i,
          runningLane: i,
          colorIdx: activeTracks[i].colorIdx,
          toHash: activeTracks[i].targetHash,
          isWorkingTreeLine: !!activeTracks[i].isWorkingTree
        });
      }
    }

    activeTracks = nextTracks;
    maxLanes = Math.max(maxLanes, activeTracks.length);
  }

  // 4. Consolidate straight vertical lines to optimize SVG rendering
  const lines = consolidateLines(rawLines);

  state.cachedLines = lines;
  state.cachedCommitNodes = commitNodes;

  // Build commit → branch name mapping using DAG topological propagation & merge message parsing
  state.commitBranchLabel = inferCommitBranches(
    state.commits,
    commitNodes,
    lines,
    hashToCommitMap,
    mainTrunk,
    state.remoteBranches
  );

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
  if (typeof window !== 'undefined') {
    window.rowMaxLanes = rowMaxLanes;
  }

  // Dynamic graph width
  const computedGraphWidth = paddingLeft + (maxLanes + 1) * laneWidth;
  state.currentGraphWidth = computedGraphWidth;

  if (typeof document !== 'undefined') {
    const graphHeader = document.querySelector('th.graph-col');
    if (graphHeader) {
      (graphHeader as HTMLElement).style.width = computedGraphWidth + 'px';
      (graphHeader as HTMLElement).style.minWidth = computedGraphWidth + 'px';
    }
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
    // 筛选/刷新时没有选中的提交：只清除行高亮和SVG选中状态，
    // 不收起右侧面板（面板可见性由 statsLoaded 消息统一管理）
    const previouslySelected = elements.commitsTbody.querySelector('tr.commit-row.selected');
    if (previouslySelected) {
      previouslySelected.classList.remove('selected');
    }
    selectCircleInGraph(null);
  }
}

