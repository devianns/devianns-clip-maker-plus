import { spawn } from 'node:child_process';
const children = [
  spawn(process.execPath, ['--experimental-strip-types', 'server/index.ts', '--dev'], {
    stdio: 'inherit',
  }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1'], {
    stdio: 'inherit',
  }),
];
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill();
}
for (const child of children)
  child.once('exit', (code) => {
    process.exitCode = code ?? 0;
    stop();
  });
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
