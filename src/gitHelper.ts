import * as cp from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';

export interface CommitInfo {
  hash: string;
  parents: string[];
  author: string;
  email: string;
  timestamp: number; // Unix timestamp
  decorations: string[];
  message: string;
}

export interface DiffLine {
  type: 'added' | 'deleted' | 'context';
  text: string;
}

export interface CommitDiff {
  hash: string;
  parentHash: string;
  author: string;
  email: string;
  timestamp: number;
  message: string;
  diffLines: DiffLine[];
}

export interface GitFilters {
  branch?: string;
  author?: string;
  since?: string;
  until?: string;
  query?: string;
}

let gitPathCache: string | undefined = undefined;

async function getGitPath(): Promise<string> {
  if (gitPathCache) {
    return gitPathCache;
  }
  try {
    const gitExtension = vscode.extensions.getExtension<any>('vscode.git');
    if (gitExtension) {
      const activated = gitExtension.isActive ? gitExtension.exports : await gitExtension.activate();
      const api = activated.getAPI(1);
      if (api && api.gitPath) {
        gitPathCache = api.gitPath;
        return gitPathCache!;
      }
    }
  } catch (e) {
    console.error('Error retrieving git path from vscode.git extension:', e);
  }
  return 'git';
}

export async function execGit(args: string[], cwd: string, signal?: AbortSignal): Promise<string> {
  const git = await getGitPath();
  const fullArgs = ['-c', 'core.quotepath=false', ...args];
  return new Promise((resolve, reject) => {
    cp.execFile(git, fullArgs, { cwd, maxBuffer: 10 * 1024 * 1024, signal }, (error, stdout, stderr) => {
      if (error) {
        if (error.name === 'AbortError' || (signal && signal.aborted)) {
          reject(new Error('ABORTED'));
        } else {
          reject(new Error(stderr || error.message));
        }
      } else {
        resolve(stdout);
      }
    });
  });
}

export async function execGitBuffer(args: string[], cwd: string, signal?: AbortSignal): Promise<Uint8Array> {
  const git = await getGitPath();
  const fullArgs = ['-c', 'core.quotepath=false', ...args];
  return new Promise((resolve, reject) => {
    cp.execFile(git, fullArgs, { cwd, maxBuffer: 10 * 1024 * 1024, signal, encoding: 'buffer' }, (error, stdout, stderr) => {
      if (error) {
        if (error.name === 'AbortError' || (signal && signal.aborted)) {
          reject(new Error('ABORTED'));
        } else {
          reject(new Error(stderr.toString() || error.message));
        }
      } else {
        resolve(new Uint8Array(stdout));
      }
    });
  });
}

export async function isGitRepository(cwd: string): Promise<boolean> {
  try {
    await execGit(['rev-parse', '--is-inside-work-tree'], cwd);
    return true;
  } catch {
    return false;
  }
}

export async function getBranches(cwd: string): Promise<string[]> {
  try {
    const output = await execGit(['branch', '-a', '--format=%(refname:short)'], cwd);
    return output
      .split('\n')
      .map(b => b.trim())
      .filter(b => b.length > 0 && !b.startsWith('origin/HEAD'));
  } catch (e) {
    console.error('Error fetching branches:', e);
    return [];
  }
}

export async function getAuthors(cwd: string): Promise<string[]> {
  try {
    const output = await execGit(['log', '-n', '10000', '--pretty=format:%an'], cwd);
    const authorsSet = new Set<string>();
    output.split('\n').forEach(name => {
      const trimmed = name.trim();
      if (trimmed) {
        authorsSet.add(trimmed);
      }
    });
    return Array.from(authorsSet); // Preserves insertion order (most recent committer first)
  } catch (e) {
    console.error('Error fetching authors:', e);
    return [];
  }
}

function buildLogArgs(filters: GitFilters): { args: string[]; searchHash: string | null } {
  const args = ['log', '--topo-order'];
  args.push('--pretty=format:%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%d%x1f%s');

  let searchHash: string | null = null;
  if (filters.query) {
    const trimmed = filters.query.trim();
    if (/^[0-9a-fA-F]{7,40}$/.test(trimmed)) {
      searchHash = trimmed;
    }
  }

  // Branch filter
  if (filters.branch) {
    args.push(filters.branch);
  } else {
    args.push('--all');
  }

  // Author filter
  if (filters.author) {
    args.push(`--author=${filters.author}`);
  }

  // Date filters
  if (filters.since) {
    args.push(`--since=${filters.since}`);
  }
  if (filters.until) {
    args.push(`--until=${filters.until}`);
  }

  // Text search filter
  if (filters.query && !searchHash) {
    args.push(`--grep=${filters.query}`, '-i');
  }

  return { args, searchHash };
}

