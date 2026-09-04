import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { execGit, toGitUri } from '../gitHelper';

/**
 * Resolves a Git file URI for diff views.
 * Checks if the file exists at the given commit ref using `git cat-file -e`.
 * If it exists, returns the VS Code git URI; otherwise returns an empty git-visual URI.
 */
export async function resolveGitFileUri(
  gitRoot: string,
  filePath: string,
  ref?: string
): Promise<vscode.Uri> {
  const absoluteFilePath = path.isAbsolute(filePath) ? filePath : path.join(gitRoot, filePath);
  if (!ref || ref === 'empty') {
    return vscode.Uri.from({ scheme: 'git-visual', path: absoluteFilePath });
  }

  const relativeFilePath = path.relative(gitRoot, absoluteFilePath).replace(/\\/g, '/');
  try {
    await execGit(['cat-file', '-e', `${ref}:${relativeFilePath}`], gitRoot);
    return await toGitUri(vscode.Uri.file(absoluteFilePath), ref);
  } catch {
    return vscode.Uri.from({ scheme: 'git-visual', path: absoluteFilePath });
  }
}

/**
 * Handles the 'openDiff' command from webview.
 * Supports working-tree diff and commit vs parent diff (with merge parent detection).
 */
export async function handleOpenDiff(gitRoot: string, data: any): Promise<void> {
  const { hash } = data;
  const file = (data.file || '').replace(/\\/g, '/');
  let parentHash = data.parentHash;

  if (hash === '*working-tree*') {
    const absoluteFilePath = path.isAbsolute(file) ? file : path.join(gitRoot, file);
    const fileUri = vscode.Uri.file(absoluteFilePath);
    const leftUri = await resolveGitFileUri(gitRoot, absoluteFilePath, 'HEAD');
    const rightUri = fs.existsSync(absoluteFilePath)
      ? fileUri
      : vscode.Uri.from({ scheme: 'git-visual', path: absoluteFilePath });
    const title = `${path.basename(file)} (HEAD vs 本地工作区)`;
    await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, title);
    return;
  }

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
  const rightUri = await resolveGitFileUri(gitRoot, absoluteFilePath, hash);
  const leftUri = await resolveGitFileUri(gitRoot, absoluteFilePath, parentHash);

  const title = `${path.basename(file)} (${(parentHash && parentHash !== 'empty') ? parentHash.substring(0, 7) : 'empty'} vs ${hash.substring(0, 7)})`;
  await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, title);
}

/**
 * Handles the 'openSingleDiff' command from webview.
 * Supports line range selection and historic rename path handling.
 */
export async function handleOpenSingleDiff(gitRoot: string, data: any): Promise<void> {
  const { hash, lineRange } = data;
  const file = (data.file || '').replace(/\\/g, '/');
  const oldFilePath = data.oldFilePath ? data.oldFilePath.replace(/\\/g, '/') : undefined;
  const newFilePath = data.newFilePath ? data.newFilePath.replace(/\\/g, '/') : undefined;
  let parentHash = data.parentHash;

  const absoluteFilePath = path.isAbsolute(file) ? file : path.join(gitRoot, file);
  const isWorkingTree = hash === 'HEAD';

  let rightUri: vscode.Uri;
  let leftUri: vscode.Uri;

  if (isWorkingTree) {
    rightUri = fs.existsSync(absoluteFilePath)
      ? vscode.Uri.file(absoluteFilePath)
      : vscode.Uri.from({ scheme: 'git-visual', path: absoluteFilePath });
  } else if (newFilePath) {
    rightUri = await resolveGitFileUri(gitRoot, newFilePath, hash);
  } else {
    rightUri = await resolveGitFileUri(gitRoot, absoluteFilePath, hash);
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

  const rightLabel = isWorkingTree ? '本地工作区' : hash.substring(0, 7);
  const title = `${path.basename(file)} (${(resolvedParentHash && resolvedParentHash !== 'empty') ? resolvedParentHash.substring(0, 7) : 'empty'} vs ${rightLabel})`;

  let options: vscode.TextDocumentShowOptions = {};
  if (lineRange) {
    const startLine = Math.max(0, lineRange.newStart - 1);
    const endLine = Math.max(0, startLine + Math.max(0, lineRange.newLength - 1));
    options.selection = new vscode.Range(startLine, 0, endLine, 0);
  }

  await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, title, options);
}

