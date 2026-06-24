import { execGitBuffer, isGitRepository, getBranches, traceFileHistory, hasFileLocalModifications } from '../gitHelper';
import * as cp from 'child_process';
import * as vscode from 'vscode';

jest.mock('child_process');
jest.mock('vscode', () => ({
  extensions: {
    getExtension: jest.fn()
  }
}), { virtual: true });

describe('gitHelper', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should verify if it is a git repo', async () => {
    (cp.execFile as any).mockImplementation((cmd: any, args: any, opts: any, cb: any) => {
      cb(null, 'true', '');
    });
    const isRepo = await isGitRepository('/mock/path');
    expect(isRepo).toBe(true);
  });

  it('should trace file history with rename support', async () => {
    const mockOutput = `COMMIT_START_LOOK\x1fhash1\x1fparent1\x1fAuthor Name\x1fauthor@example.com\x1f1624543200\x1fTest Commit Message\n` +
      `M\tsrc/webview/selectionHistory.ts\n` +
      `COMMIT_START_LOOK\x1fhash2\x1fparent2\x1fAuthor Name\x1fauthor@example.com\x1f1624540000\x1fRenamed file\n` +
      `R100\tsrc/webview/oldSelectionHistory.ts\tsrc/webview/selectionHistory.ts\n`;
    
    (cp.execFile as any).mockImplementation((cmd: any, args: any, opts: any, cb: any) => {
      cb(null, mockOutput, '');
    });
    
    const commits = await traceFileHistory('/mock/path', 'src/webview/selectionHistory.ts');
    expect(commits.length).toBe(2);
    expect(commits[0].hash).toBe('hash1');
    expect(commits[0].oldFilePath).toBe('src/webview/selectionHistory.ts');
    expect(commits[0].newFilePath).toBe('src/webview/selectionHistory.ts');
    
    expect(commits[1].hash).toBe('hash2');
    expect(commits[1].oldFilePath).toBe('src/webview/oldSelectionHistory.ts');
    expect(commits[1].newFilePath).toBe('src/webview/selectionHistory.ts');
  });

  it('should check if file has local modifications', async () => {
    (cp.execFile as any).mockImplementation((cmd: any, args: any, opts: any, cb: any) => {
      if (args.includes('rev-parse')) {
        cb(null, '/mock/path', '');
      } else {
        cb(null, 'diff content here', '');
      }
    });
    const hasMod = await hasFileLocalModifications('/mock/path', '/mock/path/file.txt');
    expect(hasMod).toBe(true);
  });
});
