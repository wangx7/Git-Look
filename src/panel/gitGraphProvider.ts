import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { getCommits, getCommitsUntil, getBranches, getAuthors, execGit, getCodeStats, clearGitCache, toGitUri } from '../gitHelper';
import { RepoManager } from '../repoManager';

export class GitGraphProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'git-visual.graphView';
  private _view?: vscode.WebviewView;
  private _abortController?: AbortController;
  private _statsAbortController?: AbortController;
  private blameManager?: any;
  private _currentGitDir?: string;
  private _gitWatcher?: fs.FSWatcher;
  private _debounceTimer?: NodeJS.Timeout;
  private _repoDisposables: vscode.Disposable[] = [];

  public showFileBlameStats(fileName: string, stats: { author: string; lines: number }[]) {
    if (this._view) {
      this._view.webview.postMessage({
        type: 'showFileBlameStats',
        fileName,
        stats
      });
      // Try to show the view but preserve focus in the editor
      // this._view.show(true); // Requires VS Code 1.67+, but might not be necessary if the panel is already visible
    }
  }

  public clearFileBlameStats() {
    if (this._view) {
      this._view.webview.postMessage({
        type: 'clearFileBlameStats'
      });
    }
  }

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _repoManager: RepoManager
  ) { }

  public setBlameManager(manager: any) {
    this.blameManager = manager;
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView;

    webviewView.onDidDispose(() => {
      this._disposeGitWatcher();
      this._repoDisposables.forEach(d => { try { d.dispose(); } catch { /* ignore */ } });
      this._repoDisposables = [];
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

    webviewView.webview.onDidReceiveMessage(async (data) => {
      // Handle repo management commands first (no git root needed)
      switch (data.command) {
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

            const [branches, remoteBranches, authors, commits] = await Promise.all([
              getBranches(gitRoot),
              execGit(['branch', '-r', '--format=%(refname:short)'], gitRoot, signal).then(out =>
                out.split('\n').map(b => b.trim()).filter(Boolean)
              ).catch(() => []),
              getAuthors(gitRoot, signal),
              getCommits(gitRoot, data.filters || {}, skip, pageSize, signal)
            ]);

            if (signal.aborted) {
              return;
            }

            webviewView.webview.postMessage({
              type: 'dataLoaded',
              branches,
              remoteBranches,
              authors,
              commits,
              page
            });
          } catch (err: any) {
            if (err.message === 'ABORTED' || (this._abortController && this._abortController.signal.aborted)) {
              // Ignore aborted commands
              return;
            }
            webviewView.webview.postMessage({
              type: 'error',
              error: err.message || '获取 Git 数据失败'
            });
          }
          break;
        }
        case 'locateCommit': {
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
              // Get branches and authors to keep dropdowns in sync
              const [branches, remoteBranches, authors] = await Promise.all([
                getBranches(gitRoot),
                execGit(['branch', '-r', '--format=%(refname:short)'], gitRoot).then(out =>
                  out.split('\n').map(b => b.trim()).filter(Boolean)
                ).catch(() => []),
                getAuthors(gitRoot)
              ]); // locateCommit 不传 signal，使其能独立完成

              webviewView.webview.postMessage({
                type: 'commitLocated',
                hash,
                commits: result.commits,
                branches,
                remoteBranches,
                authors,
                resetFilters
              });
            } else {
              webviewView.webview.postMessage({
                type: 'error',
                error: `在分支历史中未找到提交: ${hash.substring(0, 7)}`
              });
            }
          } catch (err: any) {
            webviewView.webview.postMessage({
              type: 'error',
              error: '定位提交失败: ' + err.message
            });
          }
          break;
        }
        case 'getCommitDetail': {
          try {
            // Get files changed in this commit including additions/deletions and handling merge commits (-m)
            const [statusOut, numstatOut] = await Promise.all([
              execGit(['diff-tree', '--no-commit-id', '--name-status', '-r', '-m', '--root', data.hash], gitRoot),
              execGit(['diff-tree', '--no-commit-id', '--numstat', '-r', '-m', '--root', data.hash], gitRoot)
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

            webviewView.webview.postMessage({
              type: 'commitDetail',
              hash: data.hash,
              files: Array.from(filesMap.values())
            });
          } catch (err: any) {
            webviewView.webview.postMessage({
              type: 'error',
              error: '获取提交详情失败: ' + err.message
            });
          }
          break;
        }
        case 'openDiff': {
          const { file, hash } = data;
          let parentHash = data.parentHash;

          try {
            const parentsStr = (await execGit(['show', '--pretty=format:%P', '-s', hash], gitRoot)).trim();
            const parents = parentsStr ? parentsStr.split(/\s+/) : [];
            if (parents.length > 0) {
              // Check if file exists in the current commit
              let existsInCurrent = false;
              try {
                await execGit(['cat-file', '-e', `${hash}:${file}`], gitRoot);
                existsInCurrent = true;
              } catch (e) {
                // File does not exist in current commit (deleted)
              }

              if (existsInCurrent) {
                // If it exists in the current commit, check if it exists in the primary parent
                let existsInPrimaryParent = false;
                try {
                  await execGit(['cat-file', '-e', `${parents[0]}:${file}`], gitRoot);
                  existsInPrimaryParent = true;
                } catch (e) {
                  // File does not exist in primary parent (added)
                }

                if (existsInPrimaryParent) {
                  parentHash = parents[0];
                } else {
                  parentHash = 'empty';
                }
              } else {
                // If it does not exist in current commit (deleted), find which parent contains it
                let foundParent = '';
                for (const parent of parents) {
                  try {
                    await execGit(['cat-file', '-e', `${parent}:${file}`], gitRoot);
                    foundParent = parent;
                    break;
                  } catch (e) {
                    // File does not exist in this parent
                  }
                }
                parentHash = foundParent || 'empty';
              }
            }
          } catch (e) {
            // Ignore and fall back to default
          }

          const absoluteFilePath = path.join(gitRoot, file);
          const fileUri = vscode.Uri.file(absoluteFilePath);
          const relativeFilePath = path.relative(gitRoot, absoluteFilePath).replace(/\\/g, '/');

          let rightUri: vscode.Uri;
          try {
            await execGit(['cat-file', '-e', `${hash}:${relativeFilePath}`], gitRoot);
            rightUri = await toGitUri(fileUri, hash);
          } catch (e) {
            rightUri = vscode.Uri.from({ scheme: 'git-visual', path: absoluteFilePath });
          }

          let leftUri: vscode.Uri;
          if (!parentHash || parentHash === 'empty') {
            leftUri = vscode.Uri.from({ scheme: 'git-visual', path: absoluteFilePath });
          } else {
            try {
              await execGit(['cat-file', '-e', `${parentHash}:${relativeFilePath}`], gitRoot);
              leftUri = await toGitUri(fileUri, parentHash);
            } catch (e) {
              leftUri = vscode.Uri.from({ scheme: 'git-visual', path: absoluteFilePath });
            }
          }

          const title = `${path.basename(file)} (${(parentHash && parentHash !== 'empty') ? parentHash.substring(0, 7) : 'empty'} vs ${hash.substring(0, 7)})`;

          await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, title);

          break;
        }
        case 'openSingleDiff': {
          const { file, hash, lineRange, oldFilePath, newFilePath } = data;
          let parentHash = data.parentHash;

          const absoluteFilePath = path.isAbsolute(file) ? file : path.join(gitRoot, file);

          let rightUri: vscode.Uri;
          let leftUri: vscode.Uri;

          // If we have exact historic paths from git log -L parsing, use them directly!
          // This is highly optimized and perfectly handles file renames.
          if (newFilePath) {
            try {
              await execGit(['cat-file', '-e', `${hash}:${newFilePath}`], gitRoot);
              const newAbsPath = path.join(gitRoot, newFilePath);
              rightUri = await toGitUri(vscode.Uri.file(newAbsPath), hash);
            } catch (e) {
              rightUri = vscode.Uri.from({ scheme: 'git-visual', path: absoluteFilePath });
            }
          } else {
            // Fallback to current relative path if historic paths are missing
            const relativeFilePath = path.relative(gitRoot, absoluteFilePath).replace(/\\/g, '/');
            try {
              await execGit(['cat-file', '-e', `${hash}:${relativeFilePath}`], gitRoot);
              rightUri = await toGitUri(vscode.Uri.file(absoluteFilePath), hash);
            } catch (e) {
              rightUri = vscode.Uri.from({ scheme: 'git-visual', path: absoluteFilePath });
            }
          }

          let resolvedParentHash = parentHash;
          if (parentHash && parentHash !== 'empty') {
            if (oldFilePath) {
              try {
                await execGit(['cat-file', '-e', `${parentHash}:${oldFilePath}`], gitRoot);
              } catch (e) {
                resolvedParentHash = 'empty';
              }
            } else {
               const relativeFilePath = path.relative(gitRoot, absoluteFilePath).replace(/\\/g, '/');
               try {
                 await execGit(['cat-file', '-e', `${parentHash}:${relativeFilePath}`], gitRoot);
               } catch (e) {
                 resolvedParentHash = 'empty';
                 try {
                   const parentsStr = (await execGit(['show', '--pretty=format:%P', '-s', hash], gitRoot)).trim();
                   const parents = parentsStr ? parentsStr.split(/\s+/) : [];
                   for (const p of parents) {
                     try {
                       await execGit(['cat-file', '-e', `${p}:${relativeFilePath}`], gitRoot);
                       resolvedParentHash = p;
                       break;
                     } catch (err) {}
                   }
                 } catch (err) {}
               }
            }
          }

          if (!resolvedParentHash || resolvedParentHash === 'empty') {
            leftUri = vscode.Uri.from({ scheme: 'git-visual', path: absoluteFilePath });
          } else {
            if (oldFilePath) {
              const oldAbsPath = path.join(gitRoot, oldFilePath);
              leftUri = await toGitUri(vscode.Uri.file(oldAbsPath), resolvedParentHash);
            } else {
              leftUri = await toGitUri(vscode.Uri.file(absoluteFilePath), resolvedParentHash);
            }
          }

          const title = `${path.basename(file)} (${(resolvedParentHash && resolvedParentHash !== 'empty') ? resolvedParentHash.substring(0, 7) : 'empty'} vs ${hash.substring(0, 7)})`;

          let options: vscode.TextDocumentShowOptions = {};
          if (lineRange) {
            const startLine = Math.max(0, lineRange.newStart - 1);
            const endLine = Math.max(0, startLine + Math.max(0, lineRange.newLength - 1));
            options.selection = new vscode.Range(startLine, 0, endLine, 0);
          }

          await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, title, options);

          break;
        }
        case 'openFileHistoryDiff': {
          const { file, hash, parentHash, oldFilePath, newFilePath } = data;
          // file is already repo-relative path from file history
          const relativeFilePath = path.isAbsolute(file) ? path.relative(gitRoot, file).replace(/\\/g, '/') : file;
          const absoluteFilePath = path.join(gitRoot, relativeFilePath);

          let leftUri: vscode.Uri;
          // For renamed files, use oldFilePath to look up in parent commit
          const relativeTargetPath = oldFilePath || newFilePath || relativeFilePath;

          if (!parentHash || parentHash === 'empty') {
            leftUri = vscode.Uri.from({ scheme: 'git-visual', path: absoluteFilePath });
          } else {
            try {
              await execGit(['cat-file', '-e', `${parentHash}:${relativeTargetPath}`], gitRoot);
              leftUri = await toGitUri(vscode.Uri.file(path.join(gitRoot, relativeTargetPath)), parentHash);
            } catch (e) {
              // Fallback: try with current file path if old path doesn't exist
              try {
                await execGit(['cat-file', '-e', `${parentHash}:${relativeFilePath}`], gitRoot);
                leftUri = await toGitUri(vscode.Uri.file(absoluteFilePath), parentHash);
              } catch (e2) {
                leftUri = vscode.Uri.from({ scheme: 'git-visual', path: absoluteFilePath });
              }
            }
          }

          const rightUri = vscode.Uri.file(absoluteFilePath);
          const title = `${path.basename(relativeFilePath)} (${(parentHash && parentHash !== 'empty') ? parentHash.substring(0, 7) : 'empty'} vs 本地工作区)`;

          await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, title);
          break;
        }
        case 'openWorkspaceFile': {
          const { file, hash } = data;
          // If no hash provided (e.g. from top-files list), open the workspace file directly
          if (!hash) {
            const fullPath = path.join(gitRoot, file);
            const fileUri = vscode.Uri.file(fullPath);
            try {
              await vscode.commands.executeCommand('vscode.open', fileUri);
            } catch (err: any) {
              vscode.window.showWarningMessage(`无法打开文件: ${err.message}`);
            }
            break;
          }
          // Otherwise open via the registered command (supports git-blame status bar integration)
          const uri = vscode.Uri.from({
            scheme: 'git-visual',
            authority: 'empty',
            path: file.startsWith('/') ? file : '/' + file
          });
          await vscode.commands.executeCommand('git-visual.openWorkspaceFile', uri);
          break;
        }
        case 'getStats': {
          // Use a SEPARATE abort controller — never touch _abortController (used by loadData)
          if (this._statsAbortController) {
            this._statsAbortController.abort();
          }
          this._statsAbortController = new AbortController();
          const statsSignal = this._statsAbortController.signal;
          try {
            const stats = await getCodeStats(gitRoot, data.filters || {}, statsSignal);
            if (statsSignal.aborted) { return; }
            webviewView.webview.postMessage({ type: 'statsLoaded', stats });
          } catch (err: any) {
            if (err.message === 'ABORTED') { return; }
            webviewView.webview.postMessage({ type: 'statsError', error: err.message });
          }
          break;
        }
        case 'openAllDiffs': {
          try {
            const { hash, files, parentHash, message } = data;
            const resourceList = await Promise.all(files.map(async (f: any) => {
              const absoluteFilePath = path.join(gitRoot, f.path);
              const fileUri = vscode.Uri.file(absoluteFilePath);
              
              let leftUri: vscode.Uri;
              if (f.status === 'A' || !parentHash || parentHash === 'empty') {
                leftUri = vscode.Uri.from({ scheme: 'git-visual', path: absoluteFilePath });
              } else {
                leftUri = await toGitUri(fileUri, parentHash);
              }

              let rightUri: vscode.Uri;
              if (f.status === 'D') {
                rightUri = vscode.Uri.from({ scheme: 'git-visual', path: absoluteFilePath });
              } else {
                rightUri = await toGitUri(fileUri, hash);
              }

              return [rightUri, leftUri, rightUri];
            }));
            const title = `${hash.substring(0, 7)} - ${message || ''} (${files.length} 个文件)`;
            console.log(`[Git 可视化] openAllDiffs: opening ${resourceList.length} changes with title "${title}"`);
            await vscode.commands.executeCommand('vscode.changes', title, resourceList);
          } catch (e: any) {
            vscode.window.showErrorMessage(`无法打开多文件对比: ${e.message}`);
            console.error('Error in openAllDiffs:', e);
          }
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
          break;
        }
      }
    });
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

  public refresh() {
    if (this._view && this._view.visible) {
      this._view.webview.postMessage({ type: 'refresh' });
    }
  }

  public focusCommit(hash: string) {
    if (this._view) {
      this._view.show(true); // Bring panel view to focus
      this._view.webview.postMessage({ type: 'focusCommit', hash });
    }
  }

  public showSelectionHistory(data: { filePath: string, startLine: number, endLine: number, commits: any[] }) {
    if (this._view) {
      this._view.show(true); // Bring panel view to focus
      this._view.webview.postMessage({
        type: 'showHistory',
        filePath: data.filePath,
        startLine: data.startLine,
        endLine: data.endLine,
        commits: data.commits
      });
    }
  }

  public showFileHistory(data: { filePath: string, commits: any[] }) {
    if (this._view) {
      this._view.show(true); // Bring panel view to focus
      this._view.webview.postMessage({
        type: 'showFileHistory',
        filePath: data.filePath,
        commits: data.commits
      });
    }
  }

  /**
   * Push the current repo list + selected index to the webview.
   * @param needsReload If true, the webview should reload data (e.g. after repo switch).
   */
  private _sendReposToWebview(needsReload: boolean) {
    if (!this._view) {
      return;
    }
    const repos = this._repoManager.repos.map(r => ({ root: r.root, name: r.name }));
    this._view.webview.postMessage({
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
        this._gitWatcher = fs.watch(gitDir, { recursive: true }, (eventType, filename) => {
          if (filename) {
            const normalized = filename.replace(/\\/g, '/');
            if (normalized === 'HEAD' || normalized === 'index' || normalized.startsWith('refs/')) {
              this._triggerDebouncedRefresh();
            }
          } else {
            this._triggerDebouncedRefresh();
          }
        });
      } catch (err) {
        console.warn('[Git 可视化] Recursive fs.watch failed, falling back to non-recursive watches:', err);
        const watchers: fs.FSWatcher[] = [];
        const filesToWatch = ['HEAD', 'index'];
        for (const file of filesToWatch) {
          const filePath = path.join(gitDir, file);
          if (fs.existsSync(filePath)) {
            try {
              watchers.push(fs.watch(filePath, () => this._triggerDebouncedRefresh()));
            } catch (e) { }
          }
        }
        const refsPath = path.join(gitDir, 'refs');
        if (fs.existsSync(refsPath)) {
          try {
            watchers.push(fs.watch(refsPath, () => this._triggerDebouncedRefresh()));
          } catch (e) { }
        }
        this._gitWatcher = {
          close: () => {
            watchers.forEach(w => w.close());
          }
        } as any;
      }
    } catch (e) {
      console.error('[Git 可视化] Error setting up Git watcher:', e);
    }
  }

  private _triggerDebouncedRefresh() {
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
    }
    this._debounceTimer = setTimeout(() => {
      console.log('[Git 可视化] Git change detected, refreshing graph...');
      clearGitCache();
      this.refresh();
    }, 300);
  }

  private _disposeGitWatcher() {
    if (this._gitWatcher) {
      try {
        this._gitWatcher.close();
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
