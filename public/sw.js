/*
 * 练迹 PWA Service Worker。
 *
 * 目标很克制：让安装后的 PWA 断网也能冷启动，而不是做完整的离线队列。
 * - 应用外壳（/ 与 /index.html）在 install 时预缓存；
 * - 其余同源静态资源运行时缓存（缓存优先，命中后直接用）；
 * - 导航请求网络优先，断网回退到外壳。
 *
 * 原生 App 不注册这个 SW：assets 已在 APK 内，缓存反而可能让版本落后。
 */
const VERSION = 'v1';
const CACHE = `lianji-shell-${VERSION}`;
const SHELL = ['/', '/index.html'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll(SHELL);
      /*
       * 把 index.html 里引用的入口 JS/CSS 一起预缓存。
       * 只缓存外壳不够：首次访问时页面还没被 SW 接管，
       * 入口资源不会经过 fetch 事件，断网刷新就会白屏。
       */
      try {
        const res = await fetch('/index.html', { cache: 'reload' });
        const html = await res.text();
        const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
        if (assets.length) await cache.addAll([...new Set(assets)]);
      } catch {
        /* 预缓存入口失败时仍保留外壳缓存 */
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match('/index.html')));
    return;
  }

  event.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      });
    }),
  );
});
