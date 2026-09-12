import {build} from 'esbuild';
import {mkdir,copyFile,readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const rewriteTsToMjs = {
  name: 'rewrite-ts-to-mjs',
  setup(b) {
    b.onResolve({ filter: /\.(ts|tsx)$/ }, args => {
      if (args.kind === 'entry-point') return;
      const rel = args.path.replace(/\.ts$/, '.mjs');
      return { path: rel, external: true };
    });
  }
};

await build({
  entryPoints: [root + 'packages/core/market.ts'],
  outfile: root + 'packages/core/market.mjs',
  bundle: true,
  plugins: [rewriteTsToMjs],
  format: 'esm',
  target: 'es2022'
});

await build({
  entryPoints: [root + 'packages/arc/abi.ts'],
  outfile: root + 'packages/arc/abi.mjs',
  bundle: true,
  plugins: [rewriteTsToMjs],
  format: 'esm',
  target: 'es2022'
});

await build({
  entryPoints: [root + 'packages/arc/client.ts'],
  outfile: root + 'packages/arc/client.mjs',
  bundle: true,
  plugins: [rewriteTsToMjs],
  format: 'esm',
  target: 'es2022'
});

await build({
  entryPoints: [root + 'packages/graph/index.ts'],
  outfile: root + 'packages/graph/index.mjs',
  bundle: true,
  packages: 'external',
  plugins: [rewriteTsToMjs],
  format: 'esm',
  target: 'es2022'
});

await build({
  entryPoints: [root + 'packages/cre/policy.ts'],
  outfile: root + 'packages/cre/policy.mjs',
  bundle: true,
  packages: 'external',
  plugins: [rewriteTsToMjs],
  format: 'esm',
  target: 'es2022'
});

await build({
  entryPoints: [root + 'packages/cre/index.ts'],
  outfile: root + 'packages/cre/index.mjs',
  bundle: true,
  packages: 'external',
  plugins: [rewriteTsToMjs],
  format: 'esm',
  target: 'es2022'
});

await build({
  entryPoints: [root + 'services/cre-bridge/gateway.ts'],
  outfile: root + 'services/cre-bridge/gateway.mjs',
  bundle: true,
  packages: 'external',
  plugins: [rewriteTsToMjs],
  format: 'esm',
  target: 'es2022'
});

await build({
  entryPoints: [root + 'services/cre-bridge/server.ts'],
  outfile: root + 'services/cre-bridge/server.mjs',
  bundle: true,
  packages: 'external',
  plugins: [rewriteTsToMjs],
  format: 'esm',
  target: 'es2022'
});

await build({
  entryPoints: [root + 'apps/web/server.ts'],
  outfile: root + 'apps/web/server.mjs',
  bundle: true,
  packages: 'external',
  plugins: [rewriteTsToMjs],
  format: 'esm',
  target: 'es2022'
});

await mkdir(root+'apps/web/public/assets',{recursive:true});
await build({entryPoints:[root+'apps/web/src/main.tsx'],outfile:root+'apps/web/public/assets/app.js',bundle:true,minify:true,sourcemap:false,jsx:'automatic',target:'es2022',define:{'process.env.NODE_ENV':'"production"'},legalComments:'eof'});
await copyFile(root+'apps/web/src/styles.css',root+'apps/web/public/assets/app.css');
const css=await readFile(root+'apps/web/public/assets/app.css','utf8'),js=await readFile(root+'apps/web/public/assets/app.js','utf8'),template=await readFile(root+'apps/web/public/index.html','utf8');
const font=await readFile(root+'apps/web/public/assets/thelema-sans.woff');
const inlineCss=css.replaceAll('./thelema-sans.woff',`data:font/woff;base64,${font.toString('base64')}`);
const safeJS=js.replaceAll('</script','<\\/script');
// Callback replacements avoid interpreting dollar patterns inside bundled JavaScript.
// Inline scripts do not honor defer, so bootstrap only after the root element exists.
const preview=template.replace('<link rel="stylesheet" href="/assets/app.css">',()=>`<style>${inlineCss}</style>`)
 .replace('<script src="/assets/app.js" defer></script>',()=>`<script>window.__THELEMA_PREVIEW__=true;document.addEventListener('DOMContentLoaded',function(){\n${safeJS}\n});</script>`)
 .replace('href="/assets/favicon.svg"','href="data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 64 64\'%3E%3Crect width=\'64\' height=\'64\' rx=\'12\' fill=\'%23171717\'/%3E%3Cpath d=\'M16 18h32M32 18v30M20 30l12 12 12-12\' stroke=\'white\' stroke-width=\'4\' fill=\'none\'/%3E%3C/svg%3E"');
await writeFile(root+'THELEMA-preview.html',preview);
console.log('Built browser assets and an explicitly local, self-contained THELEMA-preview.html');
