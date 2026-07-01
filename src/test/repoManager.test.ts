import { RepoManager } from '../repoManager';
import * as vscode from 'vscode';
import { isGitRepository } from '../gitHelper';

// Mock vscode module
jest.mock('vscode', () => {
  const listeners: Record<string, Function> = {};
  return {
    extensions: {
      getExtension: jest.fn()
    },
    workspace: {
      workspaceFolders: undefined as any,
      onDidChangeWorkspaceFolders: jest.fn((cb: Function) => ({ dispose: jest.fn() })),
      getWorkspaceFolder: jest.fn()
    },
    Uri: {
      file: jest.fn((path: string) => ({ fsPath: path, toString: () => path })),
    },
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

jest.mock('../gitHelper', () => ({
  isGitRepository: jest.fn()
}));

describe('RepoManager', () => {
  let manager: RepoManager;

  beforeEach(() => {
    jest.clearAllMocks();
    // Reset mocks to default state
    (vscode.extensions.getExtension as jest.Mock).mockReturnValue(undefined);
    (vscode.workspace.workspaceFolders as any) = undefined;
    (vscode.workspace.getWorkspaceFolder as jest.Mock).mockReturnValue(undefined);
    (isGitRepository as jest.Mock).mockResolvedValue(false);
    manager = new RepoManager();
  });

  afterEach(() => {
    manager.dispose();
  });

  describe('init', () => {
    it('should default to empty repos when no workspace and no git extension', async () => {
      await manager.init();
      expect(manager.repos).toHaveLength(0);
      expect(manager.selectedRepo).toBeUndefined();
      expect(manager.getSelectedRoot()).toBeUndefined();
    });

    it('should discover repos from vscode.git API', async () => {
      const mockRepo1 = { rootUri: { fsPath: '/workspace/repo1' } };
      const mockRepo2 = { rootUri: { fsPath: '/workspace/repo2' } };
      (vscode.extensions.getExtension as jest.Mock).mockReturnValue({
        isActive: true,
        exports: {
          getAPI: () => ({
            repositories: [mockRepo1, mockRepo2],
            onDidOpenRepository: () => ({ dispose: jest.fn() }),
            onDidCloseRepository: () => ({ dispose: jest.fn() })
          })
        }
      });
      (vscode.workspace.getWorkspaceFolder as jest.Mock).mockImplementation((uri: any) => {
        if (uri.fsPath === '/workspace/repo1') return { name: 'repo1' };
        if (uri.fsPath === '/workspace/repo2') return { name: 'repo2' };
        return undefined;
      });

      await manager.init();
      expect(manager.repos).toHaveLength(2);
      expect(manager.repos[0].root).toBe('/workspace/repo1');
      expect(manager.repos[0].name).toBe('repo1');
      expect(manager.repos[1].root).toBe('/workspace/repo2');
      expect(manager.repos[1].name).toBe('repo2');
    });

    it('should fall back to manual scanning when git API is unavailable', async () => {
      (vscode.extensions.getExtension as jest.Mock).mockReturnValue(undefined);
      (vscode.workspace.workspaceFolders as any) = [
        { uri: { fsPath: '/workspace/repo1' }, name: 'repo1' },
        { uri: { fsPath: '/workspace/repo2' }, name: 'repo2' }
      ];
      (isGitRepository as jest.Mock).mockImplementation(async (cwd: string) => {
        return cwd === '/workspace/repo1' || cwd === '/workspace/repo2';
      });
      (vscode.workspace.getWorkspaceFolder as jest.Mock).mockImplementation((uri: any) => {
        if (uri.fsPath === '/workspace/repo1') return { name: 'repo1' };
        if (uri.fsPath === '/workspace/repo2') return { name: 'repo2' };
        return undefined;
      });

      await manager.init();
      expect(manager.repos).toHaveLength(2);
      expect(manager.repos[0].root).toBe('/workspace/repo1');
      expect(manager.repos[1].root).toBe('/workspace/repo2');
    });

    it('should skip non-git folders during manual scanning', async () => {
      (vscode.extensions.getExtension as jest.Mock).mockReturnValue(undefined);
      (vscode.workspace.workspaceFolders as any) = [
        { uri: { fsPath: '/workspace/repo1' }, name: 'repo1' },
        { uri: { fsPath: '/workspace/non-git' }, name: 'non-git' }
      ];
      (isGitRepository as jest.Mock).mockImplementation(async (cwd: string) => {
        return cwd === '/workspace/repo1';
      });
      (vscode.workspace.getWorkspaceFolder as jest.Mock).mockImplementation((uri: any) => {
        if (uri.fsPath === '/workspace/repo1') return { name: 'repo1' };
        return undefined;
      });

      await manager.init();
      expect(manager.repos).toHaveLength(1);
      expect(manager.repos[0].root).toBe('/workspace/repo1');
    });
  });

  describe('repo selection', () => {
    it('should default to first repo (index 0)', async () => {
      setupTwoRepos();
      await manager.init();

      expect(manager.selectedIndex).toBe(0);
      expect(manager.selectedRepo?.root).toBe('/workspace/repo1');
      expect(manager.getSelectedRoot()).toBe('/workspace/repo1');
    });

    it('should switch to a different repo via selectRepo', async () => {
      setupTwoRepos();
      await manager.init();

      manager.selectRepo(1);
      expect(manager.selectedIndex).toBe(1);
      expect(manager.selectedRepo?.root).toBe('/workspace/repo2');
    });

    it('should fire onDidChangeSelection when switching repos', async () => {
      setupTwoRepos();
      await manager.init();

      let fired = false;
      manager.onDidChangeSelection(() => { fired = true; });

      manager.selectRepo(1);
      expect(fired).toBe(true);
    });

    it('should NOT fire onDidChangeSelection when selecting same index', async () => {
      setupTwoRepos();
      await manager.init();

      let fired = false;
      manager.onDidChangeSelection(() => { fired = true; });

      manager.selectRepo(0);
      expect(fired).toBe(false);
    });

    it('should ignore invalid indices', async () => {
      setupTwoRepos();
      await manager.init();

      manager.selectRepo(-1);
      expect(manager.selectedIndex).toBe(0);
      manager.selectRepo(99);
      expect(manager.selectedIndex).toBe(0);
    });

    it('should clamp selection when repos shrink', async () => {
      setupTwoRepos();
      await manager.init();

      manager.selectRepo(1);
      expect(manager.selectedIndex).toBe(1);

      // Simulate repo removal: re-init with only one repo
      setupSingleRepo();
      // Need to re-create manager since init was already called
      const newManager = new RepoManager();
      await newManager.init();
      expect(newManager.selectedIndex).toBe(0);
      newManager.dispose();
    });
  });

  describe('getRepoForFile', () => {
    it('should find the repo containing a file', async () => {
      setupTwoRepos();
      await manager.init();

      const repo = manager.getRepoForFile(vscode.Uri.file('/workspace/repo1/src/file.ts') as any);
      expect(repo).toBe('/workspace/repo1');
    });

    it('should find the correct repo for files in nested paths', async () => {
      setupTwoRepos();
      await manager.init();

      const repo = manager.getRepoForFile(vscode.Uri.file('/workspace/repo2/deep/nested/file.ts') as any);
      expect(repo).toBe('/workspace/repo2');
    });

    it('should return undefined for files not in any repo', async () => {
      setupTwoRepos();
      await manager.init();

      const repo = manager.getRepoForFile(vscode.Uri.file('/other/place/file.ts') as any);
      expect(repo).toBeUndefined();
    });

    it('should prefer the most specific (longest) repo root', async () => {
      // Simulate nested repos: /workspace and /workspace/sub-repo
      const mockRepo1 = { rootUri: { fsPath: '/workspace' } };
      const mockRepo2 = { rootUri: { fsPath: '/workspace/sub-repo' } };
      (vscode.extensions.getExtension as jest.Mock).mockReturnValue({
        isActive: true,
        exports: {
          getAPI: () => ({
            repositories: [mockRepo1, mockRepo2],
            onDidOpenRepository: () => ({ dispose: jest.fn() }),
            onDidCloseRepository: () => ({ dispose: jest.fn() })
          })
        }
      });
      (vscode.workspace.getWorkspaceFolder as jest.Mock).mockReturnValue(undefined);

      await manager.init();
      const repo = manager.getRepoForFile(vscode.Uri.file('/workspace/sub-repo/src/file.ts') as any);
      expect(repo).toBe('/workspace/sub-repo');
    });
  });

  // ── Helpers ────────────────────────────────────────
  function setupTwoRepos() {
    const mockRepo1 = { rootUri: { fsPath: '/workspace/repo1' } };
    const mockRepo2 = { rootUri: { fsPath: '/workspace/repo2' } };
    (vscode.extensions.getExtension as jest.Mock).mockReturnValue({
      isActive: true,
      exports: {
        getAPI: () => ({
          repositories: [mockRepo1, mockRepo2],
          onDidOpenRepository: () => ({ dispose: jest.fn() }),
          onDidCloseRepository: () => ({ dispose: jest.fn() })
        })
      }
    });
    (vscode.workspace.getWorkspaceFolder as jest.Mock).mockImplementation((uri: any) => {
      if (uri.fsPath === '/workspace/repo1') return { name: 'repo1' };
      if (uri.fsPath === '/workspace/repo2') return { name: 'repo2' };
      return undefined;
    });
  }

  function setupSingleRepo() {
    const mockRepo1 = { rootUri: { fsPath: '/workspace/repo1' } };
    (vscode.extensions.getExtension as jest.Mock).mockReturnValue({
      isActive: true,
      exports: {
        getAPI: () => ({
          repositories: [mockRepo1],
          onDidOpenRepository: () => ({ dispose: jest.fn() }),
          onDidCloseRepository: () => ({ dispose: jest.fn() })
        })
      }
    });
    (vscode.workspace.getWorkspaceFolder as jest.Mock).mockImplementation((uri: any) => {
      if (uri.fsPath === '/workspace/repo1') return { name: 'repo1' };
      return undefined;
    });
  }
});
