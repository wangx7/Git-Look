import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { getCommits, getCommitsUntil, getBranches, getAuthors, execGit, getCodeStats, clearGitCache, shouldSkipWatchRefresh, hasFileLocalModifications, traceFileHistory, getWorkingTreeStatus, getWorktrees, WorktreeInfo } from '../gitHelper';
import { RepoManager } from '../repoManager';
import { handleOpenDiff, handleOpenSingleDiff, handleOpenFileHistoryDiff, handleOpenAllDiffs } from './diffHelper';

export interface IBlameManager {
  highlightCommitLines(editor: vscode.TextEditor, hash: string, color: string): void;
  clearHighlight(editor: vscode.TextEditor): void;
  turnOff(): void;
}

export class GitGraphProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'git-visual.graphView';
  private _view?: vscode.WebviewView;
  private _abortController?: AbortController;
  private _statsAbortController?: AbortController;
  private _autoLoadAbortController?: AbortController; // #10: cancel stale auto-load requests
  private blameManager?: IBlameManager;
  private _currentGitDir?: string;
  private _gitWatcher?: vscode.FileSystemWatcher;
  private _debounceTimer?: NodeJS.Timeout;
  private _fileHistoryAutoTimer?: NodeJS.Timeout;
  private _fileHistoryActive = false;
  private _fileHistoryGeneration = 0;
  private _lastFileHistoryPath?: string;
  private _repoDisposables: vscode.Disposable[] = [];
  private _isWebviewReady = false;
  private _needsRefreshOnVisible = false;
  private _messageQueue: any[] = [];

  private _postMessage(message: any) {
    if (this._view && this._isWebviewReady) {
      this._view.webview.postMessage(message);
    } else {
      this._messageQueue.push(message);
    }
  }

  public showFileBlameStats(fileName: string, stats: { author: string; lines: number }[]) {
    this._postMessage({
      type: 'showFileBlameStats',
      fileName,
      stats
    });
  }

  public clearFileBlameStats() {
    this._postMessage({
      type: 'clearFileBlameStats'
    });
  }

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _repoManager: RepoManager
  ) { }

  public setBlameManager(manager: IBlameManager) {
    this.blameManager = manager;
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView;
    this._isWebviewReady = false;

    webviewView.onDidDispose(() => {
      this._disposeGitWatcher();
      if (this._fileHistoryAutoTimer) {
        clearTimeout(this._fileHistoryAutoTimer);
        this._fileHistoryAutoTimer = undefined;
      }
      // 取消所有 in-flight git 命令，避免 panel 关闭后子进程继续跑完
      this._abortController?.abort();
      this._statsAbortController?.abort();
      this._autoLoadAbortController?.abort();
      this._fileHistoryActive = false;
      this._repoDisposables.forEach(d => { try { d.dispose(); } catch { /* ignore */ } });
      this._repoDisposables = [];
      this._isWebviewReady = false;
      this._messageQueue = [];
    });

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        this._extensionUri,
        vscode.Uri.joinPath(vscode.Uri.file(vscode.env.appRoot), 'out', 'media')
      ]
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    // Listen for repo list / selection changes and push to webview
    // Both events need data reload: list change may alter the selected repo root
    this._repoDisposables.push(
      this._repoManager.onDidChangeRepos(() => this._sendReposToWebview(true))
    );
    this._repoDisposables.push(
      this._repoManager.onDidChangeSelection(() => this._sendReposToWebview(true))
    );

    // Listen for active editor changes to auto-switch file history
    this._repoDisposables.push(
      vscode.window.onDidChangeActiveTextEditor(() => {
        this._onActiveEditorChanged();
      })
    );

    // Listen for repo Git state changes (stage, commit, branch, working tree, etc.)
    if (typeof this._repoManager.onDidChangeGitState === 'function') {
      this._repoDisposables.push(
        this._repoManager.onDidChangeGitState((changedRoot) => {
          const currentRoot = this._repoManager.getSelectedRoot();
          if (!changedRoot || !currentRoot || changedRoot === currentRoot) {
            this._triggerDebouncedRefresh();
          }
        })
      );
    }

    // Listen for webview visibility changes (switching tabs or unfolding panel)
    if (typeof webviewView.onDidChangeVisibility === 'function') {
      this._repoDisposables.push(
        webviewView.onDidChangeVisibility(() => {
          if (webviewView.visible && this._needsRefreshOnVisible) {
            this._needsRefreshOnVisible = false;
            clearGitCache();
            this.refresh(true);
          }
        })
      );
    }

    webviewView.webview.onDidReceiveMessage(async (data) => {
      // Handle repo management commands first (no git root needed)
      switch (data.command) {
        case 'ready': {
          this._isWebviewReady = true;
          while (this._messageQueue.length > 0) {
            const msg = this._messageQueue.shift();
            if (this._view) {
              this._view.webview.postMessage(msg);
            }
          }
          return;
        }
        case 'getRepos': {
          this._sendReposToWebview(false);
          return;
        }
        case 'switchRepo': {
          this._repoManager.selectRepo(data.index);
          clearGitCache();
          // onDidChangeSelection will trigger _sendReposToWebview(true) → webview reloads
          return;
        }
      }

      const gitRoot = this._repoManager.getSelectedRoot();
      if (!gitRoot) {
        // No git repository — notify webview to show empty state
        this._sendReposToWebview(false);
        webviewView.webview.postMessage({ type: 'hideLoading' });
        return;
      }

      switch (data.command) {
        case 'initWatcher': {
          this._setupGitWatcher(gitRoot);
          break;
        }
        case 'loadData': {
          await this._handleLoadData(gitRoot, data, webviewView.webview);
          break;
        }
        case 'fetchRemote': {
          await this._handleFetchRemote(gitRoot, webviewView.webview);
          break;
        }
        case 'locateCommit': {
          await this._handleLocateCommit(gitRoot, data, webviewView.webview);
          break;
        }
        case 'getCommitDetail': {
          await this._handleGetCommitDetail(gitRoot, data.hash, webviewView.webview);
          break;
        }
        case 'openDiff': {
          await handleOpenDiff(gitRoot, data);
          break;
        }
        case 'openSingleDiff': {
          await handleOpenSingleDiff(gitRoot, data);
          break;
        }
        case 'openFileHistoryDiff': {
          await handleOpenFileHistoryDiff(gitRoot, data);
          break;
        }
        case 'openWorkspaceFile': {
          await this._handleOpenWorkspaceFile(gitRoot, data);
          break;
        }
        case 'getStats': {
          await this._handleGetStats(gitRoot, data, webviewView.webview);
          break;
        }
        case 'openAllDiffs': {
          await handleOpenAllDiffs(gitRoot, data);
          break;
        }
        case 'hoverBlameCommit': {
          if (vscode.window.activeTextEditor && this.blameManager) {
            this.blameManager.highlightCommitLines(vscode.window.activeTextEditor, data.hash, data.color);
          }
          break;
        }
        case 'clearHoverBlameCommit': {
          if (vscode.window.activeTextEditor && this.blameManager) {
            this.blameManager.clearHighlight(vscode.window.activeTextEditor);
          }
          break;
        }
        case 'blameVisibilityChanged': {
          if (data.state !== 4 && this.blameManager) {
            this.blameManager.turnOff();
          }
          // state === 5 means file history pane is visible
          const wasActive = this._fileHistoryActive;
          this._fileHistoryActive = (data.state === 5);
          // When file history becomes active, immediately load current file
          if (!wasActive && this._fileHistoryActive) {
            this._onActiveEditorChanged();
          }
          break;
        }
      }
    });
  }

  private async _handleLoadData(gitRoot: string, data: any, webview: vscode.Webview): Promise<void> {
    this._setupGitWatcher(gitRoot);
    const page = typeof data.page === 'number' ? data.page : 0;
    if (page === 0) {
      clearGitCache();
    }
    if (this._abortController) {
      this._abortController.abort();
    }
    this._abortController = new AbortController();
    const signal = this._abortController.signal;

    try {
      const pageSize = 150;
      const skip = page * pageSize;

      const [branches, remoteBranches, authors, commits, worktrees] = await Promise.all([
        getBranches(gitRoot),
        execGit(['branch', '-r', '--format=%(refname:short)'], gitRoot, signal).then(out =>
          out.split('\n').map(b => b.trim()).filter(Boolean)
        ).catch(() => []),
        getAuthors(gitRoot, signal),
        getCommits(gitRoot, data.filters || {}, skip, pageSize, signal),
        getWorktrees(gitRoot, signal)
      ]);

      if (signal.aborted) {
        return;
      }

      // Inject working tree virtual node on page 0 if not filtered out and working tree has modifications
      if (page === 0) {
        const filters = data.filters || {};
        const hasStrictFilter = !!(filters.author || filters.since || filters.until || filters.query);
        if (!hasStrictFilter) {
          try {
            const wtStatus = await getWorkingTreeStatus(gitRoot, signal);
            if (wtStatus.hasChanges) {
              const headCommit = commits.find(c => c.decorations && c.decorations.some(d => d === 'HEAD' || d.startsWith('HEAD ->'))) || commits[0];
              const headHash = headCommit ? headCommit.hash : undefined;
              const parents = wtStatus.isMerging && wtStatus.mergeHeads.length > 0
                ? (headHash ? [headHash, ...wtStatus.mergeHeads] : wtStatus.mergeHeads)
                : (headHash ? [headHash] : []);
              const totalChanges = wtStatus.files.length;
              const summary = `未提交的修改 (${totalChanges} 个文件${wtStatus.isMerging ? ' · 合并冲突中' : ''})`;
              commits.unshift({
                hash: '*working-tree*',
                parents,
                author: 'You',
                email: '',
                timestamp: Math.floor(Date.now() / 1000),
                decorations: ['Working Tree'],
                message: summary
              });
            }
          } catch {
            // Ignore working tree status errors
          }
        }
      }

      webview.postMessage({
        type: 'dataLoaded',
        branches,
        remoteBranches,
        authors,
        commits,
        worktrees,
        page
      });
    } catch (err: any) {
      if (err.message === 'ABORTED' || (this._abortController && this._abortController.signal.aborted)) {
        return;
      }
      webview.postMessage({
        type: 'error',
        error: err.message || '获取 Git 数据失败'
      });
    }
  }

  private async _handleFetchRemote(gitRoot: string, webview: vscode.Webview): Promise<void> {
    try {
      const refFmt = ['for-each-ref', '--format=%(refname) %(objectname)', 'refs/remotes/'];
      const beforeRefs = (await execGit(refFmt, gitRoot)).trim();
      await execGit(['fetch', '--all', '--prune'], gitRoot);
      clearGitCache();
      const afterRefs = (await execGit(refFmt, gitRoot)).trim();
      const changed = beforeRefs !== afterRefs;
      webview.postMessage({
        type: 'fetchRemoteDone',
        refresh: changed
      });
      if (changed) {
        this.refresh();
      }
    } catch (err: any) {
      clearGitCache();
      webview.postMessage({
        type: 'fetchRemoteDone',
        error: err.message || 'git fetch 失败'
      });
    }
  }

  private async _handleLocateCommit(gitRoot: string, data: any, webview: vscode.Webview): Promise<void> {
    try {
      const { hash, filters } = data;

      // 1. Try to find the commit using current filters
      let result = await getCommitsUntil(gitRoot, filters || {}, hash, 3000);
      let resetFilters = false;

      // 2. If not found, try with empty/default filters (all branches, no author/date/query)
      if (!result.found) {
        result = await getCommitsUntil(gitRoot, {}, hash, 3000);
        if (result.found) {
          resetFilters = true;
        }
      }

      if (result.found) {
        const [branches, remoteBranches, authors] = await Promise.all([
          getBranches(gitRoot),
          execGit(['branch', '-r', '--format=%(refname:short)'], gitRoot).then(out =>
            out.split('\n').map(b => b.trim()).filter(Boolean)
          ).catch(() => []),
          getAuthors(gitRoot)
        ]);

        webview.postMessage({
          type: 'commitLocated',
          hash,
          commits: result.commits,
          branches,
          remoteBranches,
          authors,
          resetFilters
        });
      } else {
        webview.postMessage({
          type: 'error',
          error: `在分支历史中未找到提交: ${hash.substring(0, 7)}`
        });
      }
    } catch (err: any) {
      webview.postMessage({
        type: 'error',
        error: '定位提交失败: ' + err.message
      });
    }
  }

  private async _handleGetCommitDetail(gitRoot: string, hash: string, webview: vscode.Webview): Promise<void> {
    try {
      if (hash === '*working-tree*') {
        const wtStatus = await getWorkingTreeStatus(gitRoot);
        const files = wtStatus.files.map(f => ({
          status: f.status,
          path: f.path,
          oldPath: f.oldPath,
          additions: f.additions ?? 0,
          deletions: f.deletions ?? 0,
          staged: f.staged
        }));

        webview.postMessage({
          type: 'commitDetail',
          hash: '*working-tree*',
          files,
          isWorkingTree: true
        });
        return;
      }

      const [statusOut, numstatOut] = await Promise.all([
        execGit(['diff-tree', '--no-commit-id', '--name-status', '-r', '-m', '--root', hash], gitRoot),
        execGit(['diff-tree', '--no-commit-id', '--numstat', '-r', '-m', '--root', hash], gitRoot)
      ]);

      const fileStatusMap = new Map<string, string>();
      statusOut.split('\n').filter(Boolean).forEach(line => {
        const parts = line.split(/\s+/);
        if (parts.length >= 2) {
          fileStatusMap.set(parts[parts.length - 1], parts[0].charAt(0));
        }
      });

      const filesMap = new Map<string, any>();
      numstatOut.split('\n').filter(Boolean).forEach(line => {
        const parts = line.split(/\t+/);
        if (parts.length >= 3) {
          const filePath = parts[2];
          if (!filesMap.has(filePath)) {
            filesMap.set(filePath, {
              status: fileStatusMap.get(filePath) || 'M',
              path: filePath,
              additions: parts[0] === '-' ? 0 : parseInt(parts[0], 10),
              deletions: parts[1] === '-' ? 0 : parseInt(parts[1], 10)
            });
          }
        }
      });

      webview.postMessage({
        type: 'commitDetail',
        hash,
        files: Array.from(filesMap.values())
      });
    } catch (err: any) {
      webview.postMessage({
        type: 'error',
        error: '获取提交详情失败: ' + err.message
      });
    }
  }

  private async _handleOpenWorkspaceFile(gitRoot: string, data: any): Promise<void> {
    const { file, hash } = data;
    if (!hash) {
      const fullPath = path.join(gitRoot, file);
      const fileUri = vscode.Uri.file(fullPath);
      try {
        await vscode.commands.executeCommand('vscode.open', fileUri);
      } catch (err: any) {
        vscode.window.showWarningMessage(`无法打开文件: ${err.message}`);
      }
      return;
    }
    const uri = vscode.Uri.from({
      scheme: 'git-visual',
      authority: 'empty',
      path: file.startsWith('/') ? file : '/' + file
    });
    await vscode.commands.executeCommand('git-visual.openWorkspaceFile', uri);
  }

  private async _handleGetStats(gitRoot: string, data: any, webview: vscode.Webview): Promise<void> {
    if (this._statsAbortController) {
      this._statsAbortController.abort();
    }
    this._statsAbortController = new AbortController();
    const statsSignal = this._statsAbortController.signal;
    try {
      const stats = await getCodeStats(gitRoot, data.filters || {}, statsSignal);
      if (statsSignal.aborted) { return; }
      webview.postMessage({ type: 'statsLoaded', stats });
    } catch (err: any) {
      if (err.message === 'ABORTED') { return; }
      webview.postMessage({ type: 'statsError', error: err.message });
    }
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    const htmlPath = vscode.Uri.joinPath(this._extensionUri, 'media', 'panel.html');
    let html = fs.readFileSync(htmlPath.fsPath, 'utf8');

    // Resolve URIs for scripts and stylesheets
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'panel.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'panel.css'));
    const codiconUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'media', 'codicon.css')
    );

    html = html.replace(/\${scriptUri}/g, scriptUri.toString());
    html = html.replace(/\${styleUri}/g, styleUri.toString());
    html = html.replace(/\${codiconUri}/g, codiconUri.toString());
    html = html.replace(/\${cspSource}/g, webview.cspSource);

    return html;
  }

  public refresh(silent = false) {
    if (this._view && this._view.visible) {
      this._postMessage({ type: 'refresh', silent });
    } else {
      this._needsRefreshOnVisible = true;
    }
  }

  public focusCommit(hash: string) {
    if (this._view) {
      this._view.show(true); // Bring panel view to focus
    }
    this._postMessage({ type: 'focusCommit', hash });
  }

  public showSelectionHistory(data: { filePath: string, startLine: number, endLine: number, commits: any[] }) {
    if (this._view) {
      this._view.show(true); // Bring panel view to focus
    }
    this._postMessage({
      type: 'showHistory',
      filePath: data.filePath,
      startLine: data.startLine,
      endLine: data.endLine,
      commits: data.commits
    });
  }

  public showFileHistory(data: { filePath: string, commits: any[] }) {
    this._fileHistoryActive = true;
    this._lastFileHistoryPath = data.filePath;
    if (this._view) {
      this._view.show(true); // Bring panel view to focus
    }
    this._postMessage({
      type: 'showFileHistory',
      filePath: data.filePath,
      commits: data.commits
    });
  }

  private _onActiveEditorChanged() {
    if (!this._fileHistoryActive) {
      return;
    }
    if (this._fileHistoryAutoTimer) {
      clearTimeout(this._fileHistoryAutoTimer);
    }
    this._fileHistoryAutoTimer = setTimeout(() => {
      this._autoLoadFileHistory();
    }, 200);
  }

  private async _autoLoadFileHistory() {
    if (!this._fileHistoryActive || !this._view) {
      return;
    }
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return;
    }
    const document = editor.document;
    if (document.isUntitled) {
      return;
    }

    let filePath = document.uri.fsPath;
    let startRef: string | undefined;

    if (document.uri.scheme === 'git') {
      try {
        const queryObj = JSON.parse(document.uri.query);
        if (queryObj.path) {
          filePath = queryObj.path;
        }
      } catch (e) {
        // Ignore
      }
    } else if (document.uri.scheme === 'git-visual') {
      return;
    } else if (document.uri.scheme !== 'file') {
      return;
    }

    const gitRoot = this._repoManager.getSelectedRoot();
    if (!gitRoot) {
      return;
    }

    const cwd = this._repoManager.getRepoForFile(vscode.Uri.file(filePath));
    if (!cwd || cwd !== gitRoot) {
      return;
    }

    if (this._lastFileHistoryPath === filePath) {
      // Prevent redundant reload when simply switching tabs of the same file (e.g. opening a diff)
      return;
    }
    this._lastFileHistoryPath = filePath;

    const generation = ++this._fileHistoryGeneration;

    // #10: Abort any previous in-flight auto-load request before starting a new one
    if (this._autoLoadAbortController) {
      this._autoLoadAbortController.abort();
    }
    this._autoLoadAbortController = new AbortController();
    const signal = this._autoLoadAbortController.signal;

    try {
      const commits = await traceFileHistory(cwd, filePath, startRef, signal);
      if (generation !== this._fileHistoryGeneration || !this._fileHistoryActive || !this._view) {
        return;
      }
      const repoFilePath = path.relative(cwd, filePath).replace(/\\/g, '/');
      const hasLocalChanges = await hasFileLocalModifications(cwd, filePath);

      if (generation !== this._fileHistoryGeneration || !this._fileHistoryActive || !this._view) {
        return;
      }

      const commitsToSend = commits.map((c: any) => ({
        hash: c.hash,
        parentHash: c.parentHash,
        author: c.author,
        timestamp: c.timestamp,
        message: c.message,
        oldFilePath: c.oldFilePath,
        newFilePath: c.newFilePath
      }));

      if (hasLocalChanges) {
        const latestRef = commits[0]?.hash ?? 'HEAD';
        commitsToSend.unshift({
          hash: 'HEAD',
          parentHash: latestRef,
          author: '工作区未提交更改',
          timestamp: Math.floor(Date.now() / 1000),
          message: '未提交的修改',
          oldFilePath: repoFilePath,
          newFilePath: repoFilePath
        });
      }

      if (generation === this._fileHistoryGeneration) {
        this._postMessage({
          type: 'showFileHistory',
          filePath: repoFilePath,
          commits: commitsToSend
        });
      }
    } catch (err: any) {
      if (err.message === 'ABORTED') {
        return; // Cancelled by a newer request — expected, do not log
      }
      // Silently ignore other auto-load errors
    }
  }

  /**
   * Push the current repo list + selected index to the webview.
   * @param needsReload If true, the webview should reload data (e.g. after repo switch).
   */
  private _sendReposToWebview(needsReload: boolean) {
    const repos = this._repoManager.repos.map(r => ({ root: r.root, name: r.name }));
    this._postMessage({
      type: 'reposLoaded',
      repos,
      selectedIndex: this._repoManager.selectedIndex,
      needsReload
    });
  }

  private _setupGitWatcher(cwd: string) {
    this._resolveAndSetupWatcher(cwd);
  }

  private async _resolveAndSetupWatcher(cwd: string) {
    try {
      const gitDirRel = (await execGit(['rev-parse', '--git-dir'], cwd)).trim();
      const gitDir = path.resolve(cwd, gitDirRel);

      if (this._currentGitDir === gitDir) {
        return; // Already watching this git directory
      }

      this._disposeGitWatcher();
      this._currentGitDir = gitDir;

      console.log(`[Git 可视化] Starting watcher for Git directory: ${gitDir}`);

      try {
        const pattern = new vscode.RelativePattern(gitDir, '{HEAD,index,refs/**}');
        this._gitWatcher = vscode.workspace.createFileSystemWatcher(pattern);
        
        this._gitWatcher.onDidChange(() => this._triggerDebouncedRefresh());
        this._gitWatcher.onDidCreate(() => this._triggerDebouncedRefresh());
        this._gitWatcher.onDidDelete(() => this._triggerDebouncedRefresh());
      } catch (err) {
        console.error('[Git 可视化] Error creating FileSystemWatcher:', err);
      }
    } catch (e) {
      console.error('[Git 可视化] Error setting up Git watcher:', e);
    }
  }

  private _triggerDebouncedRefresh() {
    if (shouldSkipWatchRefresh()) {
      return;
    }
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
    }
    this._debounceTimer = setTimeout(() => {
      if (shouldSkipWatchRefresh()) {
        return;
      }
      console.log('[Git 可视化] Git change detected, refreshing graph...');
      clearGitCache();
      this.refresh(true);
    }, 300);
  }

  private _disposeGitWatcher() {
    if (this._gitWatcher) {
      try {
        this._gitWatcher.dispose();
      } catch (e) { }
      this._gitWatcher = undefined;
    }
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = undefined;
    }
    this._currentGitDir = undefined;
  }
}
