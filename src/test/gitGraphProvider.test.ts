import * as vscode from 'vscode';
import { GitGraphProvider } from '../panel/gitGraphProvider';
import * as gitHelper from '../gitHelper';
import * as path from 'path';
import * as fs from 'fs';

jest.mock('fs', () => ({
  readFileSync: jest.fn(() => '<html></html>'),
  existsSync: jest.fn(() => true)
}));

jest.mock('vscode', () => {
  return {
    Uri: {
      file: jest.fn((path) => ({ fsPath: path, scheme: 'file' })),
      from: jest.fn((opts) => opts),
      joinPath: jest.fn((...args) => ({ fsPath: args.join('/') })),
    },
    env: { appRoot: '/mock/app/root' },
    commands: {
      executeCommand: jest.fn(),
    },
    window: {
      showErrorMessage: jest.fn(),
      activeTextEditor: undefined,
      onDidChangeActiveTextEditor: jest.fn(() => ({ dispose: jest.fn() })),
    },
    Range: jest.fn(),
    TextEditorRevealType: { InCenter: 1 }
  };
}, { virtual: true });

jest.mock('../gitHelper', () => ({
  execGit: jest.fn(),
  toGitUri: jest.fn(),
  toWorkingTreeUri: jest.fn(),
  suppressWatchRefresh: jest.fn(),
  shouldSkipWatchRefresh: jest.fn(() => false),
  hasFileLocalModifications: jest.fn(),
  traceFileHistory: jest.fn(),
  getCommits: jest.fn(),
  getCommitsUntil: jest.fn(),
  getBranches: jest.fn(),
  getAuthors: jest.fn(),
  getCodeStats: jest.fn(),
  clearGitCache: jest.fn()
}));

/** Mock RepoManager that returns '/mock/git/root' as the selected repo. */
function createMockRepoManager() {
  return {
    getSelectedRoot: () => '/mock/git/root',
    repos: [],
    selectedIndex: 0,
    onDidChangeRepos: () => ({ dispose: jest.fn() }),
    onDidChangeSelection: () => ({ dispose: jest.fn() }),
    selectRepo: jest.fn(),
  } as any;
}

