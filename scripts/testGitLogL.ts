import * as cp from 'child_process';
const git = 'git';
const file = 'yylargescreen/src/App.vue';
cp.execFile(git, ['log', '-L', `1,10:${file}`, '-n', '2', '--patch'], { cwd: '/Users/wx/Documents/code/smart_community_h5' }, (error, stdout, stderr) => {
  console.log(stdout);
});
