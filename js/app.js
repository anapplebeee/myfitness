/* app.js —— 路由 / 顶栏 / 设置 / 首启引导 */
(function () {
  const App = window.App;
  const U = App.util;
  let current = 'today';

  /* 读显式配置的自托管地址（原生壳里改这个才能连自己的服务器） */
  function readApiBase() {
    try {
      return localStorage.getItem('tieguan.api') || '';
    } catch (e) {
      return '';
    }
  }

  App.go = function (tab) {
    if (!App.views[tab]) tab = 'today';
    current = tab;
    U.$$('.tab').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    window.scrollTo(0, 0);
    App.render();
  };

  App.render = function () {
    const view = document.getElementById('view');
    const st = App.store.get();
    const p = st.profile;

    const sub = App.engine.GOAL_LABEL[p.goal] + ' · ' + p.weeklyDays + ' 天/周 · ' + U.round(p.weight, 1) + ' kg';
    document.getElementById('topbar-sub').textContent = sub;
    document.getElementById('streak-chip').textContent = '连续 ' + App.store.streak() + ' 天';

    App.views[current].render(view);
  };

  /* ---------------- 设置 ---------------- */
  App.openSettings = function () {
    const st = App.store.get();
    const p = st.profile;
    const s = st.settings;
    const first = !st.onboarded;

    const seg = (name, opts, cur) =>
      '<div class="seg" data-seg="' + name + '">' +
        opts.map((o) => '<button data-v="' + o.v + '" class="' + (String(cur) === String(o.v) ? 'on' : '') + '">' + o.t + '</button>').join('') +
      '</div>';

    const sheet = U.openSheet(
      '<div class="sheet-title">' + (first ? '先填一下身体数据' : '设置') + '</div>' +
      '<div class="small muted" style="margin:6px 0 16px">' +
        (first ? '模型与本地引擎都靠这些数据算热量和训练结构，之后可随时改。' : '修改后点保存，计划会按新数据重新计算。') +
      '</div>' +

      '<div class="section-label" style="margin-top:0">身体资料</div>' +
      '<div class="field"><label>性别</label>' + seg('sex', [{ v: 'male', t: '男' }, { v: 'female', t: '女' }], p.sex) + '</div>' +
      '<div class="grid-2">' +
        '<div class="field"><label>年龄</label><input class="input" type="number" id="f-age" value="' + p.age + '" /></div>' +
        '<div class="field"><label>身高 cm</label><input class="input" type="number" id="f-height" value="' + p.height + '" /></div>' +
      '</div>' +
      '<div class="grid-2">' +
        '<div class="field"><label>当前体重 kg</label><input class="input" type="number" step="0.1" id="f-weight" value="' + U.round(p.weight, 1) + '" /></div>' +
        '<div class="field"><label>目标体重 kg</label><input class="input" type="number" step="0.1" id="f-target" value="' + p.targetWeight + '" /></div>' +
      '</div>' +
      '<div class="field"><label>目标</label>' + seg('goal', [{ v: 'cut', t: '减脂' }, { v: 'recomp', t: '重组' }, { v: 'bulk', t: '增肌' }], p.goal) + '</div>' +
      '<div class="grid-2">' +
        '<div class="field"><label>每周训练天数</label>' + seg('weeklyDays', [2, 3, 4, 5, 6].map((n) => ({ v: n, t: n })), p.weeklyDays) + '</div>' +
        '<div class="field"><label>每日餐次</label>' + seg('mealsPerDay', [{ v: 3, t: '3' }, { v: 4, t: '4' }, { v: 5, t: '5' }], p.mealsPerDay) + '</div>' +
      '</div>' +
      '<div class="field"><label>训练经验</label><select class="select" id="f-exp">' +
        Object.keys(App.engine.EXP_LABEL).map((k) => '<option value="' + k + '" ' + (p.experience === k ? 'selected' : '') + '>' + App.engine.EXP_LABEL[k] + '</option>').join('') +
      '</select></div>' +
      '<div class="field"><label>可用器械</label><select class="select" id="f-equip">' +
        Object.keys(App.engine.EQUIP_LABEL).map((k) => '<option value="' + k + '" ' + (p.equipment === k ? 'selected' : '') + '>' + App.engine.EQUIP_LABEL[k] + '</option>').join('') +
      '</select></div>' +
      '<div class="field"><label>活动水平</label><select class="select" id="f-act">' +
        Object.keys(App.engine.ACTIVITY).map((k) => '<option value="' + k + '" ' + (String(p.activity) === k ? 'selected' : '') + '>' + k + ' · ' + App.engine.ACTIVITY[k] + '</option>').join('') +
      '</select></div>' +
      '<div class="field"><label>饮食偏好</label><select class="select" id="f-diet">' +
        [['normal', '常规'], ['vegetarian', '素食为主'], ['quick', '简单快手（少做饭）']].map((o) => '<option value="' + o[0] + '" ' + (p.dietStyle === o[0] ? 'selected' : '') + '>' + o[1] + '</option>').join('') +
      '</select></div>' +

      '<div class="section-label">模型（可选）</div>' +
      '<div class="small muted" style="margin-bottom:10px">留空则使用本地引擎：热量、训练结构、配餐照常计算，只是没有自由对话。Key 只存在本机 localStorage，不上传任何服务器。</div>' +
      '<div class="field"><label>接口地址</label><input class="input" id="f-endpoint" value="' + U.esc(s.endpoint) + '" placeholder="https://api.deepseek.com/v1" />' +
        '<span class="hint">需兼容 OpenAI 的 /chat/completions，通常以 /v1 结尾</span></div>' +
      '<div class="field"><label>模型名</label><input class="input" id="f-model" value="' + U.esc(s.model) + '" placeholder="deepseek-chat" /></div>' +
      '<div class="field"><label>API Key</label><input class="input" id="f-key" type="password" value="' + U.esc(s.apiKey) + '" placeholder="sk-..." autocomplete="off" /></div>' +
      '<div class="row" style="gap:8px;margin-bottom:6px">' +
        '<button class="btn sm" id="btn-test">测试连接</button>' +
        '<span class="tiny muted" id="test-result"></span>' +
      '</div>' +

      '<div class="section-label">数据</div>' +
      '<div class="tiny muted" style="margin-bottom:8px">当前数据源：' + U.esc(App.repo.describe()) +
        (App.repo.isRemote() ? '' : '（仅本机，换设备不会同步）') + '</div>' +
      '<div class="field"><label>自托管服务地址（可选）</label>' +
        '<input class="input" id="f-api" placeholder="http://192.168.1.10:8787/api" value="' + U.esc(readApiBase()) + '" />' +
        '<span class="hint">填了就从这台服务器读写（手机连自建服务时用）；留空则只存本机。改完点右边按钮重载</span></div>' +
      '<div class="btn-row" style="margin-bottom:10px"><button class="btn sm" id="btn-api">保存并重载</button>' +
        (App.repo.isRemote() ? '<button class="btn sm ghost" id="btn-api-clear">改回本机</button>' : '') + '</div>' +
      '<div class="btn-row">' +
        '<button class="btn sm" id="btn-export">导出备份</button>' +
        '<button class="btn sm" id="btn-import">导入备份</button>' +
        '<button class="btn sm ghost" id="btn-reset" style="color:#c0392b">清空全部数据</button>' +
      '</div>' +
      '<input type="file" id="file-import" accept="application/json" style="display:none" />' +

      '<div style="height:20px"></div>' +
      '<button class="btn primary block" id="btn-save">保存</button>' +
      '<div class="tiny muted" style="text-align:center;margin-top:10px;line-height:1.6">' +
        '本应用的所有建议基于通用运动营养学原则，不构成医疗建议。<br/>有伤病史、慢性病或孕产情况请先咨询医生。' +
      '</div>'
    );

    const $ = (sel) => sheet.panel.querySelector(sel);
    const state = {
      sex: p.sex, goal: p.goal, weeklyDays: p.weeklyDays, mealsPerDay: p.mealsPerDay,
    };
    sheet.panel.querySelectorAll('.seg').forEach((segEl) => {
      segEl.addEventListener('click', (e) => {
        const b = e.target.closest('button[data-v]');
        if (!b) return;
        const name = segEl.dataset.seg;
        state[name] = ['weeklyDays', 'mealsPerDay'].indexOf(name) >= 0 ? parseInt(b.dataset.v, 10) : b.dataset.v;
        segEl.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      });
    });

    $('#btn-test').onclick = async () => {
      const endpoint = $('#f-endpoint').value.trim();
      const model = $('#f-model').value.trim();
      const apiKey = $('#f-key').value.trim();
      const out = $('#test-result');
      if (!endpoint || !apiKey) {
        out.textContent = '先填接口地址与 Key';
        out.style.color = '#8e2f22';
        return;
      }
      App.store.update((st2) => { st2.settings = { endpoint, model, apiKey }; });
      out.textContent = '请求中…';
      out.style.color = '#86948c';
      try {
        const res = await App.llm.chat({
          messages: [
            { role: 'system', content: '你是连通性测试助手，只回复 OK。' },
            { role: 'user', content: '请回复 OK' },
          ],
          temperature: 0,
        });
        out.textContent = '连接正常：' + String(res).trim().slice(0, 20);
        out.style.color = '#0a5c4b';
      } catch (err) {
        out.textContent = '失败：' + err.message;
        out.style.color = '#8e2f22';
      }
    };

    $('#btn-save').onclick = () => {
      const profile = {
        sex: state.sex,
        goal: state.goal,
        weeklyDays: state.weeklyDays,
        mealsPerDay: state.mealsPerDay,
        age: U.clamp(U.num($('#f-age').value, p.age), 12, 90),
        height: U.clamp(U.num($('#f-height').value, p.height), 120, 230),
        weight: U.clamp(U.num($('#f-weight').value, p.weight), 30, 250),
        targetWeight: U.clamp(U.num($('#f-target').value, p.targetWeight), 30, 250),
        experience: $('#f-exp').value,
        equipment: $('#f-equip').value,
        activity: parseFloat($('#f-act').value) || 1.375,
        dietStyle: $('#f-diet').value,
      };
      App.store.setProfile(profile);
      App.store.addWeight(U.dateKey(), profile.weight, '');
      App.store.update((st2) => {
        st2.settings = {
          endpoint: $('#f-endpoint').value.trim(),
          model: $('#f-model').value.trim(),
          apiKey: $('#f-key').value.trim(),
        };
        st2.onboarded = true;
        /* 资料变了，已有计划标注需要重算 */
        if (st2.plan) st2.plan.stale = true;
      });
      sheet.close();
      U.toast('已保存', 'ok');
      App.render();
    };

    $('#btn-api').onclick = () => {
      const v = $('#f-api').value.trim().replace(/\/+$/, '');
      try {
        if (v) localStorage.setItem('tieguan.api', v);
        else localStorage.removeItem('tieguan.api');
      } catch (e) {
        U.toast('浏览器拒绝写入本地存储', 'err');
        return;
      }
      U.toast('已切换数据源，正在重载');
      setTimeout(() => location.reload(), 300);
    };
    if ($('#btn-api-clear')) {
      $('#btn-api-clear').onclick = () => {
        try {
          localStorage.removeItem('tieguan.api');
        } catch (e) {}
        U.toast('已改回本机存储，正在重载');
        setTimeout(() => location.reload(), 300);
      };
    }

    $('#btn-export').onclick = () => {
      const blob = new Blob([JSON.stringify(App.store.get(), null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'tieguan-backup-' + U.dateKey() + '.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    };
    $('#btn-import').onclick = () => $('#file-import').click();
    $('#file-import').onchange = (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = () => {
        try {
          const data = JSON.parse(r.result);
          if (!data || !data.profile) throw new Error('文件格式不符');
          App.store.update((st2) => {
            Object.keys(data).forEach((k) => { st2[k] = data[k]; });
            st2.onboarded = true;
          });
          sheet.close();
          U.toast('已导入备份', 'ok');
          App.render();
        } catch (err) {
          U.toast('导入失败：' + err.message, 'err');
        }
      };
      r.readAsText(f);
    };
    $('#btn-reset').onclick = () => {
      const c = U.openSheet(
        '<div class="sheet-title">清空全部数据</div>' +
        '<div class="small muted" style="margin:8px 0 14px">会删除本机的体重记录、计划、日程、打卡与对话，且无法恢复（可先导出备份）。</div>' +
        '<div class="btn-row"><button class="btn" id="no" style="flex:1">取消</button>' +
        '<button class="btn primary" id="yes" style="flex:1;background:#c0392b;border-color:#c0392b">确认清空</button></div>'
      );
      c.panel.querySelector('#no').onclick = c.close;
      c.panel.querySelector('#yes').onclick = () => {
        App.store.reset();
        sheet.close();
        c.close();
        U.toast('已清空，重新开始');
        App.render();
      };
    };
  };

  /* ---------------- 启动 ---------------- */
  async function boot() {
    document.getElementById('tabbar').addEventListener('click', (e) => {
      const b = e.target.closest('.tab');
      if (b) App.go(b.dataset.tab);
    });
    document.addEventListener('click', (e) => {
      if (e.target.closest('[data-act="open-settings"]')) App.openSettings();
    });

    /* 页面隐藏/关闭前把待同步的改动推上去 */
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') App.repo.flush();
    });

    await App.store.init();

    const st = App.store.get();
    const today = U.dateKey();
    /* 首次使用：把当前体重写进记录 */
    if (!st.profile.weights.length && st.profile.weight) {
      App.store.addWeight(today, st.profile.weight, '初始体重');
      App.store.save();
    }

    App.go('today');
    if (!st.onboarded) setTimeout(() => App.openSettings(), 260);

    /* 离线可用 / 可安装到主屏（file:// 与 原生壳内均跳过：壳里资源本身就是本地的） */
    if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0 && !App.repo.isNative()) {
      navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('[铁馆] Service Worker 注册失败', err));
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