describe('GitGraphProvider Diff Logic', () => {
  let provider: any;

  beforeEach(() => {
    jest.clearAllMocks();
    provider = new GitGraphProvider({} as any, createMockRepoManager());
  });

  const createMockWebviewView = (messageListenerRef: { current: any }) => {
    return {
      onDidDispose: jest.fn(),
      webview: {
        onDidReceiveMessage: (listener: any) => { messageListenerRef.current = listener; },
        html: '',
        options: {},
        postMessage: jest.fn(),
        asWebviewUri: jest.fn(uri => uri)
      }
    };
  };

  describe('openDiff', () => {
    it('should use git-visual scheme if file does not exist in target commit', async () => {
      (gitHelper.execGit as jest.Mock).mockImplementation(async (args) => {
        if (args && args[0] === 'rev-parse') return '/mock/git/root';
        if (args && args[0] === 'cat-file' && args[1] === '-e' && args[2].startsWith('target-hash')) {
          throw new Error('fatal: path not found');
        }
        return '';
      });
      (gitHelper.toGitUri as jest.Mock).mockResolvedValue({ scheme: 'git', query: 'mocked' });

      const message = {
        command: 'openDiff',
        file: 'test.ts',
        hash: 'target-hash',
        parentHash: 'parent-hash'
      };

      const listenerRef = { current: null };
      provider.resolveWebviewView(createMockWebviewView(listenerRef));
      await (listenerRef.current as any)(message);

      expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
        'vscode.diff',
        expect.anything(),
        expect.objectContaining({ scheme: 'git-visual' }),
        expect.any(String)
      );
    });

    it('should use toGitUri if file exists in target commit', async () => {
      (gitHelper.execGit as jest.Mock).mockImplementation(async (args) => {
        if (args && args[0] === 'rev-parse') return '/mock/git/root';
        return '';
      });
      (gitHelper.toGitUri as jest.Mock).mockResolvedValue({ scheme: 'git', query: 'mocked' });

      const message = {
        command: 'openDiff',
        file: 'test.ts',
        hash: 'target-hash',
        parentHash: 'parent-hash'
      };

      const listenerRef = { current: null };
      provider.resolveWebviewView(createMockWebviewView(listenerRef));
      await (listenerRef.current as any)(message);

      expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
        'vscode.diff',
        expect.objectContaining({ scheme: 'git', query: 'mocked' }),
        expect.objectContaining({ scheme: 'git', query: 'mocked' }),
        expect.any(String)
      );
    });
  });

  describe('openAllDiffs', () => {
    it('should use git-visual for Added and Deleted files', async () => {
      const message = {
        command: 'openAllDiffs',
        hash: 'target-hash',
        parentHash: 'parent-hash',
        message: 'Test message',
        files: [
          { path: 'added.ts', status: 'A' },
          { path: 'deleted.ts', status: 'D' },
          { path: 'modified.ts', status: 'M' }
        ]
      };

      (gitHelper.execGit as jest.Mock).mockImplementation(async (args) => {
        if (args && args[0] === 'rev-parse') return '/mock/git/root';
        return '';
      });
      (gitHelper.toGitUri as jest.Mock).mockResolvedValue({ scheme: 'git', query: 'mocked' });

      const listenerRef = { current: null };
      provider.resolveWebviewView(createMockWebviewView(listenerRef));
      await (listenerRef.current as any)(message);

      expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
        'vscode.changes',
        expect.any(String),
        expect.arrayContaining([
          expect.arrayContaining([
            expect.objectContaining({ scheme: 'file' }),
            expect.objectContaining({ scheme: 'git-visual' }),
            expect.objectContaining({ scheme: 'git', query: 'mocked' })
          ]),
          expect.arrayContaining([
            expect.objectContaining({ scheme: 'file' }),
            expect.objectContaining({ scheme: 'git', query: 'mocked' }),
            expect.objectContaining({ scheme: 'git-visual' })
          ]),
          expect.arrayContaining([
            expect.objectContaining({ scheme: 'file' }),
            expect.objectContaining({ scheme: 'git', query: 'mocked' }),
            expect.objectContaining({ scheme: 'git', query: 'mocked' })
          ])
        ])
      );
    });

    it('should open multi diff for working tree with HEAD and physical fileUri', async () => {
      const message = {
        command: 'openAllDiffs',
        hash: '*working-tree*',
        message: '未提交的修改 (2 个文件)',
        files: [
          { path: 'added.ts', status: 'A' },
          { path: 'modified.ts', status: 'M' }
        ]
      };

      (gitHelper.execGit as jest.Mock).mockImplementation(async (args) => {
        if (args && args[0] === 'rev-parse') return '/mock/git/root';
        return '';
      });
      (gitHelper.toGitUri as jest.Mock).mockResolvedValue({ scheme: 'git', query: 'head-mock' });

      const listenerRef = { current: null };
      provider.resolveWebviewView(createMockWebviewView(listenerRef));
      await (listenerRef.current as any)(message);

      expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
        'vscode.changes',
        '工作区未提交修改 (2 个文件)',
        expect.arrayContaining([
          expect.arrayContaining([
            expect.objectContaining({ scheme: 'file' }),
            expect.objectContaining({ scheme: 'git-visual' }),
            expect.objectContaining({ scheme: 'file' })
          ]),
          expect.arrayContaining([
            expect.objectContaining({ scheme: 'file' }),
            expect.objectContaining({ scheme: 'git', query: 'head-mock' }),
            expect.objectContaining({ scheme: 'file' })
          ])
        ])
      );
    });
  });

  describe('openFileHistoryDiff', () => {
    it('should use editable physical file URI for working tree side', async () => {
      (gitHelper.execGit as jest.Mock).mockImplementation(async (args: any[]) => {
        if (args && args[0] === 'rev-parse') return '/mock/git/root';
        return '';
      });
      (gitHelper.toGitUri as jest.Mock).mockResolvedValue({ scheme: 'git', query: 'head-mock' });

      const message = {
        command: 'openFileHistoryDiff',
        file: 'src/test.ts',
        hash: 'abc123',
        parentHash: 'def456',
        oldFilePath: null,
        newFilePath: null
      };

      const listenerRef = { current: null };
      provider.resolveWebviewView(createMockWebviewView(listenerRef));
      await (listenerRef.current as any)(message);

      expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
        'vscode.diff',
        expect.anything(),
        expect.objectContaining({ scheme: 'file', fsPath: path.join('/mock/git/root', 'src/test.ts') }),
        expect.stringContaining('本地工作区')
      );
    });
  });

  describe('openSingleDiff', () => {
    it('should use editable physical fileUri when hash is HEAD (working tree changes)', async () => {
      (gitHelper.execGit as jest.Mock).mockImplementation(async (args: any[]) => {
        if (args && args[0] === 'rev-parse') return '/mock/git/root';
        return '';
      });
      (gitHelper.toGitUri as jest.Mock).mockResolvedValue({ scheme: 'git', query: 'history-mock' });

      const message = {
        command: 'openSingleDiff',
        file: 'src/test.ts',
        hash: 'HEAD',
        parentHash: 'def456',
        oldFilePath: null,
        newFilePath: null,
        lineRange: null
      };

      const listenerRef = { current: null };
      provider.resolveWebviewView(createMockWebviewView(listenerRef));
      await (listenerRef.current as any)(message);

      expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
        'vscode.diff',
        expect.anything(),
        expect.objectContaining({ scheme: 'file', fsPath: path.join('/mock/git/root', 'src/test.ts') }),
        expect.stringContaining('本地工作区'),
        expect.anything()
      );
    });

    it('should use normal toGitUri for non-HEAD commits', async () => {
      (gitHelper.execGit as jest.Mock).mockImplementation(async (args: any[]) => {
        if (args && args[0] === 'rev-parse') return '/mock/git/root';
        return '';
      });
      (gitHelper.toGitUri as jest.Mock).mockResolvedValue({ scheme: 'git', query: 'history-mock' });

      const message = {
        command: 'openSingleDiff',
        file: 'src/test.ts',
        hash: 'abc123',
        parentHash: 'def456',
        oldFilePath: null,
        newFilePath: null,
        lineRange: null
      };

      const listenerRef = { current: null };
      provider.resolveWebviewView(createMockWebviewView(listenerRef));
      await (listenerRef.current as any)(message);

      expect(gitHelper.toWorkingTreeUri).not.toHaveBeenCalled();
      expect(gitHelper.suppressWatchRefresh).not.toHaveBeenCalled();
      expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
        'vscode.diff',
        expect.anything(),
        expect.objectContaining({ scheme: 'git', query: 'history-mock' }),
        expect.not.stringContaining('本地工作区'),
        expect.anything()
      );
    });
  });

  describe('file history auto-switch', () => {
    beforeEach(() => {
      jest.useFakeTimers();
      (gitHelper.traceFileHistory as jest.Mock).mockResolvedValue([
        { hash: 'abc123', parentHash: 'def456', author: 'test', timestamp: 1624543200, message: 'test commit', oldFilePath: 'src/test.ts', newFilePath: 'src/test.ts' }
      ]);
      (gitHelper.hasFileLocalModifications as jest.Mock).mockResolvedValue(false);
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should track file history active state from blameVisibilityChanged', () => {
      const listenerRef = { current: null };
      provider.resolveWebviewView(createMockWebviewView(listenerRef));

      (listenerRef.current as any)({ command: 'blameVisibilityChanged', state: 5 });
      expect((provider as any)._fileHistoryActive).toBe(true);

      (listenerRef.current as any)({ command: 'blameVisibilityChanged', state: 1 });
      expect((provider as any)._fileHistoryActive).toBe(false);
    });

    it('should not trigger auto-load when file history is not active', () => {
      provider.resolveWebviewView(createMockWebviewView({ current: null }));
      expect((provider as any)._fileHistoryActive).toBe(false);

      (provider as any)._onActiveEditorChanged();
      jest.advanceTimersByTime(300);
      expect(gitHelper.traceFileHistory).not.toHaveBeenCalled();
    });

    it('should skip non-file and git-visual URIs', async () => {
      const listenerRef = { current: null };
      const postMessage = jest.fn();
      provider.resolveWebviewView({
        onDidDispose: jest.fn(),
        webview: {
          onDidReceiveMessage: (listener: any) => { listenerRef.current = listener; },
          html: '',
          options: {},
          postMessage,
          asWebviewUri: jest.fn(uri => uri)
        }
      });

      (listenerRef.current as any)({ command: 'blameVisibilityChanged', state: 5 });
      (vscode.window.activeTextEditor as any) = {
        document: {
          isUntitled: false,
          uri: { scheme: 'git-visual', fsPath: '/mock/file.ts' }
        }
      };

      (provider as any)._onActiveEditorChanged();
      jest.advanceTimersByTime(300);
      await Promise.resolve();
      expect(gitHelper.traceFileHistory).not.toHaveBeenCalled();
    });
  });
});
