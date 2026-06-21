import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { getCommits, getCommitsUntil, getBranches, getAuthors, execGit } from '../gitHelper';

export class GitGraphProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'git-visual.graphView';
  private _view?: vscode.WebviewView;
  private _abortController?: AbortController;
  private _currentGitDir?: string;
  private _gitWatcher?: fs.FSWatcher;
  private _debounceTimer?: NodeJS.Timeout;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _getCwd: () => string | undefined
  ) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView;

    webviewView.onDidDispose(() => {
      this._disposeGitWatcher();
    });

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        this._extensionUri,
        vscode.Uri.joinPath(vscode.Uri.file(vscode.env.appRoot), 'out', 'media')
      ]
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (data) => {
      const cwd = this._getCwd();
      if (!cwd) {
        webviewView.webview.postMessage({ type: 'error', error: '未打开工作区或找不到项目目录' });
        return;
      }

      // Resolve Git Root
      let gitRoot = cwd;
      try {
        gitRoot = (await execGit(['rev-parse', '--show-toplevel'], cwd)).trim();
      } catch (e) {
        // Ignore
      }

      switch (data.command) {
        case 'initWatcher': {
          this._setupGitWatcher(gitRoot);
          break;
        }
        case 'loadData': {
          this._setupGitWatcher(gitRoot);
          if (this._abortController) {
            this._abortController.abort();
          }
          this._abortController = new AbortController();
          const signal = this._abortController.signal;

          try {
            const page = typeof data.page === 'number' ? data.page : 0;
            const pageSize = 150;
            const skip = page * pageSize;

            const [branches, remoteBranches, authors, commits] = await Promise.all([
              getBranches(gitRoot),
              execGit(['branch', '-r', '--format=%(refname:short)'], gitRoot, signal).then(out => 
                out.split('\n').map(b => b.trim()).filter(Boolean)
              ).catch(() => []),
              getAuthors(gitRoot),
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
              ]);

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

          const leftUri = vscode.Uri.from({
            scheme: 'git-visual',
            authority: parentHash || 'empty',
            path: file.startsWith('/') ? file : '/' + file
          });
          const rightUri = vscode.Uri.from({
            scheme: 'git-visual',
            authority: hash,
            path: file.startsWith('/') ? file : '/' + file
          });
          const title = `${path.basename(file)} (${hash.substring(0, 7)} vs ${parentHash && parentHash !== 'empty' ? parentHash.substring(0, 7) : 'empty'})`;
          
          await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, title);
          break;
        }
        case 'openWorkspaceFile': {
          const { file } = data;
          const uri = vscode.Uri.from({
            scheme: 'git-visual',
            authority: 'empty',
            path: file.startsWith('/') ? file : '/' + file
          });
          await vscode.commands.executeCommand('git-visual.openWorkspaceFile', uri);
          break;
        }
        case 'openAllDiffs': {
          try {
            const { hash, files, parentHash, message } = data;
            const resourceList = files.map((f: any) => {
              const leftUri = vscode.Uri.from({
                scheme: 'git-visual',
                authority: parentHash || 'empty',
                path: f.path.startsWith('/') ? f.path : '/' + f.path
              });
              const rightUri = vscode.Uri.from({
                scheme: 'git-visual',
                authority: hash,
                path: f.path.startsWith('/') ? f.path : '/' + f.path
              });
              return [rightUri, leftUri, rightUri];
            });
            const title = `${hash.substring(0, 7)} - ${message || ''} (${files.length} 个文件)`;
            console.log(`[Git 可视化] openAllDiffs: opening ${resourceList.length} changes with title "${title}"`);
            await vscode.commands.executeCommand('vscode.changes', title, resourceList);
          } catch (e: any) {
            vscode.window.showErrorMessage(`无法打开多文件对比: ${e.message}`);
            console.error('Error in openAllDiffs:', e);
          }
          break;
        }
      }
    });
  }

  private _getHtmlForWebview(webview: vscode.WebviewView.prototype['webview']): string {
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
    if (this._view) {
      this._view.webview.postMessage({ type: 'refresh' });
    }
  }

  public focusCommit(hash: string) {
    if (this._view) {
      this._view.show(true); // Bring panel view to focus
      this._view.webview.postMessage({ type: 'focusCommit', hash });
    }
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
            } catch (e) {}
          }
        }
        const refsPath = path.join(gitDir, 'refs');
        if (fs.existsSync(refsPath)) {
          try {
            watchers.push(fs.watch(refsPath, () => this._triggerDebouncedRefresh()));
          } catch (e) {}
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
      this.refresh();
    }, 300);
  }

  private _disposeGitWatcher() {
    if (this._gitWatcher) {
      try {
        this._gitWatcher.close();
      } catch (e) {}
      this._gitWatcher = undefined;
    }
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = undefined;
    }
    this._currentGitDir = undefined;
  }
}
