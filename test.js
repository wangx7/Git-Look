const cp = require('child_process');
const output = cp.execSync('git log -L 1,5:package.json -w --date=raw --pretty=format:COMMIT_START_LOOK%x1f%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%s').toString();
const lines = output.split('\n');
let currentCommit = null;
const commits = [];
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  if (line.startsWith('COMMIT_START_LOOK\x1f')) {
    if (currentCommit) commits.push(currentCommit);
    const parts = line.substring('COMMIT_START_LOOK\x1f'.length).split('\x1f');
    currentCommit = {
      hash: parts[0],
      parentHash: (parts[1] || '').split(' ')[0] || 'empty',
      author: parts[2],
      message: parts.slice(5).join('\x1f'),
      diffLines: []
    };
  } else if (currentCommit) {
    if (line.startsWith('diff --git') || line.startsWith('---') || line.startsWith('+++') || line.startsWith('index ') || line.startsWith('@@ ')) continue;
    if (line.startsWith('-')) currentCommit.diffLines.push({ type: 'deleted', text: line.substring(1) });
    else if (line.startsWith('+')) currentCommit.diffLines.push({ type: 'added', text: line.substring(1) });
    else if (line.startsWith(' ') || line === '') currentCommit.diffLines.push({ type: 'context', text: line.length > 0 ? line.substring(1) : '' });
  }
}
if (currentCommit) commits.push(currentCommit);
console.log(JSON.stringify(commits, null, 2));
