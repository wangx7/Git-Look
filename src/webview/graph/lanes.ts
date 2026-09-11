import { LaneState } from './types';

/**
 * Compact lanes by shifting surviving lanes to the left, removing slots left vacant
 * by terminated branches or convergence.
 *
 * Invariant:
 * Topology and parent relationships do not change; only physical lane coordinates are compacted.
 */
export function compactLanes(targetNextTracks: (LaneState | null)[]): {
  compactedLanes: LaneState[];
  laneShiftMap: Map<number, number>;
} {
  const compactedLanes: LaneState[] = [];
  const laneShiftMap = new Map<number, number>();

  for (let i = 0; i < targetNextTracks.length; i++) {
    const track = targetNextTracks[i];
    if (track !== null && track.targetHash !== '') {
      const newLaneIndex = compactedLanes.length;
      compactedLanes.push({
        ...track,
        lane: newLaneIndex
      });
      laneShiftMap.set(i, newLaneIndex);
    }
  }

  return { compactedLanes, laneShiftMap };
}

/**
 * Allocate a new lane for an unmerged branch tip or fork.
 * Standard Git Graph convention:
 * - Lane 0 is reserved for the initial first-parent backbone.
 * - Any newly discovered branch tip allocates on the outermost lane (length of active tracks).
 */
export function allocateLane(activeLanes: LaneState[], isBackbone: boolean): number {
  if (isBackbone && activeLanes.length === 0) {
    return 0;
  }
  return activeLanes.length;
}
