import * as vscode from 'vscode';
import { execGit } from './exec';

export async function toGitUri(uri: vscode.Uri, ref: string): Promise<vscode.Uri> {
  try {
    const gitExtension = vscode.extensions.getExtension<any>('vscode.git');
    if (gitExtension) {
      const activated = gitExtension.isActive ? gitExtension.exports : await gitExtension.activate();
      const api = activated.getAPI(1);
      if (api && typeof api.toGitUri === 'function') {
        // Use standard ref for empty: ''
        const standardRef = (ref === 'empty' || ref === '~') ? '' : ref;
        return api.toGitUri(uri, standardRef);
      }
    }
  } catch (e) {
    console.error('Error getting git uri:', e);
  }
  // Fallback if git api fails
  return uri.with({
    scheme: 'git',
    query: JSON.stringify({ path: uri.fsPath, ref: (ref === 'empty' || ref === '~') ? '' : ref })
  });
}

/**
 * 创建指向工作区实际内容（含未提交修改）的 git:// URI
 * 使用 git stash create 创建临时 commit 来反映工作区状态，不会修改用户工作区/暂存区
 * 注意：git stash create 会短暂修改 .git/index，可能触发文件监听刷新，调用方需配合 skipNextWatchRefresh 使用
 */
export async function toWorkingTreeUri(uri: vscode.Uri, cwd: string): Promise<vscode.Uri> {
  let ref = 'HEAD';
  try {
    const stashHash = (await execGit(['stash', 'create'], cwd)).trim();
    if (stashHash) {
      ref = stashHash;
    }
  } catch (e) {
    // fallback to HEAD
  }
  return toGitUri(uri, ref);
}
