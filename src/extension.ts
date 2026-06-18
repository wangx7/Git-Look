import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { GitGraphProvider } from './panel/gitGraphProvider';
import { TraceTabProvider } from './panel/traceTabProvider';
import { execGit, execGitBuffer } from './gitHelper';

const TRANSPARENT_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

function getEmptyContent(filePath: string): Uint8Array {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.svg') {
    return Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>', 'utf8');
  }
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.tiff'].includes(ext)) {
    return TRANSPARENT_PNG;
  }
  return new Uint8Array(0);
}

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

  // 2. Register Custom FileSystemProvider for git-look scheme
  // Used by VS Code native diff editor to fetch old/new versions of files (including binary files)
  const fileSystemProvider = new class implements vscode.FileSystemProvider {
    private _onDidChangeFile = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
    readonly onDidChangeFile = this._onDidChangeFile.event;

    watch(uri: vscode.Uri, options: { readonly recursive: boolean; readonly excludes: readonly string[]; }): vscode.Disposable {
      return new vscode.Disposable(() => {});
    }

    stat(uri: vscode.Uri): vscode.FileStat {
      return {
        type: vscode.FileType.File,
        ctime: 0,
        mtime: 0,
        size: 0
      };
    }

    readDirectory(uri: vscode.Uri): [string, vscode.FileType][] {
      return [];
    }

    createDirectory(uri: vscode.Uri): void {
      throw vscode.FileSystemError.NoPermissions('Readonly');
    }

    async readFile(uri: vscode.Uri): Promise<Uint8Array> {
      const cwd = getCwd();
      if (!cwd) {
        throw vscode.FileSystemError.Unavailable('工作区未打开');
      }
      
      const hash = uri.authority;
      const filePath = uri.path.startsWith('/') ? uri.path.substring(1) : uri.path;

      if (hash === 'empty') {
        return getEmptyContent(filePath);
      }

      try {
        return await execGitBuffer(['show', `${hash}:${filePath}`], cwd);
      } catch (err: any) {
        const errMsg = err.message || '';
        if (errMsg.includes('does not exist') || errMsg.includes('exists on disk, but not in') || errMsg.includes('fatal: path')) {
          return getEmptyContent(filePath);
        }
        throw vscode.FileSystemError.FileNotFound(uri);
      }
    }

    writeFile(uri: vscode.Uri, content: Uint8Array, options: { readonly create: boolean; readonly overwrite: boolean; }): void {
      throw vscode.FileSystemError.NoPermissions('Readonly');
    }

    delete(uri: vscode.Uri, options: { readonly recursive: boolean; }): void {
      throw vscode.FileSystemError.NoPermissions('Readonly');
    }

    rename(oldUri: vscode.Uri, newUri: vscode.Uri, options: { readonly overwrite: boolean; }): void {
      throw vscode.FileSystemError.NoPermissions('Readonly');
    }
  };
  
  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider('git-look', fileSystemProvider, {
      isCaseSensitive: true,
      isReadonly: true
    })
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

  // 4. Register Open Current Workspace File command
  const openWorkspaceFileCommand = vscode.commands.registerCommand('git-look.openWorkspaceFile', async (uri: vscode.Uri) => {
    if (!uri) {
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        uri = editor.document.uri;
      }
    }

    if (!uri || uri.scheme !== 'git-look') {
      return;
    }

    const cwd = getCwd();
    if (!cwd) {
      vscode.window.showWarningMessage('未找到工作区，请先打开一个 Git 项目文件夹！');
      return;
    }

    let repoRoot = cwd;
    try {
      repoRoot = (await execGit(['rev-parse', '--show-toplevel'], cwd)).trim();
    } catch (e) {
      // Ignore
    }

    const relativePath = uri.path.startsWith('/') ? uri.path.substring(1) : uri.path;
    const fullPath = path.join(repoRoot, relativePath);
    const fileUri = vscode.Uri.file(fullPath);

    if (!fs.existsSync(fullPath)) {
      vscode.window.showWarningMessage(`当前文件在本地中不存在或已被重命名: ${relativePath}`);
      return;
    }

    try {
      await vscode.commands.executeCommand('vscode.open', fileUri);
    } catch (err: any) {
      vscode.window.showErrorMessage(`无法打开本地文件: ${err.message}`);
    }
  });

  context.subscriptions.push(openWorkspaceFileCommand);

  // 5. Blame status bar integration for git-look files
  const outputChannel = vscode.window.createOutputChannel('Git Look');
  outputChannel.appendLine('[Git-Look] Status bar blame integration initialized');

  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  context.subscriptions.push(statusBarItem);

  let currentBlameToken: any = null;

  function formatDate(timestampSeconds: number): string {
    const date = new Date(timestampSeconds * 1000);
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  async function updateBlameStatusBar(editor: vscode.TextEditor | undefined) {
    if (!editor) {
      outputChannel.appendLine('[Git-Look] updateBlameStatusBar: no active editor');
      statusBarItem.hide();
      return;
    }

    outputChannel.appendLine(`[Git-Look] updateBlameStatusBar: active editor scheme = "${editor.document.uri.scheme}", path = "${editor.document.uri.path}"`);

    if (editor.document.uri.scheme !== 'git-look') {
      statusBarItem.hide();
      return;
    }

    const uri = editor.document.uri;
    const commitHash = uri.authority;
    outputChannel.appendLine(`[Git-Look] updateBlameStatusBar: commitHash = "${commitHash}"`);
    if (commitHash === 'empty') {
      statusBarItem.hide();
      return;
    }

    const filePath = uri.path.startsWith('/') ? uri.path.substring(1) : uri.path;
    const line = editor.selection.active.line + 1; // 1-based line number
    const cwd = getCwd();
    outputChannel.appendLine(`[Git-Look] updateBlameStatusBar: line = ${line}, filePath = "${filePath}", cwd = "${cwd}"`);
    if (!cwd) {
      statusBarItem.hide();
      return;
    }

    const token = {};
    currentBlameToken = token;

    try {
      // Run git blame for that specific line at that commit
      outputChannel.appendLine(`[Git-Look] Running: git blame -L ${line},${line} --porcelain ${commitHash} -- ${filePath}`);
      const output = await execGit([
        'blame',
        '-L',
        `${line},${line}`,
        '--porcelain',
        commitHash,
        '--',
        filePath
      ], cwd);

      if (currentBlameToken !== token) {
        outputChannel.appendLine('[Git-Look] updateBlameStatusBar: token mismatch (outdated request)');
        return; // Outdated request
      }

      if (!output) {
        outputChannel.appendLine('[Git-Look] updateBlameStatusBar: git blame returned empty output');
        statusBarItem.hide();
        return;
      }

      // Parse porcelain output
      const lines = output.split('\n');
      if (lines.length < 4) {
        outputChannel.appendLine('[Git-Look] updateBlameStatusBar: parsed output lines too short');
        statusBarItem.hide();
        return;
      }

      const firstLineParts = lines[0].split(' ');
      const blamedCommitHash = firstLineParts[0];

      let author = 'Unknown';
      let authorTime = 0;
      let summary = '';

      for (const l of lines) {
        if (l.startsWith('author ')) {
          author = l.substring(7).trim();
        } else if (l.startsWith('author-time ')) {
          authorTime = parseInt(l.substring(12).trim(), 10) || 0;
        } else if (l.startsWith('summary ')) {
          summary = l.substring(8).trim();
        }
      }

      if (blamedCommitHash.startsWith('00000000')) {
        statusBarItem.text = `$(git-commit) 未提交的更改`;
        statusBarItem.tooltip = `当前行有未提交的更改`;
        statusBarItem.command = undefined;
      } else {
        const dateStr = formatDate(authorTime);
        statusBarItem.text = `$(git-commit) ${author}, ${dateStr} • ${summary}`;
        statusBarItem.tooltip = `提交: ${blamedCommitHash}\n作者: ${author}\n时间: ${new Date(authorTime * 1000).toLocaleString()}\n信息: ${summary}\n\n点击在 Graph 中定位此提交`;
        
        statusBarItem.command = {
          title: '定位提交',
          command: 'git-look.focusCommitFromBlame',
          arguments: [blamedCommitHash]
        };
      }
      outputChannel.appendLine(`[Git-Look] updateBlameStatusBar: showing status bar text: "${statusBarItem.text}"`);
      statusBarItem.show();
    } catch (err: any) {
      outputChannel.appendLine(`[Git-Look] updateBlameStatusBar error: ${err.message || err}`);
      if (currentBlameToken === token) {
        statusBarItem.hide();
      }
    }
  }

  // Register focus commit command
  const focusBlameCmd = vscode.commands.registerCommand('git-look.focusCommitFromBlame', (hash: string) => {
    gitGraphProvider.focusCommit(hash);
  });
  context.subscriptions.push(focusBlameCmd);

  // Listen for selection & editor changes
  vscode.window.onDidChangeActiveTextEditor(editor => {
    updateBlameStatusBar(editor);
  }, null, context.subscriptions);

  vscode.window.onDidChangeTextEditorSelection(event => {
    if (event.textEditor === vscode.window.activeTextEditor) {
      updateBlameStatusBar(event.textEditor);
    }
  }, null, context.subscriptions);

  // Trigger initial blame update
  updateBlameStatusBar(vscode.window.activeTextEditor);
}

export function deactivate() {}
