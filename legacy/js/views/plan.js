/* views/plan.js —— 计划：训练 / 饮食 / 生成 / 导入日程 */
(function () {
  const App = window.App;
  const U = App.util;
  const V = (App.views = App.views || {});
  let tab = 'workout';

  function sourceBadge(src) {
    return src === 'llm'
      ? '<span class="badge w">模型生成</span>'
      : '<span class="badge">本地引擎</span>';
  }

  function ring(pct, label, value, unit) {
    const R = 26, C = 2 * Math.PI * R;
    const off = C * (1 - U.clamp(pct, 0, 100) / 100);
    return (
      '<div style="display:flex;flex-direction:column;align-items:center;gap:4px">' +
        '<svg width="68" height="68" viewBox="0 0 68 68">' +
          '<circle cx="34" cy="34" r="' + R + '" fill="none" stroke="#e9efea" stroke-width="7"/>' +
          '<circle cx="34" cy="34" r="' + R + '" fill="none" stroke="#0e7a63" stroke-width="7" stroke-linecap="round" ' +
            'stroke-dasharray="' + C.toFixed(1) + '" stroke-dashoffset="' + off.toFixed(1) + '" transform="rotate(-90 34 34)"/>' +
          '<text x="34" y="32" text-anchor="middle" font-size="13" font-weight="700" fill="#12211b">' + value + '</text>' +
          '<text x="34" y="44" text-anchor="middle" font-size="8.5" fill="#86948c">' + unit + '</text>' +
        '</svg>' +
        '<div class="tiny muted">' + label + '</div>' +
      '</div>'
    );
  }

  V.plan = {
    render(el) {
      const st = App.store.get();
      const p = st.profile;
      const plan = st.plan;

      if (!plan) {
        const t = App.engine.targets(p);
        el.innerHTML =
          '<div class="card">' +
            '<div class="card-head"><div class="card-title">还没有计划</div></div>' +
            '<div class="small muted">按你填的身体数据先算一份：BMR ' + t.bmr + ' kcal，日常消耗 ' + t.tdee +
              ' kcal，目标摄入 ' + t.kcal + ' kcal（蛋白 ' + t.protein + ' g / 碳水 ' + t.carb + ' g / 脂肪 ' + t.fat + ' g）。</div>' +
            '<div class="divider"></div>' +
            '<div class="stack">' +
              '<button class="btn primary block" data-act="gen-llm">' + (App.llm.configured() ? '让模型生成计划' : '让模型生成计划（需先配置 API）') + '</button>' +
              '<button class="btn soft block" data-act="gen-engine">用本地引擎生成（离线可用）</button>' +
              '<button class="btn ghost block sm" data-act="goto-body">先完善身体数据</button>' +
            '</div>' +
          '</div>' +
          '<div class="card"><div class="card-title" style="margin-bottom:8px">生成逻辑</div>' +
            '<ul class="list-plain">' +
              '<li>训练：按每周天数选分化（2 天全身 / 3 天推拉腿 / 4 天上下肢 / 5–6 天推拉腿）</li>' +
              '<li>动作：复合动作优先，按你的器械条件与经验筛库内动作，新手避开高阶动作</li>' +
              '<li>饮食：热量按目标做 ±20% 调整，蛋白质 1.8–2.0 g/kg，脂肪 0.9 g/kg，余量给碳水</li>' +
              '<li>导入日程后可在「今日」逐项勾选、或一句话让模型勾选</li>' +
            '</ul></div>';
        bind(el);
        return;
      }

      const w = plan.workout || {};
      const d = plan.diet || {};
      const t = d.targets || App.engine.targets(p);
      const mealKcal = (d.meals || []).reduce((a, b) => a + (b.kcal || 0), 0);
      const mealP = (d.meals || []).reduce((a, b) => a + (b.protein || 0), 0);
      const imported = plan.importedAt;

      el.innerHTML =
        '<div class="card">' +
          '<div class="card-head" style="align-items:flex-start">' +
            '<div><div class="card-title" style="font-size:16px">' + U.esc(w.title || '训练计划') + '</div>' +
            '<div class="card-sub" style="margin-top:3px">' + U.esc(w.splitLabel || '') + ' · ' + (w.weeklyDays || '—') + ' 天/周 · ' + (w.weeks || '—') + ' 周</div></div>' +
            sourceBadge(plan.source) +
          '</div>' +
          (plan.summary ? '<div class="small muted" style="margin-bottom:10px">' + U.esc(plan.summary) + '</div>' : '') +
          '<div class="row" style="gap:8px">' +
            '<button class="btn primary sm" data-act="import">' + (imported ? '重新导入日程' : '导入到日程') + '</button>' +
            '<button class="btn sm" data-act="gen-llm">模型重生成</button>' +
            '<button class="btn ghost sm" data-act="gen-engine">引擎重生成</button>' +
          '</div>' +
          (imported ? '<div class="tiny muted" style="margin-top:8px">已导入 ' + U.timeLabel(new Date(imported)) + '，覆盖未来 7 天</div>' : '') +
        '</div>' +
        (plan.stale ? '<div class="hint-bar">身体资料改过了，这份计划是按旧数据算的，建议重新生成一次。</div>' : '') +

        '<div class="plan-tab">' +
          '<button class="' + (tab === 'workout' ? 'on' : '') + '" data-act="tab" data-tab="workout">训练计划</button>' +
          '<button class="' + (tab === 'diet' ? 'on' : '') + '" data-act="tab" data-tab="diet">饮食计划</button>' +
        '</div>' + (tab === 'workout' ? workoutHtml(w) : dietHtml(t, d, mealKcal, mealP, p));

      bind(el);
    },
  };

  function workoutHtml(w) {
    const days = w.days || [];
    const volume = days.reduce((a, dd) => a + dd.items.reduce((x, it) => x + U.num(it.sets, 0) * (U.num(String(it.reps).split('-')[0], 0) || 0), 0), 0);
    return (
      '<div class="card">' +
        '<div class="grid-3">' +
          '<div class="stat"><span class="l">训练日</span><span class="v">' + days.length + '<small>天</small></span></div>' +
          '<div class="stat"><span class="l">动作数</span><span class="v">' + days.reduce((a, b) => a + b.items.length, 0) + '<small>个</small></span></div>' +
          '<div class="stat"><span class="l">周容量</span><span class="v">' + Math.round(volume) + '<small>次</small></span></div>' +
        '</div>' +
      '</div>' +
      days.map((dd) =>
        '<div class="daycard">' +
          '<div class="daycard-h"><div class="t">D' + dd.day + ' · ' + U.esc(dd.focusLabel || dd.focus) + '</div>' +
            '<div class="tiny muted">' + dd.items.length + ' 个动作</div></div>' +
          '<div class="daycard-b">' +
            dd.items.map((it) => {
              const ex = it.exerciseId ? App.exById(it.exerciseId) : null;
              return '<div class="mini-row" ' + (ex ? 'data-act="ex" data-ex="' + ex.id + '"' : '') + ' style="cursor:' + (ex ? 'pointer' : 'default') + '">' +
                '<span class="nm" style="' + (ex ? 'color:#0a5c4b' : '') + '">' + U.esc(it.name) + (ex ? ' ›' : '') + '</span>' +
                '<span class="num">' + it.sets + ' × ' + U.esc(it.reps) + '</span>' +
                '<span class="num" style="width:52px;text-align:right">' + U.esc(it.rest) + '</span>' +
              '</div>';
            }).join('') +
          '</div>' +
        '</div>'
      ).join('')
    );
  }

  function dietHtml(t, d, mealKcal, mealP, p) {
    const kcalPct = U.pct(mealKcal, t.kcal || 1);
    const pPct = t.pPct || U.pct(t.protein * 4, t.kcal);
    const cPct = t.cPct || U.pct(t.carb * 4, t.kcal);
    const fPct = t.fPct || U.pct(t.fat * 9, t.kcal);
    return (
      '<div class="card">' +
        '<div class="row" style="justify-content:space-around;margin-bottom:6px">' +
          ring(U.pct(t.protein * 4, t.kcal), '蛋白质', t.protein + 'g', pPct + '%') +
          ring(U.pct(t.carb * 4, t.kcal), '碳水', t.carb + 'g', cPct + '%') +
          ring(U.pct(t.fat * 9, t.kcal), '脂肪', t.fat + 'g', fPct + '%') +
        '</div>' +
        '<div class="divider"></div>' +
        '<div class="kv"><span class="k">每日目标热量</span><span class="v">' + t.kcal + ' kcal</span></div>' +
        '<div class="kv" style="margin-top:6px"><span class="k">餐单合计</span><span class="v">' + mealKcal + ' kcal · 蛋白 ' + mealP + ' g</span></div>' +
        '<div class="bar" style="margin-top:8px"><i style="width:' + U.clamp(kcalPct, 0, 100) + '%"></i></div>' +
        '<div class="tiny muted" style="margin-top:5px">餐单与目标偏差 ' + (mealKcal - t.kcal > 0 ? '+' : '') + (mealKcal - t.kcal) + ' kcal，±8% 以内都算合格</div>' +
      '</div>' +
      (d.meals || []).map((m) =>
        '<div class="daycard">' +
          '<div class="daycard-h"><div class="t">' + U.esc(m.slot) + (m.time ? ' <span class="tiny muted">' + U.esc(m.time) + '</span>' : '') + '</div>' +
            '<div class="tiny muted">' + m.kcal + ' kcal · 蛋白 ' + m.protein + ' g</div></div>' +
          '<div class="daycard-b">' +
            m.items.map((x) =>
              '<div class="mini-row"><span class="nm">' + U.esc(x.name) + '</span>' +
              '<span class="num">' + U.esc(x.amount) + '</span>' +
              '<span class="num" style="width:66px;text-align:right">' + x.kcal + ' kcal</span></div>'
            ).join('') +
            (m.tip ? '<div class="item-note" style="padding:8px 13px">' + U.esc(m.tip) + '</div>' : '') +
          '</div>' +
        '</div>'
      ).join('') +
      ((d.notes || []).length
        ? '<div class="card"><div class="card-title" style="margin-bottom:8px">执行要点</div><ul class="list-plain">' +
          d.notes.map((n) => '<li>' + U.esc(n) + '</li>').join('') + '</ul></div>'
        : '')
    );
  }

  function bind(el) {
    el.onclick = async (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const act = b.dataset.act;

      if (act === 'tab') {
        tab = b.dataset.tab;
        App.render();
      } else if (act === 'ex') {
        App.views.library.openDetail(b.dataset.ex);
      } else if (act === 'goto-body') {
        App.go('body');
      } else if (act === 'gen-engine') {
        const plan = App.llm.enginePlan(App.store.get().profile);
        App.store.update((s) => { s.plan = plan; });
        U.toast('本地引擎已生成计划');
        App.render();
      } else if (act === 'gen-llm') {
        generateWithModel(b);
      } else if (act === 'import') {
        const st = App.store.get();
        if (!st.plan) return;
        App.store.buildSchedule(st.plan, new Date());
        App.store.update((s) => { s.plan.importedAt = Date.now(); });
        U.toast('已导入未来 7 天日程', 'ok');
        App.go('today');
      }
    };
  }

  async function generateWithModel(btn) {
    if (!App.llm.configured()) {
      U.toast('先在设置里填写模型 API Key', 'err');
      openSettingsHint();
      return;
    }
    const old = btn.textContent;
    btn.disabled = true;
    btn.textContent = '模型生成中…';
    const sheet = U.openSheet(
      '<div class="sheet-title">正在生成计划</div>' +
      '<div class="small muted" style="margin:8px 0 12px">模型会按你的数据排训练分化与三餐配比，通常需要 20–60 秒。</div>' +
      '<div class="bar"><i id="gen-bar" style="width:8%"></i></div>' +
      '<pre id="gen-log" style="margin-top:12px;max-height:180px;overflow:auto;background:#f7faf8;border:1px solid #e2e8e3;border-radius:10px;padding:10px;font-size:11px;color:#48584f;white-space:pre-wrap;word-break:break-all"></pre>'
    );
    let buf = '';
    const log = sheet.panel.querySelector('#gen-log');
    const bar = sheet.panel.querySelector('#gen-bar');
    try {
      const plan = await App.llm.generatePlan({
        onDelta: (d, all) => {
          buf = all;
          log.textContent = all.slice(-900);
          log.scrollTop = log.scrollHeight;
          bar.style.width = Math.min(92, 8 + all.length / 30) + '%';
        },
      });
      App.store.update((s) => { s.plan = plan; s.plan.importedAt = null; });
      bar.style.width = '100%';
      sheet.close();
      U.toast('模型已生成计划', 'ok');
      App.render();
    } catch (err) {
      sheet.close();
      U.toast('生成失败：' + err.message, 'err');
      btn.disabled = false;
      btn.textContent = old;
      if (buf) console.warn('[铁馆] 模型输出片段：', buf.slice(0, 2000));
    }
  }

  function openSettingsHint() {
    const s = U.openSheet(
      '<div class="sheet-title">需要先配置模型</div>' +
      '<div class="small muted" style="margin:8px 0 14px">模型调用使用你自己的 OpenAI 兼容接口（DeepSeek / 通义 / 智谱 / Kimi 均可），Key 只存在本机浏览器，不会上传。</div>' +
      '<button class="btn primary block" id="to-set">去设置</button>'
    );
    s.panel.querySelector('#to-set').onclick = () => {
      s.close();
      App.openSettings();
    };
  }
})();
