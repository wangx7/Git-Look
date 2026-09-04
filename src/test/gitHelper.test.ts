import {
  execGitBuffer,
  isGitRepository,
  getBranches,
  traceFileHistory,
  hasFileLocalModifications,
  getCurrentGitUser,
  getFileLastCommit,
  getFileAuthors,
  isFileTracked,
  clearGitCache,
  toWorkingTreeUri,
  suppressWatchRefresh,
  shouldSkipWatchRefresh,
  getCodeStats,
  getAuthors,
  buildLogArgs,
  getWorkingTreeStatus,
  getWorktrees,
  execGit,
  execGitStream
} from '../gitHelper';
import * as cp from 'child_process';
import * as vscode from 'vscode';

jest.mock('child_process');
jest.mock('vscode', () => ({
  extensions: {
    getExtension: jest.fn()
  }
}), { virtual: true });

describe('gitHelper', () => {
  afterEach(() => {
    jest.clearAllMocks();
    clearGitCache();
  });

  it('should verify if it is a git repo', async () => {
    (cp.execFile as any).mockImplementation((cmd: any, args: any, opts: any, cb: any) => {
      cb(null, 'true', '');
    });
    const isRepo = await isGitRepository('/mock/path');
    expect(isRepo).toBe(true);
  });

  it('should trace file history with rename support', async () => {
    const mockOutput = `COMMIT_START_LOOK\x1fhash1\x1fparent1\x1fAuthor Name\x1fauthor@example.com\x1f1624543200\x1fTest Commit Message\n` +
      `M\tsrc/webview/selectionHistory.ts\n` +
      `COMMIT_START_LOOK\x1fhash2\x1fparent2\x1fAuthor Name\x1fauthor@example.com\x1f1624540000\x1fRenamed file\n` +
      `R100\tsrc/webview/oldSelectionHistory.ts\tsrc/webview/selectionHistory.ts\n`;
    
    (cp.execFile as any).mockImplementation((cmd: any, args: any, opts: any, cb: any) => {
      cb(null, mockOutput, '');
    });
    
    const commits = await traceFileHistory('/mock/path', 'src/webview/selectionHistory.ts');
    expect(commits.length).toBe(2);
    expect(commits[0].hash).toBe('hash1');
    expect(commits[0].oldFilePath).toBe('src/webview/selectionHistory.ts');
    expect(commits[0].newFilePath).toBe('src/webview/selectionHistory.ts');
    
    expect(commits[1].hash).toBe('hash2');
    expect(commits[1].oldFilePath).toBe('src/webview/oldSelectionHistory.ts');
    expect(commits[1].newFilePath).toBe('src/webview/selectionHistory.ts');
  });

  it('should check if file has local modifications', async () => {
    (cp.execFile as any).mockImplementation((cmd: any, args: any, opts: any, cb: any) => {
      if (args.includes('rev-parse')) {
        cb(null, '/mock/path', '');
      } else {
        cb(null, 'diff content here', '');
      }
    });
    const hasMod = await hasFileLocalModifications('/mock/path', '/mock/path/file.txt');
    expect(hasMod).toBe(true);
  });

  it('should get current git user', async () => {
    (cp.execFile as any).mockImplementation((cmd: any, args: any, opts: any, cb: any) => {
      if (args.includes('user.name')) {
        cb(null, 'jiapengyan\n', '');
      } else if (args.includes('user.email')) {
        cb(null, 'jiapengyan@example.com\n', '');
      } else {
        cb(null, '', '');
      }
    });

    const user = await getCurrentGitUser('/mock/path');
    expect(user.name).toBe('jiapengyan');
    expect(user.email).toBe('jiapengyan@example.com');
  });

  it('should get file last commit', async () => {
    const mockOutput = 'abc1234\x1fjiapengyan\x1fjiapengyan@example.com\x1f1624543200\x1fTest commit message\n';
    (cp.execFile as any).mockImplementation((cmd: any, args: any, opts: any, cb: any) => {
      cb(null, mockOutput, '');
    });

    const commit = await getFileLastCommit('/mock/path', 'src/file.ts');
    expect(commit).toBeDefined();
    expect(commit!.hash).toBe('abc1234');
    expect(commit!.author).toBe('jiapengyan');
    expect(commit!.email).toBe('jiapengyan@example.com');
    expect(commit!.timestamp).toBe(1624543200);
    expect(commit!.message).toBe('Test commit message');
  });

  it('should return undefined for file last commit when no history', async () => {
    (cp.execFile as any).mockImplementation((cmd: any, args: any, opts: any, cb: any) => {
      cb(null, '', '');
    });

    const commit = await getFileLastCommit('/mock/path', 'src/newFile.ts');
    expect(commit).toBeUndefined();
  });

  it('should get unique file authors from blame porcelain', async () => {
    const mockOutput = [
      '7f4e8d9c3a1b2c4d5e6f7a8b9c0d1e2f3a4b5c6d 1 1 1',
      'author jiapengyan',
      'author-mail <jiapengyan@example.com>',
      'author-time 1624543200',
      'author-tz +0800',
      'summary First commit',
      '\tline 1',
      'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0 2 2 2',
      'author wangx',
      'author-mail <wangx@example.com>',
      'author-time 1624543300',
      'author-tz +0800',
      'summary Second commit',
      '\tline 2',
      '7f4e8d9c3a1b2c4d5e6f7a8b9c0d1e2f3a4b5c6d 3 3 3',
      'author jiapengyan',
      'author-mail <jiapengyan@example.com>',
      'author-time 1624543200',
      'author-tz +0800',
      'summary First commit',
      '\tline 3'
    ].join('\n');

    (cp.execFile as any).mockImplementation((cmd: any, args: any, opts: any, cb: any) => {
      if (args.includes('blame')) {
        cb(null, mockOutput, '');
      } else {
        cb(null, '', '');
      }
    });

    const authors = await getFileAuthors('/mock/path', 'src/file.ts');
    expect(authors.length).toBe(2);
    expect(authors).toEqual([
      { name: 'jiapengyan', email: 'jiapengyan@example.com' },
      { name: 'wangx', email: 'wangx@example.com' }
    ]);
  });

  it('should ignore not-committed-yet author from blame porcelain', async () => {
    const mockOutput = [
      '7f4e8d9c3a1b2c4d5e6f7a8b9c0d1e2f3a4b5c6d 1 1 1',
      'author jiapengyan',
      'author-mail <jiapengyan@example.com>',
      'author-time 1624543200',
      'author-tz +0800',
      'summary First commit',
      '\tline 1',
      '0000000000000000000000000000000000000000 2 2 2',
      'author Not Committed Yet',
      'author-mail <not.committed.yet>',
      'author-time 1624543300',
      'author-tz +0800',
      'summary Uncommitted',
      '\tline 2'
    ].join('\n');

    (cp.execFile as any).mockImplementation((cmd: any, args: any, opts: any, cb: any) => {
      if (args.includes('blame')) {
        cb(null, mockOutput, '');
      } else {
        cb(null, '', '');
      }
    });

    const authors = await getFileAuthors('/mock/path', 'src/file.ts');
    expect(authors.length).toBe(1);
    expect(authors).toEqual([
      { name: 'jiapengyan', email: 'jiapengyan@example.com' }
    ]);
  });

  it('should check if file is tracked', async () => {
    (cp.execFile as any).mockImplementation((cmd: any, args: any, opts: any, cb: any) => {
      if (args.includes('ls-files')) {
        cb(null, 'src/file.ts\n', '');
      } else {
        cb(null, '', '');
      }
    });

    const tracked = await isFileTracked('/mock/path', 'src/file.ts');
    expect(tracked).toBe(true);
  });

  it('should check if file is not tracked', async () => {
    (cp.execFile as any).mockImplementation((cmd: any, args: any, opts: any, cb: any) => {
      if (args.includes('ls-files')) {
        cb(null, '', '');
      } else {
        cb(null, '', '');
      }
    });

    const tracked = await isFileTracked('/mock/path', 'src/newFile.ts');
    expect(tracked).toBe(false);
  });

  describe('toWorkingTreeUri', () => {
    it('should use stash hash when stash create succeeds', async () => {
      (cp.execFile as any).mockImplementation((cmd: any, args: any, opts: any, cb: any) => {
        if (args.includes('stash') && args.includes('create')) {
          cb(null, 'stash-abc123def456\n', '');
        } else {
          cb(null, '', '');
        }
      });
      (vscode.extensions.getExtension as jest.Mock).mockReturnValue(undefined);

      const uri = { fsPath: '/mock/path/file.ts', with: function(changes: any) { return { ...this, ...changes, query: changes.query || '' }; } } as any;
      const result = await toWorkingTreeUri(uri, '/mock/path');
      expect(result.scheme).toBe('git');
      const query = JSON.parse(result.query);
      expect(query.ref).toBe('stash-abc123def456');
      expect(query.path).toBe('/mock/path/file.ts');
    });

    it('should fallback to HEAD when stash create returns empty', async () => {
      (cp.execFile as any).mockImplementation((cmd: any, args: any, opts: any, cb: any) => {
        if (args.includes('stash') && args.includes('create')) {
          cb(null, '', '');
        } else {
          cb(null, '', '');
        }
      });
      (vscode.extensions.getExtension as jest.Mock).mockReturnValue(undefined);

      const uri = { fsPath: '/mock/path/file.ts', with: function(changes: any) { return { ...this, ...changes, query: changes.query || '' }; } } as any;
      const result = await toWorkingTreeUri(uri, '/mock/path');
      expect(result.scheme).toBe('git');
      const query = JSON.parse(result.query);
      expect(query.ref).toBe('HEAD');
    });

    it('should fallback to HEAD when stash create fails', async () => {
      (cp.execFile as any).mockImplementation((cmd: any, args: any, opts: any, cb: any) => {
        if (args.includes('stash') && args.includes('create')) {
          cb(new Error('stash failed'), '', 'error');
        } else {
          cb(null, '', '');
        }
      });
      (vscode.extensions.getExtension as jest.Mock).mockReturnValue(undefined);

      const uri = { fsPath: '/mock/path/file.ts', with: function(changes: any) { return { ...this, ...changes, query: changes.query || '' }; } } as any;
      const result = await toWorkingTreeUri(uri, '/mock/path');
      expect(result.scheme).toBe('git');
      const query = JSON.parse(result.query);
      expect(query.ref).toBe('HEAD');
    });
  });

  describe('watch refresh suppression', () => {
    afterEach(() => {
      suppressWatchRefresh(-10000);
    });

    it('shouldSkipWatchRefresh returns false by default', () => {
      expect(shouldSkipWatchRefresh()).toBe(false);
    });

    it('suppressWatchRefresh sets a silent window', () => {
      suppressWatchRefresh(5000);
      expect(shouldSkipWatchRefresh()).toBe(true);
    });

    it('shouldSkipWatchRefresh returns false after silent window expires', () => {
      suppressWatchRefresh(-1000);
      expect(shouldSkipWatchRefresh()).toBe(false);
    });
  });

  describe('getCodeStats hourlyActivity', () => {
    // Build a unix timestamp for a given local date + hour
    function makeTs(dateStr: string, hour: number): number {
      const d = new Date(`${dateStr}T${String(hour).padStart(2, '0')}:30:00`);
      return Math.floor(d.getTime() / 1000);
    }

    it('should return 24-bucket hourlyActivity when sinceDate === untilDate', async () => {
      const date = '2026-07-04';
      const ts9  = makeTs(date, 9);
      const ts14 = makeTs(date, 14);
      const mockOutput = [
        `COMMIT_STAT|aaa|wangx|wangx@test.com|${ts9}`,
        '2\t1\tsrc/file.ts',
        `COMMIT_STAT|bbb|jiapengyan|jp@test.com|${ts9}`,
        '1\t0\tsrc/file.ts',
        `COMMIT_STAT|ccc|wangx|wangx@test.com|${ts14}`,
        '3\t2\tsrc/other.ts',
      ].join('\n');

      (cp.execFile as any).mockImplementation((cmd: any, args: any, opts: any, cb: any) => {
        if (args.includes('log')) { cb(null, mockOutput, ''); }
        else if (args.includes('rev-parse')) { cb(null, '/usr/bin/git\n', ''); }
        else { cb(null, '', ''); }
      });

      const stats = await getCodeStats('/mock/path', { since: date, until: date });

      // Should produce exactly 24 buckets
      expect(stats.hourlyActivity).not.toBeNull();
      expect(stats.hourlyActivity!.length).toBe(24);

      // Labels are formatted correctly
      expect(stats.hourlyActivity![0].label).toBe('00:00');
      expect(stats.hourlyActivity![9].label).toBe('09:00');
      expect(stats.hourlyActivity![23].label).toBe('23:00');

      // Counts match commits
      expect(stats.hourlyActivity![9].count).toBe(2);   // wangx + jiapengyan
      expect(stats.hourlyActivity![14].count).toBe(1);  // wangx
      expect(stats.hourlyActivity![0].count).toBe(0);   // empty hour
    });

    it('should return hourlyActivity as null when sinceDate !== untilDate', async () => {
      const mockOutput = [
        `COMMIT_STAT|aaa|wangx|wangx@test.com|${makeTs('2026-07-01', 10)}`,
        '1\t0\tsrc/a.ts',
        `COMMIT_STAT|bbb|wangx|wangx@test.com|${makeTs('2026-07-02', 11)}`,
        '1\t0\tsrc/b.ts',
      ].join('\n');

      (cp.execFile as any).mockImplementation((cmd: any, args: any, opts: any, cb: any) => {
        if (args.includes('log')) { cb(null, mockOutput, ''); }
        else if (args.includes('rev-parse')) { cb(null, '/usr/bin/git\n', ''); }
        else { cb(null, '', ''); }
      });

      const stats = await getCodeStats('/mock/path', { since: '2026-07-01', until: '2026-07-02' });

      expect(stats.hourlyActivity).toBeNull();
      expect(stats.dailyActivity.length).toBe(2);
    });

    it('should return all-zero hourly buckets when no commits on that day', async () => {
      const date = '2026-07-04';

      (cp.execFile as any).mockImplementation((cmd: any, args: any, opts: any, cb: any) => {
        if (args.includes('log')) { cb(null, '', ''); }
        else if (args.includes('rev-parse')) { cb(null, '/usr/bin/git\n', ''); }
        else { cb(null, '', ''); }
      });

      const stats = await getCodeStats('/mock/path', { since: date, until: date });

      expect(stats.hourlyActivity).not.toBeNull();
      expect(stats.hourlyActivity!.length).toBe(24);
      expect(stats.hourlyActivity!.every(h => h.count === 0)).toBe(true);
    });
  });

  describe('getAuthors with git shortlog', () => {
    it('should parse tab-delimited shortlog output correctly and deduplicate', async () => {
      const mockOutput = '    15\twangx\n     8\tjiapengyan\n     2\twangx\n';
      (cp.execFile as any).mockImplementation((cmd: any, args: any, opts: any, cb: any) => {
        if (args.includes('shortlog')) {
          cb(null, mockOutput, '');
        } else {
          cb(null, '', '');
        }
      });

      const authors = await getAuthors('/mock/path');
      expect(authors).toEqual(['wangx', 'jiapengyan']);
    });

    it('should handle space-delimited shortlog lines gracefully', async () => {
      const mockOutput = '10 Alice Smith\n5 Bob Jones\n';
      (cp.execFile as any).mockImplementation((cmd: any, args: any, opts: any, cb: any) => {
        if (args.includes('shortlog')) {
          cb(null, mockOutput, '');
        } else {
          cb(null, '', '');
        }
      });

      const authors = await getAuthors('/mock/path');
      expect(authors).toEqual(['Alice Smith', 'Bob Jones']);
    });
  });

  describe('buildLogArgs', () => {
    it('should include -F with --grep to treat search query as fixed string', () => {
      const { args } = buildLogArgs({ query: '[WIP] Fix (core)' });
      expect(args).toContain('-F');
      expect(args).toContain('--grep=[WIP] Fix (core)');
    });

    it('should include --first-parent when firstParent filter is true', () => {
      const { args } = buildLogArgs({ firstParent: true });
      expect(args).toContain('--first-parent');
    });

    it('should not include --first-parent when firstParent filter is false or undefined', () => {
      const { args } = buildLogArgs({});
      expect(args).not.toContain('--first-parent');
    });
  });

  describe('getWorkingTreeStatus', () => {
    it('should parse status porcelain v1 with staged, unstaged, untracked, and conflict files', async () => {
      const statusOutput = 'M  src/staged.ts\0 M src/unstaged.ts\0?? untracked.txt\0R  newname.ts\0oldname.ts\0UU conflict.ts\0';
      const numstatOutput = '5\t2\tsrc/staged.ts\n10\t1\tsrc/unstaged.ts\n';

      (cp.execFile as any).mockImplementation((cmd: any, args: any, opts: any, cb: any) => {
        if (args.includes('status')) {
          cb(null, statusOutput, '');
        } else if (args.includes('diff') && args.includes('--numstat')) {
          cb(null, numstatOutput, '');
        } else if (args.includes('MERGE_HEAD')) {
          cb(null, 'mergehash123\n', '');
        } else {
          cb(null, '', '');
        }
      });

      const wtStatus = await getWorkingTreeStatus('/mock/path');
      expect(wtStatus.hasChanges).toBe(true);
      expect(wtStatus.isMerging).toBe(true);
      expect(wtStatus.mergeHeads).toEqual(['mergehash123']);
      expect(wtStatus.stagedCount).toBe(2); // src/staged.ts (M ) and newname.ts (R )
      expect(wtStatus.unstagedCount).toBe(2); // src/unstaged.ts ( M) and conflict.ts (UU)
      expect(wtStatus.untrackedCount).toBe(1); // untracked.txt (??)

      const stagedFile = wtStatus.files.find(f => f.path === 'src/staged.ts');
      expect(stagedFile).toBeDefined();
      expect(stagedFile?.staged).toBe(true);
      expect(stagedFile?.additions).toBe(5);
      expect(stagedFile?.deletions).toBe(2);

      const renamedFile = wtStatus.files.find(f => f.path === 'newname.ts');
      expect(renamedFile).toBeDefined();
      expect(renamedFile?.oldPath).toBe('oldname.ts');
    });

    it('should return hasChanges false when working tree is completely clean', async () => {
      (cp.execFile as any).mockImplementation((cmd: any, args: any, opts: any, cb: any) => {
        cb(null, '', '');
      });

      const wtStatus = await getWorkingTreeStatus('/mock/path');
      expect(wtStatus.hasChanges).toBe(false);
      expect(wtStatus.files.length).toBe(0);
      expect(wtStatus.isMerging).toBe(false);
    });
  });

  describe('getWorktrees', () => {
    it('should parse git worktree list porcelain output correctly', async () => {
      const mockWorktreeOutput = 
        'worktree /mock/path\n' +
        'HEAD 1111111111111111111111111111111111111111\n' +
        'branch refs/heads/main\n\n' +
        'worktree /mock/other-worktree\n' +
        'HEAD 2222222222222222222222222222222222222222\n' +
        'branch refs/heads/feature-wt\n' +
        'locked working on hotfix\n';

      (cp.execFile as any).mockImplementation((cmd: any, args: any, opts: any, cb: any) => {
        if (args.includes('worktree')) {
          cb(null, mockWorktreeOutput, '');
        } else {
          cb(null, '', '');
        }
      });

      const worktrees = await getWorktrees('/mock/path');
      expect(worktrees.length).toBe(2);
      expect(worktrees[0].path).toBe('/mock/path');
      expect(worktrees[0].branch).toBe('main');
      expect(worktrees[0].isCurrent).toBe(true);
      expect(worktrees[0].isLocked).toBe(false);

      expect(worktrees[1].path).toBe('/mock/other-worktree');
      expect(worktrees[1].branch).toBe('feature-wt');
      expect(worktrees[1].isCurrent).toBe(false);
      expect(worktrees[1].isLocked).toBe(true);
      expect(worktrees[1].lockReason).toBe('working on hotfix');
    });
  });

  describe('execGit and execGitStream', () => {
    it('execGit caches results with deterministic compound keys and avoids space collisions', async () => {
      clearGitCache();
      let callCount = 0;
      (cp.execFile as any).mockImplementation((cmd: any, args: any, opts: any, cb: any) => {
        callCount++;
        cb(null, `result-${callCount}`, '');
      });

      const res1 = await execGit(['commit', '-m', 'hello world'], '/mock/repo');
      const res2 = await execGit(['commit', '-m', 'hello world'], '/mock/repo');
      expect(res1).toBe(res2);
      expect(callCount).toBe(1);

      const res3 = await execGit(['commit', '-m', 'hello', 'world'], '/mock/repo');
      expect(callCount).toBe(2);
      expect(res3).not.toBe(res1);
    });

    it('execGitStream streams lines chunk by chunk and supports early stopping', async () => {
      const { EventEmitter } = require('events');
      const mockChild: any = new EventEmitter();
      mockChild.stdout = new EventEmitter();
      mockChild.stderr = new EventEmitter();
      mockChild.kill = jest.fn();

      (cp.spawn as any).mockImplementation(() => mockChild);

      const lines: string[] = [];
      const streamPromise = execGitStream(['log'], '/mock/repo', (line) => {
        lines.push(line);
        if (lines.length >= 2) {
          return false;
        }
      });

      setImmediate(() => {
        mockChild.stdout.emit('data', Buffer.from('line1\nline2\nline3\n'));
      });

      await streamPromise;
      expect(lines).toEqual(['line1', 'line2']);
      expect(mockChild.kill).toHaveBeenCalled();
    });
  });
});
