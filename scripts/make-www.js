#!/usr/bin/env node
/* scripts/make-www.js —— 把「可直接双击打开」的源码目录，整理成 Capacitor 用的 www/
 *
 * 只拷前端运行时资产，不拷 server.js / sw.js / docs / data / node_modules。
 * 这样根目录仍然是"双击 index.html 就能用"的形态，www/ 只是打包产物。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'www');

const FILES = ['index.html', 'manifest.webmanifest'];
const DIRS = ['css', 'js', 'icons'];

function main() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  let count = 0;
  for (const f of FILES) {
    const src = path.join(ROOT, f);
    if (!fs.existsSync(src)) {
      console.warn('[www] 跳过缺失文件 ' + f);
      continue;
    }
    fs.copyFileSync(src, path.join(OUT, f));
    count++;
  }
  for (const d of DIRS) {
    const src = path.join(ROOT, d);
    if (!fs.existsSync(src)) {
      console.warn('[www] 跳过缺失目录 ' + d);
      continue;
    }
    fs.cpSync(src, path.join(OUT, d), { recursive: true });
    count++;
  }

  /* 校验：壳里必须能自己跑起来 */
  const need = ['index.html', 'js/app.js', 'js/core/schedule.js', 'js/repo.js', 'css/app.css', 'manifest.webmanifest'];
  const missing = need.filter((f) => !fs.existsSync(path.join(OUT, f)));
  const bytes = dirSize(OUT);
  console.log('[www] 产出 ' + count + ' 项，' + (bytes / 1024).toFixed(0) + ' KB → ' + path.relative(ROOT, OUT));
  if (missing.length) {
    console.error('[www] 缺少必需文件：' + missing.join(', '));
    process.exit(1);
  }
  console.log('[www] 校验通过');
}

function dirSize(p) {
  let total = 0;
  for (const e of fs.readdirSync(p, { withFileTypes: true })) {
    const fp = path.join(p, e.name);
    total += e.isDirectory() ? dirSize(fp) : fs.statSync(fp).size;
  }
  return total;
}

main();
