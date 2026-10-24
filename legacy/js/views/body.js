/* views/body.js —— 身体：体重记录、趋势图、指标解读、打卡热力 */
(function () {
  const App = window.App;
  const U = App.util;
  const V = (App.views = App.views || {});

  function parseRecords() {
    const list = (App.store.get().profile.weights || []).slice().sort((a, b) => (a.date < b.date ? -1 : 1));
    return list;
  }

  /* 简易折线图（纯 SVG，无依赖） */
  function chart(list, targetW) {
    const W = 340, H = 150, PL = 30, PR = 10, PT = 14, PB = 22;
    if (!list.length) return '';
    const vals = list.map((r) => r.weight);
    let min = Math.min.apply(null, vals);
    let max = Math.max.apply(null, vals);
    if (targetW) { min = Math.min(min, targetW); max = Math.max(max, targetW); }
    if (max - min < 1) { max += 0.6; min -= 0.6; }
    const padV = (max - min) * 0.15;
    min -= padV; max += padV;

    const iw = W - PL - PR, ih = H - PT - PB;
    const x = (i) => PL + (list.length === 1 ? iw / 2 : (iw * i) / (list.length - 1));
    const y = (v) => PT + ih * (1 - (v - min) / (max - min));

    /* 7 点移动平均 */
    const ma = vals.map((v, i) => {
      const from = Math.max(0, i - 2);
      const seg = vals.slice(from, i + 1);
      return seg.reduce((a, b) => a + b, 0) / seg.length;
    });
    const maPath = ma.map((v, i) => (i ? 'L' : 'M') + U.round(x(i), 1) + ' ' + U.round(y(v), 1)).join(' ');
    const linePath = vals.map((v, i) => (i ? 'L' : 'M') + U.round(x(i), 1) + ' ' + U.round(y(v), 1)).join(' ');
    const areaPath = linePath + ' L' + U.round(x(vals.length - 1), 1) + ' ' + (PT + ih) + ' L' + U.round(x(0), 1) + ' ' + (PT + ih) + ' Z';

    const gridVals = [min + (max - min) * 0.25, min + (max - min) * 0.5, min + (max - min) * 0.75];
    const grid = gridVals.map((v) =>
      '<line x1="' + PL + '" y1="' + U.round(y(v), 1) + '" x2="' + (W - PR) + '" y2="' + U.round(y(v), 1) + '" stroke="#eef2ee" stroke-width="1"/>' +
      '<text x="' + (PL - 5) + '" y="' + (U.round(y(v), 1) + 3) + '" text-anchor="end" font-size="8" fill="#a6b2aa">' + U.round(v, 1) + '</text>'
    ).join('');

    const dots = list.length <= 24
      ? vals.map((v, i) => '<circle cx="' + U.round(x(i), 1) + '" cy="' + U.round(y(v), 1) + '" r="2.6" fill="#fff" stroke="#0e7a63" stroke-width="1.6"/>').join('')
      : '';

    const tLine = targetW
      ? '<line x1="' + PL + '" y1="' + U.round(y(targetW), 1) + '" x2="' + (W - PR) + '" y2="' + U.round(y(targetW), 1) + '" stroke="#e9762f" stroke-width="1.2" stroke-dasharray="4 3"/>' +
        '<text x="' + (W - PR) + '" y="' + (U.round(y(targetW), 1) - 4) + '" text-anchor="end" font-size="8.5" fill="#c1691f">目标 ' + targetW + ' kg</text>'
      : '';

    const first = list[0], last = list[list.length - 1];
    return (
      '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet">' +
        grid + tLine +
        '<path d="' + areaPath + '" fill="rgba(14,122,99,.07)"/>' +
        '<path d="' + linePath + '" fill="none" stroke="#0e7a63" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>' +
        '<path d="' + maPath + '" fill="none" stroke="#9ed3c4" stroke-width="1.6" stroke-dasharray="3 3"/>' +
        dots +
        '<text x="' + PL + '" y="' + (H - 6) + '" font-size="8.5" fill="#a6b2aa">' + first.date.slice(5) + '</text>' +
        '<text x="' + (W - PR) + '" y="' + (H - 6) + '" text-anchor="end" font-size="8.5" fill="#a6b2aa">' + last.date.slice(5) + '</text>' +
      '</svg>' +
      '<div class="legend" style="margin-top:6px">' +
        '<span><i style="background:#0e7a63"></i>实测体重</span>' +
        '<span><i style="background:#9ed3c4"></i>3 点均线</span>' +
        '<span><i style="background:#e9762f"></i>目标</span>' +
      '</div>'
    );
  }

  function heatmap() {
    const cells = [];
    for (let i = 27; i >= 0; i--) {
      const d = U.addDays(new Date(), -i);
      const k = U.dateKey(d);
      const has = !!App.store.checkins[k];
      const prog = App.store.dayProgress(k);
      let bg = '#eef2ee';
      if (has) bg = prog.total && prog.done >= prog.total ? '#0e7a63' : '#7fbfae';
      else if (prog.done > 0) bg = '#d8e8e2';
      cells.push('<div title="' + k + ' 完成 ' + prog.done + '/' + prog.total + '" style="width:100%;aspect-ratio:1;border-radius:4px;background:' + bg + '"></div>');
    }
    return '<div style="display:grid;grid-template-columns:repeat(14,1fr);gap:4px">' + cells.join('') + '</div>';
  }

  V.body = {
    render(el) {
      const st = App.store.get();
      const p = st.profile;
      const list = parseRecords();
      const w = App.engine.analyzeWeight(list, p);
      const t = App.engine.targets(p);
      const ad = App.store.adherence(7);
      const today = U.dateKey();
      const todayRec = list.find((r) => r.date === today);

      el.innerHTML =
        '<div class="card">' +
          '<div class="row between" style="align-items:flex-end">' +
            '<div>' +
              '<div class="card-sub">当前体重</div>' +
              '<div class="hero" style="margin-top:2px"><div class="num">' + U.round(p.weight, 1) + '</div><div class="unit">kg</div></div>' +
            '</div>' +
            '<div style="text-align:right">' +
              (w && w.trend7
                ? '<div class="small" style="color:' + (w.trend7 < 0 ? '#0e7a63' : '#c1691f') + ';font-weight:700">' + (w.trend7 > 0 ? '+' : '') + w.trend7 + ' kg</div><div class="tiny muted">近 7 天</div>'
                : '<div class="tiny muted">记录 3 天以上<br/>可算趋势</div>') +
            '</div>' +
          '</div>' +
          '<div class="grid-3" style="margin-top:14px">' +
            '<div class="stat"><span class="l">BMI</span><span class="v">' + (w ? w.bmi : App.engine.bmi(p.weight, p.height)) + '<small>' + App.engine.bmiLabel(App.engine.bmi(p.weight, p.height)) + '</small></span></div>' +
            '<div class="stat"><span class="l">目标</span><span class="v">' + (p.targetWeight || '—') + '<small>kg</small></span></div>' +
            '<div class="stat"><span class="l">距目标</span><span class="v">' + (w && p.targetWeight ? U.round(Math.abs(w.remain), 1) : '—') + '<small>kg</small></span></div>' +
          '</div>' +
          '<div class="divider"></div>' +
          '<div class="row" style="gap:8px">' +
            '<input class="input" id="w-input" type="number" step="0.1" inputmode="decimal" placeholder="今天的体重 kg" value="' + (todayRec ? todayRec.weight : '') + '" style="flex:1" />' +
            '<button class="btn primary sm" data-act="save-w">' + (todayRec ? '更新' : '记录') + '</button>' +
          '</div>' +
          '<div class="tiny muted" style="margin-top:6px">建议固定在早晨空腹、如厕后称重，看周均而不是单日</div>' +
        '</div>' +

        (list.length > 1
          ? '<div class="card"><div class="card-head"><div class="card-title">体重趋势</div><div class="card-sub">' + list.length + ' 条记录</div></div>' + chart(list, U.num(p.targetWeight, 0)) + '</div>'
          : '') +

        (w
          ? '<div class="card"><div class="card-title" style="margin-bottom:8px">趋势解读 · 本地引擎</div>' +
            '<div class="stack small" style="color:var(--ink-2)">' +
              '<div>· 近 7 天周变化 <b>' + (w.trend7 > 0 ? '+' : '') + w.trend7 + ' kg</b>，全周期 <b>' + (w.totalDelta > 0 ? '+' : '') + w.totalDelta + ' kg</b>（' + w.spanDays + ' 天）</div>' +
              '<div>· 当前目标「' + (App.engine.GOAL_LABEL[p.goal] || p.goal) + '」，建议周变化区间 ' +
                (p.goal === 'cut' ? '-' + U.round(p.weight * 0.005, 1) + ' ~ -' + U.round(p.weight * 0.01, 1) : p.goal === 'bulk' ? '+' + U.round(p.weight * 0.0025, 1) + ' ~ +' + U.round(p.weight * 0.005, 1) : '±0.3') + ' kg</div>' +
              (w.etaWeeks ? '<div>· 按当前速率，约 <b>' + w.etaWeeks + ' 周</b>接近目标体重</div>' : '') +
              (w.flag ? '<div class="hint-bar" style="margin-top:4px">' + U.esc(w.flag) + '</div>' : '') +
            '</div></div>'
          : '') +

        '<div class="card">' +
          '<div class="card-head"><div class="card-title">近 28 天打卡</div><div class="card-sub">连续 ' + App.store.streak() + ' 天 · 7 天完成率 ' + ad.pct + '%</div></div>' +
          heatmap() +
          '<div class="legend" style="margin-top:8px">' +
            '<span><i style="background:#0e7a63"></i>全部完成</span>' +
            '<span><i style="background:#7fbfae"></i>已打卡</span>' +
            '<span><i style="background:#d8e8e2"></i>部分完成</span>' +
            '<span><i style="background:#eef2ee"></i>无记录</span>' +
          '</div>' +
        '</div>' +

        '<div class="card">' +
          '<div class="card-head"><div class="card-title">代谢与目标</div><button class="tiny muted" data-act="edit" style="background:none;border:none;text-decoration:underline">修改资料</button></div>' +
          '<div class="kv"><span class="k">基础代谢 BMR</span><span class="v">' + t.bmr + ' kcal</span></div>' +
          '<div class="kv" style="margin-top:6px"><span class="k">日常消耗 TDEE</span><span class="v">' + t.tdee + ' kcal</span></div>' +
          '<div class="kv" style="margin-top:6px"><span class="k">目标摄入</span><span class="v">' + t.kcal + ' kcal</span></div>' +
          '<div class="kv" style="margin-top:6px"><span class="k">蛋白 / 碳水 / 脂肪</span><span class="v">' + t.protein + ' / ' + t.carb + ' / ' + t.fat + ' g</span></div>' +
          '<div class="tiny muted" style="margin-top:8px">Mifflin-St Jeor 公式 + 活动系数 ' + U.num(p.activity) + '（' + (App.engine.ACTIVITY[p.activity] || '') + '）</div>' +
        '</div>' +

        (list.length
          ? '<div class="card flush"><div style="padding:13px 15px 8px" class="card-title">历史记录</div>' +
            list.slice().reverse().slice(0, 20).map((r) =>
              '<div class="mini-row"><span class="nm">' + r.date + '</span>' +
              '<span class="num">' + r.weight + ' kg</span>' +
              '<button class="tiny muted" data-act="del-w" data-date="' + r.date + '" style="background:none;border:none;margin-left:10px">删除</button></div>'
            ).join('') + '</div>'
          : '');

      bind(el, today);
    },
  };

  function bind(el, today) {
    el.onclick = (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const act = b.dataset.act;
      if (act === 'save-w') {
        const v = el.querySelector('#w-input').value;
        if (!U.num(v)) return U.toast('请输入体重', 'err');
        App.store.addWeight(today, v, '');
        App.store.save();
        U.toast('已记录 ' + U.round(U.num(v), 1) + ' kg', 'ok');
        App.render();
      } else if (act === 'del-w') {
        App.store.removeWeight(b.dataset.date);
        App.render();
      } else if (act === 'edit') {
        App.openSettings();
      }
    };
  }
})();
