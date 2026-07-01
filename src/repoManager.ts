import * as vscode from 'vscode';
import * as path from 'path';
import { isGitRepository, getGitRoot } from './gitHelper';

export interface RepoInfo {
  root: string;          // Absolute path to the git repo root
  name: string;          // Display name (workspace folder name or folder basename)
}

/**
 * Centralized manager for discovering, tracking, and switching between
 * multiple Git repositories in a multi-root workspace.
 *
 * - Uses the built-in vscode.git extension API for repo discovery.
 * - Falls back to manual scanning of workspace folders.
 * - Maintains a "selected" repo (default: first discovered) for the graph panel.
 * - Provides file-to-repo resolution for blame / CodeLens operations.
 */
export class RepoManager implements vscode.Disposable {
  private _repos: RepoInfo[] = [];
  private _selectedIndex: number = 0;
  private _gitApi: any = undefined;
  private _disposables: vscode.Disposable[] = [];
  private _initialized = false;

  private readonly _onDidChangeRepos = new vscode.EventEmitter<void>();
  private readonly _onDidChangeSelection = new vscode.EventEmitter<void>();

  /** Fired when the repo list changes (repos added/removed/discovered). */
  public readonly onDidChangeRepos = this._onDidChangeRepos.event;
  /** Fired when the selected repo index changes. */
  public readonly onDidChangeSelection = this._onDidChangeSelection.event;

  /** Initialise the manager — call once during extension activation. */
  async init(): Promise<void> {
    if (this._initialized) {
      return;
    }
    this._initialized = true;

    try {
      const gitExtension = vscode.extensions.getExtension<any>('vscode.git');
      if (gitExtension) {
        const activated = gitExtension.isActive ? gitExtension.exports : await gitExtension.activate();
        this._gitApi = activated.getAPI(1);

        if (this._gitApi) {
          if (typeof this._gitApi.onDidOpenRepository === 'function') {
            this._disposables.push(this._gitApi.onDidOpenRepository(() => this._refresh()));
          }
          if (typeof this._gitApi.onDidCloseRepository === 'function') {
            this._disposables.push(this._gitApi.onDidCloseRepository(() => this._refresh()));
          }
        }
      }
    } catch (e) {
      console.error('[Git Look] Failed to get vscode.git API:', e);
    }

    // Listen for workspace folder changes (multi-root workspace add/remove)
    this._disposables.push(
      vscode.workspace.onDidChangeWorkspaceFolders(() => this._refresh())
    );

    await this._refresh();
  }

  /** Refresh the discovered repo list from all available sources. */
  private async _refresh(): Promise<void> {
    const oldRoots = this._repos.map(r => r.root);
    this._repos = [];

    // Source 1: vscode.git extension API (most reliable, already gives root)
    if (this._gitApi?.repositories) {
      for (const repo of this._gitApi.repositories) {
        const root = repo.rootUri.fsPath;
        await this._addRepo(root);
      }
    }

    // Source 2: manual scan of workspace folders (fallback / supplementary)
    const folders = vscode.workspace.workspaceFolders;
    if (folders) {
      for (const folder of folders) {
        const folderPath = folder.uri.fsPath;
        // Check if it's inside a git repo and resolve to the actual git root
        const gitRoot = await getGitRoot(folderPath);
        if (gitRoot) {
          await this._addRepo(gitRoot);
        }
      }
    }

    // Clamp selection index
    if (this._selectedIndex >= this._repos.length) {
      this._selectedIndex = 0;
    }

    // Notify if anything changed
    const newRoots = this._repos.map(r => r.root);
    const changed = oldRoots.length !== newRoots.length ||
      oldRoots.some((r, i) => r !== newRoots[i]);
    if (changed) {
      this._onDidChangeRepos.fire();
    }
  }

  private async _addRepo(root: string): Promise<void> {
    // Always resolve to the actual git root to handle nested directories
    const actualRoot = await getGitRoot(root);
    const finalRoot = actualRoot || root;
    
    if (this._repos.some(r => r.root === finalRoot)) {
      return; // Deduplicate
    }
    
    // Use the workspace folder name if this root contains the workspace folder,
    // otherwise use the basename of the git root
    let name: string;
    const workspaceFolders = vscode.workspace.workspaceFolders;
    const matchingFolder = workspaceFolders?.find(f => {
      const rel = path.relative(finalRoot, f.uri.fsPath);
      return !rel.startsWith('..') && !path.isAbsolute(rel);
    });
    
    if (matchingFolder) {
      name = matchingFolder.name;
    } else {
      name = path.basename(finalRoot);
    }
    
    this._repos.push({ root: finalRoot, name });
  }

  /** All discovered repositories. */
  get repos(): ReadonlyArray<RepoInfo> {
    return this._repos;
  }

  /** Currently selected repo info (default: first). */
  get selectedRepo(): RepoInfo | undefined {
    return this._repos[this._selectedIndex];
  }

  /** Root path of the currently selected repo. */
  getSelectedRoot(): string | undefined {
    return this.selectedRepo?.root;
  }

  /** Index of the currently selected repo. */
  get selectedIndex(): number {
    return this._selectedIndex;
  }

  /** Switch to a different repo by index. Fires onDidChangeSelection if changed. */
  selectRepo(index: number): void {
    if (index >= 0 && index < this._repos.length && index !== this._selectedIndex) {
      this._selectedIndex = index;
      this._onDidChangeSelection.fire();
    }
  }

  /**
   * Find the repository root that contains the given file URI.
   * Returns undefined if the file is not inside any known repo.
   * Used by blame annotations and file header CodeLens.
   */
  getRepoForFile(uri: vscode.Uri): string | undefined {
    const filePath = uri.fsPath;
    // Find the repo whose root is the longest prefix of filePath
    let bestRoot: string | undefined;
    for (const repo of this._repos) {
      const rel = path.relative(repo.root, filePath);
      if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
        if (!bestRoot || repo.root.length > bestRoot.length) {
          bestRoot = repo.root;
        }
      }
    }
    return bestRoot;
  }

  dispose(): void {
    this._disposables.forEach(d => {
      try { d.dispose(); } catch { /* ignore */ }
    });
    this._disposables = [];
    this._onDidChangeRepos.dispose();
    this._onDidChangeSelection.dispose();
  }
}
