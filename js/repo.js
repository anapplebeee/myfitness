/* repo.js —— 数据仓储层：可替换的存储适配器
 *
 *   local ：localStorage，双击 index.html 就能用
 *   http  ：自托管服务，GET/PUT {base}/state，数据落在服务器的 data/state.json
 *
 * 自动识别：从 http(s) 打开时先试同源 api/state，404 或不可达就静默回落本地。
 * 手动指定：URL 加 ?api=https://host/api ；?api=local 强制本地。
 */
(function () {
  const App = (window.App = window.App || {});
  const U = App.util;
  const STORE_KEY = 'tieguan.state.v1';
  const API_KEY = 'tieguan.api';
  const SAVE_DELAY = 300;

  const R = (App.repo = {
    base: '',
    mode: 'local',
    explicit: false,
    _timer: null,
    _pending: null,
    _lastError: '',
  });

  const trim = (s) => String(s || '').trim().replace(/\/+$/, '');

  /* 是否运行在 Capacitor 原生壳里（Android/iOS WebView） */
  R.isNative = function () {
    try {
      return !!(window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform());
    } catch (e) {
      return false;
    }
  };

  function sameOriginApi() {
    try {
      const u = new URL('api', location.href);
      return trim(u.href);
    } catch (e) {
      return '';
    }
  }

  R.configure = function () {
    let explicit = '';
    try {
      const q = new URLSearchParams(location.search).get('api');
      if (q) {
        if (q === 'local') localStorage.removeItem(API_KEY);
        else localStorage.setItem(API_KEY, trim(q));
      }
      explicit = localStorage.getItem(API_KEY) || '';
    } catch (e) {
      explicit = '';
    }
    if (!explicit && window.TIEGUAN_API) explicit = trim(window.TIEGUAN_API);

    if (explicit) {
      R.base = trim(explicit);
      R.explicit = true;
      R.mode = 'http';
      return R.mode;
    }
    /* 原生壳里同源地址是 https://localhost，没有 /api 可言，直接本地模式 */
    if (R.isNative()) {
      R.base = '';
      R.explicit = false;
      R.mode = 'local';
      return R.mode;
    }
    /* 从 http(s) 打开时先假设同源服务端存在；失败会静默回落本地 */
    if (typeof location !== 'undefined' && location.protocol && location.protocol.indexOf('http') === 0) {
      R.base = sameOriginApi();
      R.explicit = false;
      R.mode = 'http';
      return R.mode;
    }
    R.base = '';
    R.explicit = false;
    R.mode = 'local';
    return R.mode;
  };

  R.isRemote = () => R.mode === 'http';

  R.describe = function () {
    if (R.mode === 'http') return '自托管服务 · ' + R.base.replace(/\/api$/, '');
    return '本机浏览器存储';
  };

  function readLocal() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      console.warn('[铁馆] 本地数据解析失败', e);
      return null;
    }
  }

  function writeLocal(state) {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
      return true;
    } catch (e) {
      U.toast('本地存储写入失败（隐私模式或空间已满）', 'err');
      return false;
    }
  }

  /**
   * 读取状态。服务端不可用时会回落本地缓存；显式配置过地址才会弹提示。
   * @returns {Promise<object|null>}
   */
  R.load = async function () {
    R.configure();
    if (R.mode === 'local') return readLocal();
    try {
      const res = await fetch(R.base + '/state', { headers: { Accept: 'application/json' } });
      if (res.status === 404) {
        R.mode = 'local';
        R._lastError = '服务端尚无数据';
        return readLocal();
      }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      writeLocal(data);
      R._lastError = '';
      return data;
    } catch (e) {
      R._lastError = e.message || '连接失败';
      console.warn('[铁馆] 服务端读取失败，回落本地缓存', e);
      if (R.explicit) U.toast('服务端不可达，暂用本地缓存', 'err');
      R.mode = 'local';
      return readLocal();
    }
  };

  /* 本地模式同步写；HTTP 模式 300ms 去抖合并，先落本地再推服务端 */
  R.save = function (state) {
    if (R.mode === 'local') return writeLocal(state);

    R._pending = state;
    if (R._timer) return true;
    R._timer = setTimeout(async () => {
      R._timer = null;
      const payload = JSON.stringify(R._pending);
      writeLocal(R._pending);
      try {
        const res = await fetch(R.base + '/state', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        R._lastError = '';
      } catch (e) {
        R._lastError = e.message || '写入失败';
        U.toast('同步到服务端失败：' + R._lastError, 'err');
      }
    }, SAVE_DELAY);
    return true;
  };

  /* 页面隐藏 / 关闭前把待同步内容推上去 */
  R.flush = function () {
    if (R.mode !== 'http' || !R._pending) return;
    try {
      const body = new Blob([JSON.stringify(R._pending)], { type: 'application/json' });
      if (navigator.sendBeacon && navigator.sendBeacon(R.base + '/state', body)) return;
    } catch (e) {
      /* 落到下面的 fetch 兜底 */
    }
    fetch(R.base + '/state', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(R._pending),
      keepalive: true,
    }).catch(() => {});
  };
})();
