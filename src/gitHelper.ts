/**
 * Git Look — Git Helper Façade
 *
 * Provides a unified API for Git operations across the extension.
 * Implementation is partitioned into focused submodules in `src/git/`:
 * - `types`: TypeScript interfaces for commits, diffs, stats, worktrees, etc.
 * - `exec`: Process execution (`execGit`, `execGitBuffer`, `execGitStream`), LRU caching, and in-flight deduplication
 * - `uri`: VS Code Git URI construction (`toGitUri`, `toWorkingTreeUri`)
 * - `repo`: Repository discovery, branches, authors, and worktrees
 * - `log`: Log arguments building and commit history retrieval
 * - `status`: Working tree status and modifications checking
 * - `history`: Line/file history tracing, blame annotations, and author metadata
 * - `stats`: Code and contributor statistics aggregation
 */

export * from './git/types';
export * from './git/exec';
export * from './git/uri';
export * from './git/repo';
export * from './git/log';
export * from './git/status';
export * from './git/history';
export * from './git/stats';
