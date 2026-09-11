import {
  CommitInfo,
  GitRef,
  GraphLayoutOptions,
  GraphLayoutResult,
  GraphNode,
  GraphSegment,
  LaneState
} from './types';
import { getFirstParentBackbone, getGraphRoot } from './backbone';
import { allocateLane, compactLanes } from './lanes';
import { buildGraphRelations, consolidateSegments } from './edges';

export const GRAPH_CONSTANTS = {
  rowHeight: 24,
  laneWidth: 14,
  paddingLeft: 12
};

/**
 * Pure function Git DAG Layout Engine.
 * Takes raw commits, refs, and options, and computes full DAG layout:
 * - Backbone determination along first-parent chain
 * - Lane assignment, branching, merging, and inward lane compaction
 * - Topological relations and visual segments
 *
 * Requirements:
 * - 0 DOM, 0 Window, 0 VS Code API dependencies
 * - Pure data in -> pure data out
 * - Testable directly in Node/Jest
 */
export function layoutGitGraph(
  commits: CommitInfo[],
  refs: GitRef[] = [],
  options?: GraphLayoutOptions
): GraphLayoutResult {
  const rowHeight = GRAPH_CONSTANTS.rowHeight;
  const laneWidth = GRAPH_CONSTANTS.laneWidth;
  const paddingLeft = GRAPH_CONSTANTS.paddingLeft;

  if (commits.length === 0) {
    return {
      nodes: new Map(),
      relations: [],
      segments: [],
      rowMaxLanes: [],
      maxLanes: 0,
      width: paddingLeft,
      height: 0,
      backbone: new Set()
    };
  }

  const commitHashes = new Set(commits.map(c => c.hash));
  const rowMap = new Map<string, number>();
  commits.forEach((c, i) => rowMap.set(c.hash, i));

  // 1. Determine Backbone
  const rootHash = getGraphRoot(commits, refs, options);
  const backbone = getFirstParentBackbone(commits, rootHash);

  // 2. Build logical DAG relations
  const relations = buildGraphRelations(commits, backbone, rowMap);

  // 3. Main layout sweep
  const shouldDrawToBottom = options?.shouldDrawToBottom ?? false;
  let activeLanes: LaneState[] = [];
  const nodes = new Map<string, GraphNode>();
  const rawSegments: GraphSegment[] = [];
  let maxLanes = 0;
  let nextColorIdx = 1;

  for (let r = 0; r < commits.length; r++) {
    const c = commits[r];
    const hash = c.hash;
    const parents = c.parents || [];
    const isMerge = parents.length >= 2;
    const isBackbone = backbone.has(hash);
    const isWorkingTree = (hash === '*working-tree*');

    // 3.1 Find or assign lane for current commit
    const matchingIndices: number[] = [];
    for (let i = 0; i < activeLanes.length; i++) {
      if (activeLanes[i].targetHash === hash) {
        matchingIndices.push(i);
      }
    }

    let nodeLane: number;
    let nodeColorIdx: number;

    if (matchingIndices.length > 0) {
      nodeLane = matchingIndices[0];
      nodeColorIdx = activeLanes[nodeLane].colorIdx;
    } else {
      nodeLane = allocateLane(activeLanes, isBackbone);
      nodeColorIdx = (isBackbone && nodeLane === 0) ? 0 : nextColorIdx++;
      activeLanes.push({
        lane: nodeLane,
        targetHash: hash,
        colorIdx: nodeColorIdx,
        isBackbone,
        isWorkingTree
      });
    }

    // Record GraphNode
    if (isWorkingTree) {
      nodes.set(hash, {
        kind: 'working-tree',
        id: hash,
        row: r,
        lane: nodeLane,
        colorIdx: nodeColorIdx,
        isBackbone,
        isMerge,
        state: {
          hasStaged: true,
          hasUnstaged: true,
          isMerging: isMerge,
          mergeHeads: parents.slice(1)
        }
      });
    } else {
      const commitRefs = refs.filter(ref => ref.targetHash === hash);
      nodes.set(hash, {
        kind: 'commit',
        id: hash,
        hash,
        row: r,
        lane: nodeLane,
        colorIdx: nodeColorIdx,
        isBackbone,
        isMerge,
        refs: commitRefs
      });
    }

    maxLanes = Math.max(maxLanes, activeLanes.length, nodeLane + 1);

    // 3.2 Prepare next row tracks and connections
    const targetNextTracks: (LaneState | null)[] = activeLanes.map(t => ({ ...t }));
    const mergingTracks: { fromLane: number; toTargetLane: number; colorIdx: number; toHash?: string }[] = [];
    const branchingLines: { fromLane: number; toTargetLane: number; colorIdx: number; toHash?: string }[] = [];

    // Handle secondary lanes matching this commit (convergence at row r)
    for (let m = 1; m < matchingIndices.length; m++) {
      const idx = matchingIndices[m];
      targetNextTracks[idx] = null;
      mergingTracks.push({
        fromLane: idx,
        toTargetLane: nodeLane,
        colorIdx: activeLanes[idx].colorIdx,
        toHash: hash
      });
    }

    // Process primary parent (parents[0])
    if (parents.length === 0) {
      targetNextTracks[nodeLane] = null;
    } else {
      const p0 = parents[0];
      if (commitHashes.has(p0)) {
        const existingIdx = targetNextTracks.findIndex(
          (t, idx) => idx !== nodeLane && t !== null && t.targetHash === p0
        );
        if (existingIdx !== -1) {
          if (nodeLane < existingIdx) {
            const higherColor = targetNextTracks[existingIdx]!.colorIdx;
            targetNextTracks[existingIdx] = null;
            targetNextTracks[nodeLane]!.targetHash = p0;
            mergingTracks.push({
              fromLane: existingIdx,
              toTargetLane: nodeLane,
              colorIdx: higherColor,
              toHash: p0
            });
          } else {
            targetNextTracks[nodeLane] = null;
            mergingTracks.push({
              fromLane: nodeLane,
              toTargetLane: existingIdx,
              colorIdx: nodeColorIdx,
              toHash: p0
            });
          }
        } else {
          targetNextTracks[nodeLane]!.targetHash = p0;
        }
      } else {
        if (shouldDrawToBottom) {
          targetNextTracks[nodeLane]!.targetHash = p0;
        } else {
          targetNextTracks[nodeLane] = null;
        }
      }
    }

    // Process secondary parents (parents[1..n]) - supports Octopus Merge
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
            lane: newLane,
            targetHash: pk,
            colorIdx: newColor,
            isBackbone: false,
            isWorkingTree
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

    // 3.3 Lane Compaction (Inward shift)
    const { compactedLanes, laneShiftMap } = compactLanes(targetNextTracks);

    // 3.4 Generate transition segments between row r and row r + 1
    if (r < commits.length - 1) {
      // Surviving tracks
      for (let i = 0; i < activeLanes.length; i++) {
        if (laneShiftMap.has(i)) {
          const toL = laneShiftMap.get(i)!;
          const isStraight = (i === toL);
          rawSegments.push({
            fromRow: r,
            fromLane: i,
            toRow: r + 1,
            toLane: toL,
            runningLane: toL,
            colorIdx: activeLanes[i].colorIdx,
            toHash: activeLanes[i].targetHash,
            type: isStraight ? 'straight' : 'compaction',
            isWorkingTreeLine: isWorkingTree && !!activeLanes[i].isWorkingTree
          });
        }
      }

      // Merging tracks (inward merge curves)
      for (const mt of mergingTracks) {
        const toL = laneShiftMap.has(mt.toTargetLane) ? laneShiftMap.get(mt.toTargetLane)! : mt.toTargetLane;
        rawSegments.push({
          fromRow: r,
          fromLane: mt.fromLane,
          toRow: r + 1,
          toLane: toL,
          runningLane: toL,
          colorIdx: mt.colorIdx,
          toHash: mt.toHash,
          type: 'merge',
          isMergeLine: true
        });
      }

      // Branching lines (outward fork curves)
      for (const bl of branchingLines) {
        const toL = laneShiftMap.has(bl.toTargetLane) ? laneShiftMap.get(bl.toTargetLane)! : bl.toTargetLane;
        rawSegments.push({
          fromRow: r,
          fromLane: bl.fromLane,
          toRow: r + 1,
          toLane: toL,
          runningLane: toL,
          colorIdx: bl.colorIdx,
          toHash: bl.toHash,
          type: 'fork',
          isMergeLine: true
        });
      }
    } else if (shouldDrawToBottom) {
      // Last row: draw tracks to bottom
      for (let i = 0; i < activeLanes.length; i++) {
        rawSegments.push({
          fromRow: r,
          fromLane: i,
          toRow: commits.length - 0.5,
          toLane: i,
          runningLane: i,
          colorIdx: activeLanes[i].colorIdx,
          toHash: activeLanes[i].targetHash,
          type: 'straight',
          isWorkingTreeLine: !!activeLanes[i].isWorkingTree
        });
      }
    }

    activeLanes = compactedLanes;
    maxLanes = Math.max(maxLanes, activeLanes.length);
  }

  // 4. Consolidate straight vertical lines
  const segments = consolidateSegments(rawSegments);

  // 5. Calculate rowMaxLanes for virtual list viewport width optimization
  const rowMaxLanes = new Array(commits.length).fill(0);
  for (const [, node] of nodes) {
    if (node.row < commits.length) {
      rowMaxLanes[node.row] = Math.max(rowMaxLanes[node.row], node.lane);
    }
  }
  for (const seg of segments) {
    const startRow = Math.max(0, Math.min(Math.floor(seg.fromRow), Math.floor(seg.toRow)));
    const endRow = Math.min(commits.length - 1, Math.max(Math.ceil(seg.fromRow), Math.ceil(seg.toRow)));
    for (let r = startRow; r <= endRow; r++) {
      rowMaxLanes[r] = Math.max(rowMaxLanes[r], seg.fromLane, seg.toLane, seg.runningLane ?? 0);
    }
  }

  const computedWidth = paddingLeft + (maxLanes + 1) * laneWidth;
  const computedHeight = commits.length * rowHeight;

  return {
    nodes,
    relations,
    segments,
    rowMaxLanes,
    maxLanes,
    width: computedWidth,
    height: computedHeight,
    backbone
  };
}
