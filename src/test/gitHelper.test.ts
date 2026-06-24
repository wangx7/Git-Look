import { execGitBuffer, isGitRepository, getBranches } from '../gitHelper';
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
});
