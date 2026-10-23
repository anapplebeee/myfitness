/* engine.js —— 本地专家引擎：代谢计算 / 训练分期 / 饮食配餐 / 体重趋势
 * 说明：这是模型的兜底实现。未配置 API Key 时，全部「专家建议」由这里按运动营养学
 * 常规做法生成（Mifflin-St Jeor、能量平衡、蛋白质 1.6–2.2 g/kg、渐进超负荷）。
 */
(function () {
  const App = (window.App = window.App || {});
  const U = App.util;
  const E = (App.engine = {});

  const ACTIVITY = {
    1.2: '久坐（几乎不运动）',
    1.375: '轻度活动（每周 1–3 次训练）',
    1.55: '中度活动（每周 3–5 次训练）',
    1.725: '高度活动（每周 6–7 次训练）',
  };
  const GOAL_LABEL = { cut: '减脂', recomp: '身体重组', bulk: '增肌' };
  const EXP_LABEL = { beginner: '新手（0–1 年）', intermediate: '进阶（1–3 年）', advanced: '高阶（3 年以上）' };
  const EQUIP_LABEL = { gym: '健身房（器械齐全）', home: '家庭（哑铃+自重）', body: '自重为主' };
  E.ACTIVITY = ACTIVITY;
  E.GOAL_LABEL = GOAL_LABEL;
  E.EXP_LABEL = EXP_LABEL;
  E.EQUIP_LABEL = EQUIP_LABEL;

  /* ---------------- 代谢 ---------------- */
  E.bmr = function (p, weight) {
    const w = U.num(weight, p.weight);
    const h = U.num(p.height, 175);
    const a = U.num(p.age, 30);
    const base = 10 * w + 6.25 * h - 5 * a;
    return Math.round(p.sex === 'female' ? base - 161 : base + 5);
  };

  E.tdee = function (p, weight) {
    return Math.round(E.bmr(p, weight) * U.num(p.activity, 1.375));
  };

  E.targets = function (p, weight) {
    const w = U.num(weight, p.weight);
    const tdee = E.tdee(p, w);
    const goal = p.goal || 'recomp';
    const factor = goal === 'cut' ? 0.8 : goal === 'bulk' ? 1.12 : 0.95;
    let kcal = Math.round(tdee * factor);
    const floor = p.sex === 'female' ? 1200 : 1500;
    kcal = Math.max(floor, Math.round(kcal / 10) * 10);

    const bmi = E.bmi(w, p.height);
    const refW = bmi >= 28 && p.targetWeight ? Math.max(p.targetWeight, w * 0.8) : w;
    const pPerKg = goal === 'cut' ? 2.0 : goal === 'bulk' ? 1.8 : 1.9;
    const protein = Math.round(refW * pPerKg);
    const fat = Math.max(Math.round(refW * 0.9), 40);
    const carb = Math.max(Math.round((kcal - protein * 4 - fat * 9) / 4), 60);
    return {
      kcal,
      protein,
      fat,
      carb,
      tdee,
      bmr: E.bmr(p, w),
      pPct: Math.round(((protein * 4) / kcal) * 100),
      cPct: Math.round(((carb * 4) / kcal) * 100),
      fPct: Math.round(((fat * 9) / kcal) * 100),
    };
  };

  E.bmi = function (w, h) {
    h = U.num(h, 175) / 100;
    if (!h) return 0;
    return U.round(U.num(w) / (h * h), 1);
  };
  E.bmiLabel = function (bmi) {
    if (bmi < 18.5) return '偏瘦';
    if (bmi < 24) return '正常';
    if (bmi < 28) return '超重';
    return '肥胖';
  };

  /* ---------------- 训练分期 ---------------- */
  const POOL = {
    push: ['bb-bench', 'incline-db', 'db-bench', 'pushup', 'ohp', 'db-press', 'lateral-raise', 'pushdown', 'cable-fly', 'rear-fly'],
    pull: ['lat-pulldown', 'bb-row', 'db-row', 'seated-row', 'pullup', 'face-pull', 'bb-curl', 'hammer-curl', 'incline-curl'],
    legs: ['bb-squat', 'leg-press', 'goblet-squat', 'rdl', 'leg-curl', 'hip-thrust', 'bulgarian', 'calf-raise'],
    upper: ['bb-bench', 'bb-row', 'ohp', 'lat-pulldown', 'incline-db', 'seated-row', 'lateral-raise', 'pushdown', 'bb-curl', 'face-pull'],
    lower: ['bb-squat', 'rdl', 'leg-press', 'leg-curl', 'hip-thrust', 'bulgarian', 'calf-raise'],
    full: ['bb-squat', 'bb-bench', 'bb-row', 'ohp', 'rdl', 'lat-pulldown', 'farmer-walk'],
    core: ['plank', 'deadbug', 'cable-crunch', 'side-plank', 'hanging-leg-raise'],
  };
  const FOCUS_CN = {
    push: '推（胸·肩·三头）', pull: '拉（背·后肩·二头）', legs: '腿（股四·腘绳·臀）',
    upper: '上肢', lower: '下肢', full: '全身', core: '核心',
  };

  E.splitFor = function (days) {
    switch (days) {
      case 2: return [{ focus: 'full' }, { focus: 'full' }];
      case 3: return [{ focus: 'push' }, { focus: 'pull' }, { focus: 'legs' }];
      case 4: return [{ focus: 'upper' }, { focus: 'lower' }, { focus: 'upper' }, { focus: 'lower' }];
      case 5: return [{ focus: 'push' }, { focus: 'pull' }, { focus: 'legs' }, { focus: 'upper' }, { focus: 'lower' }];
      default: return [{ focus: 'push' }, { focus: 'pull' }, { focus: 'legs' }, { focus: 'push' }, { focus: 'pull' }, { focus: 'legs' }];
    }
  };

  function allowed(ex, equipment, exp) {
    const eq = equipment || 'gym';
    if (ex.equipment === 'cardio') return true;
    if (eq === 'body' && !(ex.equipment === 'body')) return false;
    if (eq === 'home' && !(ex.equipment === 'body' || ex.equipment === 'dumbbell' || ex.equipment === 'kettlebell')) return false;
    const maxLevel = exp === 'beginner' ? 2 : 3;
    return ex.level <= maxLevel;
  }

  function scheme(goal, exp) {
    if (goal === 'cut') return { sets: exp === 'beginner' ? 3 : 4, reps: '10-12', rest: '60-75s' };
    if (goal === 'bulk') return { sets: 4, reps: exp === 'beginner' ? '8-10' : '6-8', rest: '120s' };
    return { sets: 3, reps: '8-12', rest: '90s' };
  }

  E.buildWorkout = function (p) {
    const days = U.clamp(U.num(p.weeklyDays, 3), 2, 6);
    const gear = p.equipment || 'gym';
    const exp = p.experience || 'beginner';
    const goal = p.goal || 'recomp';
    const sc = scheme(goal, exp);
    const count = exp === 'beginner' ? 5 : 6;
    const split = E.splitFor(days);

    const planDays = split.map((d, i) => {
      const pool = POOL[d.focus].map((id) => App.exById(id)).filter((e) => e && allowed(e, gear, exp));
      /* 复合动作优先（level 高、动作模式为推/拉/蹲/髋铰链） */
      const compound = pool.filter((e) => ['水平推', '垂直推', '水平拉', '垂直拉', '蹲', '髋铰链', '弓步'].indexOf(e.pattern) >= 0);
      const iso = pool.filter((e) => compound.indexOf(e) < 0);
      const picked = compound.slice(0, Math.min(compound.length, Math.max(3, count - 2)))
        .concat(iso.slice(0, Math.max(1, count - Math.min(compound.length, Math.max(3, count - 2)))));
      const items = picked.map((e, idx) => ({
        name: e.name,
        exerciseId: e.id,
        sets: sc.sets,
        reps: e.unit && e.unit !== '次' ? e.reps : sc.reps,
        rest: e.rest || sc.rest,
        note: idx === 0 ? '主项：先做，状态最好时完成' : '',
      }));
      /* 核心收尾 */
      const corePool = POOL.core.map((id) => App.exById(id)).filter((e) => allowed(e, gear, exp));
      if (corePool.length) {
        const ce = corePool[i % corePool.length];
        items.push({ name: ce.name, exerciseId: ce.id, sets: 3, reps: ce.reps, rest: ce.rest, note: '收尾：控制质量优先' });
      }
      return { day: i + 1, focus: d.focus, focusLabel: FOCUS_CN[d.focus], items };
    });

    return {
      title: (goal === 'cut' ? '减脂期' : goal === 'bulk' ? '增肌期' : '重组期') + ' · ' + days + '天分化',
      splitLabel: split.map((d) => FOCUS_CN[d.focus]).join(' / '),
      weeklyDays: days,
      weeks: goal === 'cut' ? 8 : 12,
      source: 'engine',
      days: planDays,
    };
  };

  E.buildDiet = function (p, targets) {
    const t = targets || E.targets(p);
    const nMeals = U.clamp(U.num(p.mealsPerDay, 4), 3, 5);
    const veggie = p.dietStyle === 'vegetarian';
    const quick = p.dietStyle === 'quick';

    const SLOTS = {
      3: [['早餐', '07:30', 0.30], ['午餐', '12:15', 0.38], ['晚餐', '19:00', 0.32]],
      4: [['早餐', '07:30', 0.27], ['午餐', '12:15', 0.33], ['加餐', '16:00', 0.12], ['晚餐', '19:30', 0.28]],
      5: [['早餐', '07:00', 0.24], ['上午加餐', '10:00', 0.10], ['午餐', '12:30', 0.30], ['训练后', '17:00', 0.12], ['晚餐', '19:30', 0.24]],
    };
    const lib = {
      早餐: veggie ? ['鸡蛋', '希腊酸奶', '牛奶'] : ['鸡蛋', '希腊酸奶', '牛奶'],
      午餐: veggie ? ['北豆腐', '毛豆', '鸡蛋'] : ['鸡胸肉', '牛腱肉', '虾仁', '三文鱼'],
      晚餐: veggie ? ['北豆腐', '毛豆', '希腊酸奶'] : ['鳕鱼', '鸡腿肉', '牛里脊', '北豆腐'],
      加餐: ['希腊酸奶', '乳清蛋白粉', '鸡蛋'],
      上午加餐: ['希腊酸奶', '乳清蛋白粉'],
      训练后: ['乳清蛋白粉', '香蕉'],
    };
    const carbLib = {
      早餐: ['燕麦片', '全麦面包', '红薯'],
      午餐: ['米饭', '糙米饭', '藜麦'],
      晚餐: ['红薯', '玉米', '土豆', '紫薯'],
      加餐: ['香蕉', '苹果', '蓝莓'],
      上午加餐: ['香蕉', '苹果'],
      训练后: ['香蕉', '全麦面包'],
    };
    const vegLib = { 早餐: ['番茄'], 午餐: ['西兰花', '芦笋', '甜椒'], 晚餐: ['菠菜', '娃娃菜', '黄瓜'], 加餐: [], 上午加餐: [], 训练后: [] };
    const fatLib = { 早餐: ['混合坚果'], 午餐: ['橄榄油'], 晚餐: ['牛油果', '橄榄油'], 加餐: ['混合坚果'], 上午加餐: ['混合坚果'], 训练后: [] };

    const pick = (arr) => (arr && arr.length ? arr[Math.floor(Math.random() * arr.length)] : null);

    /* 份量展示：鸡蛋按个，其余按克 */
    const fmtAmount = (food, g) => {
      if (food.name.indexOf('鸡蛋') >= 0 && g >= 45) return Math.round(g / 50) + ' 个（约 ' + Math.round(g) + ' g）';
      return Math.round(g) + ' g';
    };

    /* 求解顺序：蛋白 → 脂肪 → 蔬菜 → 碳水按剩余热量补足。
       这样 p / f 精确命中目标，热量必然落在目标上，碳水自动自洽。 */
    const compose = (pT, fT, kT, foods) => {
      const pFood = foods.pFood, cFood = foods.cFood, vFood = foods.vFood, ftFood = foods.ftFood;
      let pG = 0, ftG = 0, vG = 0, cG = 0;
      let accK = 0, accP = 0, accC = 0, accF = 0;

      if (pFood && pFood.p > 0 && pT > 0) {
        pG = U.clamp(Math.round(((pT / pFood.p) * 100) / 5) * 5, 30, 400);
        const k = pG / 100;
        accK += pFood.kcal * k; accP += pFood.p * k; accC += pFood.c * k; accF += pFood.f * k;
      }
      if (ftFood && ftFood.f > 0) {
        const need = fT - accF;
        if (need > 3) {
          ftG = U.clamp(Math.round((need / ftFood.f) * 100), 5, 40);
          const k = ftG / 100;
          accK += ftFood.kcal * k; accP += ftFood.p * k; accC += ftFood.c * k; accF += ftFood.f * k;
        }
      }
      if (vFood) {
        vG = 150;
        const k = vG / 100;
        accK += vFood.kcal * k; accP += vFood.p * k; accC += vFood.c * k; accF += vFood.f * k;
      }
      if (cFood && cFood.kcal > 0) {
        const remain = kT - accK;
        if (remain > 40) cG = U.clamp(Math.round(remain / (cFood.kcal / 100) / 5) * 5, 20, 350);
      }
      return { pG, ftG, vG, cG, accK, accP, accC, accF };
    };

    const meals = SLOTS[nMeals].map((s) => {
      const slot = s[0];
      const pTarget = t.protein * s[2];
      const fTarget = t.fat * s[2];
      const kTarget = t.kcal * s[2];

      const foods = {
        pFood: App.foodByName(pick(lib[slot]) || '鸡蛋'),
        cFood: App.foodByName(pick(carbLib[slot]) || '米饭（熟）'),
        vFood: App.foodByName(pick(vegLib[slot]) || ''),
        ftFood: App.foodByName(pick(fatLib[slot]) || ''),
      };

      /* 主食、蔬菜、坚果本身也带蛋白，先把这部分量出来再从蛋白目标里扣。
         碳水份量随蛋白目标变化，所以迭代到「总蛋白 ≈ 目标」为止（最多 4 轮）。 */
      let sol = compose(pTarget, fTarget, kTarget, foods);
      for (let round = 0; round < 4; round++) {
        if (Math.abs(sol.accP - pTarget) < Math.max(2, pTarget * 0.05)) break;
        const otherP = sol.accP - (foods.pFood ? (foods.pFood.p * sol.pG) / 100 : 0);
        const next = compose(Math.max(pTarget - otherP, pTarget * 0.55), fTarget, kTarget, foods);
        if (next.pG === sol.pG && next.cG === sol.cG) break;
        sol = next;
      }

      const pG = sol.pG, cG = sol.cG, vG = sol.vG, ftG = sol.ftG;
      const pFood = foods.pFood, cFood = foods.cFood, vFood = foods.vFood, ftFood = foods.ftFood;

      const items = [];
      const push = (food, g) => {
        if (!food || !g) return;
        const k = g / 100;
        items.push({
          name: food.name, amount: fmtAmount(food, g),
          kcal: Math.round(food.kcal * k), protein: Math.round(food.p * k),
          carb: Math.round(food.c * k), fat: Math.round(food.f * k),
        });
      };
      push(pFood, pG);
      push(cFood, cG);
      push(vFood, vG);
      push(ftFood, ftG);

      const kcal = items.reduce((a, b) => a + b.kcal, 0);
      const protein = items.reduce((a, b) => a + b.protein, 0);
      const carb = items.reduce((a, b) => a + b.carb, 0);
      const fat = items.reduce((a, b) => a + b.fat, 0);

      const tips = {
        早餐: '蛋白质优先，别只吃碳水',
        午餐: '主食称重一次，之后按体积估',
        晚餐: '睡前 2 小时吃完，蛋白别省',
        加餐: '加餐目的是补足蛋白缺口',
        上午加餐: '训练前 1 小时优先碳水',
        训练后: '训练后 60 分钟内补蛋白 20–30 g',
      };
      return {
        slot,
        time: s[1],
        items,
        kcal,
        protein,
        carb,
        fat,
        targetKcal: Math.round(kTarget),
        tip: quick ? tips[slot] : '',
      };
    });

    return {
      targets: t,
      meals,
      source: 'engine',
      notes: [
        '每日饮水 30–40 ml/kg，训练日再加 500 ml。',
        '每周同一时间称重 3–5 次取均值，看周均而不是单日。',
        '蔬菜 300–500 g/天，水果 200–300 g/天，不必精确到克。',
      ],
    };
  };

  /* ---------------- 计划装配 ---------------- */
  E.buildPlan = function (p) {
    const t = E.targets(p);
    const workout = E.buildWorkout(p);
    const diet = E.buildDiet(p, t);
    return { workout, diet, createdAt: Date.now(), source: 'engine' };
  };

  /* ---------------- 体重趋势 ---------------- */
  E.analyzeWeight = function (records, p) {
    const list = (records || []).slice().sort((a, b) => (a.date < b.date ? -1 : 1));
    if (!list.length) return null;
    const latest = list[list.length - 1];
    const first = list[0];
    const w7 = valueBefore(list, 7);
    const w28 = valueBefore(list, 28);
    const bmi = E.bmi(latest.weight, p.height);
    const trend7 = w7 ? U.round((latest.weight - w7.weight) / Math.max(1, U.diffDays(U.parseKey(latest.date), U.parseKey(w7.date)) / 7), 2) : 0;
    const spanDays = Math.max(1, U.diffDays(U.parseKey(latest.date), U.parseKey(first.date)));
    const slopePerWeek = U.round(((latest.weight - first.weight) / spanDays) * 7, 2);
    const targetW = U.num(p.targetWeight, 0);
    const remain = targetW ? U.round(latest.weight - targetW, 1) : 0;
    const etaWeeks = targetW && Math.abs(slopePerWeek) > 0.05 && Math.sign(remain) === Math.sign(slopePerWeek)
      ? Math.ceil(Math.abs(remain / slopePerWeek)) : null;

    let flag = null;
    if (trend7 && Math.abs(trend7) > latest.weight * 0.01) {
      flag = '近 7 天周变化 ' + trend7 + ' kg，超过体重的 1%／周，减重速度偏快（快速减重会优先损失肌肉与力量）';
    }
    return {
      latest, first, bmi, bmiLabel: E.bmiLabel(bmi), trend7, slopePerWeek,
      remain, etaWeeks, flag, count: list.length,
      spanDays, totalDelta: U.round(latest.weight - first.weight, 1),
      w28delta: w28 ? U.round(latest.weight - w28.weight, 1) : null,
    };
  };

  function valueBefore(list, days) {
    const target = U.addDays(new Date(), -days);
    let hit = null;
    for (const r of list) {
      if (U.parseKey(r.date) <= target) hit = r;
    }
    return hit;
  }

  /* ---------------- 给模型的上下文摘要 ---------------- */
  E.profileContext = function (p) {
    const t = E.targets(p);
    const w = E.analyzeWeight(p.weights, p);
    return {
      性别: p.sex === 'female' ? '女' : '男',
      年龄: p.age,
      身高cm: p.height,
      当前体重kg: p.weight,
      目标体重kg: p.targetWeight,
      BMI: w ? w.bmi + '（' + w.bmiLabel + '）' : null,
      训练经验: EXP_LABEL[p.experience] || p.experience,
      每周训练天数: p.weeklyDays,
      可用器械: EQUIP_LABEL[p.equipment] || p.equipment,
      目标: GOAL_LABEL[p.goal] || p.goal,
      饮食偏好: p.dietStyle || 'normal',
      每日餐次: p.mealsPerDay,
      基础代谢kcal: t.bmr,
      每日消耗kcal: t.tdee,
      建议摄入kcal: t.kcal,
      蛋白质g: t.protein,
      碳水g: t.carb,
      脂肪g: t.fat,
      近7天周体重变化: U.round(p.weights && p.weights.length > 3 ? (p.weights[p.weights.length - 1].weight - (p.weights[Math.max(0, p.weights.length - 5)].weight)) : 0, 2),
    };
  };
})();
