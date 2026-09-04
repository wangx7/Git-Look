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

  const lanes: (string | null)[] = [];             // lanes[i] = hash or null (activeLanes)
  const commitNodes: Record<string, any> = {};       // hash → { row, lane, isMerge }
  const lines: any[] = [];             // 连线数据
  let maxLanes = 0;
  const freeLanePool = new FreeLanePool();

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
        laneIdx = freeLanePool.acquire(lanes, false);
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
        if (i > 0) {
          freeLanePool.release(i);
        }
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
          colorIdx: nodeColorIdx,
          isWorkingTreeLine: (hash === '*working-tree*')
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
            colorIdx: nodeColorIdx,
            isWorkingTreeLine: (hash === '*working-tree*')
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
                // 检查该 lane 上的 commit 是否把 pk 作为任意一个 parent
                // （旧实现只检查 parents[0]，导致通过 parents[1..] 合入的分支无法复用 lane，多占 1 lane）
                if (activeCommit && activeCommit.parents && activeCommit.parents.includes(pk)) {
                  otherBranchChildLaneIdx = i;
                  break;
                }
              }
            }

            if (otherBranchChildLaneIdx !== -1) {
              targetLaneIdx = otherBranchChildLaneIdx;
            } else {
              targetLaneIdx = freeLanePool.acquire(lanes, false);
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
            isMergeLine: true,
            isWorkingTreeLine: (hash === '*working-tree*')
          });
        } else {
          // Secondary parent not loaded
          if (shouldDrawToBottom) {
            let targetLaneIdx = lanes.indexOf(pk);
            if (targetLaneIdx === -1) {
              targetLaneIdx = freeLanePool.acquire(lanes, false);
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
    // 筛选/刷新时没有选中的提交：只清除行高亮和SVG选中状态，
    // 不收起右侧面板（面板可见性由 statsLoaded 消息统一管理）
    const previouslySelected = elements.commitsTbody.querySelector('tr.commit-row.selected');
    if (previouslySelected) {
      previouslySelected.classList.remove('selected');
    }
    selectCircleInGraph(null);
  }
}

