const esbuild = require("esbuild");

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

async function main() {
  const ctxExtension = await esbuild.context({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    format: 'cjs',
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: 'node',
    outfile: 'dist/extension.js',
    external: ['vscode'],
    logLevel: 'info',
  });

  const ctxWebview = await esbuild.context({
    entryPoints: ['src/webview/main.ts'],
    bundle: true,
    format: 'iife',
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: 'browser',
    outfile: 'media/panel.js',
    logLevel: 'info',
  });

  if (watch) {
    await Promise.all([ctxExtension.watch(), ctxWebview.watch()]);
    console.log('Watching for changes...');
  } else {
    await Promise.all([ctxExtension.rebuild(), ctxWebview.rebuild()]);
    await Promise.all([ctxExtension.dispose(), ctxWebview.dispose()]);
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
