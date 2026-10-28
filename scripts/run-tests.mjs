/**
 * 测试入口：把 Vitest 的临时目录固定到项目内。
 *
 * Vitest 会 `join(tmpdir(), nanoid())` 建一个运行期临时目录，
 * 用来缓存 SSR 转换结果。当前执行环境的 fs 代理对系统临时目录的写入
 * 偶发 EPERM（实测约每 2–3 次一次），表现为"全部用例通过但 Errors 1"，
 * 直接卡住发布门禁。把 TEMP/TMP/TMPDIR 指到项目内的 .tmp 即可规避，
 * 且不影响任何测试语义。
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const tmp = join(root, '.tmp');
mkdirSync(tmp, { recursive: true });

const env = { ...process.env, TEMP: tmp, TMP: tmp, TMPDIR: tmp };
const args = process.argv.slice(2);
const res = spawnSync(
  process.execPath,
  [join(root, 'node_modules', 'vitest', 'vitest.mjs'), 'run', ...args],
  { stdio: 'inherit', env, cwd: root },
);
process.exit(res.status ?? 1);
