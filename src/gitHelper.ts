import * as cp from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

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

export function execGit(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    cp.execFile('git', args, { cwd, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message));
      } else {
        resolve(stdout);
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

export async function getCommits(
  cwd: string,
  filters: GitFilters,
  skip: number = 0,
  limit: number = 150
): Promise<CommitInfo[]> {
  const args = ['log', '--date-order'];
  
  // Custom format: hash|parents|authorName|authorEmail|authorTimestamp|decorations|subject
  // parents are space-separated
  args.push('--pretty=format:%H|%P|%an|%ae|%at|%d|%s');

  let searchHash: string | null = null;
  if (filters.query) {
    const trimmed = filters.query.trim();
    if (/^[0-9a-fA-F]{7,40}$/.test(trimmed)) {
      searchHash = trimmed;
    }
  }

  if (searchHash) {
    try {
      const output = await execGit(['show', '-s', '--pretty=format:%H|%P|%an|%ae|%at|%d|%s', searchHash], cwd);
      const parsed = parseCommitLine(output.trim());
      return parsed ? [parsed] : [];
    } catch {
      // Fall back
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

  // Skip and Limit for Pagination
  args.push('-n', String(limit));
  if (skip > 0) {
    args.push('--skip', String(skip));
  }

  try {
    const output = await execGit(args, cwd);
    return output
      .split('\n')
      .map(line => parseCommitLine(line))
      .filter((c): c is CommitInfo => c !== null);
  } catch (e) {
    console.error('Error fetching commits:', e);
    return [];
  }
}

function parseCommitLine(line: string): CommitInfo | null {
  if (!line.trim()) {
    return null;
  }
  const parts = line.split('|');
  if (parts.length < 7) {
    return null;
  }
  const hash = parts[0];
  const parents = parts[1] ? parts[1].split(' ') : [];
  const author = parts[2];
  const email = parts[3];
  const timestamp = parseInt(parts[4], 10);
  const decPart = parts[5].trim();
  const message = parts.slice(6).join('|');

  // Parse decorations (e.g. "(HEAD -> master, origin/master, tag: v1.0.0)")
  const decorations: string[] = [];
  if (decPart && decPart.startsWith('(') && decPart.endsWith(')')) {
    const refs = decPart.substring(1, decPart.length - 1).split(', ');
    refs.forEach(ref => {
      const cleanRef = ref.replace('HEAD -> ', '').trim();
      if (cleanRef) {
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
  endLine: number
): Promise<CommitDiff[]> {
  const args = [
    'log',
    `-L`,
    `${startLine},${endLine}:${filePath}`,
    '-w', // ignore whitespaces to skip formatting commits
    '--date=raw',
    '--pretty=format:COMMIT_START|%H|%an|%ae|%at|%s'
  ];

  try {
    const output = await execGit(args, cwd);
    const lines = output.split('\n');
    const commits: CommitDiff[] = [];
    let currentCommit: CommitDiff | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith('COMMIT_START|')) {
        if (currentCommit) {
          commits.push(currentCommit);
        }
        const parts = line.substring('COMMIT_START|'.length).split('|');
        const hash = parts[0];
        const author = parts[1];
        const email = parts[2];
        const timestamp = parseInt(parts[3], 10);
        const message = parts.slice(4).join('|');

        currentCommit = {
          hash,
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
  } catch (e) {
    console.error('Error tracing line history:', e);
    throw e;
  }
}
