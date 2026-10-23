/* views/library.js —— 动作库：筛选、检索、动作详情 */
(function () {
  const App = window.App;
  const U = App.util;
  const V = (App.views = App.views || {});
  let bucket = 'all';
  let q = '';

  const BUCKETS = [
    { id: 'all', label: '全部', match: () => true },
    { id: 'chest', label: '胸', match: (e) => e.group === 'chest' },
    { id: 'back', label: '背', match: (e) => ['lats', 'back', 'traps', 'rear_delt'].indexOf(e.group) >= 0 },
    { id: 'legs', label: '腿臀', match: (e) => ['quads', 'hams', 'glutes', 'calves'].indexOf(e.group) >= 0 },
    { id: 'shoulders', label: '肩', match: (e) => e.group === 'shoulders' },
    { id: 'arms', label: '手臂', match: (e) => ['biceps', 'triceps', 'forearms'].indexOf(e.group) >= 0 },
    { id: 'core', label: '核心', match: (e) => e.group === 'core' },
    { id: 'cardio', label: '有氧', match: (e) => e.group === 'cardio' || e.group === 'full' },
  ];
  const LEVEL = { 1: '入门', 2: '进阶', 3: '高阶' };

  function filtered() {
    const b = BUCKETS.find((x) => x.id === bucket) || BUCKETS[0];
    const kw = q.trim().toLowerCase();
    return App.exercises.filter((e) => {
      if (!b.match(e)) return false;
      if (!kw) return true;
      const hay = (e.name + e.en + (App.groups[e.group] || '') + e.equipmentLabel + e.alt.join('')).toLowerCase();
      return hay.indexOf(kw) >= 0;
    });
  }

  V.library = {
    render(el) {
      const list = filtered();
      el.innerHTML =
        '<div class="card" style="padding:12px 14px">' +
          '<input class="input" id="ex-search" placeholder="搜动作、肌群、器械…" value="' + U.esc(q) + '" />' +
          '<div class="chips" style="margin-top:10px">' +
            BUCKETS.map((b) => '<button class="chip ' + (bucket === b.id ? 'on' : '') + '" data-act="bucket" data-b="' + b.id + '">' + b.label + '</button>').join('') +
          '</div>' +
        '</div>' +
        '<div class="card flush">' +
          '<div style="padding:12px 15px 6px" class="card-sub">' + list.length + ' 个动作 · 点开看步骤、呼吸、常见错误</div>' +
          (list.length
            ? list.map((e) =>
                '<div class="ex-card" data-act="open" data-id="' + e.id + '">' +
                  '<div class="ex-thumb">' + App.miniBody(e.group) + '</div>' +
                  '<div class="ex-body">' +
                    '<div class="ex-name">' + U.esc(e.name) + '</div>' +
                    '<div class="ex-en">' + U.esc(e.en) + '</div>' +
                    '<div class="ex-tags">' +
                      '<span class="chip tag">' + (App.groups[e.group] || '') + '</span>' +
                      '<span class="chip tag">' + U.esc(e.equipmentLabel) + '</span>' +
                      '<span class="chip tag">' + LEVEL[e.level] + '</span>' +
                    '</div>' +
                  '</div>' +
                  '<span class="chev">›</span>' +
                '</div>'
              ).join('')
            : '<div class="empty"><b>没有匹配的动作</b>换个关键词，或点「全部」</div>') +
        '</div>';

      const input = el.querySelector('#ex-search');
      input.addEventListener('input', () => {
        q = input.value;
        const pos = input.selectionStart;
        App.render();
        const again = document.getElementById('ex-search');
        if (again) { again.focus(); again.setSelectionRange(pos, pos); }
      });

      el.onclick = (e) => {
        const b = e.target.closest('[data-act]');
        if (!b) return;
        if (b.dataset.act === 'bucket') {
          bucket = b.dataset.b;
          App.render();
        } else if (b.dataset.act === 'open') {
          V.library.openDetail(b.dataset.id);
        }
      };
    },

    openDetail(id) {
      const e = App.exById(id);
      if (!e) return;
      const today = U.dateKey();
      const s = U.openSheet(
        '<div class="row between" style="align-items:flex-start">' +
          '<div><div class="sheet-title">' + U.esc(e.name) + '</div>' +
          '<div class="small muted" style="margin-top:2px">' + U.esc(e.en) + ' · ' + U.esc(e.pattern) + '</div></div>' +
          '<span class="badge">' + LEVEL[e.level] + '</span>' +
        '</div>' +

        '<div class="card" style="margin-top:14px;padding:10px;background:#fbfdfb;border-color:var(--line-2)">' +
          App.muscleMap([e.group], e.secondary || []) +
          '<div class="legend" style="justify-content:center;margin-top:8px">' +
            '<span><i style="background:#0e7a63"></i>主练</span>' +
            '<span><i style="background:#9ed3c4"></i>协同</span>' +
          '</div>' +
        '</div>' +

        '<div class="grid-3" style="margin-top:12px">' +
          '<div class="stat"><span class="l">组数</span><span class="v">' + e.sets + '</span></div>' +
          '<div class="stat"><span class="l">次数</span><span class="v">' + U.esc(e.reps) + '</span></div>' +
          '<div class="stat"><span class="l">组间休息</span><span class="v">' + U.esc(e.rest) + '</span></div>' +
        '</div>' +
        '<div class="grid-2" style="margin-top:8px">' +
          '<div class="stat"><span class="l">节奏（离心-底-向心）</span><span class="v" style="font-size:15px">' + U.esc(e.tempo) + '</span></div>' +
          '<div class="stat"><span class="l">器械</span><span class="v" style="font-size:15px">' + U.esc(e.equipmentLabel) + '</span></div>' +
        '</div>' +

        '<div class="section-label">起始位置</div>' +
        '<div class="small" style="color:var(--ink-2)">' + U.esc(e.setup) + '</div>' +

        '<div class="section-label">动作步骤</div>' +
        '<ol class="list-plain">' + e.steps.map((x) => '<li>' + U.esc(x) + '</li>').join('') + '</ol>' +

        '<div class="section-label">呼吸</div>' +
        '<div class="small" style="color:var(--ink-2)">' + U.esc(e.breath) + '</div>' +

        '<div class="section-label">常见错误</div>' +
        '<ul class="warn-list">' + e.mistakes.map((x) => '<li>' + U.esc(x) + '</li>').join('') + '</ul>' +

        '<div class="section-label">要点</div>' +
        '<ul class="list-plain">' + e.tips.map((x) => '<li>' + U.esc(x) + '</li>').join('') + '</ul>' +

        '<div class="section-label">替代动作</div>' +
        '<div class="row" style="flex-wrap:wrap;gap:6px">' +
          e.alt.map((a) => {
            const hit = App.matchExercise(a);
            return '<button class="chip" ' + (hit ? 'data-act="alt" data-id="' + hit.id + '"' : 'disabled') + '>' + U.esc(a) + '</button>';
          }).join('') +
        '</div>' +

        '<div style="height:16px"></div>' +
        '<button class="btn primary block" data-act="add-today">加入今天日程</button>' +
        '<div class="tiny muted" style="text-align:center;margin-top:8px">专家提示不等同于医疗建议；出现疼痛请立即停止并就医</div>'
      );

      s.panel.onclick = (ev) => {
        const b = ev.target.closest('[data-act]');
        if (!b) return;
        if (b.dataset.act === 'alt') {
          s.close();
          setTimeout(() => V.library.openDetail(b.dataset.id), 60);
        } else if (b.dataset.act === 'add-today') {
          App.store.addItem(today, {
            source: 'user', type: e.group === 'cardio' ? 'cardio' : 'workout',
            title: e.name, exerciseId: e.id,
            detail: e.sets + ' 组 × ' + e.reps + ' · 休息 ' + e.rest,
            done: false,
          });
          s.close();
          U.toast('已加入今天日程', 'ok');
          App.render();
        }
      };
    },
  };
})();
