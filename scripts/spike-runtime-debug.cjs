/* Debug: fork the query runtime and print its stderr/stdout verbatim. */
const { app, utilityProcess } = require('electron');
const path = require('node:path');

app.whenReady().then(() => {
  const entry = path.join(__dirname, '..', '.vite', 'runtime', 'query-runtime.cjs');
  console.log('[debug] fork:', entry);
  const child = utilityProcess.fork(entry, [], { stdio: 'pipe' });
  child.stdout?.on('data', (d) => process.stdout.write(`[rt-out] ${d}`));
  child.stderr?.on('data', (d) => process.stdout.write(`[rt-err] ${d}`));
  child.on('spawn', () => {
    console.log('[debug] spawned pid', child.pid);
    child.postMessage({ id: 1, type: 'ping' });
  });
  child.on('message', (m) => console.log('[debug] message:', JSON.stringify(m)));
  child.on('exit', (code) => {
    console.log('[debug] exit code:', code);
    app.exit(code === 0 ? 0 : 1);
  });
  setTimeout(() => {
    console.log('[debug] timeout');
    child.kill();
    app.exit(2);
  }, 15000);
});
