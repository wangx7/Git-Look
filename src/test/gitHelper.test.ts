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
  getCodeStats
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
});
