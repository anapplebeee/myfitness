/**
 * 从 free-exercise-db 构建"精选"扩展包。
 *
 * 设计立场：
 * - 上游 876 条里绝大多数没有可靠中文名。机器拼接会产出
 *   "杠铃臀臀桥""背飞鸟弹力带""辅助拉上"这类错误译名，
 *   对中文用户是误导，比不提供更糟。
 * - 因此只收录**人工确认过中文名**的动作，其余不收录。
 *
 * 授权：free-exercise-db 以 Unlicense（公有领域）发布，
 * 可自由复制、修改、分发、商用，无署名义务。本包仍保留来源以便追溯。
 *
 * 用法：node scripts/build-exercise-pack.mjs <exercises.json>
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const UPSTREAM_URL = 'https://github.com/yuhonas/free-exercise-db';
const PACKAGE_ID = 'lianji-exercises-ext';
const PACKAGE_VERSION = 1;

/** 人工确认的映射：上游 id → [中文名, 肌群, 模式]。 */
const CURATED = {
  Barbell_Squat: ['杠铃深蹲', 'legs', 'load_reps'],
  Front_Squat_Clean_Grip: ['杠铃前蹲', 'legs', 'load_reps'],
  Goblet_Squat: ['高脚杯深蹲', 'legs', 'load_reps'],
  Barbell_Hack_Squat: ['杠铃哈克深蹲', 'legs', 'load_reps'],
  Leg_Press: ['腿举', 'legs', 'load_reps'],
  Leg_Extensions: ['腿屈伸', 'legs', 'load_reps'],
  Lying_Leg_Curls: ['俯卧腿弯举', 'legs', 'load_reps'],
  Seated_Leg_Curl: ['坐姿腿弯举', 'legs', 'load_reps'],
  Barbell_Lunge: ['杠铃箭步蹲', 'legs', 'load_reps'],
  Dumbbell_Lunges: ['哑铃箭步蹲', 'legs', 'load_reps'],

  Romanian_Deadlift: ['罗马尼亚硬拉', 'legs', 'load_reps'],
  Barbell_Deadlift: ['杠铃硬拉', 'back', 'load_reps'],
  Sumo_Deadlift: ['相扑硬拉', 'legs', 'load_reps'],
  Standing_Calf_Raises: ['站姿提踵', 'legs', 'load_reps'],
  Seated_Calf_Raise: ['坐姿提踵', 'legs', 'load_reps'],

  Barbell_Hip_Thrust: ['杠铃臀推', 'glutes', 'load_reps'],
  Barbell_Glute_Bridge: ['杠铃臀桥', 'glutes', 'load_reps'],

  'Barbell_Bench_Press_-_Medium_Grip': ['杠铃卧推', 'chest', 'load_reps'],
  Incline_Dumbbell_Press: ['上斜哑铃卧推', 'chest', 'load_reps'],
  Decline_Barbell_Bench_Press: ['下斜杠铃卧推', 'chest', 'load_reps'],
  Dumbbell_Flyes: ['哑铃飞鸟', 'chest', 'load_reps'],
  Cable_Crossover: ['绳索夹胸', 'chest', 'load_reps'],
  Pushups: ['俯卧撑', 'chest', 'reps'],
  'Dips_-_Chest_Version': ['双杠臂屈伸（胸）', 'chest', 'reps'],

  Pullups: ['引体向上', 'back', 'reps'],
  'Chin-Up': ['反手引体', 'back', 'reps'],
  'Wide-Grip_Lat_Pulldown': ['宽握高位下拉', 'back', 'load_reps'],
  'Close-Grip_Front_Lat_Pulldown': ['窄握高位下拉', 'back', 'load_reps'],
  Bent_Over_Barbell_Row: ['杠铃俯身划船', 'back', 'load_reps'],
  'Bent_Over_Two-Dumbbell_Row': ['单臂哑铃划船', 'back', 'load_reps'],
  Seated_Cable_Rows: ['坐姿绳索划船', 'back', 'load_reps'],
  Face_Pull: ['面拉', 'back', 'load_reps'],
  Barbell_Shrug: ['杠铃耸肩', 'back', 'load_reps'],

  Barbell_Shoulder_Press: ['杠铃肩推', 'shoulders', 'load_reps'],
  Seated_Dumbbell_Press: ['坐姿哑铃推举', 'shoulders', 'load_reps'],
  Arnold_Dumbbell_Press: ['阿诺德推举', 'shoulders', 'load_reps'],
  Side_Lateral_Raise: ['侧平举', 'shoulders', 'load_reps'],
  Front_Dumbbell_Raise: ['哑铃前平举', 'shoulders', 'load_reps'],
  Reverse_Flyes: ['反向飞鸟', 'shoulders', 'load_reps'],
  Upright_Barbell_Row: ['直立划船', 'shoulders', 'load_reps'],

  Barbell_Curl: ['杠铃弯举', 'arms', 'load_reps'],
  Dumbbell_Bicep_Curl: ['哑铃弯举', 'arms', 'load_reps'],
  Hammer_Curls: ['锤式弯举', 'arms', 'load_reps'],
  Preacher_Curl: ['牧师凳弯举', 'arms', 'load_reps'],
  Concentration_Curls: ['集中弯举', 'arms', 'load_reps'],
  Triceps_Pushdown: ['绳索下压', 'arms', 'load_reps'],
  'Dips_-_Triceps_Version': ['双杠臂屈伸（三头）', 'arms', 'reps'],
  'Close-Grip_Barbell_Bench_Press': ['窄距卧推', 'arms', 'load_reps'],
  Standing_Dumbbell_Triceps_Extension: ['站姿哑铃臂屈伸', 'arms', 'load_reps'],

  Plank: ['平板支撑', 'core', 'duration'],
  Side_Bridge: ['侧平板', 'core', 'duration'],
  Cable_Crunch: ['绳索卷腹', 'core', 'load_reps'],
  Hanging_Leg_Raise: ['悬垂举腿', 'core', 'reps'],
  Russian_Twist: ['俄罗斯转体', 'core', 'reps'],
  Dead_Bug: ['死虫式', 'core', 'reps'],

  Ab_Roller: ['健腹轮', 'core', 'load_reps'],

  Rowing_Stationary: ['划船机', 'cardio', 'distance_duration'],
  Running_Treadmill: ['跑步机', 'cardio', 'distance_duration'],
  Elliptical_Trainer: ['椭圆机', 'cardio', 'distance_duration'],
  Bicycling_Stationary: ['动感单车', 'cardio', 'distance_duration'],
  Stairmaster: ['登阶机', 'cardio', 'distance_duration'],
};

