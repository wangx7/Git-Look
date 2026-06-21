import * as vscode from 'vscode';
import * as path from 'path';
import { execGit } from './gitHelper';

function formatBlameLabel(dateStr: string, name: string): string {
  const maxNameLen = 8;
  let formattedName = name;
  if (name.length > maxNameLen) {
    formattedName = name.substring(0, maxNameLen - 1) + '…';
  } else {
    formattedName = name.padEnd(maxNameLen, ' ');
  }
  return `${dateStr} ${formattedName}`;
}

export class BlameAnnotationsManager implements vscode.Disposable {
  private enabled = false;
  private decorationType: vscode.TextEditorDecorationType;
  private disposables: vscode.Disposable[] = [];
  private getCwd: () => string | undefined;

  constructor(getCwd: () => string | undefined) {
    this.getCwd = getCwd;

    // Create the decoration type for git blame gutter annotations
    this.decorationType = vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      before: {
        margin: '0 15px 0 0',
        color: new vscode.ThemeColor('editorGhostText.foreground'),
        fontStyle: 'normal',
        fontWeight: 'normal',
        textDecoration: 'none; display: inline-block; width: 20ch; text-align: left; overflow: hidden; white-space: pre;',
      }
    });

    // Listen to editor changes and document saves
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(editor => {
        if (this.enabled && editor) {
          this.updateAnnotations(editor);
        }
      })
    );

    this.disposables.push(
      vscode.workspace.onDidSaveTextDocument(document => {
        if (this.enabled) {
          // Find editor matching this document
          const editor = vscode.window.activeTextEditor;
          if (editor && editor.document === document) {
            this.updateAnnotations(editor);
          }
        }
      })
    );
  }

  public async toggle(editor: vscode.TextEditor | undefined) {
    if (this.enabled) {
      this.enabled = false;
      // Clear decorations in all visible editors
      for (const visibleEditor of vscode.window.visibleTextEditors) {
        visibleEditor.setDecorations(this.decorationType, []);
      }
      vscode.window.setStatusBarMessage('Git 行作者注解已关闭', 2000);
    } else {
      this.enabled = true;
      if (editor) {
        await this.updateAnnotations(editor);
      }
      vscode.window.setStatusBarMessage('Git 行作者注解已开启', 2000);
    }
  }

  private async updateAnnotations(editor: vscode.TextEditor) {
    if (!this.enabled || !editor) {
      return;
    }

    const document = editor.document;
    if (document.isUntitled || document.uri.scheme !== 'file') {
      editor.setDecorations(this.decorationType, []);
      return;
    }

    const cwd = this.getCwd();
    if (!cwd) {
      editor.setDecorations(this.decorationType, []);
      return;
    }

    const filePath = document.uri.fsPath;

    try {
      // Resolve Git Root
      let gitRoot = cwd;
      try {
        gitRoot = (await execGit(['rev-parse', '--show-toplevel'], cwd)).trim();
      } catch (e) {
        // Ignore
      }

      // Compute Relative Path
      const repoFilePath = path.relative(gitRoot, filePath).replace(/\\/g, '/');

      // Run git blame with porcelain output
      const output = await execGit(['blame', '--porcelain', repoFilePath], gitRoot);
      if (!this.enabled || vscode.window.activeTextEditor !== editor) {
        return; // User toggled off or switched editor during async git call
      }

      const lines = output.split('\n');
      const commitMap = new Map<string, { author: string; email: string; time: number; summary: string }>();
      const decorations: vscode.DecorationOptions[] = [];
      const documentLineCount = document.lineCount;

      let i = 0;
      while (i < lines.length) {
        const headerLine = lines[i].trim();
        if (!headerLine) {
          i++;
          continue;
        }

        const parts = headerLine.split(' ');
        const hash = parts[0];
        if (hash.length < 40) {
          i++;
          continue;
        }

        const finalLineNum = parseInt(parts[2], 10);

        if (!commitMap.has(hash)) {
          let author = 'Unknown';
          let email = '';
          let time = 0;
          let summary = '';

          i++;
          while (i < lines.length) {
            const l = lines[i];
            if (l.startsWith('\t')) {
              break;
            }
            if (l.startsWith('author ')) {
              author = l.substring(7).trim();
            } else if (l.startsWith('author-mail ')) {
              email = l.substring(12).trim();
            } else if (l.startsWith('author-time ')) {
              time = parseInt(l.substring(12).trim(), 10) || 0;
            } else if (l.startsWith('summary ')) {
              summary = l.substring(8).trim();
            }
            i++;
          }
          commitMap.set(hash, { author, email, time, summary });
        } else {
          // Skip header lines until tab character
          i++;
          while (i < lines.length) {
            if (lines[i].startsWith('\t')) {
              break;
            }
            i++;
          }
        }

        const meta = commitMap.get(hash)!;
        const lineIndex = finalLineNum - 1;

        if (lineIndex >= 0 && lineIndex < documentLineCount) {
          let dateStr = '----/--/--';
          if (!hash.startsWith('00000000') && meta.time) {
            const date = new Date(meta.time * 1000);
            const y = date.getFullYear();
            const m = String(date.getMonth() + 1).padStart(2, '0');
            const d = String(date.getDate()).padStart(2, '0');
            dateStr = `${y}/${m}/${d}`;
          }

          const authorName = hash.startsWith('00000000') ? '未提交' : meta.author;
          const formattedLabel = formatBlameLabel(dateStr, authorName);

          const hoverMarkdown = new vscode.MarkdownString();
          hoverMarkdown.isTrusted = true;
          if (hash.startsWith('00000000')) {
            hoverMarkdown.appendMarkdown(`### 未提交的更改\n\n当前行包含本地未提交的修改。`);
          } else {
            hoverMarkdown.appendMarkdown(`### Git 提交信息\n\n`);
            hoverMarkdown.appendMarkdown(`- **提交哈希**: \`${hash}\`\n`);
            hoverMarkdown.appendMarkdown(`- **作者**: ${meta.author} \`${meta.email}\`\n`);
            hoverMarkdown.appendMarkdown(`- **提交日期**: ${new Date(meta.time * 1000).toLocaleString()}\n`);
            hoverMarkdown.appendMarkdown(`- **提交信息**: ${meta.summary}\n`);
          }

          decorations.push({
            range: new vscode.Range(lineIndex, 0, lineIndex, 0),
            renderOptions: {
              before: {
                contentText: formattedLabel
              }
            },
            hoverMessage: hoverMarkdown
          });
        }

        i++; // Skip tab line content
      }

      editor.setDecorations(this.decorationType, decorations);

    } catch (err: any) {
      console.error('[Git 可视化] Blame annotations update failed:', err);
      editor.setDecorations(this.decorationType, []);
    }
  }

  public dispose() {
    this.enabled = false;
    for (const visibleEditor of vscode.window.visibleTextEditors) {
      try {
        visibleEditor.setDecorations(this.decorationType, []);
      } catch (e) {
        // Ignore
      }
    }
    this.decorationType.dispose();
    this.disposables.forEach(d => d.dispose());
    this.disposables = [];
  }
}
