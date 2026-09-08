jest.mock('./dom', () => ({
  elements: {
    commitsTbody: { appendChild: jest.fn(), innerHTML: '', querySelector: jest.fn() },
    graphSvg: { style: {}, classList: { remove: jest.fn(), add: jest.fn() }, querySelectorAll: jest.fn(() => []) },
    searchInput: { value: '' }
  }
}));

jest.mock('./virtualList', () => ({
  updateVirtualList: jest.fn()
}));

jest.mock('./svgRenderer', () => ({
  selectCircleInGraph: jest.fn()
}));

import {
  FreeLanePool,
  parseMergeMessage,
  extractBranchFromDecorations,
  inferCommitBranches,
  renderTableAndGraph
} from './graphLayout';
import { state } from './state';

describe('FreeLanePool', () => {
  it('should allocate new lanes when pool is empty', () => {
    const pool = new FreeLanePool();
    const lanes: (string | null)[] = [null];

    const lane1 = pool.acquire(lanes, false);
    expect(lane1).toBe(1);
    lanes[1] = 'hash1';

    const lane2 = pool.acquire(lanes, false);
    expect(lane2).toBe(2);
    lanes[2] = 'hash2';
  });

  it('should recycle the lowest available lane index using min-heap in O(log K)', () => {
    const pool = new FreeLanePool();
    const lanes: (string | null)[] = [null, 'hash1', 'hash2', 'hash3'];

    lanes[2] = null;
    pool.release(2);

    lanes[1] = null;
    pool.release(1);

    const recycled1 = pool.acquire(lanes, false);
    expect(recycled1).toBe(1);
    lanes[1] = 'hashNew1';

    const recycled2 = pool.acquire(lanes, false);
    expect(recycled2).toBe(2);
    lanes[2] = 'hashNew2';

    const newLane = pool.acquire(lanes, false);
    expect(newLane).toBe(4);
  });

  it('should support preferZero for main trunk initialization', () => {
    const pool = new FreeLanePool();
    const lanes: (string | null)[] = [null];

    const lane = pool.acquire(lanes, true);
    expect(lane).toBe(0);
  });
});

describe('parseMergeMessage', () => {
  it('extracts source branch from GitHub PR merge messages', () => {
    const msg = 'Merge pull request #3481 from deepseek-harness/fix/http-proxy-rc-version\n\nFix proxy version';
    const parsed = parseMergeMessage(msg);
    expect(parsed?.sourceBranch).toBe('fix/http-proxy-rc-version');
  });

  it('extracts source and target from merge remote-tracking branch into', () => {
    const msg = "Merge remote-tracking branch 'origin/master' into worktree/deepseek-harness-proxy-config-2f5b4a";
    const parsed = parseMergeMessage(msg);
    expect(parsed?.sourceBranch).toBe('master');
    expect(parsed?.targetBranch).toBe('worktree/deepseek-harness-proxy-config-2f5b4a');
  });

  it('extracts source and target from standard merge branch into', () => {
    const msg = "Merge branch 'feature-abc' into 'main'";
    const parsed = parseMergeMessage(msg);
    expect(parsed?.sourceBranch).toBe('feature-abc');
    expect(parsed?.targetBranch).toBe('main');
  });

  it('returns null for non-merge messages', () => {
    const msg = 'fix(http-proxy): withhold NODE_USE_ENV_PROXY';
    expect(parseMergeMessage(msg)).toBeNull();
  });
});

