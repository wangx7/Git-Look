import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import {
  execGit,
  getCurrentGitUser,
  getFileLastCommit,
  getFileAuthors,
  isFileTracked,
  hasFileLocalModifications,
  GitUser,
  FileLastCommit,
  FileAuthor
} from './gitHelper';
import { RepoManager } from './repoManager';

export interface FileHeaderData {
  displayAuthor: string;
  displayTime: string;
  authorCount: number;
  youSuffix: string;
  diffKind: 'workingTree' | 'commit';
  commitHash?: string;
}

export function formatDateTimeChinese(timestampSeconds: number): string {
  const date = new Date(timestampSeconds * 1000);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}/${month}/${day} ${hours}:${minutes}`;
}

function normalizeEmail(email: string | undefined): string | undefined {
  if (!email) { return undefined; }
  const trimmed = email.trim();
  return trimmed.startsWith('<') && trimmed.endsWith('>')
    ? trimmed.slice(1, -1).toLowerCase()
    : trimmed.toLowerCase();
}

export function buildFileHeaderData(
  lastCommit: FileLastCommit | undefined,
  authors: FileAuthor[],
  currentUser: GitUser,
  hasLocalChanges: boolean,
  isNewFile: boolean,
  nowSeconds: number
): FileHeaderData | undefined {
  const hasUncommittedContent = hasLocalChanges || isNewFile;
  if (!hasUncommittedContent && !lastCommit) {
    return undefined;
  }

  const currentUserEmail = normalizeEmail(currentUser.email);

  let displayAuthor: string;
  let timestampSeconds: number;
  let diffKind: 'workingTree' | 'commit';
  let commitHash: string | undefined;

  if (hasUncommittedContent) {
    displayAuthor = '你';
    timestampSeconds = nowSeconds;
    diffKind = 'workingTree';
  } else {
    displayAuthor = currentUserEmail && normalizeEmail(lastCommit!.email) === currentUserEmail
      ? '你'
      : lastCommit!.author;
    timestampSeconds = lastCommit!.timestamp;
    diffKind = 'commit';
    commitHash = lastCommit!.hash;
  }

  const currentUserInHistory = currentUserEmail
    ? authors.some(a => normalizeEmail(a.email) === currentUserEmail)
    : false;
  const currentUserIncluded = currentUserInHistory || hasUncommittedContent;

  const authorCount = authors.length + (hasUncommittedContent && !currentUserInHistory ? 1 : 0);

  const youSuffix = currentUserIncluded
    ? authorCount === 1 ? '（你）' : '（你和其他）'
    : '';

  return {
    displayAuthor,
    displayTime: formatDateTimeChinese(timestampSeconds),
    authorCount,
    youSuffix,
    diffKind,
    commitHash
  };
}

export class FileHeaderCodeLensProvider implements vscode.CodeLensProvider {
  private _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
  public readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;
  private repoManager: RepoManager;

  constructor(repoManager: RepoManager) {
    this.repoManager = repoManager;
  }

  public refresh(): void {
    this._onDidChangeCodeLenses.fire();
  }

  public async provideCodeLenses(document: vscode.TextDocument): Promise<vscode.CodeLens[]> {
    if (document.isUntitled || document.uri.scheme !== 'file') {
      return [];
    }

    const filePath = document.uri.fsPath;
    const gitRoot = this.repoManager.getRepoForFile(document.uri);
    if (!gitRoot) {
      return [];
    }

    const repoFilePath = path.relative(gitRoot, filePath).replace(/\\/g, '/');

    try {
      const [hasLocalChanges, isTracked, lastCommit, authors, currentUser] = await Promise.all([
        hasFileLocalModifications(gitRoot, filePath),
        isFileTracked(gitRoot, repoFilePath),
        getFileLastCommit(gitRoot, repoFilePath),
        getFileAuthors(gitRoot, repoFilePath),
        getCurrentGitUser(gitRoot)
      ]);

      const isNewFile = !isTracked && fs.existsSync(filePath) && fs.statSync(filePath).size > 0;
      const nowSeconds = Math.floor(Date.now() / 1000);

      const headerData = buildFileHeaderData(
        lastCommit,
        authors,
        currentUser,
        hasLocalChanges,
        isNewFile,
        nowSeconds
      );

      if (!headerData) {
        return [];
      }

      const range = new vscode.Range(0, 0, 0, 0);
      const lenses: vscode.CodeLens[] = [];

      lenses.push(
        new vscode.CodeLens(range, {
          title: `${headerData.displayAuthor}, ${headerData.displayTime}`,
          command: 'git-visual.openFileRecentDiff',
          arguments: [filePath, headerData.diffKind, headerData.commitHash, isNewFile]
        })
      );

      lenses.push(
        new vscode.CodeLens(range, {
          title: `${headerData.authorCount} 作者${headerData.youSuffix}`,
          command: 'git-visual.showLineBlame',
          arguments: [isNewFile]
        })
      );

      return lenses;
    } catch (err) {
      console.error('[Git Look] File header CodeLens error:', err);
      return [];
    }
  }
}
