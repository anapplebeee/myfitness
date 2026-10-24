/* util.js —— 基础工具：日期、转义、DOM、Toast、模态框 */
(function () {
  const App = (window.App = window.App || {});
  const U = (App.util = {});

  const pad = (n) => String(n).padStart(2, '0');
  U.pad = pad;
  U.dateKey = (d = new Date()) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  U.parseKey = (s) => {
    const p = String(s).split('-').map(Number);
    return new Date(p[0], p[1] - 1, p[2]);
  };
  U.addDays = (d, n) => {
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    x.setDate(x.getDate() + n);
    return x;
  };
  U.diffDays = (a, b) => Math.round((U.parseKey(U.dateKey(a)) - U.parseKey(U.dateKey(b))) / 86400000);
  U.weekdayShort = (d) => ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
  U.monthDay = (d) => d.getMonth() + 1 + '/' + d.getDate();
  U.timeLabel = (d = new Date()) => pad(d.getHours()) + ':' + pad(d.getMinutes());
  U.uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
  U.clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  U.num = (v, fb = 0) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : fb;
  };
  U.round = (v, d = 0) => {
    const m = Math.pow(10, d);
    return Math.round(v * m) / m;
  };
  U.esc = (s) =>
    String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[c]);

  U.$ = (sel, root) => (root || document).querySelector(sel);
  U.$$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  U.toast = (msg, kind) => {
    const root = document.getElementById('toast-root');
    if (!root) return;
    const el = document.createElement('div');
    el.className = 'toast ' + (kind || '');
    el.textContent = msg;
    root.appendChild(el);
    setTimeout(() => {
      el.style.transition = 'opacity .25s, transform .25s';
      el.style.opacity = '0';
      el.style.transform = 'translateY(6px)';
      setTimeout(() => el.remove(), 260);
    }, kind === 'err' ? 3600 : 2200);
  };

  /* -------- 模态 / 底部抽屉 -------- */
  U.openSheet = (html, opts) => {
    opts = opts || {};
    const root = document.getElementById('modal-root');
    const wrap = document.createElement('div');
    wrap.className = 'sheet';
    wrap.innerHTML = '<div class="sheet-panel" role="dialog" aria-modal="true">' +
      '<div class="sheet-grip"></div>' + html + '</div>';
    root.appendChild(wrap);
    document.body.style.overflow = 'hidden';
    const close = () => {
      wrap.remove();
      if (!document.querySelector('.sheet')) document.body.style.overflow = '';
    };
    wrap.addEventListener('click', (e) => {
      if (e.target === wrap && opts.dismissible !== false) close();
    });
    wrap.__close = close;
    return { el: wrap, panel: wrap.querySelector('.sheet-panel'), close };
  };
  U.closeSheets = () => {
    U.$$('.sheet').forEach((s) => s.remove());
    document.body.style.overflow = '';
  };

  /* -------- 格式化 -------- */
  U.pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0);
  U.relativeDay = (key) => {
    const today = U.dateKey();
    const diff = U.diffDays(U.parseKey(key), U.parseKey(today));
    if (diff === 0) return '今天';
    if (diff === 1) return '明天';
    if (diff === -1) return '昨天';
    const d = U.parseKey(key);
    return U.monthDay(d) + ' 周' + U.weekdayShort(d);
  };
})();
