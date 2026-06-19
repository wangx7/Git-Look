const cp = require('child_process');
const output = cp.execSync("git log -L 10,15:src/extension.ts -w --date=raw --pretty=format:'COMMIT_START_LOOK%x1f%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%s'").toString();
const lines = output.split('\n');
let currentCommit = null;
const commits = [];
for (const line of lines) {
  if (line.startsWith('COMMIT_START_LOOK\x1f')) {
    if (currentCommit) commits.push(currentCommit);
    const parts = line.substring('COMMIT_START_LOOK\x1f'.length).split('\x1f');
    currentCommit = { hash: parts[0], parentHash: (parts[1] || '').split(' ')[0] || 'empty' };
  }
}
if (currentCommit) commits.push(currentCommit);
console.log(commits);
