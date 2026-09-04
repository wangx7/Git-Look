import * as cp from 'child_process';
import * as vscode from 'vscode';
import { LRUCache } from '../utils/lruCache';

let gitPathCache: string | undefined = undefined;

export async function getGitPath(): Promise<string> {
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

/** 全局静默截止时间戳，git stash create 会短暂修改 .git/index 触发监听，此时间前跳过自动刷新 */
export let watchRefreshSilentUntil = 0;

/** 调用 git stash create 前设置，防止触发不必要的面板刷新 */
export function suppressWatchRefresh(ms = 2000) {
  watchRefreshSilentUntil = Date.now() + ms;
}

/** 检查是否应该跳过当前的 watch 刷新 */
export function shouldSkipWatchRefresh(): boolean {
  return Date.now() < watchRefreshSilentUntil;
}

interface InFlightEntry {
  promise: Promise<string>;
  signals: Set<AbortSignal>;
  controller: AbortController;
  nonAbortableCount: number;
}

/** 缓存有效期：30 秒。保证外部 git 操作（如命令行 commit、fetch）在合理时间内反映到 UI。 */
const CACHE_TTL_MS = 30 * 1000;

const inFlightEntries = new Map<string, InFlightEntry>();
const gitCache = new LRUCache<string, string>({
  capacity: 500,
  defaultTtlMs: CACHE_TTL_MS
});

export function clearGitCache() {
  gitCache.clear();
}

export async function execGit(args: string[], cwd: string, signal?: AbortSignal): Promise<string> {
  // Deterministic serialization to prevent collision on arguments containing spaces
  const cacheKey = LRUCache.serializeKey([cwd, args]);

  // Check cache first (O(1) with automatic TTL check and MRU promotion)
  const cached = gitCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
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
      gitCache.set(cacheKey, result);
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

/**
 * Stream lines from a Git command stdout using child_process.spawn.
 * Eliminates maxBuffer memory overflow for large repository history or diffs.
 * If onLine returns false, the process is killed early and the stream terminates cleanly.
 */
export async function execGitStream(
  args: string[],
  cwd: string,
  onLine: (line: string) => void | boolean,
  signal?: AbortSignal
): Promise<void> {
  const git = await getGitPath();
  const fullArgs = ['-c', 'core.quotepath=false', ...args];

  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      return reject(new Error('ABORTED'));
    }

    const child = cp.spawn(git, fullArgs, { cwd });

    let stderr = '';
    let buffer = '';
    let isTerminated = false;

    const onAbort = () => {
      isTerminated = true;
      try { child.kill(); } catch { /* ignore */ }
      reject(new Error('ABORTED'));
    };

    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }

    child.stdout.on('data', (chunk: Buffer) => {
      if (isTerminated) return;
      buffer += chunk.toString('utf8');
      let idx: number;
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.substring(0, idx);
        buffer = buffer.substring(idx + 1);
        const shouldStop = onLine(line);
        if (shouldStop === false) {
          isTerminated = true;
          try { child.kill(); } catch { /* ignore */ }
          if (signal) signal.removeEventListener('abort', onAbort);
          resolve();
          return;
        }
      }
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', (err) => {
      if (signal) signal.removeEventListener('abort', onAbort);
      if (!isTerminated) reject(err);
    });

    child.on('close', (code) => {
      if (signal) signal.removeEventListener('abort', onAbort);
      if (isTerminated) return;
      if (code === 0) {
        if (buffer.length > 0) {
          onLine(buffer);
        }
        resolve();
      } else {
        reject(new Error(stderr || `Git process exited with code ${code}`));
      }
    });
  });
}
