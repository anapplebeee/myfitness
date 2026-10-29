/**
 * 抓取动作示意图的**第二帧**（终点姿势）。
 *
 * 背景：free-exercise-db 每个动作给两张图——
 * `0.jpg` 起始姿势、`1.jpg` 终点姿势。项目此前只打包了第一帧，
 * 白白浪费了现成的"动作轨迹"信息。
 *
 * 难点：本地动作 id 是自定义的（`bb-squat`），上游 id 是
 * `Barbell_Squat`，两者没有直接映射。
 * 这里用**中文名**做桥：exercises.ts 里 id → 中文名，
 * build-exercise-pack.mjs 的 CURATED 里 上游id → 中文名，
 * 两边按中文名对齐。
 *
 * 对不上的不报错、不猜：跳过并打印出来，界面会退回单帧。
 *
 * 用法：node scripts/fetch-exercise-frames.mjs [--dry]
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = process.cwd();
const OUT_DIR = join(ROOT, 'src', 'assets', 'exercise');
const UPSTREAM = 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises';
const DRY = process.argv.includes('--dry');

/** 从 exercises.ts 里抽 `e('id', '名称', ...)`。 */
function parseBuiltins(source) {
  const out = new Map();
  const re = /e\('([^']+)',\s*'([^']+)'/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    out.set(m[1], m[2]);
  }
  return out;
}

/** 从 build-exercise-pack.mjs 的 CURATED 里抽 `上游id: ['中文名', ...]`。 */
function parseCurated(source) {
  const out = new Map();
  // 形如：  Barbell_Squat: ['杠铃深蹲', 'legs', 'load_reps'],
  // 也支持带引号的键：'Dips_-_Chest_Version': ['双杠臂屈伸（胸）', ...]
  const re = /^\s*'?([A-Za-z0-9_\-]+)'?:\s*\['([^']+)'/gm;
  let m;
  while ((m = re.exec(source)) !== null) {
    out.set(m[1], m[2]);
  }
  return out;
}

async function head(url) {
  const res = await fetch(url, { method: 'HEAD' });
  return { ok: res.ok, size: Number(res.headers.get('content-length') ?? 0) };
}

async function main() {
  const exercisesTs = await readFile(join(ROOT, 'src', 'content', 'exercises.ts'), 'utf8');
  const packScript = await readFile(join(ROOT, 'scripts', 'build-exercise-pack.mjs'), 'utf8');

  const builtins = parseBuiltins(exercisesTs);
  const curated = parseCurated(packScript);

  // 中文名 → 上游 id
  const byName = new Map();
  for (const [upstreamId, name] of curated) byName.set(name, upstreamId);

  const matched = [];
  const unmatched = [];

  /*
   * 扩展包里有精确的 upstreamId，直接用，不用猜。
   * 这些动作的 id 是 `ext-<slug>`，中文名与上游一一对应过。
   */
  const packJson = JSON.parse(
    await readFile(join(ROOT, 'src', 'content', 'packs', 'exercises-ext.json'), 'utf8'),
  );
  for (const ex of packJson.exercises) {
    if (ex.source?.upstreamId) {
      matched.push({ localId: ex.id, name: ex.name, upstreamId: ex.source.upstreamId });
    }
  }

  // 内置动作没有 upstreamId，只能按中文名对；对不上的保持单帧。
  for (const [localId, name] of builtins) {
    const upstreamId = byName.get(name);
    if (upstreamId) matched.push({ localId, name, upstreamId });
    else unmatched.push({ localId, name });
  }


  console.log(`内置动作 ${builtins.size} 个，CURATED ${curated.size} 条`);
  console.log(`按中文名对上 ${matched.length} 个，对不上 ${unmatched.length} 个`);
  if (unmatched.length > 0) {
    console.log('对不上的（保持单帧）：');
    for (const u of unmatched) console.log(`  ${u.localId}  ${u.name}`);
  }
  if (DRY) return;

  await mkdir(OUT_DIR, { recursive: true });

  let ok = 0;
  let skipped = 0;
  let bytes = 0;

  for (const item of matched) {
    const url = `${UPSTREAM}/${encodeURIComponent(item.upstreamId)}/1.jpg`;
    try {
      const res = await fetch(url);
      if (!res.ok) {
        console.log(`  缺图 ${item.upstreamId}: HTTP ${res.status}`);
        skipped += 1;
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      // 上游有的条目复用同一张图（作者注明的重复图片），跳过体积极小的
      if (buf.length < 2000) {
        skipped += 1;
        continue;
      }
      await writeFile(join(OUT_DIR, `${item.localId}-b.jpg`), buf);
      bytes += buf.length;
      ok += 1;
    } catch (err) {
      console.log(`  失败 ${item.upstreamId}: ${err.message}`);
      skipped += 1;
    }
  }

  console.log(`\n写入 ${ok} 张，跳过 ${skipped} 张，共 ${(bytes / 1024 / 1024).toFixed(2)} MB`);
}

await main();
