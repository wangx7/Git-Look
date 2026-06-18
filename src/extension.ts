import * as vscode from 'vscode';
import { GitGraphProvider } from './panel/gitGraphProvider';
import { TraceTabProvider } from './panel/traceTabProvider';
import { execGit } from './gitHelper';

export function activate(context: vscode.ExtensionContext) {
  // Helper to get active workspace folder CWD
  const getCwd = () => {
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      const folder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
      if (folder) {
        return folder.uri.fsPath;
      }
    }
    const folders = vscode.workspace.workspaceFolders;
    if (folders && folders.length > 0) {
      return folders[0].uri.fsPath;
    }
    return undefined;
  };

  // 1. Register Git Graph panel provider
  const gitGraphProvider = new GitGraphProvider(context.extensionUri, getCwd);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(GitGraphProvider.viewType, gitGraphProvider)
  );

  // 2. Register Custom DocumentContentProvider for git-look scheme
  // Used by VS Code native diff editor to fetch old/new versions of files at specific commits
  const documentProvider = new class implements vscode.TextDocumentContentProvider {
    async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
      const cwd = getCwd();
      if (!cwd) {
        throw new Error('工作区未打开');
      }
      
      const hash = uri.authority;
      const filePath = uri.path.startsWith('/') ? uri.path.substring(1) : uri.path;

      if (hash === 'empty') {
        return '';
      }

      try {
        return await execGit(['show', `${hash}:${filePath}`], cwd);
      } catch (err: any) {
        const errMsg = err.message || '';
        // If file doesn't exist in this revision (newly added or deleted), return empty string
        if (errMsg.includes('does not exist') || errMsg.includes('exists on disk, but not in') || errMsg.includes('fatal: path')) {
          return '';
        }
        throw new Error(`无法获取 Git 文件内容 (${hash}:${filePath}): ${err.message}`);
      }
    }
  };
  
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider('git-look', documentProvider)
  );

  // 3. Register Code Origin Tracing context command
  const traceCommand = vscode.commands.registerCommand('git-look.traceOrigin', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('请在编辑器中打开一个代码文件以进行追溯！');
      return;
    }

    const document = editor.document;
    if (document.isUntitled) {
      vscode.window.showWarningMessage('无法追溯未保存的文件！');
      return;
    }

    const cwd = getCwd();
    if (!cwd) {
      vscode.window.showWarningMessage('未找到工作区，请先打开一个 Git 项目文件夹！');
      return;
    }

    const filePath = document.uri.fsPath;
    
    // Get line ranges (convert 0-indexed to 1-indexed)
    const startLine = editor.selection.start.line + 1;
    const endLine = editor.selection.end.line + 1;

    try {
      await TraceTabProvider.createOrShow(
        context.extensionUri,
        cwd,
        filePath,
        startLine,
        endLine,
        (hash) => {
          // Highlight and focus the selected commit in bottom panel
          gitGraphProvider.focusCommit(hash);
        }
      );
    } catch (err: any) {
      vscode.window.showErrorMessage(`追溯代码历史失败: ${err.message}`);
    }
  });

  context.subscriptions.push(traceCommand);
}

export function deactivate() {}
