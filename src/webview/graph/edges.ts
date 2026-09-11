import { CommitInfo, GraphRelation, GraphSegment } from './types';

/**
 * Build authoritative Git DAG relationships between commits.
 * Unlike visual segments which are bounded row-by-row, a GraphRelation records
 * the full span from child commit row to parent commit row.
 */
export function buildGraphRelations(
  commits: CommitInfo[],
  backbone: Set<string>,
  rowMap: Map<string, number>
): GraphRelation[] {
  const relations: GraphRelation[] = [];

  commits.forEach((c, fromRow) => {
    const parents = c.parents || [];
    parents.forEach((parentHash, parentIndex) => {
      const toRow = rowMap.get(parentHash);
      if (toRow !== undefined) {
        relations.push({
          id: `${c.hash}->${parentHash}#${parentIndex}`,
          fromHash: c.hash,
          toHash: parentHash,
          fromRow,
          toRow,
          parentIndex,
          isBackbone: parentIndex === 0 && backbone.has(c.hash) && backbone.has(parentHash)
        });
      }
    });
  });

  return relations;
}

/**
 * Consolidate consecutive vertical straight segments on the same lane into single lines.
 * This dramatically reduces the number of SVG sub-commands and keeps path strings minimal.
 */
export function consolidateSegments(rawSegments: GraphSegment[]): GraphSegment[] {
  const straightMap = new Map<string, GraphSegment>();
  const consolidated: GraphSegment[] = [];

  for (const segment of rawSegments) {
    const isStraight = segment.fromLane === segment.toLane && !segment.isMergeLine;
    const key = `${segment.fromLane}_${segment.colorIdx}_${!!segment.isWorkingTreeLine}`;

    if (isStraight) {
      const prev = straightMap.get(key);
      if (prev && prev.toRow === segment.fromRow && prev.toLane === segment.fromLane) {
        prev.toRow = segment.toRow;
        continue;
      }
      const cloned: GraphSegment = { ...segment };
      straightMap.set(key, cloned);
      consolidated.push(cloned);
    } else {
      straightMap.delete(key);
      consolidated.push({ ...segment });
    }
  }

  return consolidated;
}

/**
 * Backward compatibility alias for existing code/tests expecting consolidateLines.
 */
export const consolidateLines = consolidateSegments;
