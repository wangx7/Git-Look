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
  parents?: string[];
  author: string;
  email: string;
  timestamp: number;
  message: string;
  diffLines: DiffLine[];
  lineRange?: {
    oldStart: number;
    oldLength: number;
    newStart: number;
    newLength: number;
  };
  oldFilePath?: string;
  newFilePath?: string;
}

export interface GitFilters {
  branch?: string;
  author?: string;
  since?: string;
  until?: string;
  query?: string;
}

export interface ContributorStat {
  author: string;
  email: string;
  commits: number;
  additions: number;
  deletions: number;
  totalChanged: number; // additions + deletions
  weekdayDistribution: number[]; // [Mon(1)..Sun(0)], index 0=Sun,1=Mon,...,6=Sat
  topFiles: FileStat[]; // per-author most-modified files
}

export interface DailyActivity {
  date: string; // YYYY-MM-DD
  count: number;
}

export interface FileStat {
  path: string;
  changes: number; // number of commits touching this file
}

export interface CodeStats {
  totalCommits: number;
  totalAdditions: number;
  totalDeletions: number;
  totalChanged: number;
  contributors: ContributorStat[];
  dailyActivity: DailyActivity[];
  topFiles: FileStat[];
  sinceDate: string;
  untilDate: string;
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

interface InFlightEntry {
  promise: Promise<string>;
  signals: Set<AbortSignal>;
  controller: AbortController;
  nonAbortableCount: number;
}

const inFlightEntries = new Map<string, InFlightEntry>();
const gitCache = new Map<string, { value: string; timestamp: number }>();

export function clearGitCache() {
  gitCache.clear();
}

export async function execGit(args: string[], cwd: string, signal?: AbortSignal): Promise<string> {
  const cacheKey = cwd + '::' + args.join(' ');
  
  // Check cache first
  if (gitCache.has(cacheKey)) {
    return gitCache.get(cacheKey)!.value;
  }
  
  if (signal?.aborted) {
    throw new Error('ABORTED');
  }
  
  let entry = inFlightEntries.get(cacheKey);
  
  if (!entry) {
    const controller = new AbortController();
    const promise = execGitInternal(args, cwd, controller.signal);
    entry = {
      promise,
      signals: new Set<AbortSignal>(),
      controller,
      nonAbortableCount: 0
    };
    inFlightEntries.set(cacheKey, entry);
    
    promise.then(result => {
      gitCache.set(cacheKey, { value: result, timestamp: Date.now() });
    }).catch(() => {
      // Don't cache errors
    }).finally(() => {
      inFlightEntries.delete(cacheKey);
    });
  }
  
  if (signal) {
    entry.signals.add(signal);
  } else {
    entry.nonAbortableCount++;
  }
  
  const currentEntry = entry; // capture local reference
  
  return new Promise<string>((resolve, reject) => {
    const onAbort = () => {
      if (signal) {
        currentEntry.signals.delete(signal);
        // If no other signals or non-abortable callers are waiting, abort the child process
        if (currentEntry.signals.size === 0 && currentEntry.nonAbortableCount === 0) {
          currentEntry.controller.abort();
        }
      }
      reject(new Error('ABORTED'));
    };
    
    if (signal?.aborted) {
      return onAbort();
    }
    
    if (signal) {
      signal.addEventListener('abort', onAbort);
    }
    
    currentEntry.promise.then(
      res => {
        if (signal) {
          signal.removeEventListener('abort', onAbort);
          currentEntry.signals.delete(signal);
        }
        resolve(res);
      },
      err => {
        if (signal) {
          signal.removeEventListener('abort', onAbort);
          currentEntry.signals.delete(signal);
        }
        if (err.message === 'ABORTED' || err.name === 'AbortError') {
          reject(new Error('ABORTED'));
        } else {
          reject(err);
        }
      }
    );
  });
}

async function execGitInternal(args: string[], cwd: string, signal?: AbortSignal): Promise<string> {
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

export async function getAuthors(cwd: string, signal?: AbortSignal): Promise<string[]> {
  try {
    const output = await execGit(['log', '--all', '-n', '10000', '--pretty=format:%an'], cwd, signal);
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
    let untilVal = filters.until;
    if (/^\d{4}-\d{2}-\d{2}$/.test(untilVal)) {
      untilVal += ' 23:59:59';
    }
    args.push(`--until=${untilVal}`);
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

export async function hasLocalModifications(
  cwd: string,
  filePath: string,
  startLine: number,
  endLine: number
): Promise<boolean> {
  try {
    let gitRoot = cwd;
    try {
      gitRoot = (await execGit(['rev-parse', '--show-toplevel'], cwd)).trim();
    } catch (e) {
      // Ignore
    }
    const repoFilePath = path.relative(gitRoot, filePath).replace(/\\/g, '/');
    const diffOutput = await execGit(['diff', '-U0', 'HEAD', '--', repoFilePath], gitRoot);
    if (!diffOutput.trim()) {
      return false;
    }
    
    const lines = diffOutput.split('\n');
    for (const line of lines) {
      const match = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
      if (match) {
        const newStart = parseInt(match[3], 10);
        const newLength = match[4] !== undefined ? parseInt(match[4], 10) : 1;
        
        let isOverlap = false;
        if (newLength > 0) {
          isOverlap = newStart <= endLine && (newStart + newLength - 1) >= startLine;
        } else {
          isOverlap = newStart >= startLine - 1 && newStart <= endLine;
        }
        
        if (isOverlap) {
          return true;
        }
      }
    }
    return false;
  } catch (e) {
    console.error('Error checking local modifications:', e);
    return false;
  }
}

export async function traceLineHistory(
  cwd: string,
  filePath: string,
  startLine: number,
  endLine: number,
  startRef?: string,
  signal?: AbortSignal
): Promise<CommitDiff[]> {
  let gitRoot = cwd;
  try {
    gitRoot = (await execGit(['rev-parse', '--show-toplevel'], cwd)).trim();
  } catch (e) {
    // Ignore
  }

  const repoFilePath = path.relative(gitRoot, filePath).replace(/\\/g, '/');

  let mappedStart = startLine;
  let mappedEnd = endLine;

  // Map working tree line numbers to HEAD line numbers if tracing from working tree
  if (!startRef) {
    try {
      const diffOutput = await execGit(['diff', '-U0', 'HEAD', '--', repoFilePath], gitRoot, signal);
      if (diffOutput.trim()) {
        const lines = diffOutput.split('\n');
        interface Hunk { oldStart: number; oldLength: number; newStart: number; newLength: number; }
        const hunks: Hunk[] = [];
        
        for (const line of lines) {
          const match = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
          if (match) {
            hunks.push({
              oldStart: parseInt(match[1], 10),
              oldLength: match[2] !== undefined ? parseInt(match[2], 10) : 1,
              newStart: parseInt(match[3], 10),
              newLength: match[4] !== undefined ? parseInt(match[4], 10) : 1
            });
          }
        }

        const mapLine = (line: number, hunks: Hunk[], isEnd: boolean): number => {
          let offset = 0;
          for (const hunk of hunks) {
            const newEnd = hunk.newStart + hunk.newLength - 1;
            if (line < hunk.newStart) {
              return line - offset;
            }
            if (line <= newEnd) {
              return isEnd 
                ? Math.max(1, hunk.oldStart + hunk.oldLength - 1)
                : Math.max(1, hunk.oldStart);
            }
            offset += (hunk.newLength - hunk.oldLength);
          }
          return line - offset;
        };

        mappedStart = Math.max(1, mapLine(startLine, hunks, false));
        mappedEnd = Math.max(1, mapLine(endLine, hunks, true));
      }
    } catch (e) {
      console.warn('Error adjusting for local diffs:', e);
    }
  }

  // If mappedStart > mappedEnd, it means the selected range consists entirely of newly inserted lines
  // that do not exist in HEAD at all. History is empty.
  if (mappedStart > mappedEnd) {
    return [];
  }

  const args = ['log'];
  if (startRef) {
    args.push(startRef);
  }
  args.push(
    `-L`,
    `${mappedStart},${mappedEnd}:${repoFilePath}`,
    '--date=raw',
    '--pretty=format:COMMIT_START_LOOK%x1f%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%s'
  );

  try {
    const output = await execGit(args, gitRoot, signal);
    const lines = output.split('\n');
    const commits: CommitDiff[] = [];
    let currentCommit: CommitDiff | null = null;

    let seenDiffHeader = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith('COMMIT_START_LOOK\x1f')) {
        if (currentCommit) {
          commits.push(currentCommit);
        }
        seenDiffHeader = false;
        const parts = line.substring('COMMIT_START_LOOK\x1f'.length).split('\x1f');
        const hash = parts[0];
        const parentsStr = parts[1] || '';
        const author = parts[2];
        const email = parts[3];
        const timestamp = parseInt(parts[4], 10);
        const message = parts.slice(5).join('\x1f');

        const parents = parentsStr.split(' ').filter(p => p.trim().length > 0);
        const parentHash = parents[0] || 'empty';

        currentCommit = {
          hash,
          parentHash,
          parents,
          author,
          email,
          timestamp,
          message,
          diffLines: []
        };
      } else if (currentCommit) {
        // Track when we enter the diff section (skip diff metadata headers)
        if (line.startsWith('diff --git')) {
          seenDiffHeader = true;
          const match = line.match(/^diff --git a\/(.+) b\/(.+)$/);
          if (match) {
            currentCommit.oldFilePath = match[1];
            currentCommit.newFilePath = match[2];
          }
          continue;
        }
        if (line.startsWith('@@ ')) {
          const match = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
          if (match) {
            currentCommit.lineRange = {
              oldStart: parseInt(match[1], 10),
              oldLength: match[2] !== undefined ? parseInt(match[2], 10) : 1,
              newStart: parseInt(match[3], 10),
              newLength: match[4] !== undefined ? parseInt(match[4], 10) : 1
            };
          }
          continue;
        }
        if (
          line.startsWith('---') ||
          line.startsWith('+++') ||
          line.startsWith('index ')
        ) {
          continue;
        }

        // Skip lines before the diff header (blank lines between format output and diff)
        if (!seenDiffHeader) {
          continue;
        }

        // Skip '\ No newline at end of file' marker
        if (line.startsWith('\\')) {
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

    // Resolve correct parent hash for merge commits asynchronously
    for (const commit of commits) {
      if (commit.parents && commit.parents.length > 1) {
        for (const parent of commit.parents) {
          try {
            const diffOutput = await execGit(['diff', '--name-only', parent, commit.hash, '--', repoFilePath], gitRoot);
            if (diffOutput.trim()) {
              commit.parentHash = parent;
              break;
            }
          } catch (e) {
            // ignore
          }
        }
      }
    }

    // Filter out commits where the tracked line range has only whitespace/indentation changes.
    // This matches VS Code's built-in diff highlighting: VS Code ignores whitespace
    // differences, so commits that only changed indentation show zero highlights.
    // We normalize each line (trim + collapse internal whitespace) and compare
    // deleted vs added lines to determine if there are real content changes.
    const normalize = (text: string) => text.trim().replace(/\s+/g, ' ');
    return commits.filter(c => {
      const added = c.diffLines.filter(l => l.type === 'added');
      const deleted = c.diffLines.filter(l => l.type === 'deleted');

      // If only additions or only deletions exist, it's a real change
      if (added.length === 0 && deleted.length === 0) {
        return false;
      }
      if (added.length !== deleted.length) {
        return true;
      }

      // Same number of added/deleted lines — compare each pair ignoring whitespace
      for (let i = 0; i < added.length; i++) {
        if (normalize(deleted[i].text) !== normalize(added[i].text)) {
          return true; // Found a real content change
        }
      }
      return false; // All lines differ only in whitespace
    });
  } catch (e: any) {
    if (e.message === 'ABORTED') {
      throw e;
    }
    console.error('Error tracing line history:', e);
    throw e;
  }
}

export async function getCodeStats(
  cwd: string,
  filters: GitFilters,
  signal?: AbortSignal
): Promise<CodeStats> {
  // Default time window: last 100 days if no date range specified
  const effectiveSince = filters.since || (() => {
    const d = new Date();
    d.setDate(d.getDate() - 100);
    return d.toISOString().split('T')[0];
  })();
  const effectiveUntil = filters.until || new Date().toISOString().split('T')[0];
  let effectiveUntilVal = effectiveUntil;
  if (/^\d{4}-\d{2}-\d{2}$/.test(effectiveUntilVal)) {
    effectiveUntilVal += ' 23:59:59';
  }

  const args = ['log', '--no-merges', '--numstat', '--no-renames',
    '--pretty=format:COMMIT_STAT|%H|%an|%ae|%at'];

  if (filters.branch) {
    args.push(filters.branch);
  } else {
    args.push('--all');
  }
  if (filters.author) {
    args.push(`--author=${filters.author}`);
  }
  args.push(`--since=${effectiveSince}`, `--until=${effectiveUntilVal}`);

  let output: string;
  try {
    output = await execGit(args, cwd, signal);
  } catch (e: any) {
    if (e.message === 'ABORTED') { throw e; }
    console.error('Error running git log for getCodeStats:', e);
    throw e;
  }

  try {
    const lines = output.split('\n');

    const authorMap = new Map<string, {
      email: string;
      commits: number;
      additions: number;
      deletions: number;
      weekdays: number[];
      fileMap: Map<string, number>;
    }>();
    const dailyMap = new Map<string, number>();
    const fileMap = new Map<string, number>();

    let currentAuthor = '';
    let currentEmail = '';
    let currentTs = 0;

    for (const line of lines) {
      if (line.startsWith('COMMIT_STAT|')) {
        const parts = line.split('|');
        currentAuthor = parts[2];
        currentEmail = parts[3];
        currentTs = parseInt(parts[4], 10);

        if (!authorMap.has(currentAuthor)) {
          authorMap.set(currentAuthor, {
            email: currentEmail,
            commits: 0,
            additions: 0,
            deletions: 0,
            weekdays: [0, 0, 0, 0, 0, 0, 0],
            fileMap: new Map()
          });
        }
        const entry = authorMap.get(currentAuthor)!;
        entry.commits++;

        const d = new Date(currentTs * 1000);
        entry.weekdays[d.getDay()]++;
        const dateStr = d.toISOString().split('T')[0];
        dailyMap.set(dateStr, (dailyMap.get(dateStr) || 0) + 1);

      } else if (line.trim() && currentAuthor) {
        const tabParts = line.split('\t');
        if (tabParts.length >= 3) {
          const adds = tabParts[0] === '-' ? 0 : (parseInt(tabParts[0], 10) || 0);
          const dels = tabParts[1] === '-' ? 0 : (parseInt(tabParts[1], 10) || 0);
          const filePath = tabParts[2];

          const entry = authorMap.get(currentAuthor)!;
          entry.additions += adds;
          entry.deletions += dels;

          if (filePath) {
            fileMap.set(filePath, (fileMap.get(filePath) || 0) + 1);
            entry.fileMap.set(filePath, (entry.fileMap.get(filePath) || 0) + 1);
          }
        }
      }
    }

    const contributors: ContributorStat[] = Array.from(authorMap.entries())
      .map(([author, s]) => ({
        author,
        email: s.email,
        commits: s.commits,
        additions: s.additions,
        deletions: s.deletions,
        totalChanged: s.additions + s.deletions,
        weekdayDistribution: s.weekdays,
        topFiles: Array.from(s.fileMap.entries())
          .map(([p, changes]) => ({ path: p, changes }))
          .sort((a, b) => b.changes - a.changes)
          .slice(0, 8)
      }))
      .sort((a, b) => b.totalChanged - a.totalChanged);

    const totalCommits = contributors.reduce((s, c) => s + c.commits, 0);
    const totalAdditions = contributors.reduce((s, c) => s + c.additions, 0);
    const totalDeletions = contributors.reduce((s, c) => s + c.deletions, 0);

    const dailyActivity: DailyActivity[] = [];
    const startD = new Date(effectiveSince + 'T00:00:00Z');
    const endD = new Date(effectiveUntil + 'T00:00:00Z');
    for (let d = new Date(startD); d <= endD; d.setUTCDate(d.getUTCDate() + 1)) {
      const dateStr = d.toISOString().split('T')[0];
      dailyActivity.push({ date: dateStr, count: dailyMap.get(dateStr) || 0 });
    }

    const topFiles: FileStat[] = Array.from(fileMap.entries())
      .map(([p, changes]) => ({ path: p, changes }))
      .sort((a, b) => b.changes - a.changes)
      .slice(0, 10);

    return {
      totalCommits,
      totalAdditions,
      totalDeletions,
      totalChanged: totalAdditions + totalDeletions,
      contributors,
      dailyActivity,
      topFiles,
      sinceDate: effectiveSince,
      untilDate: effectiveUntil
    };
  } catch (e: any) {
    console.error('Error parsing getCodeStats output:', e);
    throw e;
  }
}

export async function hasFileLocalModifications(
  cwd: string,
  filePath: string
): Promise<boolean> {
  try {
    let gitRoot = cwd;
    try {
      gitRoot = (await execGit(['rev-parse', '--show-toplevel'], cwd)).trim();
    } catch (e) {
      // Ignore
    }
    const repoFilePath = path.relative(gitRoot, filePath).replace(/\\/g, '/');
    const diffOutput = await execGit(['diff', 'HEAD', '--', repoFilePath], gitRoot);
    return diffOutput.trim().length > 0;
  } catch (e) {
    console.error('Error checking file local modifications:', e);
    return false;
  }
}

export async function traceFileHistory(
  cwd: string,
  filePath: string,
  startRef?: string,
  signal?: AbortSignal
): Promise<CommitDiff[]> {
  let gitRoot = cwd;
  try {
    gitRoot = (await execGit(['rev-parse', '--show-toplevel'], cwd)).trim();
  } catch (e) {
    // Ignore
  }

  const repoFilePath = path.relative(gitRoot, filePath).replace(/\\/g, '/');

  const args = [
    'log',
    '--follow',
    '--name-status',
    '--date=raw',
    '--pretty=format:COMMIT_START_LOOK%x1f%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%s'
  ];
  if (startRef) {
    args.push(startRef);
  }
  args.push('--', repoFilePath);

  try {
    const output = await execGit(args, gitRoot, signal);
    const lines = output.split('\n');
    const commits: CommitDiff[] = [];
    let currentCommit: CommitDiff | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
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

        const parents = parentsStr.split(' ').filter(p => p.trim().length > 0);
        const parentHash = parents[0] || 'empty';

        currentCommit = {
          hash,
          parentHash,
          parents,
          author,
          email,
          timestamp,
          message,
          diffLines: [],
          oldFilePath: repoFilePath,
          newFilePath: repoFilePath
        };
      } else if (currentCommit && line) {
        // Parse the status line
        // Typically it is "M\tfilepath" or "R100\toldpath\tnewpath" or "A\tfilepath"
        const parts = line.split('\t');
        if (parts.length >= 2) {
          const status = parts[0];
          if (status.startsWith('R')) {
            // Rename: R100 \t oldpath \t newpath
            currentCommit.oldFilePath = parts[1];
            currentCommit.newFilePath = parts[2];
          } else {
            currentCommit.oldFilePath = parts[1];
            currentCommit.newFilePath = parts[1];
          }
        }
      }
    }

    if (currentCommit) {
      commits.push(currentCommit);
    }
    return commits;
  } catch (err) {
    console.error('Error tracing file history:', err);
    return [];
  }
}

export interface GitUser {
  name?: string;
  email?: string;
}

export async function getCurrentGitUser(gitRoot: string, signal?: AbortSignal): Promise<GitUser> {
  try {
    const [name, email] = await Promise.all([
      execGit(['config', 'user.name'], gitRoot, signal).then(s => s.trim()).catch(() => ''),
      execGit(['config', 'user.email'], gitRoot, signal).then(s => s.trim()).catch(() => '')
    ]);
    return {
      name: name || undefined,
      email: email || undefined
    };
  } catch (e) {
    console.error('Error getting current git user:', e);
    return {};
  }
}

export interface FileLastCommit {
  hash: string;
  author: string;
  email: string;
  timestamp: number;
  message: string;
}

export async function getFileLastCommit(
  gitRoot: string,
  repoFilePath: string,
  signal?: AbortSignal
): Promise<FileLastCommit | undefined> {
  try {
    const output = await execGit(
      ['log', '-1', '--follow', '--pretty=format:%H%x1f%aN%x1f%aE%x1f%at%x1f%s', '--', repoFilePath],
      gitRoot,
      signal
    );
    const trimmed = output.trim();
    if (!trimmed) {
      return undefined;
    }
    const parts = trimmed.split('\x1f');
    if (parts.length < 5) {
      return undefined;
    }
    const [hash, author, email, timestampStr, ...messageParts] = parts;
    return {
      hash,
      author,
      email,
      timestamp: parseInt(timestampStr, 10) || 0,
      message: messageParts.join('\x1f')
    };
  } catch (e) {
    console.error('Error getting file last commit:', e);
    return undefined;
  }
}

export interface FileAuthor {
  name: string;
  email: string;
}

const NOT_COMMITTED_EMAIL = 'not.committed.yet';

export async function getFileAuthors(
  gitRoot: string,
  repoFilePath: string,
  signal?: AbortSignal
): Promise<FileAuthor[]> {
  try {
    // Use git blame --porcelain so the author set matches the line blame view exactly.
    const output = await execGit(['blame', '--porcelain', repoFilePath], gitRoot, signal);
    const authorsByEmail = new Map<string, FileAuthor>();
    const lines = output.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith('author ')) {
        const name = line.substring(7).trim();
        const nextLine = lines[i + 1] || '';
        let email = '';
        if (nextLine.startsWith('author-mail ')) {
          email = nextLine.substring(12).trim();
          if (email.startsWith('<') && email.endsWith('>')) {
            email = email.slice(1, -1);
          }
        }
        if (email && email !== NOT_COMMITTED_EMAIL) {
          authorsByEmail.set(email.toLowerCase(), { name: name || 'Unknown', email: email.toLowerCase() });
        }
      }
    }

    return Array.from(authorsByEmail.values());
  } catch (e) {
    console.error('Error getting file authors:', e);
    return [];
  }
}

export async function isFileTracked(
  gitRoot: string,
  repoFilePath: string,
  signal?: AbortSignal
): Promise<boolean> {
  try {
    const output = await execGit(['ls-files', '--', repoFilePath], gitRoot, signal);
    return output.trim().length > 0;
  } catch (e) {
    console.error('Error checking if file is tracked:', e);
    return false;
  }
}


