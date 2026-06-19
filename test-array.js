const cp = require('child_process');
const path = require('path');
const absPath = path.resolve('package.json');
cp.execFile('git', [
  'log',
  '-L',
  `1,5:${absPath}`,
  '-w',
  '--date=raw',
  '--pretty=format:COMMIT_START_LOOK'
], (err, stdout, stderr) => {
  if (err) {
    console.log("Error:", err.message);
    console.log("Stderr:", stderr);
  } else {
    console.log("Success! Output length:", stdout.length);
  }
});
