/**
 * 动作示意图。
 *
 * 数据来自 free-exercise-db（Unlicense，可商用、可离线打包）。
 *
 * 上游每个动作给两帧：`0.jpg` 起始姿势、`1.jpg` 终点姿势。
 * 两帧交替显示就能表达动作轨迹——比单张静图有用得多，
 * 而且不用视频，包体只多 5 MB。
 *
 * 命名约定：
 *   `<exerciseId>.jpg`   第一帧（起始）
 *   `<exerciseId>-b.jpg` 第二帧（终点，缺失时界面退回单帧）
 *
 * 为什么不用在线图片：这是本地优先应用，训练时经常没有网络，
 * 示意图必须在包里。
 */

const files = import.meta.glob('../assets/exercise/*.jpg', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

const FRAMES = new Map<string, { a: string; b: string | null }>();
for (const [path, url] of Object.entries(files)) {
  const base = path.split('/').pop()?.replace(/\.jpg$/, '') ?? '';
  if (!base) continue;
  if (base.endsWith('-b')) {
    const id = base.slice(0, -2);
    const cur = FRAMES.get(id) ?? { a: '', b: null };
    FRAMES.set(id, { ...cur, b: url });
  } else {
    const cur = FRAMES.get(base) ?? { a: '', b: null };
    FRAMES.set(base, { ...cur, a: url });
  }
}

/** 第一帧；没有图返回 null，界面退回"要领文字"模式。 */
export function demoImage(exerciseId: string): string | null {
  const f = FRAMES.get(exerciseId);
  return f?.a ? f.a : null;
}

/**
 * 两帧都齐时返回 [起始, 终点]，否则返回 null。
 * 调用方据此决定是否做交替动画。
 */
export function demoFrames(exerciseId: string): [string, string] | null {
  const f = FRAMES.get(exerciseId);
  if (!f?.a || !f.b) return null;
  return [f.a, f.b];
}

export const DEMO_ATTRIBUTION = '示意图：free-exercise-db（Unlicense）';
