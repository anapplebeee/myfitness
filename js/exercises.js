/* exercises.js —— 动作库数据 + 肌群示意图 */
(function () {
  const App = (window.App = window.App || {});

  App.groups = {
    chest: '胸大肌',
    back: '背部',
    lats: '背阔肌',
    traps: '斜方肌',
    shoulders: '三角肌前中束',
    rear_delt: '三角肌后束',
    biceps: '肱二头肌',
    triceps: '肱三头肌',
    forearms: '前臂',
    core: '核心',
    quads: '股四头肌',
    hams: '腘绳肌',
    glutes: '臀大肌',
    calves: '小腿三头肌',
    cardio: '心肺',
    full: '全身',
  };

  const C = { primary: '#0e7a63', secondary: '#9ed3c4', base: '#e9efea', ghost: '#f5f8f6' };

  /* 前侧肌群区域几何 */
  const FRONT = [
    { key: 'shoulders', d: '<ellipse cx="37" cy="40" rx="7" ry="6.5"/><ellipse cx="73" cy="40" rx="7" ry="6.5"/>' },
    { key: 'chest', d: '<rect x="43.5" y="44" width="12" height="15" rx="5"/><rect x="54.5" y="44" width="12" height="15" rx="5"/>' },
    { key: 'biceps', d: '<ellipse cx="31" cy="64" rx="5.5" ry="12"/><ellipse cx="79" cy="64" rx="5.5" ry="12"/>' },
    { key: 'forearms', d: '<ellipse cx="27.5" cy="92" rx="4.6" ry="12"/><ellipse cx="82.5" cy="92" rx="4.6" ry="12"/>' },
    { key: 'core', d: '<rect x="46" y="61" width="18" height="33" rx="6"/>' },
    { key: 'quads', d: '<ellipse cx="47" cy="141" rx="7.2" ry="24"/><ellipse cx="63" cy="141" rx="7.2" ry="24"/>' },
    { key: 'calves', d: '<ellipse cx="47" cy="187" rx="5.2" ry="14"/><ellipse cx="63" cy="187" rx="5.2" ry="14"/>' },
  ];
  /* 后侧肌群区域几何 */
  const BACK = [
    { key: 'traps', d: '<path d="M44 32 L66 32 L61 54 L49 54 Z"/>' },
    { key: 'rear_delt', d: '<ellipse cx="37" cy="40" rx="7" ry="6.5"/><ellipse cx="73" cy="40" rx="7" ry="6.5"/>' },
    { key: 'back', d: '<path d="M41.5 54 L53 54 L53 84 L44 88 Z"/><path d="M56.5 54 L68.5 54 L66 88 L57 84 Z"/><rect x="52" y="56" width="6" height="34" rx="3"/>' },
    { key: 'lats', d: '<path d="M41.5 54 L53 54 L53 84 L44 88 Z"/><path d="M56.5 54 L68.5 54 L66 88 L57 84 Z"/>' },
    { key: 'triceps', d: '<ellipse cx="31" cy="64" rx="5.5" ry="12"/><ellipse cx="79" cy="64" rx="5.5" ry="12"/>' },
    { key: 'forearms', d: '<ellipse cx="27.5" cy="92" rx="4.6" ry="12"/><ellipse cx="82.5" cy="92" rx="4.6" ry="12"/>' },
    { key: 'glutes', d: '<ellipse cx="47.5" cy="113" rx="8.5" ry="10"/><ellipse cx="62.5" cy="113" rx="8.5" ry="10"/>' },
    { key: 'hams', d: '<ellipse cx="47" cy="141" rx="7.2" ry="23"/><ellipse cx="63" cy="141" rx="7.2" ry="23"/>' },
    { key: 'calves', d: '<ellipse cx="47" cy="187" rx="5.2" ry="14"/><ellipse cx="63" cy="187" rx="5.2" ry="14"/>' },
  ];

  const SILHOUETTE =
    '<g fill="' + C.ghost + '">' +
    '<circle cx="55" cy="16" r="10"/>' +
    '<rect x="50" y="26" width="10" height="8" rx="3"/>' +
    '<path d="M38 36 h34 l6 26 -4 42 -8 12 h-24 l-8 -12 -4 -42z"/>' +
    '<ellipse cx="32" cy="62" rx="6.4" ry="17"/><ellipse cx="78" cy="62" rx="6.4" ry="17"/>' +
    '<ellipse cx="27.5" cy="92" rx="5" ry="14"/><ellipse cx="82.5" cy="92" rx="5" ry="14"/>' +
    '<ellipse cx="47" cy="141" rx="8.2" ry="27"/><ellipse cx="63" cy="141" rx="8.2" ry="27"/>' +
    '<ellipse cx="47" cy="187" rx="5.6" ry="16"/><ellipse cx="63" cy="187" rx="5.6" ry="16"/>' +
    '</g>';

  function figure(side, colorOf) {
    const regions = side === 'front' ? FRONT : BACK;
    return (
      '<svg viewBox="0 0 110 210" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
      SILHOUETTE +
      regions.map((r) => '<g fill="' + colorOf(r.key) + '">' + r.d + '</g>').join('') +
      '</svg>'
    );
  }

  /* 完整肌群图：主练 (primary) 深色，协同 (secondary) 浅色 */
  App.muscleMap = function (primary, secondary) {
    const pri = new Set(primary || []);
    const sec = new Set(secondary || []);
    const colorOf = (k) => (pri.has(k) ? C.primary : sec.has(k) ? C.secondary : C.base);
    return (
      '<div style="display:flex;gap:6px;align-items:flex-end">' +
      '<div style="flex:1;text-align:center">' + figure('front', colorOf) +
      '<div class="tiny muted" style="margin-top:2px">前侧</div></div>' +
      '<div style="flex:1;text-align:center">' + figure('back', colorOf) +
      '<div class="tiny muted" style="margin-top:2px">后侧</div></div>' +
      '</div>'
    );
  };

  /* 缩略图：只高亮一个动作的主练肌群 */
  App.miniBody = function (group) {
    const hasBack = ['back', 'lats', 'traps', 'glutes', 'hams', 'triceps', 'rear_delt'].indexOf(group) >= 0;
    const side = hasBack ? 'back' : 'front';
    const colorOf = (k) => {
      if (group === 'full' || group === 'cardio') return C.secondary;
      return k === group ? C.primary : C.base;
    };
    return figure(side, colorOf);
  };

  /* ------------------------------------------------------------------ */
  /* 动作库：38 个动作，含步骤 / 呼吸 / 常见错误 / 要点 / 替代            */
  /* level: 1 入门 2 进阶 3 高阶；equipment: barbell|dumbbell|machine|cable|body|kettlebell|cardio */
  /* ------------------------------------------------------------------ */
  App.exercises = [
    /* ---------------- 胸 ---------------- */
    {
      id: 'bb-bench', name: '杠铃卧推', en: 'Barbell Bench Press', group: 'chest',
      secondary: ['triceps', 'shoulders'], equipment: 'barbell', equipmentLabel: '杠铃', level: 2, pattern: '水平推',
      setup: '平凳、深蹲架（带保护杆）；杠铃位于乳头连线上方',
      steps: [
        '仰卧平凳，双脚踩实地面，肩胛骨后缩下沉贴紧凳面，保持自然腰桥',
        '双手略宽于肩握杠，手腕保持中立不后折，出杠后锁定在肩关节正上方',
        '控制 2–3 秒下降，杠铃触及乳头连线附近（不弹胸）',
        '沿略偏向头侧的弧线推起，顶端保持肘微屈，胸肌不收力',
      ],
      breath: '下降时吸气、推起时呼气；大重量可在顶端换气，全程避免屏气过久',
      mistakes: ['肩胛松散、耸肩借力，胸肌失去张力', '落点过高（锁骨上方）造成肩前侧挤压', '臀部离凳过度反弓，缩短行程'],
      tips: ['肘与躯干夹角 45°–60°，不要完全外展 90°', '想象双手把杠铃「向外掰弯」，维持肩外旋张力'],
      alt: ['哑铃卧推', '器械推胸', '俯卧撑'],
      tempo: '3-1-1', sets: 4, reps: '6-8', rest: '120s',
    },
    {
      id: 'db-bench', name: '哑铃卧推', en: 'Dumbbell Bench Press', group: 'chest',
      secondary: ['triceps', 'shoulders'], equipment: 'dumbbell', equipmentLabel: '哑铃', level: 1, pattern: '水平推',
      setup: '平凳 + 一对哑铃，重量以能控制下降为准',
      steps: [
        '坐在凳端，哑铃立于大腿上，借膝盖上顶顺势躺下',
        '肩胛后缩下沉，哑铃在肩关节正上方，掌心朝前',
        '肘部下沉至与躯干约 45°，感觉胸大肌被拉长',
        '沿弧线上推并轻微内收，顶端两只哑铃不碰撞',
      ],
      breath: '下降吸气、推起呼气，节奏与推起速度匹配',
      mistakes: ['下落过深导致肩关节前侧压力骤增', '两侧不同步，重量明显弱侧偏移', '顶端用力夹哑铃，转化不成推力'],
      tips: ['活动度不足者可缩小行程，不要硬拉到极限', '每组末尾可做 2–3 次半程「代谢次数」'],
      alt: ['杠铃卧推', '上斜哑铃卧推', '俯卧撑'],
      tempo: '3-0-1', sets: 4, reps: '8-12', rest: '90s',
    },
    {
      id: 'incline-db', name: '上斜哑铃卧推', en: 'Incline Dumbbell Press', group: 'chest',
      secondary: ['shoulders', 'triceps'], equipment: 'dumbbell', equipmentLabel: '哑铃', level: 2, pattern: '斜推',
      setup: '可调凳设为 30°，角度越高越偏肩前束',
      steps: [
        '靠背上缘不超过锁骨，肩胛贴紧靠背',
        '哑铃沿上胸方向下降至接近腋前线',
        '肘角保持 45°–60°，沿斜上方向推起',
        '顶端不耸肩，感受上胸收缩',
      ],
      breath: '下降吸气、推起呼气',
      mistakes: ['凳角过高（>45°）变成推举', '臀部离凳、腰部过度反弓', '下放过深拉伤肩前侧'],
      tips: ['30° 是上胸参与度与肩部安全的平衡点', '强调离心 2–3 秒，比加重量更有效'],
      alt: ['上斜杠铃卧推', '器械上斜推胸', '下斜俯卧撑'],
      tempo: '3-0-1', sets: 4, reps: '8-12', rest: '90s',
    },
    {
      id: 'cable-fly', name: '绳索夹胸', en: 'Cable Crossover', group: 'chest',
      secondary: ['shoulders'], equipment: 'cable', equipmentLabel: '绳索', level: 1, pattern: '夹',
      setup: '双侧高位滑轮，握把略高于肩',
      steps: [
        '一脚前一脚后站稳，躯干前倾约 10°，核心收紧',
        '肘微屈固定角度，双手沿弧线向体前中线靠拢',
        '最低点双手几乎相触，停顿 1 秒感受胸肌收缩',
        '缓慢还原至胸前有拉伸感，不让配重片归零',
      ],
      breath: '夹胸呼气、还原吸气',
      mistakes: ['用肘屈伸代替肩关节内收', '重量过大导致躯干前后晃动', '还原过快丢掉张力'],
      tips: ['这是一个「感受」动作，重量永远服从于收缩质量', '可换中位/低位滑轮改变刺激区域'],
      alt: ['哑铃飞鸟', '蝴蝶机夹胸', '弹力带夹胸'],
      tempo: '2-1-2', sets: 3, reps: '12-15', rest: '60s',
    },
    {
      id: 'pushup', name: '俯卧撑', en: 'Push-up', group: 'chest',
      secondary: ['triceps', 'core', 'shoulders'], equipment: 'body', equipmentLabel: '自重', level: 1, pattern: '水平推',
      setup: '地面，双手略宽于肩，肩在手腕正上方',
      steps: [
        '头、肩、髋、踝保持一条直线，臀部不塌不翘',
        '肘部沿与躯干约 45° 的方向弯曲，胸口接近地面',
        '掌根发力推开地面，肩胛做前伸动作',
        '顶端不完全放松，保持核心张力进入下一次',
      ],
      breath: '下降吸气、推起呼气',
      mistakes: ['塌腰或撅臀，腰椎代偿', '肘部完全外展成「T」形', '只做半程，胸口离地很远'],
      tips: ['做不到标准次数时，先做上斜俯卧撑而不是跪姿', '收紧臀部和腹部，把自己「变成一块板」'],
      alt: ['上斜俯卧撑', '哑铃卧推', '器械推胸'],
      tempo: '3-0-1', sets: 4, reps: '12-20', rest: '60s',
    },
    {
      id: 'dips', name: '双杠臂屈伸', en: 'Chest Dips', group: 'chest',
      secondary: ['triceps', 'shoulders'], equipment: 'body', equipmentLabel: '自重', level: 3, pattern: '垂直推',
      setup: '双杠，肩关节需有足够活动度',
      steps: [
        '双臂支撑身体，肩胛下沉，躯干前倾约 15°',
        '肘部向后下方弯曲，下降至上臂接近平行地面',
        '胸肌发力推起，顶端不完全锁死肘关节',
        '如肩部不适，立即缩小行程或换动作',
      ],
      breath: '下降吸气、推起呼气',
      mistakes: ['下降过深造成肩关节囊过度牵拉', '耸肩、脖子前伸', '身体摆动借力'],
      tips: ['前倾更多 = 偏胸；躯干垂直 = 偏肱三头', '这是高阶动作，肩部有伤史直接跳过'],
      alt: ['器械臂屈伸', '窄距卧推', '俯卧撑'],
      tempo: '3-0-1', sets: 3, reps: '8-12', rest: '90s',
    },

    /* ---------------- 背 ---------------- */
    {
      id: 'pullup', name: '引体向上', en: 'Pull-up', group: 'lats',
      secondary: ['biceps', 'traps', 'forearms'], equipment: 'body', equipmentLabel: '自重', level: 2, pattern: '垂直拉',
      setup: '单杠，正握略宽于肩',
      steps: [
        '悬垂时肩胛先下沉后收，避免完全松垮的「死挂」',
        '想象用肘部向下拉，把胸口拉向横杠',
        '下巴过杠后控制 2 秒下降，肩胛保持张力',
        '最低点不完全放松，直接进入下一次',
      ],
      breath: '上拉呼气、下降吸气',
      mistakes: ['踢腿摆动借力', '只做上半程，背阔肌未充分缩短', '耸肩，颈部代偿'],
      tips: ['做不起来时用弹力带辅助或做离心引体（跳上去慢慢下）', '肩胛控制比次数更重要'],
      alt: ['高位下拉', '辅助引体机', '弹力带引体'],
      tempo: '2-0-2', sets: 4, reps: '6-10', rest: '120s',
    },
    {
      id: 'lat-pulldown', name: '高位下拉', en: 'Lat Pulldown', group: 'lats',
      secondary: ['biceps', 'traps'], equipment: 'machine', equipmentLabel: '器械', level: 1, pattern: '垂直拉',
      setup: '坐姿下拉器，腿垫固定大腿',
      steps: [
        '正握略宽于肩，躯干后倾约 10°–15° 并保持不动',
        '肩胛先下沉，再用肘部带动把横杆拉向上胸',
        '拉至锁骨附近，肘部指向地面偏后',
        '控制还原至手臂伸直、背阔肌完全拉长',
      ],
      breath: '下拉呼气、还原吸气',
      mistakes: ['用身体后仰的惯性甩重量', '拉到颈后（肩关节高风险）', '握太窄变成练肱二头'],
      tips: ['先想「肘往下走」，而不是「手往下拉」', '还原阶段慢于下拉阶段'],
      alt: ['引体向上', '直臂下压', '坐姿绳索划船'],
      tempo: '2-1-2', sets: 4, reps: '10-12', rest: '90s',
    },
    {
      id: 'bb-row', name: '杠铃划船', en: 'Barbell Row', group: 'back',
      secondary: ['lats', 'biceps', 'core', 'traps'], equipment: 'barbell', equipmentLabel: '杠铃', level: 2, pattern: '水平拉',
      setup: '杠铃，站姿髋铰链前倾约 45°',
      steps: [
        '双脚与髋同宽，屈髋前倾，背部保持中立，核心收紧',
        '杠铃自然垂于膝下，肩胛先收再拉',
        '沿大腿方向把杠铃拉向下腹，肘部贴身向后',
        '顶端挤压肩胛 1 秒，控制下降',
      ],
      breath: '拉起呼气、下降吸气；组前吸气收紧核心',
      mistakes: ['腰部圆背，腰椎承压', '躯干反复起伏借力', '拉向胸口导致斜方肌代偿'],
      tips: ['重量以能保持背部中立为上限', '呼气时不要完全放松核心'],
      alt: ['单臂哑铃划船', '坐姿绳索划船', '器械划船'],
      tempo: '2-1-2', sets: 4, reps: '8-10', rest: '90s',
    },
    {
      id: 'db-row', name: '单臂哑铃划船', en: 'One-arm Dumbbell Row', group: 'back',
      secondary: ['lats', 'biceps'], equipment: 'dumbbell', equipmentLabel: '哑铃', level: 1, pattern: '水平拉',
      setup: '平凳，同侧手膝支撑',
      steps: [
        '支撑侧背部放平，躯干与地面接近平行',
        '哑铃自然下垂，肩胛先向下沉再向后收',
        '把哑铃拉向髋部方向，肘部贴身后拉',
        '控制下降至背阔肌完全拉长',
      ],
      breath: '拉起呼气、下降吸气',
      mistakes: ['躯干旋转借力', '拉向肩部而不是髋部', '两侧次数/重量长期不对称'],
      tips: ['弱侧先做，强侧按弱侧次数对齐', '顶端停 1 秒，比加重量更有效'],
      alt: ['杠铃划船', '坐姿绳索划船', '器械划船'],
      tempo: '2-1-2', sets: 4, reps: '10-12', rest: '75s',
    },
    {
      id: 'seated-row', name: '坐姿绳索划船', en: 'Seated Cable Row', group: 'back',
      secondary: ['lats', 'biceps', 'traps'], equipment: 'cable', equipmentLabel: '绳索', level: 1, pattern: '水平拉',
      setup: '低位滑轮 + V 字把手，膝关节微屈',
      steps: [
        '坐稳，躯干直立，胸口抬起',
        '肩胛后收，把手拉向腹部，肘部贴身后拉',
        '顶端挤压背部 1 秒，躯干不后仰',
        '缓慢前送，感受肩胛前伸、背阔肌拉长',
      ],
      breath: '后拉呼气、前送吸气',
      mistakes: ['躯干大幅后仰形成划船甩动', '耸肩，斜方肌上束抢戏', '行程太短，只拉一半'],
      tips: ['允许肩胛自然前伸再后收，这是水平拉的核心', '把手拉向肚脐而不是胸口'],
      alt: ['杠铃划船', '单臂哑铃划船', '器械划船'],
      tempo: '2-1-2', sets: 3, reps: '12-15', rest: '75s',
    },
    {
      id: 'face-pull', name: '面拉', en: 'Face Pull', group: 'rear_delt',
      secondary: ['traps', 'back'], equipment: 'cable', equipmentLabel: '绳索', level: 1, pattern: '水平拉',
      setup: '滑轮调至面部高度，使用绳索把手',
      steps: [
        '退后一步，手臂伸直，绳索有初始张力',
        '肘部抬起与肩同高，把绳索拉向眉心两侧',
        '末端双手外旋，做出「双肱二头肌」姿势',
        '控制还原，保持肩胛稳定',
      ],
      breath: '后拉呼气、还原吸气',
      mistakes: ['重量过大导致肘部下垂', '躯干后仰借力', '没有末端外旋，只做了后拉'],
      tips: ['这是肩关节健康的「保险动作」，重量要轻', '每周 2–3 次，每次 2–3 组即可'],
      alt: ['俯身反向飞鸟', '弹力带面拉'],
      tempo: '2-1-2', sets: 3, reps: '15-20', rest: '45s',
    },

    /* ---------------- 腿 / 臀 ---------------- */
    {
      id: 'bb-squat', name: '杠铃深蹲', en: 'Barbell Back Squat', group: 'quads',
      secondary: ['glutes', 'hams', 'core', 'back'], equipment: 'barbell', equipmentLabel: '杠铃', level: 2, pattern: '蹲',
      setup: '深蹲架 + 保护杆，杠铃置于斜方肌上部',
      steps: [
        '双脚与肩同宽或略宽，脚尖外展 15°–30°',
        '吸气收紧核心，屈髋屈膝同时下沉，膝盖跟随脚尖方向',
        '下蹲至大腿接近平行地面或略低，背部保持中立',
        '脚掌三点（脚跟、大脚趾、小脚趾）均匀压地，站起',
      ],
      breath: '下蹲前吸气 + 收紧核心，站起过程中呼气',
      mistakes: ['膝盖内扣（Knee valgus）', '底部腰椎弯曲（屁股眨眼）', '重心过度前移，脚跟离地'],
      tips: ['深度以「骨盆不后倾」为界，不为深度牺牲腰椎', '保护杆高度设在大腿下 2–3 cm'],
      alt: ['腿举', '高脚杯深蹲', '史密斯深蹲'],
      tempo: '3-1-1', sets: 4, reps: '6-8', rest: '150s',
    },
    {
      id: 'goblet-squat', name: '高脚杯深蹲', en: 'Goblet Squat', group: 'quads',
      secondary: ['glutes', 'core'], equipment: 'dumbbell', equipmentLabel: '哑铃', level: 1, pattern: '蹲',
      setup: '一只哑铃或壶铃抱于胸前',
      steps: [
        '双手托住哑铃上端，肘部向下，贴近胸口',
        '双脚略宽于肩，脚尖外展，核心收紧',
        '垂直下沉，胸口保持抬起，肘部在膝盖内侧',
        '脚跟发力站起，顶端收紧臀部',
      ],
      breath: '下蹲吸气、站起呼气',
      mistakes: ['哑铃离开胸口，重心前移', '下蹲时含胸圆背', '膝内扣'],
      tips: ['学习深蹲模式最安全的入门动作', '把肘部「顶开」膝盖，防止内扣'],
      alt: ['杠铃深蹲', '腿举', '自重深蹲'],
      tempo: '2-0-1', sets: 4, reps: '10-15', rest: '75s',
    },
    {
      id: 'leg-press', name: '腿举', en: 'Leg Press', group: 'quads',
      secondary: ['glutes', 'hams'], equipment: 'machine', equipmentLabel: '器械', level: 1, pattern: '蹲',
      setup: '45° 腿举机，脚距与肩同宽',
      steps: [
        '背部与臀部完全贴紧靠垫，腰部不留空隙',
        '双脚置于踏板中部，脚尖略外展',
        '控制下降至膝关节约 90°（不追求极限深度）',
        '脚跟发力推起，顶端膝盖保持微屈不锁死',
      ],
      breath: '下降吸气、推起呼气',
      mistakes: ['臀部离垫，腰椎弯曲承压', '膝盖完全锁死形成关节冲击', '下降过深导致骨盆翻转'],
      tips: ['脚位越高越偏臀腿后侧，越低越偏股四头', '手不要推膝盖（常见于力竭时）'],
      alt: ['杠铃深蹲', '高脚杯深蹲', '保加利亚分腿蹲'],
      tempo: '3-0-1', sets: 4, reps: '10-12', rest: '100s',
    },
    {
      id: 'rdl', name: '罗马尼亚硬拉', en: 'Romanian Deadlift', group: 'hams',
      secondary: ['glutes', 'back'], equipment: 'barbell', equipmentLabel: '杠铃', level: 2, pattern: '髋铰链',
      setup: '杠铃，站姿与髋同宽',
      steps: [
        '杠铃贴腿，肩胛微收，膝盖保持微屈并固定角度',
        '以髋为轴向后推臀，杠铃沿腿前侧下降',
        '下降至腘绳肌有明显拉伸（通常膝盖下方），背部始终中立',
        '臀部发力向前顶髋站直，顶端收紧臀肌',
      ],
      breath: '下降吸气、站起呼气',
      mistakes: ['把 RDL 做成硬拉（屈膝过多）', '杠铃离开身体，腰间受力暴增', '为追求深度圆背'],
      tips: ['全程「推臀」而不是「弯腰」', '行程终点由腘绳肌柔韧性决定，不是地面'],
      alt: ['直腿硬拉', '坐姿腿弯举', '臀桥'],
      tempo: '3-1-1', sets: 4, reps: '8-10', rest: '120s',
    },
    {
      id: 'leg-curl', name: '坐姿腿弯举', en: 'Seated Leg Curl', group: 'hams',
      secondary: ['calves'], equipment: 'machine', equipmentLabel: '器械', level: 1, pattern: '屈膝',
      setup: '坐姿腿弯举机，膝轴对齐器械转轴',
      steps: [
        '背部贴紧靠背，腿垫压在跟腱上方',
        '腘绳肌发力屈膝，把腿垫向下压到底',
        '底端停 1 秒，感受大腿后侧收缩',
        '控制还原，不让配重片撞击',
      ],
      breath: '屈膝呼气、还原吸气',
      mistakes: ['臀部离垫抬升', '用惯性甩动', '行程不到位'],
      tips: ['腘绳肌跨膝关节，孤立训练不可省', '脚尖回勾可略增加刺激'],
      alt: ['俯卧腿弯举', '罗马尼亚硬拉', '臀桥'],
      tempo: '2-1-2', sets: 3, reps: '12-15', rest: '60s',
    },
    {
      id: 'hip-thrust', name: '杠铃臀推', en: 'Barbell Hip Thrust', group: 'glutes',
      secondary: ['hams', 'core'], equipment: 'barbell', equipmentLabel: '杠铃', level: 1, pattern: '髋铰链',
      setup: '平凳 + 杠铃 + 护垫，肩胛靠在凳沿',
      steps: [
        '上背（肩胛下缘）靠在凳上，双脚与髋同宽踩实',
        '下巴微收，视线向前，杠铃置于髋部（垫护垫）',
        '臀部发力顶起，直到躯干与大腿成一条直线',
        '顶端停 1–2 秒夹紧臀部，控制下降',
      ],
      breath: '顶髋呼气、下降吸气',
      mistakes: ['顶端腰椎过度反弓（用腰代替臀）', '脚位过远导致腘绳肌抢力', '下巴上扬、颈部后仰'],
      tips: ['顶端靠「夹臀」而不是「塌腰」', '脚位调整到小腿垂直地面'],
      alt: ['臀桥', '罗马尼亚硬拉', '绳索后踢腿'],
      tempo: '1-2-2', sets: 4, reps: '10-12', rest: '90s',
    },
    {
      id: 'bulgarian', name: '保加利亚分腿蹲', en: 'Bulgarian Split Squat', group: 'quads',
      secondary: ['glutes', 'hams', 'core'], equipment: 'dumbbell', equipmentLabel: '哑铃', level: 2, pattern: '弓步',
      setup: '长凳 + 哑铃，后脚脚背置于凳面',
      steps: [
        '后脚背置于凳上，前脚向前约一大步',
        '躯干保持直立或略前倾，核心收紧',
        '垂直下沉至后膝接近地面',
        '前脚全脚掌发力站起，膝盖跟随脚尖',
      ],
      breath: '下沉吸气、站起呼气',
      mistakes: ['前脚离凳太近，膝盖前移过度', '躯干摇晃、重心不稳', '后腿主动发力代偿'],
      tips: ['这是单侧力量的黄金动作，重量从轻开始', '不稳时可先扶固定物'],
      alt: ['行走箭步蹲', '腿举', '台阶踏步'],
      tempo: '2-0-1', sets: 3, reps: '8-12', rest: '90s',
    },
    {
      id: 'lunge', name: '行走箭步蹲', en: 'Walking Lunge', group: 'quads',
      secondary: ['glutes', 'hams', 'core'], equipment: 'dumbbell', equipmentLabel: '哑铃', level: 2, pattern: '弓步',
      setup: '开阔空间 + 一对哑铃',
      steps: [
        '自然站立，双手持哑铃垂于体侧',
        '向前迈一大步，双膝同时弯曲下沉',
        '后膝接近地面但不触地，前膝不内扣',
        '前脚跟发力站起，后腿跟上进入下一步',
      ],
      breath: '下沉吸气、站起呼气',
      mistakes: ['步幅过小，膝盖压力集中', '躯干前倾或左右摇晃', '后膝砸地'],
      tips: ['步幅以「下沉时前小腿接近垂直」为准', '核心收紧能显著改善稳定性'],
      alt: ['保加利亚分腿蹲', '台阶踏步', '原地箭步蹲'],
      tempo: '2-0-1', sets: 3, reps: '10-12', rest: '90s',
    },
    {
      id: 'calf-raise', name: '站姿提踵', en: 'Standing Calf Raise', group: 'calves',
      secondary: [], equipment: 'machine', equipmentLabel: '器械', level: 1, pattern: '屈踝',
      setup: '站姿提踵机，前脚掌踩在踏板边缘',
      steps: [
        '膝盖保持微屈固定，不要用屈膝借力',
        '脚跟下沉至小腿有拉伸感',
        '前脚掌发力顶到最高点，停 1–2 秒',
        '缓慢下降，全程控制',
      ],
      breath: '提起呼气、下降吸气',
      mistakes: ['弹震式快速起落', '行程不足只做上半段', '膝盖反复屈伸借力'],
      tips: ['小腿需要更长 TUT（张力时间），12–20 次更合适', '顶端停顿比加重量有效'],
      alt: ['坐姿提踵', '单腿提踵'],
      tempo: '2-2-2', sets: 4, reps: '15-20', rest: '45s',
    },
    {
      id: 'sumo-dl', name: '相扑硬拉', en: 'Sumo Deadlift', group: 'glutes',
      secondary: ['quads', 'hams', 'back', 'traps'], equipment: 'barbell', equipmentLabel: '杠铃', level: 3, pattern: '髋铰链',
      setup: '杠铃，宽站距，脚尖外展约 45°',
      steps: [
        '站距宽于肩，脚尖外展，杠铃贴小腿',
        '屈髋屈膝下握，背部中立，腋下夹紧',
        '「推地」而非「拉杠」，髋膝同时伸展',
        '站直时收紧臀部，不要过度后仰',
      ],
      breath: '起杠前深吸气 + 收紧核心，锁定后呼气',
      mistakes: ['起始时臀部过高变成硬拉', '膝盖内扣', '锁定阶段腰椎过伸'],
      tips: ['宽站距对髋关节活动度要求高，先做活动度测试', '大重量务必使用腰带与保护'],
      alt: ['传统硬拉', '罗马尼亚硬拉', '臀推'],
      tempo: '1-0-2', sets: 4, reps: '5-6', rest: '180s',
    },

    /* ---------------- 肩 ---------------- */
    {
      id: 'ohp', name: '站姿杠铃推举', en: 'Overhead Press', group: 'shoulders',
      secondary: ['triceps', 'core', 'traps'], equipment: 'barbell', equipmentLabel: '杠铃', level: 2, pattern: '垂直推',
      setup: '深蹲架，杠铃置于锁骨高度',
      steps: [
        '握距略宽于肩，前臂垂直地面',
        '收紧臀部与核心，避免腰椎代偿',
        '杠铃沿面部前方垂直上推，头略后让位',
        '过头后头部回到中立位，杠铃在头顶正上方',
      ],
      breath: '上推呼气、下降吸气；组前吸气收紧核心',
      mistakes: ['腰部过度反弓变成「站姿上斜推」', '杠铃绕过下巴走弧线过大', '手腕后折'],
      tips: ['「夹紧屁股」是防止腰代偿最简单的提示', '肩部活动度不足先用哑铃'],
      alt: ['坐姿哑铃推举', '器械推肩', '阿诺德推举'],
      tempo: '2-0-1', sets: 4, reps: '6-8', rest: '120s',
    },
    {
      id: 'db-press', name: '坐姿哑铃推举', en: 'Seated Dumbbell Press', group: 'shoulders',
      secondary: ['triceps', 'traps'], equipment: 'dumbbell', equipmentLabel: '哑铃', level: 1, pattern: '垂直推',
      setup: '可调凳 80°–85°，背部有支撑',
      steps: [
        '哑铃举至耳侧，肘部略在身体前方',
        '核心收紧、背部贴靠背',
        '沿略向内的弧线推至头顶上方',
        '控制下降至耳侧高度，不砸肩',
      ],
      breath: '上推呼气、下降吸气',
      mistakes: ['凳角过平变成上斜推胸', '下降过深造成肩关节压力', '两侧轨迹不对称'],
      tips: ['肘部保持在身体前侧 15°–30°，肩更安全', '中等重量 + 稳定节奏优于冲重量'],
      alt: ['站姿杠铃推举', '器械推肩', '侧平举'],
      tempo: '2-0-1', sets: 4, reps: '8-12', rest: '90s',
    },
    {
      id: 'lateral-raise', name: '哑铃侧平举', en: 'Dumbbell Lateral Raise', group: 'shoulders',
      secondary: ['traps'], equipment: 'dumbbell', equipmentLabel: '哑铃', level: 1, pattern: '外展',
      setup: '一对轻哑铃，站姿',
      steps: [
        '身体略前倾 5°，哑铃置于体侧',
        '肘部微屈固定，以肩为轴把手臂「向外抬」',
        '抬至与肩同高即可，小指略高于拇指',
        '缓慢下降，到底部保持张力不甩',
      ],
      breath: '抬起呼气、下降吸气',
      mistakes: ['耸肩用斜方肌代偿', '重量过大靠甩', '抬过肩高造成肩峰撞击'],
      tips: ['想象「把手肘向外顶」，而不是「把哑铃举高」', '轻重量、多次数、慢离心'],
      alt: ['绳索侧平举', '器械侧平举', '弹力带外展'],
      tempo: '2-1-2', sets: 4, reps: '12-15', rest: '60s',
    },
    {
      id: 'rear-fly', name: '俯身反向飞鸟', en: 'Bent-over Reverse Fly', group: 'rear_delt',
      secondary: ['traps', 'back'], equipment: 'dumbbell', equipmentLabel: '哑铃', level: 1, pattern: '水平外展',
      setup: '一对轻哑铃，屈髋前倾约 45°',
      steps: [
        '背部中立，核心收紧，哑铃垂于胸下',
        '肘微屈，肩部发力把手臂向两侧打开',
        '打开至与肩同高，肩胛保持稳定不夹紧',
        '控制还原，不让哑铃自由下落',
      ],
      breath: '打开呼气、还原吸气',
      mistakes: ['借助躯干起伏甩动', '耸肩', '把动作做成划船'],
      tips: ['后束常被忽略，每周至少 2 次', '重量宁轻不重，感受后肩发力'],
      alt: ['面拉', '蝴蝶机反向飞鸟', '弹力带拉开'],
      tempo: '2-1-2', sets: 3, reps: '15-20', rest: '45s',
    },

    /* ---------------- 臂 ---------------- */
    {
      id: 'bb-curl', name: '杠铃弯举', en: 'Barbell Curl', group: 'biceps',
      secondary: ['forearms'], equipment: 'barbell', equipmentLabel: '杠铃', level: 1, pattern: '屈肘',
      setup: '曲杆或直杆杠铃，站姿与髋同宽',
      steps: [
        '上臂贴紧体侧固定，肘部不前移',
        '肱二头肌发力屈肘，把杠铃举至肩前',
        '顶端收紧 1 秒，不甩腕',
        '控制 2–3 秒还原至手臂接近伸直',
      ],
      breath: '弯举呼气、还原吸气',
      mistakes: ['肘部前移变成肩前束发力', '躯干后仰甩重量', '行程只有一半'],
      tips: ['上臂不动是这个动作的全部要点', '曲杆（EZ 杆）对手腕更友好'],
      alt: ['哑铃弯举', '锤式弯举', '绳索弯举'],
      tempo: '2-1-3', sets: 3, reps: '10-12', rest: '60s',
    },
    {
      id: 'incline-curl', name: '上斜哑铃弯举', en: 'Incline Dumbbell Curl', group: 'biceps',
      secondary: ['forearms'], equipment: 'dumbbell', equipmentLabel: '哑铃', level: 1, pattern: '屈肘',
      setup: '可调凳 45°–60°，背部贴靠',
      steps: [
        '坐姿后靠，手臂自然下垂于体侧后方',
        '在肩关节伸展位开始弯举（拉长肱二头肌长头）',
        '上臂保持不动，屈肘至顶端',
        '缓慢还原到完全伸展位',
      ],
      breath: '弯举呼气、还原吸气',
      mistakes: ['肩部前移缩短行程', '背部离开靠背', '还原时自由落体'],
      tips: ['长头拉伸位刺激更强，重量要相应降低', '每组末端做 2 次半程可提升泵感'],
      alt: ['杠铃弯举', '锤式弯举'],
      tempo: '2-1-2', sets: 3, reps: '10-12', rest: '60s',
    },
    {
      id: 'hammer-curl', name: '锤式弯举', en: 'Hammer Curl', group: 'biceps',
      secondary: ['forearms'], equipment: 'dumbbell', equipmentLabel: '哑铃', level: 1, pattern: '屈肘',
      setup: '一对哑铃，掌心相对',
      steps: [
        '上臂贴身，掌心相对握哑铃',
        '屈肘举起，全程保持中立握',
        '顶端收紧肱肌与肱桡肌',
        '控制还原',
      ],
      breath: '弯举呼气、还原吸气',
      mistakes: ['借助躯干摆动', '手腕旋转改变握法', '肘部前移'],
      tips: ['中立握对肱肌与肱桡肌刺激更好，能增加手臂围度', '可与弯举做超级组'],
      alt: ['杠铃弯举', '绳索锤式弯举'],
      tempo: '2-1-2', sets: 3, reps: '12-15', rest: '60s',
    },
    {
      id: 'pushdown', name: '绳索下压', en: 'Triceps Pushdown', group: 'triceps',
      secondary: [], equipment: 'cable', equipmentLabel: '绳索', level: 1, pattern: '伸肘',
      setup: '高位滑轮 + 绳索或直杆',
      steps: [
        '上臂贴紧体侧，肘部固定',
        '肱三头肌发力伸肘，把手压至大腿前',
        '底端充分伸直并稍作停顿',
        '控制还原至肘约 90°',
      ],
      breath: '下压呼气、还原吸气',
      mistakes: ['肘部外扩或前移', '躯干前倾压重量', '只做下半程'],
      tips: ['绳索把手可在底端外旋，增强收缩', '上臂「钉」在体侧是关键'],
      alt: ['窄距卧推', '仰卧臂屈伸', '哑铃颈后臂屈伸'],
      tempo: '2-1-2', sets: 3, reps: '12-15', rest: '60s',
    },
    {
      id: 'skull', name: '仰卧臂屈伸', en: 'Skull Crusher', group: 'triceps',
      secondary: [], equipment: 'barbell', equipmentLabel: '杠铃', level: 2, pattern: '伸肘',
      setup: '平凳 + 曲杆，仰卧',
      steps: [
        '手臂垂直地面，上臂略向后倾',
        '保持上臂不动，屈肘把杠铃降至额头上方',
        '肱三头肌发力伸肘还原',
        '顶端不完全锁死，保持张力',
      ],
      breath: '下放吸气、伸肘呼气',
      mistakes: ['上臂移动变成推举', '肘部外展', '下放过快伤及肘关节'],
      tips: ['用曲杆或哑铃更护肘', '重量保守，肘部最怕失控'],
      alt: ['绳索下压', '窄距卧推', '哑铃颈后臂屈伸'],
      tempo: '3-0-1', sets: 3, reps: '10-12', rest: '75s',
    },
    {
      id: 'close-bench', name: '窄距卧推', en: 'Close-grip Bench Press', group: 'triceps',
      secondary: ['chest', 'shoulders'], equipment: 'barbell', equipmentLabel: '杠铃', level: 2, pattern: '水平推',
      setup: '平凳，握距约与肩同宽',
      steps: [
        '握距收窄至与肩同宽，手腕中立',
        '肩胛后缩，肘部贴身下降',
        '杠铃下降至下胸位置',
        '肱三头肌主导推起，肘部保持内收',
      ],
      breath: '下降吸气、推起呼气',
      mistakes: ['握距过窄手腕压力大', '肘部外展变成普通卧推', '落点过高'],
      tips: ['这是能上重量的肱三头动作', '握距以手腕不痛为界'],
      alt: ['绳索下压', '双杠臂屈伸', '仰卧臂屈伸'],
      tempo: '2-0-1', sets: 4, reps: '8-10', rest: '90s',
    },

    /* ---------------- 核心 ---------------- */
    {
      id: 'plank', name: '平板支撑', en: 'Plank', group: 'core',
      secondary: ['shoulders', 'glutes'], equipment: 'body', equipmentLabel: '自重', level: 1, pattern: '抗伸展',
      setup: '地面，肘部在肩关节正下方',
      steps: [
        '前臂撑地，肘在肩下，双脚与髋同宽',
        '收紧臀部与腹部，骨盆略后倾',
        '头、肩、髋、踝保持一条直线',
        '保持均匀呼吸，不憋气',
      ],
      breath: '全程自然呼吸，避免屏气',
      mistakes: ['塌腰，腰椎承受剪切力', '撅臀降低难度', '憋气导致血压升高'],
      tips: ['质量优先：30 秒标准 > 2 分钟塌腰', '能坚持 60 秒后改做负重或单侧变式'],
      alt: ['死虫式', '侧平板', '健腹轮'],
      tempo: '等长', sets: 3, reps: '30-45秒', rest: '45s', unit: '秒',
    },
    {
      id: 'hanging-leg-raise', name: '悬垂举腿', en: 'Hanging Leg Raise', group: 'core',
      secondary: ['forearms', 'lats'], equipment: 'body', equipmentLabel: '自重', level: 3, pattern: '屈髋',
      setup: '单杠，正握悬垂',
      steps: [
        '肩胛下沉稳定，身体不摆动',
        '骨盆后倾，用腹部力量把腿抬起',
        '抬至大腿超过水平，膝可微屈',
        '控制 3 秒下降，避免摆荡',
      ],
      breath: '抬腿呼气、下降吸气',
      mistakes: ['靠摆荡惯性抬腿', '只屈髋不后倾骨盆（练成髂腰肌）', '肩部完全松垮'],
      tips: ['做不到直腿先做屈膝举腿', '骨盆后倾是腹肌真正参与的关键'],
      alt: ['屈膝举腿', '绳索卷腹', '反向卷腹'],
      tempo: '2-0-3', sets: 3, reps: '8-12', rest: '75s',
    },
    {
      id: 'cable-crunch', name: '绳索卷腹', en: 'Cable Crunch', group: 'core',
      secondary: [], equipment: 'cable', equipmentLabel: '绳索', level: 2, pattern: '屈曲',
      setup: '高位滑轮 + 绳索，跪姿',
      steps: [
        '跪于滑轮前，绳索置于头部两侧',
        '髋关节固定，用腹肌把胸廓拉向骨盆',
        '底端充分收缩，腹部缩短',
        '控制还原至腹部拉长但不塌腰',
      ],
      breath: '卷腹呼气、还原吸气',
      mistakes: ['用髋部屈曲代替脊柱屈曲', '重量过大靠手臂拉', '还原时腰椎过伸'],
      tips: ['这是少数能负重的腹肌动作', '想象「把肋骨拉向耻骨」'],
      alt: ['反向卷腹', '悬垂举腿', '器械卷腹'],
      tempo: '2-1-2', sets: 3, reps: '12-15', rest: '60s',
    },
    {
      id: 'deadbug', name: '死虫式', en: 'Dead Bug', group: 'core',
      secondary: [], equipment: 'body', equipmentLabel: '自重', level: 1, pattern: '抗伸展',
      setup: '仰卧，双臂指向天花板，髋膝各 90°',
      steps: [
        '腰部轻贴地面，保持骨盆中立',
        '对侧手脚同时缓慢伸展',
        '腰部始终不离开地面',
        '还原后换另一侧',
      ],
      breath: '伸展时呼气、还原时吸气',
      mistakes: ['腰部拱起离地', '动作过快失去控制', '憋气'],
      tips: ['腰部能夹住一张纸即为合格', '这是腰椎友好度最高的核心动作'],
      alt: ['平板支撑', '鸟狗式', '反向卷腹'],
      tempo: '3-0-3', sets: 3, reps: '10-12', rest: '45s',
    },
    {
      id: 'side-plank', name: '侧平板支撑', en: 'Side Plank', group: 'core',
      secondary: ['glutes', 'shoulders'], equipment: 'body', equipmentLabel: '自重', level: 1, pattern: '抗侧屈',
      setup: '侧卧，肘部在肩下',
      steps: [
        '肘部支撑，身体侧向一条直线',
        '髋部抬起，不前后旋转',
        '上方手臂可叉腰或指向天花板',
        '保持均匀呼吸，两侧时间相同',
      ],
      breath: '自然呼吸',
      mistakes: ['髋部下沉', '身体旋转前倾', '颈部歪斜'],
      tips: ['腹斜肌与侧向稳定性的核心动作', '难度不够可抬起上侧腿'],
      alt: ['平板支撑', '死虫式', '农夫行走'],
      tempo: '等长', sets: 3, reps: '30秒/侧', rest: '45s', unit: '秒',
    },
    {
      id: 'russian-twist', name: '俄罗斯转体', en: 'Russian Twist', group: 'core',
      secondary: [], equipment: 'body', equipmentLabel: '自重', level: 1, pattern: '旋转',
      setup: '坐姿，膝盖弯曲，可抱重物',
      steps: [
        '躯干后倾约 45°，背部保持中立',
        '双手持重物向一侧旋转胸廓',
        '回到中间再转向另一侧',
        '旋转来自胸椎，不是甩手臂',
      ],
      breath: '转体时呼气',
      mistakes: ['只用手臂摆动', '圆背、腰椎屈曲承压', '速度过快失控'],
      tips: ['腰椎不适合大量旋转，重量轻、次数中等', '腰椎有不适史者换死虫式'],
      alt: ['死虫式', '侧平板', '绳索伐木'],
      tempo: '2-0-2', sets: 3, reps: '16-20', rest: '45s',
    },

    /* ---------------- 全身 / 有氧 ---------------- */
    {
      id: 'kb-swing', name: '壶铃摆动', en: 'Kettlebell Swing', group: 'full',
      secondary: ['glutes', 'hams', 'core', 'back'], equipment: 'kettlebell', equipmentLabel: '壶铃', level: 2, pattern: '髋铰链',
      setup: '壶铃，站姿略宽于肩',
      steps: [
        '壶铃置于身前，屈髋前倾双手握住',
        '把壶铃向后「甩」到双腿之间，背部中立',
        '爆发式顶髋，让壶铃借惯性荡至胸高',
        '手臂只是绳子，力量来自髋',
      ],
      breath: '顶髋时短促呼气',
      mistakes: ['用肩部抬举壶铃（变成前平举）', '圆背', '下蹲过多变成深蹲'],
      tips: ['这是髋铰链爆发力动作，不是手臂训练', '每组 10–15 次，质量优先'],
      alt: ['罗马尼亚硬拉', '臀推', '波比跳'],
      tempo: '爆发', sets: 4, reps: '12-15', rest: '75s',
    },
    {
      id: 'farmer-walk', name: '农夫行走', en: 'Farmer Walk', group: 'full',
      secondary: ['core', 'traps', 'forearms'], equipment: 'dumbbell', equipmentLabel: '哑铃', level: 1, pattern: '负重行走',
      setup: '一对重哑铃或壶铃',
      steps: [
        '屈髋屈膝拿起负重，背部中立',
        '站直，肩胛下沉，核心收紧',
        '小步平稳行走，躯干不左右倾斜',
        '保持时间或距离，放下时同样屈髋',
      ],
      breath: '自然呼吸，核心保持张力',
      mistakes: ['耸肩', '身体侧倾', '弯腰放下重量'],
      tips: ['握力与核心的复合训练，非常省时间', '以「走完还能保持姿势」为重量上限'],
      alt: ['侧平板', '硬拉', '负重台阶'],
      tempo: '匀速', sets: 3, reps: '30-40米', rest: '75s', unit: '米',
    },
    {
      id: 'burpee', name: '波比跳', en: 'Burpee', group: 'full',
      secondary: ['chest', 'quads', 'core', 'cardio'], equipment: 'body', equipmentLabel: '自重', level: 2, pattern: '全身',
      setup: '开阔空间，自重',
      steps: [
        '站姿下蹲，双手撑地',
        '双脚后跳成俯卧撑位，可加一次俯卧撑',
        '双脚跳回手边，起身向上跳',
        '落地缓冲，膝盖微屈',
      ],
      breath: '节奏化呼吸，避免长时间屏气',
      mistakes: ['塌腰落地', '膝盖内扣', '为速度牺牲动作质量'],
      tips: ['HIIT 场景使用，单次 20–30 秒为一轮', '心肺基础差者先做「无跳跃版本」'],
      alt: ['壶铃摆动', '划船机', '坡度快走'],
      tempo: '爆发', sets: 4, reps: '20-30秒', rest: '60s', unit: '秒',
    },
    {
      id: 'incline-walk', name: '坡度快走', en: 'Incline Treadmill Walk', group: 'cardio',
      secondary: ['glutes', 'calves'], equipment: 'cardio', equipmentLabel: '有氧器械', level: 1, pattern: '低强度有氧',
      setup: '跑步机，坡度 8%–12%',
      steps: [
        '坡度 8%–12%，速度 4–5.5 km/h',
        '躯干直立，不要扶扶手',
        '全脚掌着地，步频自然',
        '心率维持在最大心率的 60%–70%',
      ],
      breath: '自然呼吸，能说话但不能唱歌的强度',
      mistakes: ['扶扶手导致坡度失效', '速度过快变成跑步', '坡度一次性加到很高'],
      tips: ['减脂期最推荐的有氧：关节压力小、可持续', '每次 30–45 分钟，每周 2–4 次'],
      alt: ['划船机', '动感单车', '椭圆机'],
      tempo: '稳态', sets: 1, reps: '30-45分钟', rest: '—', unit: '分钟',
    },
    {
      id: 'rowing', name: '划船机', en: 'Rowing Machine', group: 'cardio',
      secondary: ['back', 'quads', 'core'], equipment: 'cardio', equipmentLabel: '有氧器械', level: 1, pattern: '低强度有氧',
      setup: '划船机，阻力 4–6 档',
      steps: [
        '顺序：腿 → 髋 → 手（拉）；回程：手 → 髋 → 腿',
        '发力 60% 来自腿部，不是手臂',
        '躯干后倾不超过 15°',
        '回程控制，保持节奏',
      ],
      breath: '拉时呼气、回程吸气',
      mistakes: ['先用手拉', '圆背', '回程过快丢掉节奏'],
      tips: ['关注每 500 米配速，比重更大要有效', '20–30 分钟稳态即可'],
      alt: ['坡度快走', '动感单车', '跳绳'],
      tempo: '稳态', sets: 1, reps: '20-30分钟', rest: '—', unit: '分钟',
    },
    {
      id: 'jump-rope', name: '跳绳', en: 'Jump Rope', group: 'cardio',
      secondary: ['calves', 'core'], equipment: 'cardio', equipmentLabel: '有氧器械', level: 1, pattern: '高强度有氧',
      setup: '跳绳，长度约到腋下',
      steps: [
        '手腕发力摇绳，大臂贴身',
        '前脚掌轻落地，膝微屈缓冲',
        '跳起高度 2–3 cm 即可',
        '按 30 秒跳 / 15 秒歇循环',
      ],
      breath: '节奏化呼吸',
      mistakes: ['大臂甩动', '全脚掌重落地', '跳太高'],
      tips: ['热量消耗高但需要小腿适应', '体重基数大者先从快走过渡'],
      alt: ['波比跳', '划船机', '动感单车'],
      tempo: '间歇', sets: 6, reps: '30秒', rest: '15s', unit: '秒',
    },
  ];

  App.exById = function (id) {
    return App.exercises.find((e) => e.id === id) || null;
  };

  /* 按名称模糊匹配动作库（模型输出的动作名 → 库内动作）
     「哑铃卧推（上斜）」这类写法会先试「上斜哑铃卧推」的组合形式。 */
  App.matchExercise = function (name) {
    if (!name) return null;
    const full = String(name).trim();
    const inner = (full.match(/[（(]([^）)]*)[）)]/) || [])[1] || '';
    const core = full.replace(/[（(][^）)]*[）)]/g, '').replace(/\s/g, '');
    const cands = [full.replace(/\s/g, ''), inner + core, core + inner, core];
    for (let i = 0; i < cands.length; i++) {
      const c = cands[i];
      if (!c) continue;
      const hit = App.exercises.find((e) => e.name === c || (e.en && e.en.toLowerCase() === c.toLowerCase()));
      if (hit) return hit;
    }
    let hit = App.exercises.find((e) => core && (core.indexOf(e.name) >= 0 || e.name.indexOf(core) >= 0));
    if (hit) return hit;
    hit = App.exercises.find((e) => e.alt.some((a) => a === core || a === full));
    return hit || null;
  };
})();
