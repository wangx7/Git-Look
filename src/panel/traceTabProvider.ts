import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { traceLineHistory, CommitDiff } from '../gitHelper';

export class TraceTabProvider {
  public static activePanels: Map<string, vscode.WebviewPanel> = new Map();

  public static async createOrShow(
    extensionUri: vscode.Uri,
    cwd: string,
    filePath: string,
    startLine: number,
    endLine: number,
    onShowCommitInGraph: (hash: string) => void
  ) {
    const relativePath = path.relative(cwd, filePath);
    const panelId = `${relativePath}:${startLine}-${endLine}`;

    // If panel already exists, reveal it
    const existingPanel = this.activePanels.get(panelId);
    if (existingPanel) {
      existingPanel.reveal(vscode.ViewColumn.One);
      return;
    }

    const title = `Code Tracing: ${path.basename(filePath)} (${startLine}-${endLine})`;
    const panel = vscode.window.createWebviewPanel(
      'gitLookCodeTracing',
      title,
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(extensionUri, 'media'),
          vscode.Uri.joinPath(vscode.Uri.file(vscode.env.appRoot), 'out', 'media')
        ]
      }
    );

    this.activePanels.set(panelId, panel);

    // Clean up on dispose
    panel.onDidDispose(() => {
      this.activePanels.delete(panelId);
    });

    // Load HTML
    const htmlPath = vscode.Uri.joinPath(extensionUri, 'media', 'trace.html');
    let html = fs.readFileSync(htmlPath.fsPath, 'utf8');

    const scriptUri = panel.webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'trace.js'));
    const styleUri = panel.webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'trace.css'));
    const codiconUri = panel.webview.asWebviewUri(
      vscode.Uri.joinPath(vscode.Uri.file(vscode.env.appRoot), 'out', 'media', 'codicon.css')
    );

    html = html.replace('${scriptUri}', scriptUri.toString());
    html = html.replace('${styleUri}', styleUri.toString());
    html = html.replace('${codiconUri}', codiconUri.toString());
    panel.webview.html = html;

    // Fetch tracing data
    try {
      const commits = await traceLineHistory(cwd, filePath, startLine, endLine);
      
      // Send data to Webview
      panel.webview.postMessage({
        type: 'traceData',
        file: relativePath,
        startLine,
        endLine,
        commits
      });
    } catch (err: any) {
      panel.webview.postMessage({
        type: 'error',
        error: err.message || '追踪代码历史失败'
      });
    }

    // Handle messages from tracing webview
    panel.webview.onDidReceiveMessage((data) => {
      switch (data.command) {
        case 'showInGraph':
          onShowCommitInGraph(data.hash);
          break;
      }
    });
  }
}
