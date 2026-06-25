import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { GitGraphProvider } from './panel/gitGraphProvider';
import { execGit, traceLineHistory, hasLocalModifications, clearGitCache, traceFileHistory, hasFileLocalModifications, toGitUri } from './gitHelper';
import { BlameAnnotationsManager } from './blameAnnotations';
import { FileHeaderCodeLensProvider } from './fileHeaderCodeLens';

export function activate(context: vscode.ExtensionContext) {
  // Register a dummy document content provider for the git-visual scheme
  // so that VS Code can resolve git-visual URIs (used for custom labels in multi-diff editors).
  const docProvider = vscode.workspace.registerTextDocumentContentProvider('git-visual', {
    provideTextDocumentContent(): string {
      return '';
    }
  });
  context.subscriptions.push(docProvider);

  // Clear git cache when text documents are saved
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(() => {
      clearGitCache();
    })
  );

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

    let filePath = document.uri.fsPath;

    let startRef: string | undefined = undefined;
    if (document.uri.scheme === 'git') {
      try {
        const queryObj = JSON.parse(document.uri.query);
        if (queryObj.ref) {
          startRef = queryObj.ref;
        }
        if (queryObj.path) {
          filePath = queryObj.path;
        }
      } catch (e) {
        // Ignore
      }
    }

    // Get line ranges (convert 0-indexed to 1-indexed)
    const startLine = editor.selection.start.line + 1;
    let endLine = editor.selection.end.line + 1;
    if (editor.selection.end.character === 0 && startLine !== endLine) {
      endLine--;
    }

    try {
      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: "正在获取 Git 选区历史...",
        cancellable: false
      }, async () => {
        const commits = await traceLineHistory(cwd, filePath, startLine, endLine, startRef);
        const hasLocalChanges = !startRef && (await hasLocalModifications(cwd, filePath, startLine, endLine));

        if (commits.length === 0 && !hasLocalChanges) {
          vscode.window.showInformationMessage('未找到该选区的历史记录');
          return;
        }

        let repoRoot = cwd;
        try {
          repoRoot = (await execGit(['rev-parse', '--show-toplevel'], cwd)).trim();
        } catch (e) { }
        const repoFilePath = path.relative(repoRoot, filePath).replace(/\\/g, '/');

        const commitsToSend = commits.map(c => ({
          hash: c.hash,
          parentHash: c.parentHash,
          author: c.author,
          timestamp: c.timestamp,
          message: c.message,
          lineRange: c.lineRange,
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
            lineRange: {
              oldStart: startLine,
              oldLength: endLine - startLine + 1,
              newStart: startLine,
              newLength: endLine - startLine + 1
            },
            oldFilePath: repoFilePath,
            newFilePath: repoFilePath
          });
        }

        await vscode.commands.executeCommand('git-visual.graphView.focus');

        gitGraphProvider.showSelectionHistory({
          filePath: repoFilePath,
          startLine,
          endLine,
          commits: commitsToSend
        });
      });
    } catch (err: any) {
      vscode.window.showErrorMessage(`获取选区历史失败: ${err.message}`);
    }
  });

  context.subscriptions.push(traceCommand);

  // Register File History context command (Git 文件历史)
  const traceFileHistoryCommand = vscode.commands.registerCommand('git-visual.traceFileHistory', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('请在编辑器中打开一个代码文件以查看文件历史！');
      return;
    }

    const document = editor.document;
    if (document.isUntitled) {
      vscode.window.showWarningMessage('无法查看未保存文件的文件历史！');
      return;
    }

    const cwd = getCwd();
    if (!cwd) {
      vscode.window.showWarningMessage('未找到工作区，请先打开一个 Git 项目文件夹！');
      return;
    }

    let filePath = document.uri.fsPath;
    let startRef: string | undefined = undefined;

    if (document.uri.scheme === 'git') {
      try {
        const queryObj = JSON.parse(document.uri.query);
        if (queryObj.ref) {
          startRef = queryObj.ref;
        }
        if (queryObj.path) {
          filePath = queryObj.path;
        }
      } catch (e) {
        // Ignore
      }
    }

    try {
      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: "正在获取 Git 文件历史...",
        cancellable: false
      }, async () => {
        const commits = await traceFileHistory(cwd, filePath, startRef);
        
        let repoRoot = cwd;
        try {
          repoRoot = (await execGit(['rev-parse', '--show-toplevel'], cwd)).trim();
        } catch (e) {}
        const repoFilePath = path.relative(repoRoot, filePath).replace(/\\/g, '/');

        const hasLocalChanges = !startRef && (await hasFileLocalModifications(cwd, filePath));

        const commitsToSend = commits.map(c => ({
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

        await vscode.commands.executeCommand('git-visual.graphView.focus');

        gitGraphProvider.showFileHistory({
          filePath: repoFilePath,
          commits: commitsToSend
        });
      });
    } catch (err: any) {
      vscode.window.showErrorMessage(`获取文件历史失败: ${err.message}`);
    }
  });

  context.subscriptions.push(traceFileHistoryCommand);

  // 3.5 Register Toggle Blame Annotations command (Git 行作者)
  const blameAnnotationsManager = new BlameAnnotationsManager(getCwd, gitGraphProvider);
  gitGraphProvider.setBlameManager(blameAnnotationsManager);
  context.subscriptions.push(blameAnnotationsManager);

  const toggleBlameCommand = vscode.commands.registerCommand('git-visual.toggleLineBlame', async () => {
    const editor = vscode.window.activeTextEditor;
    await blameAnnotationsManager.toggle(editor);
  });
  context.subscriptions.push(toggleBlameCommand);

  // 3.6 Register File Header CodeLens Provider
  const fileHeaderProvider = new FileHeaderCodeLensProvider(getCwd);
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider({ scheme: 'file' }, fileHeaderProvider)
  );

  // Refresh file header CodeLens on save and document changes
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(() => {
      fileHeaderProvider.refresh();
    })
  );

  let fileHeaderChangeDebounce: NodeJS.Timeout | undefined;
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument(() => {
      if (fileHeaderChangeDebounce) {
        clearTimeout(fileHeaderChangeDebounce);
      }
      fileHeaderChangeDebounce = setTimeout(() => {
        fileHeaderProvider.refresh();
      }, 1000);
    })
  );

  // Register Open File Recent Diff command
  const openFileRecentDiffCommand = vscode.commands.registerCommand('git-visual.openFileRecentDiff', async (filePath: string, diffKind: 'workingTree' | 'commit', hash?: string, isNewFile?: boolean) => {
    if (!filePath || isNewFile) {
      return;
    }

    const cwd = getCwd();
    if (!cwd) {
      vscode.window.showWarningMessage('未找到工作区，请先打开一个 Git 项目文件夹！');
      return;
    }

    let gitRoot = cwd;
    try {
      gitRoot = (await execGit(['rev-parse', '--show-toplevel'], cwd)).trim();
    } catch (e) {
      vscode.window.showWarningMessage('当前文件不在 Git 仓库中！');
      return;
    }

    const fileUri = vscode.Uri.file(filePath);
    const repoFilePath = path.relative(gitRoot, filePath).replace(/\\/g, '/');

    try {
      if (diffKind === 'workingTree') {
        const leftUri = await toGitUri(fileUri, 'HEAD');
        const title = `${path.basename(filePath)} (HEAD vs 工作区)`;
        await vscode.commands.executeCommand('vscode.diff', leftUri, fileUri, title);
      } else if (hash) {
        const parentHash = (await execGit(['log', '-1', '--pretty=%P', hash], gitRoot)).trim().split(' ')[0];
        const emptyUri = vscode.Uri.from({ scheme: 'git-visual', path: filePath });
        let leftUri = emptyUri;
        if (parentHash) {
          try {
            await execGit(['cat-file', '-e', `${parentHash}:${repoFilePath}`], gitRoot);
            leftUri = await toGitUri(fileUri, parentHash);
          } catch (e) {
            // keep emptyUri
          }
        }
        const rightUri = await toGitUri(fileUri, hash);
        const title = `${path.basename(filePath)} (${parentHash ? parentHash.substring(0, 7) : 'empty'} vs ${hash.substring(0, 7)})`;
        await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, title);
      }
    } catch (err: any) {
      vscode.window.showErrorMessage(`打开 diff 失败: ${err.message}`);
    }
  });
  context.subscriptions.push(openFileRecentDiffCommand);

  // Register Show/Toggle Line Blame command from file header
  const showLineBlameCommand = vscode.commands.registerCommand('git-visual.showLineBlame', async (isNewFile?: boolean) => {
    const editor = vscode.window.activeTextEditor;
    if (!editor || isNewFile) {
      return;
    }

    await blameAnnotationsManager.toggle(editor);
    fileHeaderProvider.refresh();
  });
  context.subscriptions.push(showLineBlameCommand);

  // 4. Register Open Current Workspace File command
  const openWorkspaceFileCommand = vscode.commands.registerCommand('git-visual.openWorkspaceFile', async (uri: vscode.Uri) => {
    if (!uri) {
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        uri = editor.document.uri;
      }
    }

    if (!uri || (uri.scheme !== 'git' && uri.scheme !== 'git-visual')) {
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
    if (uri.query) {
      try {
        const queryObj = JSON.parse(uri.query);
        if (queryObj && queryObj.path) {
          relativePath = queryObj.path;
        }
      } catch (e) {
        // Ignore
      }
    }

    if (!relativePath) {
      if (uri.scheme === 'git') {
        relativePath = uri.path;
      } else {
        relativePath = uri.path.startsWith('/') ? uri.path.substring(1) : uri.path;
        const parts = relativePath.split(' | ');
        if (parts.length > 1) {
          relativePath = parts[parts.length - 1];
        }
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


}

export function deactivate() { }