/**
 * Handles the 'openFileHistoryDiff' command from webview.
 */
export async function handleOpenFileHistoryDiff(gitRoot: string, data: any): Promise<void> {
  const { file, hash, oldFilePath, newFilePath } = data;
  const relativeFilePath = path.isAbsolute(file) ? path.relative(gitRoot, file).replace(/\\/g, '/') : file;
  const absoluteFilePath = path.join(gitRoot, relativeFilePath);

  const relativeHistPath = oldFilePath || newFilePath || relativeFilePath;
  let leftUri: vscode.Uri;
  try {
    await execGit(['cat-file', '-e', `${hash}:${relativeHistPath}`], gitRoot);
    leftUri = await toGitUri(vscode.Uri.file(path.join(gitRoot, relativeHistPath)), hash);
  } catch (e) {
    leftUri = await resolveGitFileUri(gitRoot, absoluteFilePath, hash);
  }

  const rightUri = fs.existsSync(absoluteFilePath)
    ? vscode.Uri.file(absoluteFilePath)
    : vscode.Uri.from({ scheme: 'git-visual', path: absoluteFilePath });

  const title = `${path.basename(relativeFilePath)} (${hash.substring(0, 7)} vs 本地工作区)`;
  await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, title);
}

/**
 * Handles the 'openAllDiffs' command from webview.
 * Opens multi-file diff view in VS Code via 'vscode.changes'.
 */
export async function handleOpenAllDiffs(gitRoot: string, data: any): Promise<void> {
  try {
    const { hash, files, parentHash, message } = data;
    const isWorkingTree = (hash === '*working-tree*');
    const resourceList = await Promise.all(files.map(async (f: any) => {
      const absoluteFilePath = path.join(gitRoot, f.path);
      const fileUri = vscode.Uri.file(absoluteFilePath);

      let leftUri: vscode.Uri;
      if (isWorkingTree) {
        if (f.status === 'A' || f.status === '?') {
          leftUri = vscode.Uri.from({ scheme: 'git-visual', path: absoluteFilePath });
        } else {
          try {
            await execGit(['cat-file', '-e', `HEAD:${f.path}`], gitRoot);
            leftUri = await toGitUri(fileUri, 'HEAD');
          } catch {
            leftUri = vscode.Uri.from({ scheme: 'git-visual', path: absoluteFilePath });
          }
        }
      } else {
        if (f.status === 'A' || !parentHash || parentHash === 'empty') {
          leftUri = vscode.Uri.from({ scheme: 'git-visual', path: absoluteFilePath });
        } else {
          leftUri = await toGitUri(fileUri, parentHash);
        }
      }

      let rightUri: vscode.Uri;
      if (isWorkingTree) {
        if (f.status === 'D' || !fs.existsSync(absoluteFilePath)) {
          rightUri = vscode.Uri.from({ scheme: 'git-visual', path: absoluteFilePath });
        } else {
          rightUri = fileUri;
        }
      } else {
        if (f.status === 'D') {
          rightUri = vscode.Uri.from({ scheme: 'git-visual', path: absoluteFilePath });
        } else {
          rightUri = await toGitUri(fileUri, hash);
        }
      }

      return [fileUri, leftUri, rightUri];
    }));

    const title = isWorkingTree
      ? `工作区未提交修改 (${files.length} 个文件)`
      : `${hash.substring(0, 7)} - ${message || ''} (${files.length} 个文件)`;
    console.log(`[Git 可视化] openAllDiffs: opening ${resourceList.length} changes with title "${title}"`);
    await vscode.commands.executeCommand('vscode.changes', title, resourceList);
  } catch (e: any) {
    vscode.window.showErrorMessage(`无法打开多文件对比: ${e.message}`);
    console.error('Error in openAllDiffs:', e);
  }
}
