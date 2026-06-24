import * as cp from 'child_process';
const git = 'git';
const hash = 'HEAD';
const file = 'src/extension.ts';
cp.execFile(git, ['cat-file', '-e', `${hash}:${file}`], (error, stdout, stderr) => {
  console.log('cat-file error:', error);
  console.log('cat-file stdout:', stdout);
});

const file2 = 'media/panel.html';
cp.execFile(git, ['cat-file', '-e', `${hash}:${file2}`], (error, stdout, stderr) => {
  console.log('cat-file2 error:', error);
  console.log('cat-file2 stdout:', stdout);
});
