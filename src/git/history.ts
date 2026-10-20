import * as path from 'path';
import { execGit } from './exec';
import { CommitDiff, GitUser, FileLastCommit, FileAuthor } from './types';
import { splitMessage } from './message';

// The message (%B) may span several lines, so it is terminated by NUL, which git never allows inside a commit message.
const HISTORY_PRETTY_FORMAT = '--pretty=format:COMMIT_START_LOOK%x1f%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%B%x00';

/**
 * Splits `git log` output produced with HISTORY_PRETTY_FORMAT into commits plus the
 * lines git printed after each message (diff hunks for -L, name-status for --follow).
 */
function parseHistoryRecords(output: string): { commit: CommitDiff; lines: string[] }[] {
  return output.split(/^COMMIT_START_LOOK\x1f/m).slice(1).map(record => {
    const nul = record.indexOf('\x00');
    const headerEnd = nul === -1 ? record.length : nul;
    const parts = record.substring(0, headerEnd).split('\x1f');
    const parents = (parts[1] || '').split(' ').filter(p => p.trim().length > 0);
    const { subject, body } = splitMessage(parts.slice(5).join('\x1f'));

    return {
      commit: {
        hash: parts[0],
        parentHash: parents[0] || 'empty',
        parents,
        author: parts[2],
        email: parts[3],
        timestamp: parseInt(parts[4], 10),
        message: subject,
        body,
        diffLines: []
      },
      lines: record.substring(headerEnd + 1).split('\n')
    };
  });
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
    HISTORY_PRETTY_FORMAT
  );

  try {
    const output = await execGit(args, gitRoot, signal);
    const commits = parseHistoryRecords(output).map(({ commit, lines }) => {
      let seenDiffHeader = false;
      for (const line of lines) {
        // Track when we enter the diff section (skip diff metadata headers)
        if (line.startsWith('diff --git')) {
          seenDiffHeader = true;
          const match = line.match(/^diff --git a\/(.+) b\/(.+)$/);
          if (match) {
            commit.oldFilePath = match[1];
            commit.newFilePath = match[2];
          }
          continue;
        }
        if (line.startsWith('@@ ')) {
          const match = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
          if (match) {
            commit.lineRange = {
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
          commit.diffLines.push({ type: 'deleted', text: line.substring(1) });
        } else if (line.startsWith('+')) {
          commit.diffLines.push({ type: 'added', text: line.substring(1) });
        } else if (line.startsWith(' ') || line === '') {
          commit.diffLines.push({
            type: 'context',
            text: line.length > 0 ? line.substring(1) : ''
          });
        }
      }
      return commit;
    });

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
    HISTORY_PRETTY_FORMAT
  ];
  if (startRef) {
    args.push(startRef);
  }
  args.push('--', repoFilePath);

  try {
    const output = await execGit(args, gitRoot, signal);
    return parseHistoryRecords(output).map(({ commit, lines }) => {
      commit.oldFilePath = repoFilePath;
      commit.newFilePath = repoFilePath;
      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) {
          continue;
        }
        // Parse the status line
        // Typically it is "M\tfilepath" or "R100\toldpath\tnewpath" or "A\tfilepath"
        const parts = line.split('\t');
        if (parts.length >= 2) {
          const status = parts[0];
          if (status.startsWith('R')) {
            // Rename: R100 \t oldpath \t newpath
            commit.oldFilePath = parts[1];
            commit.newFilePath = parts[2];
          } else {
            commit.oldFilePath = parts[1];
            commit.newFilePath = parts[1];
          }
        }
      }
      return commit;
    });
  } catch (err) {
    console.error('Error tracing file history:', err);
    return [];
  }
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
  } catch (e: any) {
    if (e?.message !== 'ABORTED' && !signal?.aborted) {
      console.error('Error getting current git user:', e);
    }
    return {};
  }
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
  } catch (e: any) {
    if (e?.message !== 'ABORTED' && !signal?.aborted) {
      console.error('Error getting file last commit:', e);
    }
    return undefined;
  }
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
  } catch (e: any) {
    if (e?.message !== 'ABORTED' && !signal?.aborted) {
      console.error('Error getting file authors:', e);
    }
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
  } catch (e: any) {
    if (e?.message !== 'ABORTED' && !signal?.aborted) {
      console.error('Error checking if file is tracked:', e);
    }
    return false;
  }
}
