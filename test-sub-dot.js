const cp = require('child_process');
const fs = require('fs');

if (!fs.existsSync('sub')) fs.mkdirSync('sub');
fs.writeFileSync('sub/test.txt', 'hello-dot');

try {
  cp.execSync('git add sub/test.txt');
  cp.execSync('git commit -m "add test.txt for dot test"');
  
  const commitHash = cp.execSync('git rev-parse HEAD').toString().trim();
  
  // Try git show with ./ prefix inside the subdirectory
  const output = cp.execSync(`git show ${commitHash}:./test.txt`, { cwd: 'sub' }).toString();
  console.log("Success! Output:", output);
} catch (e) {
  console.log("Failed! Error:", e.message);
} finally {
  try {
    cp.execSync('git reset HEAD~1');
    fs.unlinkSync('sub/test.txt');
    fs.rmdirSync('sub');
  } catch (cleanError) {}
}
