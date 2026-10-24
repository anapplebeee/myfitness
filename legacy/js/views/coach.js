/* views/coach.js —— 教练：模型对话（健身专家 / 营养师）+ 数据分析 */
(function () {
  const App = window.App;
  const U = App.util;
  const V = (App.views = App.views || {});
  let persona = 'workout';
  let sending = false;
  let controller = null;

  const QUICK = {
    workout: ['分析我最近的体重变化', '这周训练强度怎么调', '今天只有 20 分钟怎么练', '深蹲膝盖不舒服怎么办'],
    nutrition: ['按我的数据排一天三餐', '外食怎么点才不超热量', '练完多久内要吃东西', '蛋白质吃不够怎么补'],
  };

  function messagesHtml(list) {
    if (!list.length) {
      return '<div class="empty" style="padding:26px 8px"><b>' + (persona === 'workout' ? '健身教练在线' : '营养师在线') + '</b>' +
        '先点「分析我的数据」让模型读一遍你的体重、计划与打卡记录，或直接提问。</div>';
    }
    return list.map((m) =>
      '<div class="msg ' + (m.role === 'user' ? 'user' : '') + '">' +
        '<div class="av">' + (m.role === 'user' ? '我' : 'AI') + '</div>' +
        '<div class="bubble">' + U.esc(m.content) + '</div>' +
      '</div>'
    ).join('');
  }

  V.coach = {
    render(el) {
      const st = App.store.get();
      const on = App.llm.configured();
      const list = st.chat[persona] || [];

      el.innerHTML =
        '<div class="card" style="padding:12px 14px">' +
          '<div class="row between">' +
            '<div class="seg" style="flex:1;max-width:260px">' +
              '<button class="' + (persona === 'workout' ? 'on' : '') + '" data-act="persona" data-p="workout">健身教练</button>' +
              '<button class="' + (persona === 'nutrition' ? 'on' : '') + '" data-act="persona" data-p="nutrition">营养师</button>' +
            '</div>' +
            '<div class="row" style="gap:6px">' +
              '<span class="badge ' + (on ? 'w' : '') + '">' + (on ? '模型已连接' : '本地模式') + '</span>' +
              '<button class="icon-btn" data-act="settings" title="模型设置" style="width:30px;height:30px">⚙</button>' +
            '</div>' +
          '</div>' +
          (on
            ? '<div class="tiny muted" style="margin-top:8px">' + U.esc(st.settings.model) + ' · ' + U.esc(App.llm.maskedKey()) + '</div>'
            : '<div class="hint-bar" style="margin-top:10px">未配置模型：下方「分析我的数据」会使用本地引擎计算，对话式问答需先填入 API Key（任意 OpenAI 兼容接口）。</div>') +
        '</div>' +

        '<div class="chips">' +
          '<button class="chip" data-act="analyze">✦ 分析我的数据</button>' +
          QUICK[persona].map((q) => '<button class="chip" data-act="ask" data-q="' + U.esc(q) + '">' + U.esc(q) + '</button>').join('') +
        '</div>' +

        '<div class="chat-wrap" id="chat-list">' + messagesHtml(list) + '</div>' +

        '<div class="chat-input">' +
          '<div class="chat-box">' +
            '<textarea id="chat-text" rows="1" placeholder="' + (on ? '问点什么，比如：这周体重掉了 0.8 kg，需要加餐吗' : '配置模型后可自由提问') + '"></textarea>' +
            '<button class="send-btn" id="send-btn" ' + (on ? '' : 'disabled') + '>↑</button>' +
          '</div>' +
          '<div class="row" style="margin-top:8px">' +
            '<span class="tiny muted">上下文：体重 ' + U.num(st.profile.weight) + ' kg · 日程完成率 ' + App.store.adherence(7).pct + '%</span>' +
            '<div class="spacer"></div>' +
            '<button class="tiny muted" data-act="clear" style="background:none;border:none;text-decoration:underline">清空对话</button>' +
          '</div>' +
        '</div>';

      bind(el);
    },
  };

  function bind(el) {
    const ta = el.querySelector('#chat-text');
    const sendBtn = el.querySelector('#send-btn');
    if (ta) {
      ta.addEventListener('input', () => {
        ta.style.height = 'auto';
        ta.style.height = Math.min(120, ta.scrollHeight) + 'px';
      });
      ta.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
          e.preventDefault();
          send();
        }
      });
    }
    if (sendBtn) sendBtn.onclick = () => send();

    el.onclick = (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const act = b.dataset.act;
      if (act === 'persona') {
        persona = b.dataset.p;
        App.render();
      } else if (act === 'settings') {
        App.openSettings();
      } else if (act === 'analyze') {
        analyze();
      } else if (act === 'ask') {
        const ta2 = el.querySelector('#chat-text');
        ta2.value = b.dataset.q;
        send();
      } else if (act === 'clear') {
        App.store.clearChat(persona);
        App.render();
      }
    };
  }

  function pushBubble(role, text) {
    const listEl = document.getElementById('chat-list');
    if (!listEl) return null;
    const empty = listEl.querySelector('.empty');
    if (empty) empty.remove();
    const wrap = document.createElement('div');
    wrap.className = 'msg ' + (role === 'user' ? 'user' : '');
    wrap.innerHTML = '<div class="av">' + (role === 'user' ? '我' : 'AI') + '</div>' +
      '<div class="bubble"></div>';
    const bubble = wrap.querySelector('.bubble');
    bubble.textContent = text;
    listEl.appendChild(wrap);
    if (typeof wrap.scrollIntoView === 'function') wrap.scrollIntoView({ block: 'end', behavior: 'smooth' });
    return bubble;
  }

  async function send() {
    if (sending) return;
    const ta = document.getElementById('chat-text');
    if (!ta) return;
    const text = (ta.value || '').trim();
    if (!text) return;
    if (!App.llm.configured()) return U.toast('先在设置里配置模型 API Key', 'err');

    ta.value = '';
    ta.style.height = 'auto';
    sending = true;
    const btn = document.getElementById('send-btn');
    if (btn) btn.disabled = true;

    App.store.pushChat(persona, { role: 'user', content: text, ts: Date.now() });
    pushBubble('user', text);
    const bubble = pushBubble('assistant', '');
    bubble.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>';

    const hist = (App.store.get().chat[persona] || []).slice(-12).map((m) => ({ role: m.role, content: m.content }));
    const messages = [
      { role: 'system', content: App.llm.systemPrompt(persona) + '\n\n' + App.llm.dataBlock() },
      ...hist,
    ];

    controller = new AbortController();
    let acc = '';
    try {
      await App.llm.chat({
        messages,
        signal: controller.signal,
        onDelta: (d, all) => {
          acc = all;
          bubble.textContent = all;
        },
      });
      App.store.pushChat(persona, { role: 'assistant', content: acc, ts: Date.now() });
    } catch (err) {
      if (err && err.name === 'AbortError') {
        if (acc) App.store.pushChat(persona, { role: 'assistant', content: acc, ts: Date.now() });
        bubble.textContent = acc + '\n\n（已停止生成）';
      } else {
        bubble.textContent = acc + (acc ? '\n\n' : '') + '⚠ ' + err.message;
        if (!acc) bubble.style.color = '#8e2f22';
      }
    } finally {
      sending = false;
      controller = null;
      const b = document.getElementById('send-btn');
      if (b) b.disabled = false;
    }
  }

  /* ---------- 分析我的数据 ---------- */
  async function analyze() {
    if (sending) return;
    const st = App.store.get();
    const w = App.engine.analyzeWeight(st.profile.weights, st.profile);
    const ad = App.store.adherence(7);

    if (!App.llm.configured()) {
      const txt = localAnalysis(st, w, ad);
      App.store.pushChat(persona, { role: 'assistant', content: txt, ts: Date.now() });
      pushBubble('assistant', txt);
      return;
    }

    sending = true;
    const prompt = persona === 'workout'
      ? '基于 <data> 里的数据，给我一份训练层面的体检：1) 体重与目标是否匹配当前训练结构 2) 依从性与容量是否够 3) 未来 2 周具体要改的 1–2 件事。用短列表，给数字。'
      : '基于 <data> 里的数据，给我一份饮食层面的体检：1) 当前热量与蛋白质是否够/超 2) 体重变化方向与摄入是否自洽 3) 未来 2 周具体要改的 1–2 件事。用短列表，给数字。';

    App.store.pushChat(persona, { role: 'user', content: '【分析我的数据】', ts: Date.now() });
    pushBubble('user', '【分析我的数据】');
    const bubble = pushBubble('assistant', '');
    bubble.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>';

    controller = new AbortController();
    let acc = '';
    try {
      await App.llm.chat({
        messages: [
          { role: 'system', content: App.llm.systemPrompt(persona) + '\n\n' + App.llm.dataBlock() },
          { role: 'user', content: prompt },
        ],
        signal: controller.signal,
        temperature: 0.4,
        onDelta: (d, all) => { acc = all; bubble.textContent = all; },
      });
      App.store.pushChat(persona, { role: 'assistant', content: acc, ts: Date.now() });
    } catch (err) {
      bubble.textContent = acc || ('⚠ ' + err.message);
      if (!acc) bubble.style.color = '#8e2f22';
    } finally {
      sending = false;
      controller = null;
    }
  }

  /* 本地分析：用真实数字生成，不编造 */
  function localAnalysis(st, w, ad) {
    const p = st.profile;
    const t = App.engine.targets(p);
    const lines = [];
    const goal = App.engine.GOAL_LABEL[p.goal] || p.goal;

    lines.push('【' + (persona === 'workout' ? '训练体检' : '饮食体检') + ' · 本地引擎，未调用模型】');

    if (w) {
      lines.push('');
      lines.push('体重 · 当前 ' + w.latest.weight + ' kg，BMI ' + w.bmi + '（' + w.bmiLabel + '）');
      lines.push('- 近 7 天周变化 ' + (w.trend7 > 0 ? '+' : '') + w.trend7 + ' kg，全周期变化 ' + (w.totalDelta > 0 ? '+' : '') + w.totalDelta + ' kg');
      if (p.targetWeight) lines.push('- 距目标 ' + Math.abs(w.remain) + ' kg' + (w.etaWeeks ? '，按当前速率约 ' + w.etaWeeks + ' 周' : ''));
      if (w.flag) lines.push('- 注意：' + w.flag);
    } else {
      lines.push('体重 · 还没有记录，先去「身体」页记录 3 天以上再分析趋势');
    }

    lines.push('');
    lines.push('摄入 · 目标 ' + t.kcal + ' kcal（蛋白 ' + t.protein + ' g / 碳水 ' + t.carb + ' g / 脂肪 ' + t.fat + ' g），TDEE ' + t.tdee + ' kcal');
    if (p.goal === 'cut') lines.push('- 当前为减脂档（-20%），周减重目标 0.5%–1% 体重，即 ' + U.round(p.weight * 0.005, 1) + '–' + U.round(p.weight * 0.01, 1) + ' kg/周');
    if (p.goal === 'bulk') lines.push('- 当前为增肌档（+12%），周增重 0.25%–0.5% 体重，即 ' + U.round(p.weight * 0.0025, 1) + '–' + U.round(p.weight * 0.005, 1) + ' kg/周');
    if (p.goal === 'recomp') lines.push('- 当前为重组档（-5%），体重基本持平、腰围下降是正确信号');

    lines.push('');
    lines.push('执行 · 近 7 天日程完成 ' + ad.done + '/' + ad.total + '（' + ad.pct + '%），打卡 ' + ad.checked + '/7 天，连续 ' + App.store.streak() + ' 天');
    if (ad.pct < 60) lines.push('- 依从性偏低：先把「每周完成 3 次训练」当作唯一目标，不要同时改饮食');
    else if (ad.pct < 85) lines.push('- 依从性中等：固定训练时间比增加动作更有效');
    else lines.push('- 依从性良好：可以开始加负荷，主项每 2 周加 2.5–5%');

    lines.push('');
    lines.push('下一步（两周内只做两件）');
    if (persona === 'workout') {
      lines.push('1. 主项（第一个动作）每两周加 2.5 kg 或 +1 次，其余动作保持组次');
      lines.push('2. 训练日固定到具体时间，日程里勾选完成，别靠当天决定');
    } else {
      lines.push('1. 每餐先定蛋白质份量（' + Math.round(t.protein / Math.max(3, p.mealsPerDay)) + ' g/餐），再补碳水');
      lines.push('2. 每周同一时间称重 3–5 次取均值，用周均判断，不看单日');
    }
    lines.push('');
    lines.push('（这是本地规则引擎的输出。填入模型 API Key 后可获得结合你具体日程的对话式分析。）');
    return lines.join('\n');
  }
})();
