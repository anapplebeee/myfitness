/**
 * 服务入口。
 *
 * 只做三件事：读配置、选存储、起 HTTP。
 * 任何一步失败都**非零退出**——尤其是台账校验失败（IntegrityError）：
 * 这时启动起来对外服务，等于让删除过的数据有机会被旧设备写回来。
 */
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { createCloudService } from './app.mjs';
import { logEvent } from './audit.mjs';
import { ConfigError, loadConfig } from './config.mjs';
import { createMailer } from './mailer.mjs';
import { IntegrityError, createFileStore } from './store/file.mjs';

/**
 * @param {{ env?: Record<string, string | undefined>, store?: any, mailer?: any, clock?: () => Date, quiet?: boolean }} [options]
 */
export async function startServer(options = {}) {
  const config = loadConfig(options.env ?? process.env);
  for (const warning of config.warnings) {
    logEvent({ event: 'config_warning', message: warning });
  }

  const store = options.store ?? (await createFileStore({ dir: config.dataDir }));
  const mailer = options.mailer ?? createMailer(config);
  const service = createCloudService({ config, store, mailer, clock: options.clock, quiet: options.quiet });

  const server = createServer((req, res) => {
    service.handler(req, res).catch((error) => {
      logEvent({ event: 'unhandled', error: String(error).slice(0, 200) });
      if (!res.writableEnded) res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end('{"error":{"code":"INTERNAL_ERROR"}}');
    });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.host, resolve);
  });

  const address = server.address();
  logEvent({
    event: 'server_started',
    host: config.host,
    port: typeof address === 'object' && address ? address.port : config.port,
    storage: store.kind,
    mailer: mailer.kind,
    env: config.nodeEnv,
  });

  return {
    server,
    config,
    store,
    mailer,
    service,
    async close() {
      await new Promise((resolve) => server.close(resolve));
      await store.close();
    },
  };
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  startServer().catch((error) => {
    logEvent({
      event: 'startup_failed',
      code: error instanceof ConfigError ? 'CONFIG_INVALID' : error instanceof IntegrityError ? error.code : 'STARTUP_FAILED',
      error: error instanceof Error ? error.message : String(error),
      ...(error?.details ? { details: error.details } : {}),
    });
    process.exit(1);
  });
}
