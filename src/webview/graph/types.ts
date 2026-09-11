// ============================================================================
// Git Authoritative Data & Ref Models
// ============================================================================

export interface CommitInfo {
  hash: string;
  parents: string[];
  author?: string;
  email?: string;
  timestamp?: number;
  message?: string;
  decorations?: string[];
}

export type RefType = 'head' | 'local' | 'remote' | 'tag';

export interface GitRef {
  type: RefType;
  name: string;        // e.g. "main", "origin/feat", "v1.0.0", "HEAD"
  targetHash: string;  // Commit SHA this ref points to
  remote?: string;     // e.g. "origin"
}

export interface WorkingTreeState {
  hasStaged: boolean;
  hasUnstaged: boolean;
  isMerging: boolean;
  mergeHeads?: string[];
}

// ============================================================================
// Graph Node Models
// ============================================================================

export type GraphNodeKind = 'commit' | 'working-tree';

export interface BaseGraphNode {
  id: string;               // Unique node ID (commit SHA or "*working-tree*")
  kind: GraphNodeKind;
  row: number;              // Topological row index (0..N-1)
  lane: number;             // Visual lane column index (0..M)
  colorIdx: number;         // Visual color index (maps to colors palette)
  isBackbone: boolean;      // Whether this node is on the active first-parent backbone
}

export interface CommitGraphNode extends BaseGraphNode {
  kind: 'commit';
  hash: string;             // 40-character commit SHA
  refs: GitRef[];           // Authoritative refs pointing directly to this commit
  isMerge: boolean;         // parents.length >= 2
}

export interface WorkingTreeGraphNode extends BaseGraphNode {
  kind: 'working-tree';
  hash?: never;             // Working tree does not have a real Git commit SHA
  isMerge: boolean;         // Conflict merge state in progress
  state: WorkingTreeState;
}

export type GraphNode = CommitGraphNode | WorkingTreeGraphNode;

// ============================================================================
// Topology & Rendering Models (Relations vs. Segments)
// ============================================================================

/**
 * GraphRelation represents the logical Git DAG edge from a child commit to its parent.
 * It carries the true topological span between fromRow and toRow (which can span multiple rows).
 */
export interface GraphRelation {
  id: string;               // e.g. "hashA->hashB#0"
  fromHash: string;
  toHash: string;
  fromRow: number;          // Child commit row
  toRow: number;            // Parent commit row
  parentIndex: number;      // 0 for first parent, 1..n for secondary parents
  isBackbone: boolean;
}

export type GraphSegmentType =
  | 'straight'     // Vertical straight segment on the same lane (fromLane === toLane)
  | 'fork'         // Outward curve branching to a secondary parent lane
  | 'merge'        // Inward curve merging into a parent lane
  | 'compaction'   // Inward horizontal shift due to dead lanes termination
  | 'working-tree' // Dashed line connection from working tree to HEAD
  ;

/**
 * GraphSegment represents a discrete visual line segment rendered between rows.
 * This is the direct input for the SVG/Canvas renderer.
 */
export interface GraphSegment {
  fromRow: number;
  toRow: number;
  fromLane: number;
  toLane: number;
  runningLane: number;      // Lane column traversed during vertical extension
  colorIdx: number;         // Visual color index
  type: GraphSegmentType;
  toHash?: string;          // Target commit hash
  relationId?: string;      // Logical GraphRelation ID
  isMergeLine?: boolean;    // Compatibility flag for SVG renderer
  isWorkingTreeLine?: boolean; // Render as dashed line
}

// ============================================================================
// Layout Runtime & Result Models
// ============================================================================

export interface LaneState {
  lane: number;             // Physical lane column index
  targetHash: string;       // Commit SHA this lane is tracking downwards
  branchKey?: string;       // Stable branch identity (if known)
  colorIdx: number;         // Stable visual color index
  isBackbone: boolean;      // Whether this lane carries the backbone
  isWorkingTree?: boolean;  // Temporary lane for working tree
}

export interface GraphLayoutOptions {
  rootHash?: string;        // Starting commit hash for backbone calculation
  selectedBranch?: string;  // Explicit branch focus
  compactLanes?: boolean;   // Enable inward compaction (default: true)
  shouldDrawToBottom?: boolean; // Draw surviving lines to the bottom when more history can be paged
}

export interface GraphLayoutResult {
  nodes: Map<string, GraphNode>;
  relations: GraphRelation[];
  segments: GraphSegment[];
  rowMaxLanes: number[];    // Maximum lane index occupied at each row
  maxLanes: number;         // Global maximum lanes
  width: number;            // Computed SVG width in pixels
  height: number;           // Computed SVG height in pixels
  backbone: Set<string>;    // Set of commit hashes forming the backbone
}