const EQUIPMENT_MAP = {
  'body only': '自重',
  barbell: '杠铃',
  dumbbell: '哑铃',
  cable: '器械',
  machine: '器械',
  kettlebells: '壶铃',
  bands: '弹力带',
  'medicine ball': '药球',
  'exercise ball': '瑞士球',
  'e-z curl bar': '曲杆',
  other: '其他',
};

function canonicalize(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  const out = {};
  for (const k of Object.keys(value).sort()) {
    if (value[k] === undefined) continue;
    out[k] = canonicalize(value[k]);
  }
  return out;
}

const inputPath = process.argv[2];
if (!inputPath) {
  console.error('用法: node scripts/build-exercise-pack.mjs <exercises.json>');
  process.exit(1);
}

const raw = JSON.parse(await readFile(inputPath, 'utf8'));
const byId = new Map(raw.map((x) => [x.id, x]));
const sourceSha = createHash('sha256').update(JSON.stringify(raw)).digest('hex');

const exercises = [];
const missing = [];

for (const [upstreamId, [name, group, mode]] of Object.entries(CURATED)) {
  const item = byId.get(upstreamId);
  if (!item) {
    missing.push(upstreamId);
    continue;
  }
  exercises.push({
    id: 'ext-' + upstreamId.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
    name,
    group,
    equipment: EQUIPMENT_MAP[item.equipment] ?? '其他',
    mode,
    load: mode === 'load_reps' ? 'totalExternal' : 'bodyweight',
    level: item.level ?? null,
    mechanic: item.mechanic ?? null,
    // 不引入英文要领：中文界面里显示英文步骤会不一致，宁可留空由内容审核补写
    cues: [],
    source: {
      dataset: 'free-exercise-db',
      upstreamId,
      license: 'Unlicense',
      url: UPSTREAM_URL,
    },
  });
}

exercises.sort((a, b) => a.id.localeCompare(b.id));

const nameCount = new Map();
for (const e of exercises) nameCount.set(e.name, (nameCount.get(e.name) ?? 0) + 1);
const dupes = [...nameCount.entries()].filter(([, n]) => n > 1);

const pack = {
  packageId: PACKAGE_ID,
  version: PACKAGE_VERSION,
  title: '铁馆扩展动作包',
  description:
    '基于 free-exercise-db（公有领域）精选的动作子集，仅收录已确认中文名的动作，并按本项目模式标注。',
  license: {
    id: 'Unlicense',
    url: 'https://unlicense.org/',
    attribution:
      'Exercise data derived from free-exercise-db by yuhonas, released under the Unlicense.',
    upstream: UPSTREAM_URL,
    upstreamSha256: sourceSha,
    notice:
      'Unlicense 属公有领域奉献，可自由复制、修改、分发与商用，无署名义务；本文件保留来源以便追溯。',
    modifications: '仅做字段映射、中文名补充与跟踪模式标注，未改动作要领原文。',
  },
  generatedAt: new Date().toISOString(),
  counts: {
    upstreamTotal: raw.length,
    included: exercises.length,
    curated: Object.keys(CURATED).length,
    missingUpstream: missing.length,
    duplicateNames: dupes.length,
  },
  modeDistribution: exercises.reduce((acc, e) => {
    acc[e.mode] = (acc[e.mode] ?? 0) + 1;
    return acc;
  }, {}),
  exercises,
};

const canonicalBody = canonicalize({ ...pack, generatedAt: undefined, checksum: undefined });
pack.checksum = createHash('sha256').update(JSON.stringify(canonicalBody)).digest('hex');

const outDir = join(process.cwd(), 'src', 'content', 'packs');
await mkdir(outDir, { recursive: true });
await writeFile(join(outDir, 'exercises-ext.json'), JSON.stringify(pack, null, 2), 'utf8');

console.log('纳入 ' + exercises.length + ' 个动作（人工确认中文名）');
console.log('上游总数 ' + raw.length + '，未收录 ' + (raw.length - exercises.length));
console.log('模式分布: ' + JSON.stringify(pack.modeDistribution));
console.log('重名: ' + dupes.length + (dupes.length ? ' → ' + dupes.map((d) => d[0]).join(', ') : ''));
if (missing.length) console.log('上游缺失: ' + missing.join(', '));
console.log('checksum: ' + pack.checksum.slice(0, 16) + '…');




