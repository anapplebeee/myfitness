/* views/today.js —— 今日：日程 / 打卡 / 一句话汇报 */
(function () {
  const App = window.App;
  const U = App.util;
  const V = (App.views = App.views || {});

  const TYPE_META = {
    workout: { label: '训练', cls: 'w' },
    cardio: { label: '有氧', cls: 'c' },
    meal: { label: '饮食', cls: 'm' },
    rest: { label: '恢复', cls: '' },
    custom: { label: '自定义', cls: '' },
  };

  let activeDate = U.dateKey();

  function itemRow(it, dateKey) {
    const meta = TYPE_META[it.type] || TYPE_META.custom;
    const hasEx = it.exerciseId && App.exById(it.exerciseId);
    return (
      '<div class="item ' + (it.done ? 'done' : '') + '" data-id="' + it.id + '">' +
        '<button class="check ' + (it.done ? 'done' : '') + '" data-act="toggle" data-id="' + it.id + '" aria-label="切换完成">' + (it.done ? '✓' : '') + '</button>' +
        '<div class="item-main">' +
          '<div class="item-title">' +
            '<span class="badge ' + meta.cls + '">' + meta.label + '</span>' +
            (hasEx
              ? '<a href="javascript:void 0" data-act="ex" data-ex="' + it.exerciseId + '">' + U.esc(it.title) + '</a>'
              : U.esc(it.title)) +
            (it.time ? '<span class="tiny muted">' + U.esc(it.time) + '</span>' : '') +
          '</div>' +
          (it.detail ? '<div class="item-meta">' + U.esc(it.detail) + '</div>' : '') +
          (it.note ? '<div class="item-note">' + U.esc(it.note) + '</div>' : '') +
        '</div>' +
        '<button class="icon-btn" style="width:28px;height:28px;font-size:13px;border-color:transparent;background:transparent;color:#c3cec6" data-act="del" data-id="' + it.id + '" title="删除">✕</button>' +
      '</div>'
    );
  }

  function section(title, sub, items, dateKey, emptyText) {
    return (
      '<div class="card flush">' +
        '<div style="padding:13px 15px 10px;display:flex;align-items:center;justify-content:space-between">' +
          '<div class="card-title">' + title + '</div>' +
          '<div class="card-sub">' + sub + '</div>' +
        '</div>' +
        (items.length ? items.map((it) => itemRow(it, dateKey)).join('') : '<div class="empty" style="padding:18px">' + emptyText + '</div>') +
      '</div>'
    );
  }

  V.today = {
    render(el) {
      const st = App.store.get();
      const p = st.profile;
      const dateKey = activeDate;
      const isToday = dateKey === U.dateKey();
      const items = App.store.dayItems(dateKey);
      const prog = App.store.dayProgress(dateKey);
      const streak = App.store.streak();
      const ad = App.store.adherence(7);
      const checked = App.store.checkins[dateKey];

      const trainItems = items.filter((x) => x.type === 'workout' || x.type === 'cardio');
      const restItems = items.filter((x) => x.type === 'rest');
      const mealItems = items.filter((x) => x.type === 'meal');
      const otherItems = items.filter((x) => x.type === 'custom');

      /* 日期条：今天起 7 天 */
      const strip = [];
      for (let i = 0; i < 7; i++) {
        const d = U.addDays(new Date(), i);
        const k = U.dateKey(d);
        const ip = App.store.dayItems(k);
        strip.push(
          '<button class="daycell ' + (k === dateKey ? 'on' : '') + ' ' + (k === U.dateKey() ? 'today' : '') + '" data-act="day" data-key="' + k + '">' +
            '<span class="d">' + (i === 0 ? '今' : '周' + U.weekdayShort(d)) + '</span>' +
            '<span class="n">' + d.getDate() + '</span>' +
            '<span class="dot ' + (ip.length ? 'fill' : '') + '"></span>' +
          '</button>'
        );
      }

      const noPlan = !st.plan || !items.length;

      el.innerHTML =
        /* ---- 打卡卡 ---- */
        '<div class="card">' +
          '<div class="row between" style="align-items:flex-start">' +
            '<div>' +
              '<div class="card-title">' + (isToday ? '今天' : U.relativeDay(dateKey)) + ' · ' + U.monthDay(U.parseKey(dateKey)) + ' 周' + U.weekdayShort(U.parseKey(dateKey)) + '</div>' +
              '<div class="card-sub" style="margin-top:2px">' +
                (items.length ? '已完成 ' + prog.done + ' / ' + prog.total + ' 项' : '日程为空') +
              '</div>' +
            '</div>' +
            '<div style="text-align:right">' +
              '<div class="hero"><div class="num">' + streak + '</div><div class="unit">天连续</div></div>' +
            '</div>' +
          '</div>' +
          '<div style="margin:12px 0 8px" class="bar"><i style="width:' + prog.pct + '%"></i></div>' +
          '<div class="row between small muted" style="margin-bottom:12px">' +
            '<span>训练 ' + prog.workDone + '/' + prog.workTotal + '</span>' +
            '<span>近 7 天完成率 ' + ad.pct + '%</span>' +
          '</div>' +
          (checked
            ? '<div class="ai-note"><b>已打卡 ' + U.timeLabel(new Date(checked.ts)) + '</b>' + (checked.note ? U.esc(checked.note) : '今天已记录，继续保持节奏。') + '</div>'
            : '<button class="btn primary block" data-act="checkin">' + (isToday ? '完成今日打卡' : '补签这一天') + '</button>') +
        '</div>' +

        /* ---- 日期条 ---- */
        '<div class="daystrip">' + strip.join('') + '</div>' +

        (noPlan
          ? '<div class="card"><div class="empty" style="padding:12px 4px 16px"><b>还没有日程</b>先在「计划」里生成训练与饮食计划，一键导入日程。</div>' +
            '<button class="btn primary block" data-act="goto-plan">去生成计划</button></div>'
          : '') +

        /* ---- 训练 ---- */
        (trainItems.length || restItems.length
          ? section('训练与恢复', trainItems.length + ' 项', trainItems.concat(restItems), dateKey, '今天没有训练安排')
          : '') +

        /* ---- 饮食 ---- */
        (mealItems.length ? section('饮食', mealItems.length + ' 餐', mealItems, dateKey, '') : '') +

        /* ---- 自定义 ---- */
        (otherItems.length ? section('其他', '', otherItems, dateKey, '') : '') +

        /* ---- 一句话汇报 ---- */
        (items.length
          ? '<div class="card">' +
              '<div class="card-head"><div class="card-title">一句话汇报</div><div class="card-sub">模型自动勾选日程</div></div>' +
              '<textarea class="textarea" id="quick-note" placeholder="例：深蹲和卧推做完了，腿举跳到下一轮，晚餐没吃主食"></textarea>' +
              '<div class="row" style="margin-top:10px">' +
                '<button class="btn soft sm" data-act="add-custom">+ 加一条</button>' +
                '<div class="spacer"></div>' +
                '<button class="btn primary sm" data-act="quick-checkin" id="quick-btn">解析并打卡</button>' +
              '</div>' +
              '<div id="quick-result" style="margin-top:10px"></div>' +
            '</div>'
          : '<div class="card"><button class="btn ghost block sm" data-act="add-custom">+ 手动添加一条日程</button></div>');

      bind(el, dateKey);
    },
  };

  function bind(el, dateKey) {
    el.onclick = async (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const act = b.dataset.act;
      if (act === 'day') {
        activeDate = b.dataset.key;
        App.render();
      } else if (act === 'toggle') {
        App.store.toggleItem(dateKey, b.dataset.id);
        const prog = App.store.dayProgress(dateKey);
        if (prog.total > 0 && prog.done === prog.total && !App.store.hasCheckin(dateKey)) {
          App.store.checkin(dateKey, { note: '全部完成，自动打卡' });
          U.toast('全部完成，已自动打卡', 'ok');
        }
        App.render();
      } else if (act === 'del') {
        App.store.removeItem(dateKey, b.dataset.id);
        App.render();
      } else if (act === 'ex') {
        App.views.library.openDetail(b.dataset.ex);
      } else if (act === 'checkin') {
        const prog = App.store.dayProgress(dateKey);
        App.store.checkin(dateKey, { note: prog.done ? '完成 ' + prog.done + '/' + prog.total + ' 项' : '今天按下打卡' });
        U.toast('已打卡 · 连续 ' + App.store.streak() + ' 天', 'ok');
        App.render();
      } else if (act === 'goto-plan') {
        App.go('plan');
      } else if (act === 'add-custom') {
        addCustom(dateKey);
      } else if (act === 'quick-checkin') {
        quickCheckin(dateKey, b);
      }
    };
  }

  function addCustom(dateKey) {
    const s = U.openSheet(
      '<div class="sheet-title">添加日程条目</div>' +
      '<div class="field" style="margin-top:14px"><label>类型</label>' +
        '<select class="select" id="nc-type">' +
          '<option value="workout">训练</option><option value="cardio">有氧</option>' +
          '<option value="meal">饮食</option><option value="rest">恢复</option><option value="custom">其他</option>' +
        '</select></div>' +
      '<div class="field"><label>标题</label><input class="input" id="nc-title" placeholder="例：游泳 30 分钟" /></div>' +
      '<div class="field"><label>说明（可选）</label><input class="input" id="nc-detail" placeholder="例：自由泳，中等强度" /></div>' +
      '<button class="btn primary block" id="nc-save">保存到 ' + U.relativeDay(dateKey) + '</button>'
    );
    s.panel.querySelector('#nc-save').onclick = () => {
      const title = s.panel.querySelector('#nc-title').value.trim();
      if (!title) return U.toast('标题不能为空', 'err');
      App.store.addItem(dateKey, {
        source: 'user',
        type: s.panel.querySelector('#nc-type').value,
        title,
        detail: s.panel.querySelector('#nc-detail').value.trim(),
        done: false,
      });
      s.close();
      U.toast('已添加');
      App.render();
    };
  }

  async function quickCheckin(dateKey, btn) {
    const ta = document.getElementById('quick-note');
    const out = document.getElementById('quick-result');
    const text = (ta.value || '').trim();
    if (!text) return U.toast('先写一句今天的情况', 'err');
    const items = App.store.dayItems(dateKey);
    if (!items.length) return U.toast('这天没有日程条目', 'err');

    btn.disabled = true;
    btn.textContent = '解析中…';
    out.innerHTML = '<div class="small muted">正在把这句话映射到日程条目…</div>';

    let res;
    let usedModel = false;
    try {
      if (App.llm.configured()) {
        res = await App.llm.parseCheckin(text, items);
        usedModel = true;
      } else {
        res = App.llm.localCheckin(text, items);
      }
    } catch (err) {
      res = App.llm.localCheckin(text, items);
      out.innerHTML = '<div class="hint-bar">模型调用失败（' + U.esc(err.message) + '），已改用本地规则解析。</div>';
    }

    res.completed.forEach((i) => {
      const it = items[i];
      if (it && !it.done) App.store.toggleItem(dateKey, it.id);
    });
    res.skipped.forEach((i) => {
      const it = items[i];
      if (it && it.done) App.store.toggleItem(dateKey, it.id);
    });
    App.store.checkin(dateKey, { note: res.note || text.slice(0, 20) });

    U.toast('已更新日程 · 连续 ' + App.store.streak() + ' 天', 'ok');
    setTimeout(() => {
      App.render();
      const box = document.getElementById('quick-result');
      if (box) {
        box.innerHTML =
          '<div class="ai-note"><b>' + (usedModel ? '模型解析' : '本地解析') + '：完成 ' + res.completed.length + ' 项' +
          (res.skipped.length ? ' · 跳过 ' + res.skipped.length + ' 项' : '') + '</b>' + U.esc(res.reply || '已按你的描述更新日程。') + '</div>';
      }
    }, 30);
  }
})();
