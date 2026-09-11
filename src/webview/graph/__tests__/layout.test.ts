import { layoutGitGraph } from '../layout';
import { CommitInfo } from '../types';

describe('layoutGitGraph pure engine', () => {
  it('handles empty commits array cleanly', () => {
    const result = layoutGitGraph([]);
    expect(result.nodes.size).toBe(0);
    expect(result.relations.length).toBe(0);
    expect(result.segments.length).toBe(0);
    expect(result.maxLanes).toBe(0);
  });

  it('lays out a single linear backbone chain on lane 0', () => {
    const commits: CommitInfo[] = [
      { hash: 'c3', parents: ['c2'], message: 'c3', author: 'a', email: 'e', timestamp: 300 },
      { hash: 'c2', parents: ['c1'], message: 'c2', author: 'a', email: 'e', timestamp: 200 },
      { hash: 'c1', parents: [],     message: 'c1', author: 'a', email: 'e', timestamp: 100 }
    ];

    const result = layoutGitGraph(commits);

    expect(result.nodes.size).toBe(3);
    expect(result.nodes.get('c3')?.lane).toBe(0);
    expect(result.nodes.get('c2')?.lane).toBe(0);
    expect(result.nodes.get('c1')?.lane).toBe(0);

    // All nodes are on backbone
    expect(result.backbone.has('c3')).toBe(true);
    expect(result.backbone.has('c2')).toBe(true);
    expect(result.backbone.has('c1')).toBe(true);

    // Check relations
    expect(result.relations.length).toBe(2);
    expect(result.relations[0]).toEqual({
      id: 'c3->c2#0',
      fromHash: 'c3',
      toHash: 'c2',
      fromRow: 0,
      toRow: 1,
      parentIndex: 0,
      isBackbone: true
    });

    // Consolidated straight segments: single line from row 0 to 2
    expect(result.segments.length).toBe(1);
    expect(result.segments[0].fromRow).toBe(0);
    expect(result.segments[0].toRow).toBe(2);
    expect(result.segments[0].fromLane).toBe(0);
    expect(result.segments[0].toLane).toBe(0);
  });

  it('handles Case A: Fork DAG (A <- B <- C, and B <- D <- E)', () => {
    const commits: CommitInfo[] = [
      { hash: 'C', parents: ['B'], message: 'C', author: 'a', email: 'e', timestamp: 500, decorations: ['HEAD -> main'] },
      { hash: 'E', parents: ['D'], message: 'E', author: 'a', email: 'e', timestamp: 400, decorations: ['feature'] },
      { hash: 'D', parents: ['B'], message: 'D', author: 'a', email: 'e', timestamp: 300 },
      { hash: 'B', parents: ['A'], message: 'B', author: 'a', email: 'e', timestamp: 200 },
      { hash: 'A', parents: [],    message: 'A', author: 'a', email: 'e', timestamp: 100 }
    ];

    const result = layoutGitGraph(commits);

    // Node lane checks
    expect(result.nodes.get('C')?.lane).toBe(0);
    expect(result.nodes.get('E')?.lane).toBe(1);
    expect(result.nodes.get('D')?.lane).toBe(1);
    expect(result.nodes.get('B')?.lane).toBe(0);
    expect(result.nodes.get('A')?.lane).toBe(0);

    // Backbone check
    expect(result.backbone.has('C')).toBe(true);
    expect(result.backbone.has('B')).toBe(true);
    expect(result.backbone.has('A')).toBe(true);
    expect(result.backbone.has('E')).toBe(false);
    expect(result.backbone.has('D')).toBe(false);

    // Verify merge inward segment from D (lane 1) to B (lane 0)
    const mergeSeg = result.segments.find(s => s.isMergeLine && s.toHash === 'B');
    expect(mergeSeg).toBeDefined();
    expect(mergeSeg?.fromLane).toBe(1);
    expect(mergeSeg?.toLane).toBe(0);
  });

  it('handles Case B: Merge DAG (A <- B <- C <- M, with E <- M and B <- D <- E)', () => {
    const commits: CommitInfo[] = [
      { hash: 'M', parents: ['C', 'E'], message: "Merge branch 'feature'", author: 'a', email: 'e', timestamp: 600, decorations: ['HEAD -> main'] },
      { hash: 'C', parents: ['B'],      message: 'C', author: 'a', email: 'e', timestamp: 500 },
      { hash: 'E', parents: ['D'],      message: 'E', author: 'a', email: 'e', timestamp: 400 },
      { hash: 'D', parents: ['B'],      message: 'D', author: 'a', email: 'e', timestamp: 300 },
      { hash: 'B', parents: ['A'],      message: 'B', author: 'a', email: 'e', timestamp: 200 },
      { hash: 'A', parents: [],         message: 'A', author: 'a', email: 'e', timestamp: 100 }
    ];

    const result = layoutGitGraph(commits);

    // M is merge node on lane 0
    const nodeM = result.nodes.get('M');
    expect(nodeM?.lane).toBe(0);
    expect(nodeM?.isMerge).toBe(true);

    // First parent C continues on lane 0
    expect(result.nodes.get('C')?.lane).toBe(0);

    // Secondary parent E on lane 1
    expect(result.nodes.get('E')?.lane).toBe(1);
    expect(result.nodes.get('D')?.lane).toBe(1);

    // Common ancestor B on lane 0
    expect(result.nodes.get('B')?.lane).toBe(0);

    // Relations check: 6 relations total
    expect(result.relations.length).toBe(6);
    expect(result.relations.find(r => r.fromHash === 'M' && r.toHash === 'C')).toBeDefined();
    expect(result.relations.find(r => r.fromHash === 'M' && r.toHash === 'E')).toBeDefined();

    // Branching fork segment for M -> E
    const forkSeg = result.segments.find(s => s.fromRow === 0 && s.toHash === 'E' && s.isMergeLine);
    expect(forkSeg).toBeDefined();
    expect(forkSeg?.fromLane).toBe(0);
    expect(forkSeg?.toLane).toBe(1);
  });

  it('supports Octopus merge with 3 and 4 parents without throwing', () => {
    const octopusCommits: CommitInfo[] = [
      { hash: 'M',  parents: ['P0', 'P1', 'P2', 'P3'], message: 'Octopus merge 4 branches', author: 'a', email: 'e', timestamp: 500 },
      { hash: 'P0', parents: ['Base'], message: 'P0', author: 'a', email: 'e', timestamp: 400 },
      { hash: 'P1', parents: ['Base'], message: 'P1', author: 'a', email: 'e', timestamp: 300 },
      { hash: 'P2', parents: ['Base'], message: 'P2', author: 'a', email: 'e', timestamp: 200 },
      { hash: 'P3', parents: ['Base'], message: 'P3', author: 'a', email: 'e', timestamp: 100 },
      { hash: 'Base', parents: [],     message: 'Base', author: 'a', email: 'e', timestamp: 50 }
    ];

    expect(() => {
      const result = layoutGitGraph(octopusCommits);
      expect(result.nodes.get('M')?.isMerge).toBe(true);
      expect(result.relations.filter(r => r.fromHash === 'M').length).toBe(4);
      expect(result.maxLanes).toBeGreaterThanOrEqual(4);
    }).not.toThrow();
  });

  it('handles *working-tree* virtual node correctly with dashed line properties', () => {
    const commits: CommitInfo[] = [
      { hash: '*working-tree*', parents: ['c_head'], message: 'Uncommitted changes', author: 'You', email: '', timestamp: 1000, decorations: ['Working Tree'] },
      { hash: 'c_head',         parents: ['c_base'], message: 'Head commit', author: 'a', email: 'e', timestamp: 900, decorations: ['HEAD -> main'] },
      { hash: 'c_base',         parents: [],         message: 'Base commit', author: 'a', email: 'e', timestamp: 800 }
    ];

    const result = layoutGitGraph(commits);

    const wtNode = result.nodes.get('*working-tree*');
    expect(wtNode?.kind).toBe('working-tree');
    expect(wtNode?.lane).toBe(0);

    // Working tree line is marked with isWorkingTreeLine
    const wtLine = result.segments.find(s => s.fromRow === 0 && s.isWorkingTreeLine);
    expect(wtLine).toBeDefined();
    expect(wtLine?.fromLane).toBe(0);
    expect(wtLine?.toLane).toBe(0);
  });

  it('performs lane compaction (inward shift) matching standard reference', () => {
    const commits: CommitInfo[] = [
      { hash: 'c0', parents: ['c_blue1', 'c_orange1'], decorations: ['HEAD -> main'], message: 'merge', author: 'U', email: 'u', timestamp: 2200 },
      { hash: 'c_orange1', parents: ['c_orange2'], decorations: [], message: 'orange 1', author: 'U', email: 'u', timestamp: 2100 },
      { hash: 'c_orange2', parents: ['c_orange3', 'c_pink1'], decorations: [], message: 'orange 2', author: 'U', email: 'u', timestamp: 2000 },
      { hash: 'c_orange3', parents: ['c_orange4', 'c_brown1'], decorations: [], message: 'orange 3', author: 'U', email: 'u', timestamp: 1900 },
      { hash: 'c_brown1', parents: ['c_brown2'], decorations: [], message: 'brown 1', author: 'U', email: 'u', timestamp: 1800 },
      { hash: 'c_brown2', parents: ['c_brown3'], decorations: [], message: 'brown 2', author: 'U', email: 'u', timestamp: 1700 },
      { hash: 'c_brown3', parents: ['c_brown4'], decorations: [], message: 'brown 3', author: 'U', email: 'u', timestamp: 1600 },
      { hash: 'c_brown4', parents: ['c_brown5'], decorations: [], message: 'brown 4', author: 'U', email: 'u', timestamp: 1500 },
      { hash: 'c_brown5', parents: ['c_brown6', 'c_teal1'], decorations: [], message: 'brown 5', author: 'U', email: 'u', timestamp: 1400 },
      { hash: 'c_brown6', parents: ['c_brown7'], decorations: [], message: 'brown 6', author: 'U', email: 'u', timestamp: 1300 },
      { hash: 'c_brown7', parents: ['c_brown8'], decorations: [], message: 'brown 7', author: 'U', email: 'u', timestamp: 1200 },
      { hash: 'c_orange4', parents: ['c_blue1'], decorations: [], message: 'orange 4 (merges to blue)', author: 'U', email: 'u', timestamp: 1100 },
      { hash: 'c_blue1', parents: ['c_blue2'], decorations: [], message: 'blue 1', author: 'U', email: 'u', timestamp: 1000 },
      { hash: 'c_blue2', parents: ['c_blue3'], decorations: [], message: 'blue 2', author: 'U', email: 'u', timestamp: 900 },
      { hash: 'c_blue3', parents: ['c_blue4'], decorations: [], message: 'blue 3', author: 'U', email: 'u', timestamp: 800 },
      { hash: 'c_purple1', parents: ['c_purple2'], decorations: [], message: 'purple 1 (unmerged tip)', author: 'U', email: 'u', timestamp: 700 },
      { hash: 'c_purple2', parents: ['c_pink1'], decorations: [], message: 'purple 2 (merges to pink)', author: 'U', email: 'u', timestamp: 600 },
      { hash: 'c_pink1', parents: ['c_pink2'], decorations: [], message: 'pink 1', author: 'U', email: 'u', timestamp: 500 },
      { hash: 'c_pink2', parents: ['c_blue4'], decorations: [], message: 'pink 2', author: 'U', email: 'u', timestamp: 400 },
      { hash: 'c_blue4', parents: ['c_blue5'], decorations: [], message: 'blue 4', author: 'U', email: 'u', timestamp: 300 },
      { hash: 'c_blue5', parents: ['c_blue6'], decorations: [], message: 'blue 5', author: 'U', email: 'u', timestamp: 200 },
      { hash: 'c_blue6', parents: [], decorations: [], message: 'blue 6', author: 'U', email: 'u', timestamp: 100 }
    ];

    const result = layoutGitGraph(commits, [], { shouldDrawToBottom: true });

    expect(result.nodes.get('c0')?.lane).toBe(0);          // Row 0: Blue (lane 0)
    expect(result.nodes.get('c_orange1')?.lane).toBe(1);   // Row 1: Orange (lane 1)
    expect(result.nodes.get('c_brown1')?.lane).toBe(3);     // Row 4: Brown (lane 3)
    expect(result.nodes.get('c_orange4')?.lane).toBe(1);   // Row 11: Orange (lane 1)
    expect(result.nodes.get('c_blue1')?.lane).toBe(0);     // Row 12: Blue (lane 0)
    expect(result.nodes.get('c_purple1')?.lane).toBe(4);   // Row 15: Unmerged Purple opens on outermost lane 4!
    expect(result.nodes.get('c_pink1')?.lane).toBe(1);     // Row 17: Pink has shifted into lane 1!
  });
});
