import {
  buildFileHeaderData,
  formatDateTimeChinese,
  FileHeaderCodeLensProvider
} from '../fileHeaderCodeLens';
import * as gitHelper from '../gitHelper';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

jest.mock('fs', () => ({
  existsSync: jest.fn(),
  statSync: jest.fn()
}));
jest.mock('../gitHelper', () => ({
  execGit: jest.fn(),
  getCurrentGitUser: jest.fn(),
  getFileLastCommit: jest.fn(),
  getFileAuthors: jest.fn(),
  isFileTracked: jest.fn(),
  hasFileLocalModifications: jest.fn()
}));
jest.mock('vscode', () => ({
  Range: jest.fn((startLine, startChar, endLine, endChar) => ({
    start: { line: startLine, character: startChar },
    end: { line: endLine, character: endChar }
  })),
  CodeLens: jest.fn((range, command) => ({ range, command })),
  window: {},
  workspace: {},
  languages: {
    registerCodeLensProvider: jest.fn(() => ({ dispose: jest.fn() }))
  },
  EventEmitter: jest.fn(() => ({
    event: jest.fn(),
    fire: jest.fn()
  }))
}), { virtual: true });

/** Mock RepoManager that returns '/mock/git/root' for any file. */
function createMockRepoManager() {
  return {
    getRepoForFile: () => '/mock/git/root',
  } as any;
}

