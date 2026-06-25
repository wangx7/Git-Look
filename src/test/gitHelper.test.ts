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
  clearGitCache
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
});
