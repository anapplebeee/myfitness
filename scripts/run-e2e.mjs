/** 在同一Node进程管理预览服务，避免Windows进程树taskkill阻塞测试退出。 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { build, preview } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
function run(file, args, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [file, ...args], { cwd: root, env, stdio: 'inherit', windowsHide: true });
    child.on('error', reject);
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

let server;
try {
  const types = await run(fileURLToPath(new URL('../node_modules/vue-tsc/bin/vue-tsc.js', import.meta.url)), ['--noEmit']);
  if (types !== 0) process.exitCode = types;
  else {
    await build({ root });
    server = await preview({ root, preview: { host: '127.0.0.1', port: 4173, strictPort: true } });
    process.exitCode = await run(fileURLToPath(new URL('../node_modules/playwright/cli.js', import.meta.url)),
      ['test', ...process.argv.slice(2)], { ...process.env, E2E_MANAGED_SERVER: '1' });
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  if (server) {
    server.httpServer.closeAllConnections();
    await new Promise((resolve, reject) => server.httpServer.close((error) => error ? reject(error) : resolve()));
  }
}
