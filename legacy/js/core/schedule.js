/* core/schedule.js —— 纯函数层：日程构建 / 连续天数 / 依从率
 * 不碰 DOM、不碰存储，只吃数据吐数据。等价于 openGym 的 frontend/src/lib/。
 */
(function () {
  const App = (window.App = window.App || {});
  const U = App.util;
  const C = (App.core = App.core || {});

  /* 一周里哪几天练：2 天 → 周一/周四，3 天 → 一/三/五，以此类推 */
  const PATTERN = {
    2: [1, 4],
    3: [0, 2, 4],
    4: [0, 1, 3, 4],
    5: [0, 1, 2, 3, 5],
    6: [0, 1, 2, 3, 4, 5],
  };

  /**
   * 按计划生成未来 7 天的日程条目（不含用户手动添加的条目）。
   * @param {object} plan    { workout:{days,weeklyDays}, diet:{meals} }
   * @param {object} profile { goal }
   * @param {Date}   fromDate
   * @param {function} makeId () => string
   * @returns {Object<string, Array>} { 'YYYY-MM-DD': items[] }
   */
  C.buildSchedule = function (plan, profile, fromDate, makeId) {
    const uid = makeId || (() => U.uid());
    const start = fromDate || new Date();
    const p = profile || {};
    const days = U.clamp(U.num(plan && plan.workout && plan.workout.weeklyDays, p.weeklyDays || 3), 2, 6);
    const trainIdx = PATTERN[days] || PATTERN[3];
    const wDays = (plan && plan.workout && plan.workout.days) || [];
    const meals = (plan && plan.diet && plan.diet.meals) || [];
    const out = {};

    for (let i = 0; i < 7; i++) {
      const key = U.dateKey(U.addDays(start, i));
      const list = (out[key] = []);

      const slot = trainIdx.indexOf(i);
      if (slot >= 0 && wDays[slot % wDays.length]) {
        const wd = wDays[slot % wDays.length];
        (wd.items || []).forEach((it) => {
          const ex = it.exerciseId ? App.exById(it.exerciseId) : App.matchExercise(it.name);
          list.push({
            id: uid(),
            source: 'plan',
            type: 'workout',
            done: false,
            title: it.name,
            detail: [it.sets ? it.sets + ' 组' : '', it.reps ? '× ' + it.reps : '', it.rest ? '· 休息 ' + it.rest : '']
              .filter(Boolean).join(' '),
            exerciseId: ex ? ex.id : null,
            note: it.note || '',
            dayLabel: 'D' + wd.day + ' ' + (wd.focusLabel || wd.focus || ''),
          });
        });
      } else if (p.goal === 'cut') {
        list.push({
          id: uid(), source: 'plan', type: 'cardio', done: false,
          title: '坡度快走 30 分钟', detail: '坡度 8–10% · 心率 60–70% 最大心率',
          exerciseId: 'incline-walk', note: '休息日做低强度有氧，不抢恢复',
        });
      } else {
        list.push({
          id: uid(), source: 'plan', type: 'rest', done: false,
          title: '休息日', detail: '睡眠 7–9 小时 · 步行 6000 步以上', exerciseId: null, note: '',
        });
      }

      meals.forEach((m) => {
        list.push({
          id: uid(), source: 'plan', type: 'meal', done: false,
          title: m.slot + '（' + m.kcal + ' kcal · 蛋白 ' + m.protein + ' g）',
          detail: (m.items || []).map((x) => x.name + ' ' + x.amount).join('、'),
          time: m.time,
          note: m.tip || '',
          exerciseId: null,
        });
      });
    }
    return out;
  };

  /** 连续打卡天数：今天没签就从昨天往前数 */
  C.streak = function (checkins, todayKey) {
    const map = checkins || {};
    const today = todayKey || U.dateKey();
    let cur = U.parseKey(today);
    let n = 0;
    if (!map[today]) cur = U.addDays(cur, -1);
    while (map[U.dateKey(cur)]) {
      n++;
      cur = U.addDays(cur, -1);
    }
    return n;
  };

  /** 近 n 天完成率 */
  C.adherence = function (schedule, checkins, days, todayKey) {
    const sch = schedule || {};
    const map = checkins || {};
    const today = U.parseKey(todayKey || U.dateKey());
    let done = 0, total = 0, checked = 0;
    for (let i = 0; i < (days || 7); i++) {
      const k = U.dateKey(U.addDays(today, -i));
      const list = sch[k] || [];
      total += list.length;
      done += list.filter((x) => x.done).length;
      if (map[k]) checked++;
    }
    return { done, total, pct: total > 0 ? Math.round((done / total) * 100) : 0, checked, days: days || 7 };
  };

  /** 单日进度 */
  C.dayProgress = function (items) {
    const list = items || [];
    const done = list.filter((x) => x.done).length;
    const work = list.filter((x) => x.type === 'workout' || x.type === 'cardio');
    return {
      total: list.length,
      done,
      pct: list.length ? Math.round((done / list.length) * 100) : 0,
      workTotal: work.length,
      workDone: work.filter((x) => x.done).length,
    };
  };
})();
