const cp = require('child_process');
try {
  const output = cp.execSync('git log -L 1,1:src/extension.ts -w --date=raw --pretty=format:COMMIT_START_LOOK%x1f%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%s').toString();
  console.log("Output excerpt:", output.substring(0, 1000));
} catch (e) {
  console.log(e.message);
}
