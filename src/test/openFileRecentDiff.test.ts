import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { activate } from '../extension';
import * as gitHelper from '../gitHelper';

jest.mock('fs', () => ({
  existsSync: jest.fn(() => true)
}));

jest.mock('../gitHelper', () => ({
  execGit: jest.fn(),
  getGitRoot: jest.fn(async () => '/mock/workspace'),
  toGitUri: jest.fn(),
  traceLineHistory: jest.fn(),
  hasLocalModifications: jest.fn(),
  clearGitCache: jest.fn(),
  traceFileHistory: jest.fn(),
  hasFileLocalModifications: jest.fn()
}));

jest.mock('../blameAnnotations', () => ({
  BlameAnnotationsManager: jest.fn().mockImplementation(() => ({
    toggle: jest.fn(),
    dispose: jest.fn()
  }))
}));

const commandHandlers = new Map<string, (...args: any[]) => any>();

jest.mock('vscode', () => {
  return {
    extensions: {
      getExtension: jest.fn().mockReturnValue(undefined)
    },
    Uri: {
      file: jest.fn((p: string) => ({ scheme: 'file', fsPath: p, path: p })),
      from: jest.fn((components: any) => ({ scheme: components.scheme, path: components.path }))
    },
    commands: {
      registerCommand: jest.fn((name: string, handler: any) => {
        commandHandlers.set(name, handler);
        return { dispose: jest.fn() };
      }),
      executeCommand: jest.fn()
    },
    window: {
      registerWebviewViewProvider: jest.fn(() => ({ dispose: jest.fn() })),
      showWarningMessage: jest.fn(),
      showErrorMessage: jest.fn(),
      activeTextEditor: undefined
    },
    workspace: {
      registerTextDocumentContentProvider: jest.fn(() => ({ dispose: jest.fn() })),
      getConfiguration: jest.fn(() => ({
        get: jest.fn((key, def) => def)
      })),
      workspaceFolders: [{ uri: { fsPath: '/mock/workspace' } }],
      onDidChangeWorkspaceFolders: jest.fn(() => ({ dispose: jest.fn() })),
      onDidSaveTextDocument: jest.fn(() => ({ dispose: jest.fn() })),
      onDidChangeTextDocument: jest.fn(() => ({ dispose: jest.fn() })),
      getWorkspaceFolder: jest.fn()
    },
    languages: {
      registerCodeLensProvider: jest.fn(() => ({ dispose: jest.fn() }))
    },
    Range: jest.fn((sl, sc, el, ec) => ({ start: { line: sl, character: sc }, end: { line: el, character: ec } })),
    CodeLens: jest.fn((range, command) => ({ range, command })),
    EventEmitter: class {
      private listeners: Function[] = [];
      event = (listener: Function) => {
        this.listeners.push(listener);
        return { dispose: () => { this.listeners = this.listeners.filter(l => l !== listener); } };
      };
      fire = (data?: any) => { this.listeners.forEach(l => l(data)); };
      dispose = () => { this.listeners = []; };
    }
  };
}, { virtual: true });

describe('openFileRecentDiff command', () => {
  let context: any;

  beforeEach(async () => {
    jest.clearAllMocks();
    commandHandlers.clear();

    (gitHelper.execGit as jest.Mock).mockImplementation(async (args: any[]) => {
      if (args && args[0] === 'rev-parse' && args.includes('--show-toplevel')) {
        return '/mock/workspace\n';
      }
      return '';
    });

    (gitHelper.toGitUri as jest.Mock).mockImplementation(async (uri: any, ref: string) => {
      return { scheme: 'git', fsPath: uri.fsPath, query: JSON.stringify({ ref }) };
    });

    context = {
      subscriptions: [],
      extensionUri: { fsPath: '/mock/extension' }
    };

    await activate(context);
  });

  it('should open diff with editable fileUri on the right for workingTree diff', async () => {
    const handler = commandHandlers.get('git-visual.openFileRecentDiff');
    expect(handler).toBeDefined();

    const filePath = '/mock/workspace/src/test.ts';
    await handler!(filePath, 'workingTree');

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      'vscode.diff',
      expect.objectContaining({ scheme: 'git' }),
      expect.objectContaining({ scheme: 'file', fsPath: filePath }),
      'test.ts (HEAD vs 工作区)'
    );
  });

  it('should open diff with empty left side and editable fileUri on the right for new untracked files', async () => {
    const handler = commandHandlers.get('git-visual.openFileRecentDiff');
    expect(handler).toBeDefined();

    const filePath = '/mock/workspace/src/new-file.ts';
    await handler!(filePath, 'workingTree', undefined, true);

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      'vscode.diff',
      expect.objectContaining({ scheme: 'git-visual' }),
      expect.objectContaining({ scheme: 'file', fsPath: filePath }),
      'new-file.ts (未跟踪 vs 工作区)'
    );
  });

  it('should open commit vs parent diff for commit diffKind', async () => {
    const handler = commandHandlers.get('git-visual.openFileRecentDiff');
    expect(handler).toBeDefined();

    (gitHelper.execGit as jest.Mock).mockImplementation(async (args: any[]) => {
      if (args && args[0] === 'rev-parse' && args.includes('--show-toplevel')) {
        return '/mock/workspace\n';
      }
      if (args && args[0] === 'log' && args.includes('--pretty=%P')) {
        return 'parent123456\n';
      }
      return '';
    });

    const filePath = '/mock/workspace/src/test.ts';
    await handler!(filePath, 'commit', 'child123456', false);

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      'vscode.diff',
      expect.objectContaining({ scheme: 'git' }),
      expect.objectContaining({ scheme: 'git' }),
      'test.ts (parent1 vs child12)'
    );
  });

  it('should fall back to empty git-visual URI on right side if file is deleted from disk', async () => {
    (fs.existsSync as jest.Mock).mockReturnValueOnce(false);
    const handler = commandHandlers.get('git-visual.openFileRecentDiff');
    expect(handler).toBeDefined();

    const filePath = '/mock/workspace/src/deleted.ts';
    await handler!(filePath, 'workingTree');

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      'vscode.diff',
      expect.objectContaining({ scheme: 'git' }),
      expect.objectContaining({ scheme: 'git-visual', path: filePath }),
      'deleted.ts (HEAD vs 工作区)'
    );
  });
});
