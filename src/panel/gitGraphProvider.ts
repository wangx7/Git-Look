import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { getCommits, getBranches, getAuthors, execGit } from '../gitHelper';

export class GitGraphProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'git-look.graphView';
  private _view?: vscode.WebviewView;

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

      switch (data.command) {
        case 'loadData': {
          try {
            const page = typeof data.page === 'number' ? data.page : 0;
            const pageSize = 150;
            const skip = page * pageSize;

            const [branches, authors, commits] = await Promise.all([
              getBranches(cwd),
              getAuthors(cwd),
              getCommits(cwd, data.filters || {}, skip, pageSize)
            ]);

            webviewView.webview.postMessage({
              type: 'dataLoaded',
              branches,
              authors,
              commits,
              page
            });
          } catch (err: any) {
            webviewView.webview.postMessage({
              type: 'error',
              error: err.message || '获取 Git 数据失败'
            });
          }
          break;
        }
        case 'getCommitDetail': {
          try {
            // Get files changed in this commit
            // git diff-tree --no-commit-id --name-status -r <hash>
            const stdout = await execGit(['diff-tree', '--no-commit-id', '--name-status', '-r', data.hash], cwd);
            const files = stdout.split('\n').filter(Boolean).map(line => {
              const [status, filePath] = line.split(/\s+/);
              return { status, path: filePath };
            });
            
            webviewView.webview.postMessage({
              type: 'commitDetail',
              hash: data.hash,
              files
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
          const { file, hash, parentHash } = data;
          const leftUri = vscode.Uri.parse(`git-look://${parentHash || 'empty'}/${file}`);
          const rightUri = vscode.Uri.parse(`git-look://${hash}/${file}`);
          const title = `${path.basename(file)} (${hash.substring(0, 7)} vs ${parentHash ? parentHash.substring(0, 7) : 'empty'})`;
          
          await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, title);
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
      vscode.Uri.joinPath(vscode.Uri.file(vscode.env.appRoot), 'out', 'media', 'codicon.css')
    );

    html = html.replace('${scriptUri}', scriptUri.toString());
    html = html.replace('${styleUri}', styleUri.toString());
    html = html.replace('${codiconUri}', codiconUri.toString());

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
}
