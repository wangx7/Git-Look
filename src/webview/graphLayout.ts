import { state } from './state';
import { elements } from './dom';
import { colors } from './utils/format';
import { constants } from './constants';
import { updateVirtualList } from './virtualList';
import { selectCircleInGraph } from './svgRenderer';
import { MinHeap } from '../utils/minHeap';
import { layoutGitGraph } from './graph/layout';
import { GraphNode } from './graph/types';

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

  // ─── 1. 纯函数 Graph Engine 计算 DAG 布局 ─────────

  const isFiltered = !!(
    (elements.authorSelect && elements.authorSelect.value) ||
    (elements.sinceDate && elements.sinceDate.value) ||
    (elements.untilDate && elements.untilDate.value) ||
    (elements.datePresetSelect && elements.datePresetSelect.value && elements.datePresetSelect.value !== 'custom') ||
    (elements.searchInput && elements.searchInput.value.trim())
  );
  const shouldDrawToBottom = state.hasMoreCommits && !isFiltered;

  const layout = layoutGitGraph(state.commits, [], {
    shouldDrawToBottom
  });

  state.graphLayout = layout;
  state.cachedLines = layout.segments;

  const commitNodesObj: Record<string, GraphNode> = {};
  state.branchColorMap.clear();

  for (const [hash, node] of layout.nodes) {
    commitNodesObj[hash] = node;
  }
  state.cachedCommitNodes = commitNodesObj;

  // Branch colors decoration mapping
  for (const c of state.commits) {
    const node = commitNodesObj[c.hash];
    if (node && c.decorations && c.decorations.length > 0) {
      c.decorations.forEach(dec => {
        state.branchColorMap.set(dec, colors[node.colorIdx % colors.length]);
      });
    }
  }

  // VS Code-style: show only real Git decorations/refs.
  state.commitBranchLabel = {};

  // Save row max lanes to window object
  if (typeof window !== 'undefined') {
    window.rowMaxLanes = layout.rowMaxLanes;
  }

  // Dynamic graph width
  const computedGraphWidth = layout.width;
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