describe('extractBranchFromDecorations', () => {
  it('prefers local branch over remote', () => {
    const decs = ['origin/feature-1', 'feature-1', 'origin/HEAD'];
    expect(extractBranchFromDecorations(decs, ['origin/feature-1', 'origin/HEAD'])).toBe('feature-1');
  });

  it('extracts clean branch name from remote branch when no local exists', () => {
    const decs = ['origin/feature-rc'];
    expect(extractBranchFromDecorations(decs, ['origin/feature-rc'])).toBe('feature-rc');
  });

  it('extracts branch name from HEAD pointer', () => {
    const decs = ['HEAD -> main', 'origin/main'];
    expect(extractBranchFromDecorations(decs, ['origin/main'])).toBe('main');
  });

  it('filters out Working Tree, bare HEAD, and tags', () => {
    expect(extractBranchFromDecorations(['Working Tree'])).toBeNull();
    expect(extractBranchFromDecorations(['HEAD'])).toBeNull();
    expect(extractBranchFromDecorations(['tag: v1.0.0'])).toBeNull();
    expect(extractBranchFromDecorations(['Working Tree', 'tag: v1.0.0', 'HEAD'])).toBeNull();
    expect(extractBranchFromDecorations(['tag: v1.0.0', 'origin/dev', 'Working Tree'])).toBe('dev');
    expect(extractBranchFromDecorations(['HEAD -> 社区商城', 'Working Tree'])).toBe('社区商城');
  });
});

describe('inferCommitBranches', () => {
  it('propagates PR branch name down to intermediate commits on the feature lane', () => {
    // Topology:
    // c1 (merge PR #3481) -> parents: [c0, c2]
    // c2 (feature tip)    -> parents: [c3]
    // c3 (intermediate)   -> parents: [c4]
    // c4 (fork point)     -> parents: []
    const commits = [
      {
        hash: 'c1',
        parents: ['c0', 'c2'],
        decorations: ['origin/master', 'origin/HEAD'],
        message: 'Merge pull request #3481 from deepseek-harness/fix/http-proxy-rc-version'
      },
      {
        hash: 'c2',
        parents: ['c3'],
        decorations: [],
        message: 'fix(http-proxy): match workspace version'
      },
      {
        hash: 'c3',
        parents: ['c4'],
        decorations: [],
        message: 'fix(http-proxy): withhold NODE_USE_ENV_PROXY'
      },
      {
        hash: 'c0',
        parents: ['c4'],
        decorations: [],
        message: 'previous commit on master'
      },
      {
        hash: 'c4',
        parents: [],
        decorations: [],
        message: 'initial fork commit'
      }
    ];

    const commitNodes: Record<string, any> = {
      c1: { row: 0, lane: 0, colorIdx: 0 },
      c2: { row: 1, lane: 1, colorIdx: 1 },
      c3: { row: 2, lane: 1, colorIdx: 1 },
      c0: { row: 3, lane: 0, colorIdx: 0 },
      c4: { row: 4, lane: 0, colorIdx: 0 }
    };

    const hashToCommitMap = new Map(commits.map(c => [c.hash, c]));
    const mainTrunk = new Set(['c1', 'c0', 'c4']);

    const branchLabels = inferCommitBranches(
      commits,
      commitNodes,
      [],
      hashToCommitMap,
      mainTrunk,
      ['origin/master', 'origin/HEAD']
    );

    // Trunk commit c1 is master
    expect(branchLabels['c1'].name).toBe('master');

    // Intermediate commits c2 and c3 are accurately inferred as fix/http-proxy-rc-version
    expect(branchLabels['c2'].name).toBe('fix/http-proxy-rc-version');
    expect(branchLabels['c3'].name).toBe('fix/http-proxy-rc-version');
  });

  it('performs dynamic branch handoff from feature branch (社区商城) to base branch (dev) on trunk', () => {
    // Topology:
    // c_wt (*working-tree*)        -> parents: [c_head]
    // c_head (HEAD -> 社区商城)     -> parents: [c_feat_inter]
    // c_feat_inter (81262100)      -> parents: [c_dev_tip]
    // c_dev_tip (378eff5b, dev)    -> parents: [c_dev_inter]
    // c_dev_inter (9c7d5c45)       -> parents: [c_dev_base]
    // c_dev_base (4fbdd48)         -> parents: []
    const commits = [
      {
        hash: '*working-tree*',
        parents: ['c_head'],
        decorations: ['Working Tree'],
        message: '未提交的修改'
      },
      {
        hash: 'c_head',
        parents: ['c_feat_inter'],
        decorations: ['HEAD -> 社区商城', 'origin/社区商城'],
        message: 'feat: head commit on feature branch'
      },
      {
        hash: 'c_feat_inter',
        parents: ['c_dev_tip'],
        decorations: [],
        message: 'feat: intermediate commit on feature branch (81262100)'
      },
      {
        hash: 'c_dev_tip',
        parents: ['c_dev_inter'],
        decorations: ['dev', 'origin/dev'],
        message: 'dev: tip commit of dev branch (378eff5b)'
      },
      {
        hash: 'c_dev_inter',
        parents: ['c_dev_base'],
        decorations: [],
        message: 'dev: intermediate commit on dev (9c7d5c45)'
      },
      {
        hash: 'c_dev_base',
        parents: [],
        decorations: [],
        message: 'dev: base commit'
      }
    ];

    const commitNodes: Record<string, any> = {
      '*working-tree*': { row: 0, lane: 0, colorIdx: 0 },
      'c_head': { row: 1, lane: 0, colorIdx: 0 },
      'c_feat_inter': { row: 2, lane: 0, colorIdx: 0 },
      'c_dev_tip': { row: 3, lane: 0, colorIdx: 0 },
      'c_dev_inter': { row: 4, lane: 0, colorIdx: 0 },
      'c_dev_base': { row: 5, lane: 0, colorIdx: 0 }
    };

    const hashToCommitMap = new Map(commits.map(c => [c.hash, c]));
    const mainTrunk = new Set(commits.map(c => c.hash));

    const branchLabels = inferCommitBranches(
      commits,
      commitNodes,
      [],
      hashToCommitMap,
      mainTrunk,
      ['origin/社区商城', 'origin/dev']
    );

    // 1. Feature branch commits above fork point are accurately inferred as '社区商城'
    expect(branchLabels['c_head'].name).toBe('社区商城');
    expect(branchLabels['c_feat_inter'].name).toBe('社区商城');

    // 2. Fork point with explicit 'dev' ref is 'dev'
    expect(branchLabels['c_dev_tip'].name).toBe('dev');

    // 3. Trunk ancestors below fork point dynamically switch to 'dev' (Branch Handoff)
    expect(branchLabels['c_dev_inter'].name).toBe('dev');
    expect(branchLabels['c_dev_base'].name).toBe('dev');

    // 4. Working tree node belongs to trunk branch '社区商城', NEVER 'Working Tree'
    expect(branchLabels['*working-tree*'].name).toBe('社区商城');
  });
});

