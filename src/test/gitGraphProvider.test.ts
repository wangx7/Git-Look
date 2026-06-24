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
      file: jest.fn((path) => ({ fsPath: path })),
      from: jest.fn((opts) => opts),
      joinPath: jest.fn((...args) => ({ fsPath: args.join('/') })),
    },
    env: { appRoot: '/mock/app/root' },
    commands: {
      executeCommand: jest.fn(),
    },
    window: {
      showErrorMessage: jest.fn(),
    },
    Range: jest.fn(),
    TextEditorRevealType: { InCenter: 1 }
  };
}, { virtual: true });

jest.mock('../gitHelper', () => ({
  execGit: jest.fn(),
  toGitUri: jest.fn(),
  getCommits: jest.fn(),
  getCommitsUntil: jest.fn(),
  getBranches: jest.fn(),
  getAuthors: jest.fn(),
  getCodeStats: jest.fn(),
  clearGitCache: jest.fn()
}));

describe('GitGraphProvider Diff Logic', () => {
  let provider: any;

  beforeEach(() => {
    jest.clearAllMocks();
    provider = new GitGraphProvider({} as any, () => 'test-cwd');
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
            expect.objectContaining({ scheme: 'git', query: 'mocked' }),
            expect.objectContaining({ scheme: 'git-visual' }),
            expect.objectContaining({ scheme: 'git', query: 'mocked' })
          ]),
          expect.arrayContaining([
            expect.objectContaining({ scheme: 'git-visual' }),
            expect.objectContaining({ scheme: 'git', query: 'mocked' }),
            expect.objectContaining({ scheme: 'git-visual' })
          ]),
          expect.arrayContaining([
            expect.objectContaining({ scheme: 'git', query: 'mocked' }),
            expect.objectContaining({ scheme: 'git', query: 'mocked' }),
            expect.objectContaining({ scheme: 'git', query: 'mocked' })
          ])
        ])
      );
    });
  });
});
