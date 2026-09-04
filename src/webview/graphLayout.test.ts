jest.mock('./dom', () => ({
  elements: {
    commitsTbody: {},
    graphSvg: {}
  }
}));

import {
  FreeLanePool,
  parseMergeMessage,
  extractBranchFromDecorations,
  inferCommitBranches
} from './graphLayout';

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
});