describe('renderTableAndGraph standard contiguous layout & lane compaction', () => {
  it('allocates unmerged branch tips on the outermost track and prevents overlap', () => {
    // Topology:
    // c0 (row 0, trunk)              -> parents: [c5]
    // c1 (row 1, side branch tip)     -> parents: [c2]
    // c2 (row 2, merge into side)     -> parents: [c3, c5] (merging trunk commit c5)
    // c3 (row 3, side branch commit)  -> parents: [c4]
    // c4 (row 4, side branch base)    -> parents: []
    // c5 (row 5, trunk commit)        -> parents: [c6]
    // c6 (row 6, trunk commit)        -> parents: []
    state.commits = [
      {
        hash: 'c0',
        parents: ['c5'],
        decorations: ['HEAD -> main', 'origin/main'],
        message: 'trunk head',
        author: 'User',
        email: 'u@example.com',
        timestamp: 1000
      },
      {
        hash: 'c1',
        parents: ['c2'],
        decorations: ['feature'],
        message: 'feature tip',
        author: 'User',
        email: 'u@example.com',
        timestamp: 900
      },
      {
        hash: 'c2',
        parents: ['c3', 'c5'],
        decorations: [],
        message: "Merge remote-tracking branch 'origin/main'",
        author: 'User',
        email: 'u@example.com',
        timestamp: 800
      },
      {
        hash: 'c3',
        parents: ['c4'],
        decorations: [],
        message: 'feature commit',
        author: 'User',
        email: 'u@example.com',
        timestamp: 700
      },
      {
        hash: 'c4',
        parents: [],
        decorations: [],
        message: 'feature root',
        author: 'User',
        email: 'u@example.com',
        timestamp: 600
      },
      {
        hash: 'c5',
        parents: ['c6'],
        decorations: [],
        message: 'trunk commit (target of merge)',
        author: 'User',
        email: 'u@example.com',
        timestamp: 500
      },
      {
        hash: 'c6',
        parents: [],
        decorations: [],
        message: 'trunk base',
        author: 'User',
        email: 'u@example.com',
        timestamp: 400
      }
    ];

    renderTableAndGraph();

    // 1. Trunk commits c0 and c5 must be on lane 0
    expect(state.cachedCommitNodes['c0'].lane).toBe(0);
    expect(state.cachedCommitNodes['c5'].lane).toBe(0);

    // 2. Side branch tip c1 and c2 must be on outermost lane (lane 1)
    expect(state.cachedCommitNodes['c1'].lane).toBe(1);
    expect(state.cachedCommitNodes['c2'].lane).toBe(1);

    // 3. Find the merge line from c2 to c5
    const mergeLine = state.cachedLines.find(l => l.fromRow === 2 && l.toHash === 'c5' && l.isMergeLine);
    expect(mergeLine).toBeDefined();

    // 4. The merge line smoothly joins lane 0 between row 2 and 3
    expect(mergeLine!.fromLane).toBe(1);
    expect(mergeLine!.toLane).toBe(0);
    expect(mergeLine!.fromRow).toBe(2);
    expect(mergeLine!.toRow).toBe(3);

    // 5. OVERLAP INVARIANT: Active tracks running vertically never share the same lane
    const straightLines = state.cachedLines.filter(l => l.fromLane === l.toLane && !l.isMergeLine);
    for (let r = 0; r <= 6; r++) {
      const activeAtRow = straightLines.filter(l => r >= l.fromRow && r <= l.toRow);
      const lanesAtRow = activeAtRow.map(l => l.fromLane);
      const uniqueLanes = new Set(lanesAtRow);
      expect(lanesAtRow.length).toBe(uniqueLanes.size);
    }
  });

  it('performs lane compaction (inward shift) when inner branches terminate matching standard reference', () => {
    // 22-commit topology matching reference graph left_graph.png:
    // Demonstrates:
    // - Row 0..3: Orange opens at lane 1, Pink at lane 2, Brown at lane 3, Teal at lane 4
    // - Row 11: Orange terminates into Blue (lane 0)
    // - Row 11->12: Pink shifts from lane 2 to 1, Brown from 3 to 2, Teal from 4 to 3
    // - Row 15: Unmerged Purple tip opens on the outermost lane (lane 4)
    state.commits = [
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

    renderTableAndGraph();

    // Verify commit node lanes match standard reference
    expect(state.cachedCommitNodes['c0'].lane).toBe(0);          // Row 0: Blue (lane 0)
    expect(state.cachedCommitNodes['c_orange1'].lane).toBe(1);   // Row 1: Orange (lane 1)
    expect(state.cachedCommitNodes['c_brown1'].lane).toBe(3);     // Row 4: Brown (lane 3)
    expect(state.cachedCommitNodes['c_orange4'].lane).toBe(1);   // Row 11: Orange (lane 1)
    expect(state.cachedCommitNodes['c_blue1'].lane).toBe(0);     // Row 12: Blue (lane 0)
    expect(state.cachedCommitNodes['c_purple1'].lane).toBe(4);   // Row 15: Unmerged Purple opens on outermost lane 4!
    expect(state.cachedCommitNodes['c_pink1'].lane).toBe(1);     // Row 17: Pink has shifted into lane 1!

    // Verify compaction shift lines from row 11 to 12
    const pinkShift = state.cachedLines.find(l => l.fromRow === 11 && l.toRow === 12 && l.fromLane === 2 && l.toLane === 1);
    const brownShift = state.cachedLines.find(l => l.fromRow === 11 && l.toRow === 12 && l.fromLane === 3 && l.toLane === 2);
    const tealShift = state.cachedLines.find(l => l.fromRow === 11 && l.toRow === 12 && l.fromLane === 4 && l.toLane === 3);
    const orangeMerge = state.cachedLines.find(l => l.fromRow === 11 && l.toRow === 12 && l.fromLane === 1 && l.toLane === 0);

    expect(pinkShift).toBeDefined();
    expect(brownShift).toBeDefined();
    expect(tealShift).toBeDefined();
    expect(orangeMerge).toBeDefined();
  });
});