describe('fileHeaderCodeLens', () => {
  describe('formatDateTimeChinese', () => {
    it('should format date as YYYY/MM/DD HH:MM', () => {
      const ts = Math.floor(new Date(2024, 0, 1, 12, 0, 0).getTime() / 1000);
      expect(formatDateTimeChinese(ts)).toBe('2024/01/01 12:00');
    });

    it('should pad single digit month/day/hour/minute', () => {
      const ts = Math.floor(new Date(2024, 2, 5, 3, 7, 0).getTime() / 1000);
      expect(formatDateTimeChinese(ts)).toBe('2024/03/05 03:07');
    });
  });

  describe('buildFileHeaderData', () => {
    const currentUser = { name: 'jiapengyan', email: 'jiapengyan@example.com' };
    const otherUser = { name: 'wangx', email: 'wangx@example.com' };
    const nowSeconds = Math.floor(new Date(2026, 5, 25, 12, 0, 0).getTime() / 1000);

    it('should show "你" when there are local changes', () => {
      const lastCommit = { hash: 'abc', author: 'wangx', email: 'wangx@example.com', timestamp: nowSeconds - 86400, message: 'msg' };
      const data = buildFileHeaderData(lastCommit, [otherUser], currentUser, true, false, nowSeconds);
      expect(data).toBeDefined();
      expect(data!.displayAuthor).toBe('你');
      expect(data!.diffKind).toBe('workingTree');
      expect(data!.authorCount).toBe(2);
      expect(data!.youSuffix).toBe('（你和其他）');
    });

    it('should show last commit author when no local changes', () => {
      const lastCommit = { hash: 'abc', author: 'wangx', email: 'wangx@example.com', timestamp: nowSeconds - 86400, message: 'msg' };
      const data = buildFileHeaderData(lastCommit, [otherUser], currentUser, false, false, nowSeconds);
      expect(data).toBeDefined();
      expect(data!.displayAuthor).toBe('wangx');
      expect(data!.diffKind).toBe('commit');
      expect(data!.authorCount).toBe(1);
      expect(data!.youSuffix).toBe('');
    });

    it('should show "你" when current user is the last committer', () => {
      const lastCommit = { hash: 'abc', author: 'jiapengyan', email: 'jiapengyan@example.com', timestamp: nowSeconds - 86400, message: 'msg' };
      const data = buildFileHeaderData(lastCommit, [currentUser], currentUser, false, false, nowSeconds);
      expect(data).toBeDefined();
      expect(data!.displayAuthor).toBe('你');
      expect(data!.authorCount).toBe(1);
      expect(data!.youSuffix).toBe('（你）');
    });

    it('should handle new file with no history', () => {
      const data = buildFileHeaderData(undefined, [], currentUser, false, true, nowSeconds);
      expect(data).toBeDefined();
      expect(data!.displayAuthor).toBe('你');
      expect(data!.authorCount).toBe(1);
      expect(data!.youSuffix).toBe('（你）');
    });

    it('should handle single author file when current user modifies it', () => {
      const lastCommit = { hash: 'abc', author: 'wangx', email: 'wangx@example.com', timestamp: nowSeconds - 86400, message: 'msg' };
      const data = buildFileHeaderData(lastCommit, [otherUser], currentUser, true, false, nowSeconds);
      expect(data).toBeDefined();
      expect(data!.authorCount).toBe(2);
      expect(data!.youSuffix).toBe('（你和其他）');
    });

    it('should not double count current user if already in history', () => {
      const lastCommit = { hash: 'abc', author: 'jiapengyan', email: 'jiapengyan@example.com', timestamp: nowSeconds - 86400, message: 'msg' };
      const data = buildFileHeaderData(lastCommit, [currentUser], currentUser, true, false, nowSeconds);
      expect(data).toBeDefined();
      expect(data!.authorCount).toBe(1);
      expect(data!.youSuffix).toBe('（你）');
    });

    it('should return undefined when no history and no local changes', () => {
      const data = buildFileHeaderData(undefined, [], currentUser, false, false, nowSeconds);
      expect(data).toBeUndefined();
    });
  });

  describe('FileHeaderCodeLensProvider', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should return empty array for untitled documents', async () => {
      const provider = new FileHeaderCodeLensProvider(createMockRepoManager());
      const document = { isUntitled: true, uri: { scheme: 'file' } } as any;
      const lenses = await provider.provideCodeLenses(document);
      expect(lenses).toEqual([]);
    });

    it('should return CodeLenses for tracked file with history', async () => {
      (gitHelper.hasFileLocalModifications as jest.Mock).mockResolvedValue(false);
      (gitHelper.isFileTracked as jest.Mock).mockResolvedValue(true);
      (gitHelper.getFileLastCommit as jest.Mock).mockResolvedValue({
        hash: 'abc1234',
        author: 'jiapengyan',
        email: 'jiapengyan@example.com',
        timestamp: 1624543200,
        message: 'msg'
      });
      (gitHelper.getFileAuthors as jest.Mock).mockResolvedValue([
        { name: 'jiapengyan', email: 'jiapengyan@example.com' }
      ]);
      (gitHelper.getCurrentGitUser as jest.Mock).mockResolvedValue({
        name: 'jiapengyan',
        email: 'jiapengyan@example.com'
      });

      const provider = new FileHeaderCodeLensProvider(createMockRepoManager());
      const document = {
        isUntitled: false,
        uri: { scheme: 'file', fsPath: path.join('/mock/git/root', 'src', 'file.ts') }
      } as any;

      const lenses = await provider.provideCodeLenses(document);
      expect(lenses.length).toBe(2);
      expect(lenses[0].command.command).toBe('git-visual.openFileRecentDiff');
      expect(lenses[0].command.arguments).toEqual([document.uri.fsPath, 'commit', 'abc1234', false]);
      expect(lenses[1].command.command).toBe('git-visual.showLineBlame');
      expect(lenses[1].command.arguments).toEqual([false]);
    });

    it('should pass isNewFile=true for untracked new files', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.statSync as jest.Mock).mockReturnValue({ size: 100 });
      (gitHelper.hasFileLocalModifications as jest.Mock).mockResolvedValue(false);
      (gitHelper.isFileTracked as jest.Mock).mockResolvedValue(false);
      (gitHelper.getFileLastCommit as jest.Mock).mockResolvedValue(undefined);
      (gitHelper.getFileAuthors as jest.Mock).mockResolvedValue([]);
      (gitHelper.getCurrentGitUser as jest.Mock).mockResolvedValue({
        name: 'jiapengyan',
        email: 'jiapengyan@example.com'
      });

      const provider = new FileHeaderCodeLensProvider(createMockRepoManager());
      const document = {
        isUntitled: false,
        uri: { scheme: 'file', fsPath: path.join('/mock/git/root', 'new-file.ts') }
      } as any;

      const lenses = await provider.provideCodeLenses(document);
      expect(lenses.length).toBe(2);
      expect(lenses[0].command.command).toBe('git-visual.openFileRecentDiff');
      expect(lenses[0].command.arguments).toEqual([document.uri.fsPath, 'workingTree', undefined, true]);
      expect(lenses[1].command.command).toBe('git-visual.showLineBlame');
      expect(lenses[1].command.arguments).toEqual([true]);
    });
  });
});