export async function getCommits(
  cwd: string,
  filters: GitFilters,
  skip: number = 0,
  limit: number = 150,
  signal?: AbortSignal
): Promise<CommitInfo[]> {
  const { args, searchHash } = buildLogArgs(filters);

  if (searchHash) {
    try {
      const output = await execGit(['show', '-s', '--pretty=format:%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%d%x1f%s', searchHash], cwd, signal);
      const parsed = parseCommitLine(output.trim());
      return parsed ? [parsed] : [];
    } catch {
      // Fall back
    }
  }

  // Skip and Limit for Pagination
  args.push('-n', String(limit));
  if (skip > 0) {
    args.push('--skip', String(skip));
  }

  try {
    const output = await execGit(args, cwd, signal);
    return output
      .split('\n')
      .map(line => parseCommitLine(line))
      .filter((c): c is CommitInfo => c !== null);
  } catch (e: any) {
    if (e.message === 'ABORTED') {
      throw e;
    }
    console.error('Error fetching commits:', e);
    return [];
  }
}

export async function getCommitsUntil(
  cwd: string,
  filters: GitFilters,
  targetHash: string,
  maxLimit: number = 3000,
  signal?: AbortSignal
): Promise<{ commits: CommitInfo[]; found: boolean }> {
  const { args, searchHash } = buildLogArgs(filters);
  args.push('-n', String(maxLimit));

  try {
    const output = await execGit(args, cwd, signal);
    const allCommits = output
      .split('\n')
      .map(line => parseCommitLine(line))
      .filter((c): c is CommitInfo => c !== null);

    const targetLower = targetHash.toLowerCase();
    const index = allCommits.findIndex(c => c.hash.toLowerCase().startsWith(targetLower));

    if (index !== -1) {
      // Return commits up to and including the target commit, plus 50 more to show history context below it
      const endSlice = Math.min(allCommits.length, index + 50);
      return {
        commits: allCommits.slice(0, endSlice),
        found: true
      };
    }

    return {
      commits: [],
      found: false
    };
  } catch (e: any) {
    if (e.message === 'ABORTED') {
      throw e;
    }
    console.error('Error in getCommitsUntil:', e);
    return { commits: [], found: false };
  }
}

function parseCommitLine(line: string): CommitInfo | null {
  if (!line.trim()) {
    return null;
  }
  const parts = line.split('\x1f');
  if (parts.length < 7) {
    return null;
  }
  const hash = parts[0];
  const parents = parts[1] ? parts[1].split(' ') : [];
  const author = parts[2];
  const email = parts[3];
  const timestamp = parseInt(parts[4], 10);
  const decPart = parts[5].trim();
  const message = parts.slice(6).join('\x1f');

  // Parse decorations (e.g. "(HEAD -> master, origin/master, tag: v1.0.0)")
  const decorations: string[] = [];
  if (decPart && decPart.startsWith('(') && decPart.endsWith(')')) {
    const refs = decPart.substring(1, decPart.length - 1).split(', ');
    refs.forEach(ref => {
      if (ref.startsWith('HEAD -> ') || ref === 'HEAD') {
        decorations.push('HEAD');
      }
      const cleanRef = ref.replace('HEAD -> ', '').trim();
      if (cleanRef && cleanRef !== 'HEAD') {
        decorations.push(cleanRef);
      }
    });
  }

  return { hash, parents, author, email, timestamp, decorations, message };
}

export async function traceLineHistory(
  cwd: string,
  filePath: string,
  startLine: number,
  endLine: number,
  signal?: AbortSignal
): Promise<CommitDiff[]> {
  const args = [
    'log',
    `-L`,
    `${startLine},${endLine}:${filePath}`,
    '-w', // ignore whitespaces to skip formatting commits
    '--date=raw',
    '--pretty=format:COMMIT_START_LOOK%x1f%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%s'
  ];

  try {
    const output = await execGit(args, cwd, signal);
    const lines = output.split('\n');
    const commits: CommitDiff[] = [];
    let currentCommit: CommitDiff | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith('COMMIT_START_LOOK\x1f')) {
        if (currentCommit) {
          commits.push(currentCommit);
        }
        const parts = line.substring('COMMIT_START_LOOK\x1f'.length).split('\x1f');
        const hash = parts[0];
        const parentsStr = parts[1] || '';
        const author = parts[2];
        const email = parts[3];
        const timestamp = parseInt(parts[4], 10);
        const message = parts.slice(5).join('\x1f');

        const parentHash = parentsStr.split(' ')[0] || 'empty';

        currentCommit = {
          hash,
          parentHash,
          author,
          email,
          timestamp,
          message,
          diffLines: []
        };
      } else if (currentCommit) {
        if (
          line.startsWith('diff --git') ||
          line.startsWith('---') ||
          line.startsWith('+++') ||
          line.startsWith('index ')
        ) {
          continue;
        }
        
        if (line.startsWith('@@ ')) {
          continue;
        }
        
        if (line.startsWith('-')) {
          currentCommit.diffLines.push({ type: 'deleted', text: line.substring(1) });
        } else if (line.startsWith('+')) {
          currentCommit.diffLines.push({ type: 'added', text: line.substring(1) });
        } else if (line.startsWith(' ') || line === '') {
          currentCommit.diffLines.push({ 
            type: 'context', 
            text: line.length > 0 ? line.substring(1) : '' 
          });
        }
      }
    }

    if (currentCommit) {
      commits.push(currentCommit);
    }

    return commits;
  } catch (e: any) {
    if (e.message === 'ABORTED') {
      throw e;
    }
    console.error('Error tracing line history:', e);
    throw e;
  }
}

