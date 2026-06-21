import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { GitGraphProvider } from './panel/gitGraphProvider';
import { execGit, execGitBuffer, traceLineHistory } from './gitHelper';
import { BlameAnnotationsManager } from './blameAnnotations';



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

  // 3. Register Line History context command (Git 选区历史)
  const traceCommand = vscode.commands.registerCommand('git-visual.traceOrigin', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('请在编辑器中打开一个代码文件以查看选区历史！');
      return;
    }

    const document = editor.document;
    if (document.isUntitled) {
      vscode.window.showWarningMessage('无法查看未保存文件的选区历史！');
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
      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: "正在获取 Git 选区历史...",
        cancellable: false
      }, async () => {
        const commits = await traceLineHistory(cwd, filePath, startLine, endLine);
        if (commits.length === 0) {
          vscode.window.showInformationMessage('未找到该选区的历史记录');
          return;
        }

        const relativePath = path.relative(cwd, filePath).replace(/\\/g, '/');
        const fileName = path.basename(filePath);

        // Construct resourceList for vscode.changes Multi Diff Editor
        const resourceList = commits.map(commit => {
          const absoluteFilePath = filePath;
          const leftUri = vscode.Uri.from({
            scheme: 'git',
            path: absoluteFilePath,
            query: JSON.stringify({
              path: absoluteFilePath,
              ref: commit.parentHash || 'empty'
            })
          });

          const rightUri = vscode.Uri.from({
            scheme: 'git',
            path: absoluteFilePath,
            query: JSON.stringify({
              path: absoluteFilePath,
              ref: commit.hash
            })
          });

          const cleanMsg = commit.message.replace(/[\/\?#\\:\*]/g, ' ').trim();
          const customPath = '/' + [
            commit.hash.substring(0, 7),
            commit.author,
            cleanMsg,
            path.basename(filePath)
          ].join(' | ');

          const labelUri = vscode.Uri.from({
            scheme: 'git',
            path: customPath,
            query: JSON.stringify({
              path: absoluteFilePath,
              ref: commit.hash
            })
          });

          return [rightUri, leftUri, labelUri];
        });

        const title = `Git 选区历史: ${fileName} (L${startLine}-L${endLine})`;
        await vscode.commands.executeCommand('vscode.changes', title, resourceList);
      });
    } catch (err: any) {
      vscode.window.showErrorMessage(`获取选区历史失败: ${err.message}`);
    }
  });

  context.subscriptions.push(traceCommand);

  // 3.5 Register Toggle Blame Annotations command (Git 行作者)
  const blameAnnotationsManager = new BlameAnnotationsManager(getCwd);
  context.subscriptions.push(blameAnnotationsManager);

  const toggleBlameCommand = vscode.commands.registerCommand('git-visual.toggleLineBlame', async () => {
    const editor = vscode.window.activeTextEditor;
    await blameAnnotationsManager.toggle(editor);
  });
  context.subscriptions.push(toggleBlameCommand);

  // 4. Register Open Current Workspace File command
  const openWorkspaceFileCommand = vscode.commands.registerCommand('git-visual.openWorkspaceFile', async (uri: vscode.Uri) => {
    if (!uri) {
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        uri = editor.document.uri;
      }
    }

    if (!uri || uri.scheme !== 'git') {
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

    let relativePath = '';
    if (uri.scheme === 'git') {
      try {
        const queryObj = JSON.parse(uri.query);
        relativePath = queryObj.path;
      } catch (e) {
        relativePath = uri.path;
      }
    } else {
      relativePath = uri.path.startsWith('/') ? uri.path.substring(1) : uri.path;
      const parts = relativePath.split(' | ');
      if (parts.length > 1) {
        relativePath = parts[parts.length - 1];
      }
    }

    const fullPath = path.isAbsolute(relativePath) ? relativePath : path.join(repoRoot, relativePath);
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

  // 5. Blame status bar integration for git-visual files
  const outputChannel = vscode.window.createOutputChannel('Git 可视化');
  outputChannel.appendLine('[Git 可视化] Status bar blame integration initialized');

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
      outputChannel.appendLine('[Git 可视化] updateBlameStatusBar: no active editor');
      statusBarItem.hide();
      return;
    }

    outputChannel.appendLine(`[Git 可视化] updateBlameStatusBar: active editor scheme = "${editor.document.uri.scheme}", path = "${editor.document.uri.path}"`);

    if (editor.document.uri.scheme !== 'git') {
      statusBarItem.hide();
      return;
    }

    const uri = editor.document.uri;
    let commitHash = '';
    let filePath = '';
    if (uri.scheme === 'git') {
      try {
        const queryObj = JSON.parse(uri.query);
        commitHash = queryObj.ref;
        filePath = queryObj.path;
      } catch (e) {
        // Fallback
      }
    }

    outputChannel.appendLine(`[Git 可视化] updateBlameStatusBar: commitHash = "${commitHash}"`);
    if (!commitHash || commitHash === 'empty') {
      statusBarItem.hide();
      return;
    }

    const line = editor.selection.active.line + 1; // 1-based line number
    const cwd = getCwd();
    outputChannel.appendLine(`[Git 可视化] updateBlameStatusBar: line = ${line}, raw filePath = "${filePath}", cwd = "${cwd}"`);
    if (!cwd) {
      statusBarItem.hide();
      return;
    }

    // Resolve Git root and compute repository-relative path
    let gitRoot = cwd;
    try {
      gitRoot = (await execGit(['rev-parse', '--show-toplevel'], cwd)).trim();
    } catch (e) {
      // Ignore
    }

    const absoluteFilePath = path.isAbsolute(filePath) ? filePath : path.resolve(gitRoot, filePath);
    const repoFilePath = path.relative(gitRoot, absoluteFilePath).replace(/\\/g, '/');
    outputChannel.appendLine(`[Git 可视化] updateBlameStatusBar: resolved gitRoot = "${gitRoot}", repoFilePath = "${repoFilePath}"`);

    const token = {};
    currentBlameToken = token;

    try {
      // Run git blame for that specific line at that commit
      outputChannel.appendLine(`[Git 可视化] Running: git blame -L ${line},${line} --porcelain ${commitHash} -- ${repoFilePath} (in ${gitRoot})`);
      const output = await execGit([
        'blame',
        '-L',
        `${line},${line}`,
        '--porcelain',
        commitHash,
        '--',
        repoFilePath
      ], gitRoot);

      if (currentBlameToken !== token) {
        outputChannel.appendLine('[Git 可视化] updateBlameStatusBar: token mismatch (outdated request)');
        return; // Outdated request
      }

      if (!output) {
        outputChannel.appendLine('[Git 可视化] updateBlameStatusBar: git blame returned empty output');
        statusBarItem.hide();
        return;
      }

      // Parse porcelain output
      const lines = output.split('\n');
      if (lines.length < 4) {
        outputChannel.appendLine('[Git 可视化] updateBlameStatusBar: parsed output lines too short');
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
          command: 'git-visual.focusCommitFromBlame',
          arguments: [blamedCommitHash]
        };
      }
      outputChannel.appendLine(`[Git 可视化] updateBlameStatusBar: showing status bar text: "${statusBarItem.text}"`);
      statusBarItem.show();
    } catch (err: any) {
      outputChannel.appendLine(`[Git 可视化] updateBlameStatusBar error: ${err.message || err}`);
      if (currentBlameToken === token) {
        statusBarItem.hide();
      }
    }
  }

  // Register focus commit command
  const focusBlameCmd = vscode.commands.registerCommand('git-visual.focusCommitFromBlame', (hash: string) => {
    gitGraphProvider.focusCommit(hash);
  });
  context.subscriptions.push(focusBlameCmd);

  // Listen for selection & editor changes
  vscode.window.onDidChangeActiveTextEditor(editor => {
    updateBlameStatusBar(editor);
  }, null, context.subscriptions);

  let blameSelectionDebounce: ReturnType<typeof setTimeout> | undefined;
  vscode.window.onDidChangeTextEditorSelection(event => {
    if (event.textEditor === vscode.window.activeTextEditor) {
      if (blameSelectionDebounce) {
        clearTimeout(blameSelectionDebounce);
      }
      // 防抖 300ms，避免光标每次移动都触发 git blame 子进程
      blameSelectionDebounce = setTimeout(() => {
        updateBlameStatusBar(event.textEditor);
      }, 300);
    }
  }, null, context.subscriptions);

  // Trigger initial blame update
  updateBlameStatusBar(vscode.window.activeTextEditor);
}

export function deactivate() {}
