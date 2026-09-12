import { watch } from 'node:fs';
import { spawn } from 'node:child_process';

const preview = process.argv.includes('--preview');
let server;
let building = false;
let queued = false;
let timer;
let stopping = false;

async function rebuild() {
  if (building) { queued = true; return; }
  building = true;
  const build = spawn(process.execPath, ['scripts/build.mjs'], { stdio: 'inherit' });
  const success = await new Promise(resolve => build.once('exit', code => resolve(code === 0)));
  if (success && !stopping) {
    if (server) {
      const exited = new Promise(resolve => server.once('exit', resolve));
      server.kill('SIGTERM');
      await exited;
    }
    server = spawn(process.execPath, ['apps/web/server.mjs'], { stdio: 'inherit' });
    server.once('exit', () => { server = undefined; });
    console.log('Development build ready. Refresh the browser to see changes.');
  }
  building = false;
  if (queued && !stopping) { queued = false; await rebuild(); }
}

const watchers = ['apps/web', 'packages', 'services'].map(directory => watch(directory, { recursive: true }, (_, file) => {
  if (!file || /(^|\/)(node_modules|out|cache|dist|public)(\/|$)/.test(file) || !/\.(tsx?|css)$/.test(file)) return;
  clearTimeout(timer);
  timer = setTimeout(rebuild, 200);
}));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  stopping = true;
  clearTimeout(timer);
  watchers.forEach(watcher => watcher.close());
  server?.kill(signal);
});
await rebuild();
