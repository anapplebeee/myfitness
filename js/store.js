/* store.js —— 状态容器：只负责内存状态与持久化编排
 * 业务计算全部下沉到 core/schedule.js；存储读写全部交给 repo.js。
 */
(function () {
  const App = (window.App = window.App || {});
  const U = App.util;
  const S = (App.store = {});
  let state = defaults();

  function defaults() {
    return {
      v: 1,
      onboarded: false,
      profile: {
        name: '',
        sex: 'male',
        age: 30,
        height: 175,
        weight: 75,
        targetWeight: 70,
        bodyFat: '',
        activity: 1.375,
        goal: 'recomp',
        weeklyDays: 3,
        experience: 'beginner',
        equipment: 'gym',
        dietStyle: 'normal',
        mealsPerDay: 4,
        weights: [],
      },
      plan: null,
      schedule: {},
      checkins: {},
      chat: { workout: [], nutrition: [] },
      settings: { endpoint: 'https://api.deepseek.com/v1', model: 'deepseek-chat', apiKey: '' },
    };
  }

  function merge(raw) {
    const d = defaults();
    if (!raw || typeof raw !== 'object') return d;
    const out = Object.assign({}, d, raw);
    out.profile = Object.assign({}, d.profile, raw.profile || {});
    out.settings = Object.assign({}, d.settings, raw.settings || {});
    out.chat = Object.assign({}, d.chat, raw.chat || {});
    out.schedule = raw.schedule || {};
    out.checkins = raw.checkins || {};
    if (!Array.isArray(out.profile.weights)) out.profile.weights = [];
    return out;
  }

  function save() {
    App.repo.save(state);
  }

  /* ---------- 生命周期 ---------- */

  S.init = async function () {
    const raw = await App.repo.load();
    state = merge(raw);
    return state;
  };

  S.get = () => state;
  S.save = save;
  S.defaults = defaults;

  S.reset = function () {
    state = defaults();
    save();
  };

  S.update = function (fn) {
    fn(state);
    save();
    return state;
  };

  S.setProfile = function (patch) {
    Object.assign(state.profile, patch);
    if (patch.weight) S.addWeight(U.dateKey(), patch.weight, '', true);
    save();
  };

  /* ---------- 体重 ---------- */

  S.addWeight = function (date, weight, note, silent) {
    const w = U.num(weight, 0);
    if (!w) return;
    const list = state.profile.weights;
    const i = list.findIndex((r) => r.date === date);
    const row = { date, weight: U.round(w, 1), note: note || '' };
    if (i >= 0) list[i] = Object.assign(list[i], row);
    else list.push(row);
    list.sort((a, b) => (a.date < b.date ? -1 : 1));
    state.profile.weight = w;
    if (!silent) save();
  };

  S.removeWeight = function (date) {
    state.profile.weights = state.profile.weights.filter((r) => r.date !== date);
    save();
  };

  /* ---------- 日程 ---------- */

  S.dayItems = (dateKey) => state.schedule[dateKey] || [];

  S.ensureDay = function (dateKey) {
    if (!state.schedule[dateKey]) state.schedule[dateKey] = [];
    return state.schedule[dateKey];
  };

  S.addItem = function (dateKey, item) {
    S.ensureDay(dateKey).push(Object.assign({ id: U.uid(), done: false }, item));
    save();
  };

  S.toggleItem = function (dateKey, id) {
    const it = (state.schedule[dateKey] || []).find((x) => x.id === id);
    if (!it) return;
    it.done = !it.done;
    it.doneAt = it.done ? Date.now() : null;
    save();
    return it;
  };

  S.removeItem = function (dateKey, id) {
    state.schedule[dateKey] = (state.schedule[dateKey] || []).filter((x) => x.id !== id);
    save();
  };

  S.clearSchedule = function () {
    state.schedule = {};
    save();
  };

  S.dayProgress = (dateKey) => App.core.dayProgress(S.dayItems(dateKey));

  /* 按计划重建未来 7 天；保留用户手动添加的条目 */
  S.buildSchedule = function (plan, fromDate) {
    const built = App.core.buildSchedule(plan, state.profile, fromDate || new Date(), U.uid);
    Object.keys(state.schedule).forEach((k) => {
      state.schedule[k] = (state.schedule[k] || []).filter((x) => x.source !== 'plan');
      if (!state.schedule[k].length) delete state.schedule[k];
    });
    Object.keys(built).forEach((k) => {
      state.schedule[k] = (state.schedule[k] || []).concat(built[k]);
    });
    save();
    return built;
  };

  /* ---------- 打卡 ---------- */

  S.checkin = function (dateKey, extra) {
    const prog = S.dayProgress(dateKey);
    const rec = Object.assign({
      ts: Date.now(),
      done: prog.done,
      total: prog.total,
      workDone: prog.workDone,
      workTotal: prog.workTotal,
      mood: 'ok',
      note: '',
    }, extra || {});
    state.checkins[dateKey] = Object.assign(state.checkins[dateKey] || {}, rec);
    save();
    return rec;
  };

  S.hasCheckin = (dateKey) => !!state.checkins[dateKey];
  S.streak = () => App.core.streak(state.checkins, U.dateKey());
  S.adherence = (n) => App.core.adherence(state.schedule, state.checkins, n || 7, U.dateKey());

  /* ---------- 对话 ---------- */

  S.pushChat = function (role, msg) {
    const arr = state.chat[role] || (state.chat[role] = []);
    arr.push(msg);
    if (arr.length > 40) arr.splice(0, arr.length - 40);
    save();
  };

  S.clearChat = function (role) {
    state.chat[role] = [];
    save();
  };

  S.planImportedAt = () => (state.plan ? state.plan.importedAt || null : null);

  /* 只读访问器：视图里可直接读打卡 / 日程表 / 对话 */
  Object.defineProperty(S, 'checkins', { get: () => state.checkins });
  Object.defineProperty(S, 'schedule', { get: () => state.schedule });
  Object.defineProperty(S, 'chat', { get: () => state.chat });
})();
