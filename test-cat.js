const cp = require('child_process');
const fs = require('fs');

if (!fs.existsSync('sub')) fs.mkdirSync('sub');
fs.writeFileSync('sub/test.txt', 'hello-cat');

try {
  cp.execSync('git add sub/test.txt');
  cp.execSync('git commit -m "add test.txt for cat test"');
  
  const commitHash = cp.execSync('git rev-parse HEAD').toString().trim();
  
  // Try git cat-file relative to Git Root inside the subdirectory
  cp.execSync(`git cat-file -e ${commitHash}:sub/test.txt`, { cwd: 'sub' });
  console.log("Success! Git Root relative path worked!");
  
  // Try git cat-file relative to subdirectory inside the subdirectory
  try {
    cp.execSync(`git cat-file -e ${commitHash}:test.txt`, { cwd: 'sub' });
    console.log("Subdirectory-relative path worked!");
  } catch (e) {
    console.log("Subdirectory-relative path failed!");
  }
} catch (e) {
  console.log("Failed! Error:", e.message);
} finally {
  try {
    cp.execSync('git reset HEAD~1');
    fs.unlinkSync('sub/test.txt');
    fs.rmdirSync('sub');
  } catch (cleanError) {}
}
