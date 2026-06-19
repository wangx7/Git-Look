const cp = require('child_process');
const path = require('path');
const absPath = path.resolve('package.json');
try {
  const output = cp.execSync(`git log -L 1,5:${absPath} -w --date=raw --pretty=format:COMMIT_START_LOOK`).toString();
  console.log("Success, output length:", output.length);
} catch (e) {
  console.log("Error:", e.message);
}
