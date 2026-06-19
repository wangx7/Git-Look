const cp = require('child_process');
const fs = require('fs');

// Create a subdirectory
if (!fs.existsSync('sub')) fs.mkdirSync('sub');
fs.writeFileSync('sub/test.txt', 'hello');

try {
  // Commit it
  cp.execSync('git add sub/test.txt');
  const hash = cp.execSync('git commit -m "add test.txt"').toString().split('\n')[0];
  console.log("Committed. Hash is:", hash);
  
  // Get latest commit hash
  const commitHash = cp.execSync('git rev-parse HEAD').toString().trim();
  
  // Try git show relative to subdirectory, inside the subdirectory
  const output = cp.execSync(`git show ${commitHash}:test.txt`, { cwd: 'sub' }).toString();
  console.log("Success! Output:", output);
} catch (e) {
  console.log("Failed! Error:", e.message);
} finally {
  // Clean up
  try {
    cp.execSync('git reset HEAD~1');
    fs.unlinkSync('sub/test.txt');
    fs.rmdirSync('sub');
  } catch (cleanError) {}
}
