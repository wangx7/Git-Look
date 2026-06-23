import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { GitGraphProvider } from './panel/gitGraphProvider';
import { execGit, traceLineHistory, hasLocalModifications } from './gitHelper';
import { BlameAnnotationsManager } from './blameAnnotations';

export function activate(context: vscode.ExtensionContext) {
  // Register a dummy document content provider for the git-visual scheme
  // so that VS Code can resolve git-visual URIs (used for custom labels in multi-diff editors).
  const docProvider = vscode.workspace.registerTextDocumentContentProvider('git-visual', {
    provideTextDocumentContent(): string {
      return '';
    }
  });
  context.subscriptions.push(docProvider);

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

    let startRef: string | undefined = undefined;
    if (document.uri.scheme === 'git') {
      try {
        const queryObj = JSON.parse(document.uri.query);
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
        // Check for local changes (uncommitted changes in the working tree) within the selected line range
        const hasLocalChanges = !startRef && (await hasLocalModifications(cwd, filePath, startLine, endLine));

        if (commits.length === 0 && !hasLocalChanges) {
          vscode.window.showInformationMessage('未找到该选区的历史记录');
          return;
        }

        const fileName = path.basename(filePath);

        // The Git empty-tree hash — used as "parent" for root commits that have no parent
        const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

        const resourceList: any[] = [];

        // git log -L returns commits newest-first; keep that order so the
        // multi-diff editor shows the latest change at the top.
        const orderedCommits = commits;

        for (const commit of orderedCommits) {
          // Safely resolve the parent ref — parentHash may be the literal string 'empty'
          // when traceLineHistory encounters a root commit (no actual parent).
          let parentRef = (!commit.parentHash || commit.parentHash === 'empty')
            ? EMPTY_TREE
            : commit.parentHash;

          // If the parent is not empty, check if the file actually existed in that parent commit.
          // If the file did not exist (e.g. it was newly created in this commit),
          // we must diff it against the EMPTY_TREE so VS Code can render the diff properly.
          if (parentRef !== EMPTY_TREE) {
            try {
              let repoRoot = cwd;
              try {
                repoRoot = (await execGit(['rev-parse', '--show-toplevel'], cwd)).trim();
              } catch (e) { }
              const repoFilePath = path.relative(repoRoot, filePath).replace(/\\/g, '/');
              await execGit(['cat-file', '-e', `${parentRef}:${repoFilePath}`], repoRoot);
            } catch (e) {
              parentRef = EMPTY_TREE;
            }
          }

          // File as it existed in the parent commit (older state → LEFT side)
          let parentHashDisplay = parentRef === EMPTY_TREE ? 'Empty Tree' : parentRef.substring(0, 7);
          const originalLabel = `/[${parentHashDisplay}]/${fileName}`;
          const originalUri = vscode.Uri.from({
            scheme: 'git',
            path: originalLabel,
            query: JSON.stringify({ path: filePath, ref: parentRef })
          });

          // Construct a dummy label URI to satisfy the 3-element tuple requirement of vscode.changes
          const labelUri = vscode.Uri.from({
            scheme: 'git-visual',
            path: '/dummy',
            query: ''
          });

          // File as it became in this commit (newer state → RIGHT side)
          // We put the commit info in a pseudo-directory so the basename matches the real file, preserving syntax highlighting.
          const cleanMessage = commit.message.replace(/[\r\n]+/g, ' ').substring(0, 30);
          const modifiedLabel = `/[${commit.hash.substring(0, 7)}] ${cleanMessage}/${fileName}`;

          const modifiedUri = vscode.Uri.from({
            scheme: 'git',
            path: modifiedLabel,
            query: JSON.stringify({ path: filePath, ref: commit.hash })
          });
          // vscode.changes tuple: [labelUri, originalUri, modifiedUri]
          resourceList.push([labelUri, originalUri, modifiedUri]);
        }

        // Prepend working-tree (uncommitted) changes as the very first — i.e. newest — entry.
        if (hasLocalChanges) {
          const latestRef = commits[0]?.hash ?? 'HEAD';
          const headLabel = `/[${latestRef.substring(0, 7)}]/${fileName}`;
          const headUri = vscode.Uri.from({
            scheme: 'git',
            path: headLabel,
            query: JSON.stringify({ path: filePath, ref: latestRef })
          });
          const workingTreeUri = vscode.Uri.file(filePath);

          const labelUri = vscode.Uri.from({
            scheme: 'git-visual',
            path: '/dummy',
            query: ''
          });

          // For local working tree changes, we pass the actual file URI so it remains editable.
          resourceList.unshift([labelUri, headUri, workingTreeUri]);
        }

        const title = `Git 选区历史: ${fileName} (L${startLine}–L${endLine})`;
        await vscode.commands.executeCommand('vscode.changes', title, resourceList);

        // After the multi-diff editor opens, reveal the selected line range so the
        // user lands directly on the relevant change instead of the top of the file.
        // We retry a few times because the diff editor may take a moment to become active.
        const targetRange = new vscode.Range(
          new vscode.Position(Math.max(0, startLine - 2), 0),
          new vscode.Position(endLine - 1, 0)
        );
        let revealed = false;
        for (let attempt = 0; attempt < 6 && !revealed; attempt++) {
          await new Promise(r => setTimeout(r, 200 + attempt * 150));
          const activeEditor = vscode.window.activeTextEditor;
          if (activeEditor) {
            activeEditor.revealRange(targetRange, vscode.TextEditorRevealType.InCenter);
            revealed = true;
          }
        }
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
